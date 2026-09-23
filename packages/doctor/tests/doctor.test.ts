import { describe, expect, it } from "vitest";

import {
  checkAndroidGpu,
  checkCensus,
  checkEnv,
  checkGfx,
  checkIdle,
  checkInteraction,
  checkProfile,
  checkScroll,
  type Env,
  type Sample,
} from "../src/checks";
import {
  isReactRuntime,
  pickTarget,
  targetInfo,
  type MetroTarget,
} from "../src/metro";
import { parseGfxinfo, parseGles } from "../src/native";
import { summarizeProfile, type CpuProfile } from "../src/profile";
import { exitCode, renderText } from "../src/report";

const devEnv: Env = {
  dev: true,
  hermes: true,
  fabric: true,
  bridgeless: true,
  devtoolsHook: true,
  rnVersion: "0.81.5",
};
const relEnv: Env = { ...devEnv, dev: false };

const sample = (over: Partial<Sample> = {}): Sample => ({
  seconds: 5,
  jsFps: 60,
  p50: 16.7,
  p90: 17,
  p99: 18,
  max: 20,
  over33: 0,
  over100: 0,
  commits: 0,
  commitsPerSec: 0,
  commitOrigins: [],
  warnCount: 0,
  errorCount: 0,
  warnings: [],
  ...over,
});

describe("metro targets", () => {
  // Real /json/list shape from an RN 0.81 bridgeless iOS sim.
  const targets: MetroTarget[] = [
    {
      id: "1",
      title: "com.english.app (iPhone 17 Pro)",
      description: "React Native Bridgeless [C++ connection]",
      webSocketDebuggerUrl: "ws://a",
    },
    {
      id: "2",
      title: "com.english.app (iPhone 17 Pro)",
      description: "UI [C++ connection]",
      webSocketDebuggerUrl: "ws://b",
    },
    {
      id: "3",
      title: "com.english.app (sdk_gphone16k_arm64)",
      description: "React Native Bridgeless [C++ connection]",
      webSocketDebuggerUrl: "ws://c",
    },
  ];
  it("keeps only the React runtime pages", () => {
    expect(targets.filter(isReactRuntime).map((t) => t.id)).toEqual(["1", "3"]);
  });
  it("picks by device substring", () => {
    expect(pickTarget(targets, "gphone")?.id).toBe("3");
    expect(pickTarget(targets)?.id).toBe("1");
    expect(pickTarget(targets, "pixel")).toBeUndefined();
  });
  it("parses app id and device from the title", () => {
    expect(targetInfo(targets[0])).toEqual({
      appId: "com.english.app",
      deviceName: "iPhone 17 Pro",
    });
  });
});

describe("android parsers", () => {
  it("flags a software GPU (SwiftShader) and passes a real one", () => {
    const sw = parseGles(
      "GLES: Google (Google Inc. (Google)), Android Emulator OpenGL ES Translator (ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver-5.0.0)), OpenGL ES 3.1",
    );
    expect(sw?.software).toBe(true);
    const hw = parseGles(
      "GLES: Google (Apple), Android Emulator OpenGL ES Translator (Apple M3 Pro), OpenGL ES 3.0 (4.1 Metal - 90.5)",
    );
    expect(hw?.software).toBe(false);
    expect(checkAndroidGpu(sw, true)[0].status).toBe("fail");
    expect(checkAndroidGpu(hw, true)[0].status).toBe("pass");
  });

  it("parses gfxinfo percentiles", () => {
    const out = `Total frames rendered: 167
Janky frames: 164 (98.20%)
Janky frames (legacy): 150 (89.82%)
50th percentile: 85ms
90th percentile: 150ms
95th percentile: 150ms
99th percentile: 200ms
50th gpu percentile: 15ms
Number Slow UI thread: 92`;
    const g = parseGfxinfo(out)!;
    expect(g).toMatchObject({
      totalFrames: 167,
      jankyFrames: 164,
      jankyPct: 98.2,
      p50: 85,
      p90: 150,
      p99: 200,
      slowUiThread: 92,
    });
    expect(checkGfx("fling", g, devEnv)[0].status).toBe("fail");
    expect(
      checkGfx("fling", { ...g, p50: 16, p90: 22, p95: 25, p99: 40 }, devEnv)[0]
        .status,
    ).toBe("pass");
  });

  it("returns undefined for garbage", () => {
    expect(parseGfxinfo("No process found for: com.x")).toBeUndefined();
  });
});

