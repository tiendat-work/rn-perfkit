/**
 * Turn measurements into pass / warn / fail findings with advice. Pure — the
 * thresholds and wording are unit-tested. Every rule of thumb here comes from
 * a measurement (see the repo RESEARCH.md and each `why`).
 */
import type { GfxStats, GpuInfo } from './native';
import type { ProfileSummary } from './profile';

export type Status = 'pass' | 'warn' | 'fail' | 'info' | 'skip';

export type Finding = {
  id: string;
  title: string;
  status: Status;
  value?: string;
  advice?: string;
};

export type Env = {
  dev: boolean | null;
  hermes: boolean;
  fabric: boolean;
  bridgeless: boolean;
  devtoolsHook: boolean;
  rnVersion: string | null;
};

export type Census = {
  fibers: number;
  host: number;
  byType: Array<[string, number]>;
  byOwner: Array<[string, number]>;
};

export type Sample = {
  seconds: number;
  jsFps: number;
  p50: number;
  p90: number;
  p99: number;
  max: number;
  over33: number;
  over100: number;
  commits: number;
  commitsPerSec: number;
  commitOrigins: Array<[string, number]>;
  warnCount: number;
  errorCount: number;
  warnings: Array<[string, number]>;
};

export const THRESHOLDS = {
  hostViews: { warn: 1500, fail: 3000 },
  idleCommitsPerSec: { warn: 2, fail: 10 },
  idleJsFps: { warn: 55, fail: 45 },
  scrollJsFps: { warn: 50, fail: 35 },
  scrollMaxGapMs: { warn: 100, fail: 250 },
  gfxP99Ms: { warn: 50, fail: 100 },
  gfxP50Ms: { warn: 20, fail: 34 },
  commitP50Ms: { warn: 16, fail: 33 },
};

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();

export function checkEnv(env: Env): Finding[] {
  const out: Finding[] = [];
  out.push({
    id: 'build-mode',
    title: 'Build mode',
    status: env.dev ? 'info' : 'pass',
    value: env.dev ? 'Debug (__DEV__)' : 'Release',
    advice: env.dev
      ? 'Debug JS timings are NOT representative. Measured: the same gallery scrolled at 25-28 JS fps in Debug and 58-60 in Release (iOS sim). Confirm any JS-thread finding in a Release build before optimising.'
      : undefined,
  });
  out.push({
    id: 'engine',
    title: 'JS engine / architecture',
    status: env.hermes ? 'pass' : 'warn',
    value: `${env.hermes ? 'Hermes' : 'not Hermes'}${env.fabric ? ', Fabric' : ''}${env.bridgeless ? ', bridgeless' : ''}${env.rnVersion ? `, RN ${env.rnVersion}` : ''}`,
    advice: env.hermes ? undefined : 'Hermes is the default engine; JSC/remote debugging change timings.',
  });
  return out;
}

export function checkCensus(c: Census): Finding[] {
  const { warn, fail } = THRESHOLDS.hostViews;
  const status: Status = c.host >= fail ? 'fail' : c.host >= warn ? 'warn' : 'pass';
  const owners = c.byOwner
    .slice(0, 5)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');
  return [
    {
      id: 'host-views',
      title: 'Mounted native views',
      status,
      value: `${c.host} host views / ${c.fibers} fibers`,
      advice:
        status === 'pass'
          ? undefined
          : `Fabric commit cost on the JS thread scales with mounted host views (measured: ~2950 views → 40-75ms per commit in Debug). Biggest owners: ${owners}. Virtualise off-screen content, flatten wrapper Views, merge SVG elements into one <Path>.`,
    },
  ];
}

export function checkIdle(s: Sample): Finding[] {
  const out: Finding[] = [];
  const cps = THRESHOLDS.idleCommitsPerSec;
  const cStatus: Status = s.commitsPerSec >= cps.fail ? 'fail' : s.commitsPerSec >= cps.warn ? 'warn' : 'pass';
  const origins = s.commitOrigins
    .slice(0, 4)
    .map(([k, v]) => `${k} ×${v}`)
    .join(', ');
  out.push({
    id: 'idle-commits',
    title: 'React commits while idle',
    status: cStatus,
    value: `${f1(s.commitsPerSec)}/s (${s.commits} in ${f1(s.seconds)}s)`,
    advice:
      cStatus === 'pass'
        ? undefined
        : `Something re-renders with nobody touching the screen: ${origins || 'unknown origin'}. Typical: a timer/interval setState (loaders), a subscription firing, a context value recreated every render.`,
  });
  const f = THRESHOLDS.idleJsFps;
  const fStatus: Status = s.jsFps < f.fail ? 'fail' : s.jsFps < f.warn ? 'warn' : 'pass';
  out.push({
    id: 'idle-js-fps',
    title: 'JS frame pacing while idle',
    status: fStatus,
    value: `${f1(s.jsFps)} fps, p99 ${f1(s.p99)}ms, max ${f1(s.max)}ms`,
    advice: fStatus === 'pass' ? undefined : 'The JS thread is busy with no input. Profile with --profile to see which functions.',
  });
  out.push(...checkWarnings(s));
  return out;
}

