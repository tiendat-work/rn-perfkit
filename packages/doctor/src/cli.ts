#!/usr/bin/env node
/**
 * react-native-perfkit — React Native performance doctor.
 *
 *   react-native-perfkit doctor [--device <name>] [--idle 5] [--no-scroll] [--profile out.cpuprofile]
 *                     [--json] [--out report.json] [--fail-on fail|warn|never] [--metro http://localhost:8081]
 *   react-native-perfkit targets
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { listTargets, runDoctor, runRecord } from "./doctor";
import { isReactRuntime } from "./metro";
import { exitCode, renderText } from "./report";

const HELP = `react-native-perfkit — on-device React Native performance doctor

Usage:
  react-native-perfkit doctor [options]   measure the app on a connected device/simulator
  react-native-perfkit record [options]   sample one interaction window (open a sheet, drag,
                                          navigate) while adb or you drive it
  react-native-perfkit targets            list Metro inspector targets

Doctor options:
  --metro <url>        Metro dev server (default http://localhost:8081)
  --device <text>      pick a target by device name / app id (default: first RN runtime)
  --idle <seconds>     idle sampling window (default 5)
  --park <px|%>        scroll the main list there first (e.g. 4000 or 60%) so the idle
                       window measures a specific region reproducibly
  --no-scroll          skip the scroll benchmark
  --passes <n>         scroll passes down+up (default 1)
  --step <ms>          delay between scroll steps (default 450)
  --profile [file]     Hermes CPU profile during the scroll (optionally save .cpuprofile)
  --no-android         skip adb checks (GPU renderer, gfxinfo)
  --json               print the report as JSON
  --out <file>         also write the JSON report to a file
  --fail-on <level>    exit 1 on: fail (default) | warn | never

Record options:
  --seconds <n>        window length (default 5)
  --adb "<cmds>"       Android: adb shell commands run at the start, ';'-separated,
                       'sleep <s>' allowed (e.g. "input tap 600 1400; sleep 1.5; input swipe 600 1400 600 2600 300")
  --device, --metro, --json, --out, --fail-on, --no-android as for doctor

The app must be a dev build connected to Metro (the JS probes run over CDP).
Debug-build timings overstate JS cost; confirm JS findings in a Release build.
`;

async function main(argv: string[]): Promise<number> {
  const cmd = argv[0];
  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
    process.stdout.write(HELP);
    return 0;
  }
  // `--profile` may be a bare flag or take a file: normalise before parseArgs.
  const rest = argv.slice(1);
  let profileFlag = false;
  let profileFile: string | undefined;
  const pi = rest.indexOf("--profile");
  if (pi !== -1) {
    profileFlag = true;
    const next = rest[pi + 1];
    if (next && !next.startsWith("--")) {
      profileFile = next;
      rest.splice(pi, 2);
    } else rest.splice(pi, 1);
  }
  const { values } = parseArgs({
    args: rest,
    allowPositionals: false,
    options: {
      metro: { type: "string", default: "http://localhost:8081" },
      device: { type: "string" },
      idle: { type: "string", default: "5" },
      park: { type: "string" },
      seconds: { type: "string", default: "5" },
      adb: { type: "string" },
      "no-scroll": { type: "boolean", default: false },
      passes: { type: "string", default: "1" },
      step: { type: "string", default: "450" },
      "no-android": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      out: { type: "string" },
      "fail-on": { type: "string", default: "fail" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }

  if (cmd === "targets") {
    const targets = await listTargets(values.metro!);
    for (const t of targets) {
      process.stdout.write(
        `${isReactRuntime(t) ? "*" : " "} ${t.title}  —  ${t.description ?? ""}\n`,
      );
    }
    process.stdout.write("\n* = React Native JS runtime (doctor target)\n");
    return 0;
  }

  if (cmd !== "doctor" && cmd !== "record") {
    process.stderr.write(`Unknown command "${cmd}".\n\n${HELP}`);
    return 2;
  }

  const failOn = values["fail-on"] as "fail" | "warn" | "never";
  if (!["fail", "warn", "never"].includes(failOn)) {
    process.stderr.write(`--fail-on must be fail | warn | never\n`);
    return 2;
  }
  const quiet = values.json;
  const log = (m: string) => {
    if (!quiet) process.stderr.write(`· ${m}\n`);
  };
  const report =
    cmd === "record"
      ? await runRecord({
          metro: values.metro!,
          device: values.device,
          seconds: Math.max(1, Number(values.seconds)),
          adb: values.adb,
          android: !values["no-android"],
          log,
        })
      : await runDoctor({
          metro: values.metro!,
          device: values.device,
          idleSeconds: Math.max(1, Number(values.idle)),
          scroll: !values["no-scroll"],
          scrollPasses: Math.max(1, Number(values.passes)),
          scrollStepMs: Math.max(50, Number(values.step)),
          profile: profileFlag,
          park: values.park,
          profileOut: profileFile,
          android: !values["no-android"],
          log,
        });

  if (values.out) writeFileSync(values.out, JSON.stringify(report, null, 2));
  if (values.json) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  else process.stdout.write(renderText(report, process.stdout.isTTY) + "\n");
  return exitCode(report.findings, failOn);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: Error) => {
    process.stderr.write(`react-native-perfkit: ${err.message}\n`);
    process.exit(2);
  },
);