describe("checks", () => {
  it("debug build is flagged as info with a release caveat", () => {
    const [mode] = checkEnv(devEnv);
    expect(mode.status).toBe("info");
    expect(mode.advice).toMatch(/Release/);
    expect(checkEnv(relEnv)[0].status).toBe("pass");
  });

  it("host-view thresholds", () => {
    const c = (host: number) =>
      checkCensus({
        fibers: host * 3,
        host,
        byType: [],
        byOwner: [["PixelFrame", 300]],
      })[0].status;
    expect(c(800)).toBe("pass");
    expect(c(2000)).toBe("warn");
    expect(c(3089)).toBe("fail");
  });

  it("idle commits name their origin", () => {
    const f = checkIdle(
      sample({
        commits: 60,
        commitsPerSec: 12,
        commitOrigins: [["Spinner", 60]],
      }),
    );
    const commits = f.find((x) => x.id === "idle-commits")!;
    expect(commits.status).toBe("fail");
    expect(commits.advice).toContain("Spinner");
  });

  it("recognises the Reanimated inline-style warning", () => {
    const f = checkIdle(
      sample({
        warnCount: 27,
        warnings: [
          [
            "It looks like you might be using shared value's .value inside reanimated inline style.",
            27,
          ],
        ],
      }),
    ).find((x) => x.id === "dev-warnings")!;
    expect(f.status).toBe("warn");
    expect(f.advice).toContain("no-value-in-inline-style");
  });

  it("scroll: debug stall fails with a release caveat; smooth passes", () => {
    const bad = checkScroll(
      sample({ jsFps: 35.2, max: 456, over100: 37, commits: 237 }),
      devEnv,
    )[0];
    expect(bad.status).toBe("fail");
    expect(bad.advice).toMatch(/Release/);
    expect(checkScroll(sample({ jsFps: 59, max: 45 }), relEnv)[0].status).toBe(
      "pass",
    );
  });

  it("record: grades the interaction window and lists commit origins", () => {
    // Numbers from the gorhom sheet bench (Android emulator, debug).
    const [js, commits] = checkInteraction(
      sample({
        jsFps: 32.2,
        p99: 148,
        max: 329,
        over100: 18,
        commits: 36,
        commitOrigins: [
          ["ViewHolderCollection", 14],
          ["PixelSheetBackground", 7],
        ],
      }),
      devEnv,
    );
    expect(js.status).toBe("fail");
    expect(js.advice).toMatch(/Debug build/);
    expect(commits.status).toBe("info");
    expect(commits.value).toContain("ViewHolderCollection ×14");
    expect(
      checkInteraction(sample({ jsFps: 59, max: 40 }), relEnv)[0].status,
    ).toBe("pass");
  });

  it("exit code honours --fail-on", () => {
    const f = [{ id: "a", title: "a", status: "warn" as const }];
    expect(exitCode(f, "fail")).toBe(0);
    expect(exitCode(f, "warn")).toBe(1);
    expect(
      exitCode([{ id: "b", title: "b", status: "fail" as const }], "never"),
    ).toBe(0);
  });

  it("renders a plain-text report with a summary line", () => {
    const txt = renderText({
      tool: "react-native-perfkit",
      version: "0.0.0",
      createdAt: "",
      target: { title: "app (sim)" },
      findings: [
        ...checkEnv(devEnv),
        ...checkCensus({ fibers: 9000, host: 3089, byType: [], byOwner: [] }),
      ],
      raw: {},
    });
    expect(txt).toContain("FAIL  Mounted native views: 3089");
    expect(txt).toMatch(/Summary: 1 fail, 0 warn, 1 pass/);
  });
});

describe("cpu profile summary", () => {
  // Tiny synthetic profile: root → app fn → completeRoot (host), with idle samples.
  const profile: CpuProfile = {
    nodes: [
      {
        id: 1,
        callFrame: { functionName: "[root]", url: "", lineNumber: 0 },
        children: [2, 4],
      },
      {
        id: 2,
        callFrame: {
          functionName: "performWorkOnRoot",
          url: "http://localhost:8081/index.bundle?platform=ios",
          lineNumber: 10,
        },
        children: [3],
      },
      {
        id: 3,
        callFrame: {
          functionName: "[Host Function] completeRoot",
          url: "[host]",
          lineNumber: 0,
        },
      },
      {
        id: 4,
        callFrame: {
          functionName: "recycle",
          url: "http://localhost:8081/node_modules/@shopify/flash-list/dist/x.js",
          lineNumber: 5,
        },
      },
    ],
    // 3 samples completeRoot (one run), idle, completeRoot x2 (second run), flash-list
    samples: [3, 3, 3, 1, 3, 3, 4, 2],
    timeDeltas: [10000, 10000, 10000, 5000, 20000, 20000, 3000, 2000],
  };
  it("buckets self time and measures commit runs", () => {
    const s = summarizeProfile(profile);
    expect(s.totalMs).toBe(80);
    expect(s.idleMs).toBe(5);
    expect(s.byBucket[0]).toEqual(["host", 70]);
    expect(s.byBucket.map(([k]) => k)).toContain("@shopify/flash-list");
    expect(s.commit.runs).toBe(2);
    expect(s.commit.totalMs).toBe(70);
    expect(s.commit.max).toBe(40);
    const f = checkProfile(s, devEnv).find((x) => x.id === "fabric-commit")!;
    expect(f.status).toBe("fail");
  });
});