export function checkWarnings(s: Sample): Finding[] {
  if (!s.warnCount && !s.errorCount) return [{ id: 'dev-warnings', title: 'Dev warnings / errors', status: 'pass', value: '0' }];
  const top = s.warnings
    .slice(0, 3)
    .map(([k, v]) => `${v}× "${k}"`)
    .join('; ');
  const reanimated = s.warnings.some(([k]) => /shared value.*inline style/i.test(k));
  return [
    {
      id: 'dev-warnings',
      title: 'Dev warnings / errors',
      status: s.errorCount ? 'fail' : 'warn',
      value: `${s.warnCount} warn, ${s.errorCount} error`,
      advice:
        `Each console.warn/error costs JS time and shows a LogBox toast. Top: ${top}.` +
        (reanimated
          ? ' The Reanimated inline-style warning fires for ANY `style={{ x: obj.value }}` — destructure plain fields (eslint-plugin-rn-perfkit: no-value-in-inline-style).'
          : ''),
    },
  ];
}

export function checkScroll(s: Sample, env: Env): Finding[] {
  const f = THRESHOLDS.scrollJsFps;
  const g = THRESHOLDS.scrollMaxGapMs;
  const fps: Status = s.jsFps < f.fail ? 'fail' : s.jsFps < f.warn ? 'warn' : 'pass';
  const gap: Status = s.max >= g.fail ? 'fail' : s.max >= g.warn ? 'warn' : 'pass';
  const status: Status = fps === 'fail' || gap === 'fail' ? 'fail' : fps === 'warn' || gap === 'warn' ? 'warn' : 'pass';
  const origins = s.commitOrigins
    .slice(0, 4)
    .map(([k, v]) => `${k} ×${v}`)
    .join(', ');
  let advice: string | undefined;
  if (status !== 'pass') {
    advice = `JS thread stalls while scrolling (${s.over100} frames >100ms). Commits: ${s.commits} (${origins}).`;
    if (env.dev) advice += ' This is a Debug build — re-measure in Release before optimising (Debug overstated this ~2x in our measurements).';
    advice +=
      ' If commits come from FlashList with heterogeneous items, add getItemType + a memo cell (eslint-plugin-rn-perfkit: flashlist-heterogeneous-item-type).';
  }
  return [
    {
      id: 'scroll-js',
      title: 'JS thread while scrolling',
      status,
      value: `${f1(s.jsFps)} fps, p99 ${f1(s.p99)}ms, max ${f1(s.max)}ms, ${s.commits} commits`,
      advice,
    },
  ];
}

export function checkProfile(p: ProfileSummary, env: Env): Finding[] {
  const busyPct = p.totalMs ? (100 * p.busyMs) / p.totalMs : 0;
  const top = p.topSelf
    .slice(0, 4)
    .map(([k, v]) => `${k} ${f1(v)}ms`)
    .join(', ');
  const out: Finding[] = [
    { id: 'cpu-busy', title: 'JS CPU busy (sampled)', status: 'info', value: `${f1(busyPct)}% of ${f1(p.totalMs)}ms`, advice: `Top self time: ${top}` },
  ];
  if (p.commit.runs) {
    const c = THRESHOLDS.commitP50Ms;
    const status: Status = p.commit.p50 >= c.fail ? 'fail' : p.commit.p50 >= c.warn ? 'warn' : 'pass';
    const share = p.busyMs ? (100 * p.commit.totalMs) / p.busyMs : 0;
    out.push({
      id: 'fabric-commit',
      title: 'Fabric commit (completeRoot) on JS',
      status,
      value: `${p.commit.runs} commits, p50 ${f1(p.commit.p50)}ms, p90 ${f1(p.commit.p90)}ms, ${f1(share)}% of busy time`,
      advice:
        status === 'pass'
          ? undefined
          : `Commit cost grows with mounted host views. Reduce the tree (see host-views)${env.dev ? '; Debug adds large DEV overhead here — confirm in Release' : ''}.`,
    });
  }
  return out;
}

export function checkAndroidGpu(gpu: GpuInfo | undefined, emulator: boolean): Finding[] {
  if (!gpu) return [{ id: 'android-gpu', title: 'Android GPU renderer', status: 'skip', value: 'could not read SurfaceFlinger' }];
  return [
    {
      id: 'android-gpu',
      title: 'Android GPU renderer',
      status: gpu.software ? 'fail' : 'pass',
      value: gpu.renderer,
      advice: gpu.software
        ? `${emulator ? 'The emulator' : 'The device'} rasterises on the CPU. Every screen janks at idle (measured: 98% janky frames, p50 85ms) and app-side fixes won't show. Restart with \`emulator -avd <name> -gpu host\` and set Graphics = Hardware in the AVD settings.`
        : undefined,
    },
  ];
}

export function checkGfx(label: string, g: GfxStats | undefined, env: Env): Finding[] {
  if (!g || !g.totalFrames) return [{ id: `gfx-${label}`, title: `Android frames (${label})`, status: 'skip', value: 'no frames recorded' }];
  const p99 = THRESHOLDS.gfxP99Ms;
  const p50 = THRESHOLDS.gfxP50Ms;
  const status: Status =
    g.p99 >= p99.fail || g.p50 >= p50.fail ? 'fail' : g.p99 >= p99.warn || g.p50 >= p50.warn ? 'warn' : 'pass';
  return [
    {
      id: `gfx-${label}`,
      title: `Android frames (${label})`,
      status,
      value: `${g.totalFrames} frames, p50 ${g.p50}ms, p90 ${g.p90}ms, p99 ${g.p99}ms, slow UI thread ${g.slowUiThread}`,
      advice:
        status === 'pass'
          ? undefined
          : `Compare percentiles, not the janky %, which stays high on Debug builds.${env.dev ? ' Debug build: confirm in Release.' : ''} Blank cells while flinging a heterogeneous FlashList → getItemType.`,
    },
  ];
}
