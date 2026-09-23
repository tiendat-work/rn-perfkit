/** Orchestrates one doctor run against a Metro-connected app. */
import { writeFileSync } from 'node:fs';

import { CdpClient, sleep, waitFor } from './cdp';
import {
  type Census,
  checkAndroidGpu,
  checkCensus,
  checkEnv,
  checkGfx,
  checkIdle,
  checkInteraction,
  checkProfile,
  checkScroll,
  type Env,
  type Finding,
  type Sample,
} from './checks';
import { fetchJson, type MetroTarget, pickTarget, targetInfo } from './metro';
import { adbPath, androidDevices, androidFling, androidGpu, bootedIosSims, exec, gfxRead, gfxReset } from './native';
import {
  censusProbe,
  envProbe,
  parkProbe,
  scrollDoneProbe,
  startSamplingProbe,
  startScrollProbe,
  stopSamplingProbe,
} from './probes';
import { type CpuProfile, summarizeProfile } from './profile';
import type { Report } from './report';

export type DoctorOptions = {
  metro: string;
  device?: string;
  idleSeconds: number;
  scroll: boolean;
  scrollPasses: number;
  scrollStepMs: number;
  profile: boolean;
  /** Park the main scroller before the idle window: px (e.g. '4000') or percent ('60%'). */
  park?: string;
  profileOut?: string;
  android: boolean;
  log: (msg: string) => void;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const VERSION: string = require('../package.json').version;

function platformOf(t: MetroTarget): 'ios' | 'android' | 'unknown' {
  const s = `${t.title} ${t.deviceName ?? ''}`;
  if (/iPhone|iPad|iOS/i.test(s)) return 'ios';
  if (/sdk_gphone|Android|Pixel|emulator|SM-|Galaxy/i.test(s)) return 'android';
  return 'unknown';
}

export async function listTargets(metro: string): Promise<MetroTarget[]> {
  return fetchJson<MetroTarget[]>(`${metro.replace(/\/$/, '')}/json/list`);
}

export async function runDoctor(opts: DoctorOptions): Promise<Report> {
  const findings: Finding[] = [];
  const raw: Record<string, unknown> = {};

  let targets: MetroTarget[];
  try {
    targets = await listTargets(opts.metro);
  } catch (e) {
    throw new Error(`Cannot reach Metro at ${opts.metro} (${(e as Error).message}). Start the dev server and open the app.`);
  }
  const target = pickTarget(targets, opts.device);
  if (!target) {
    const list = targets.map((t) => `  - ${t.title} (${t.description ?? ''})`).join('\n') || '  (none)';
    throw new Error(`No React Native runtime target${opts.device ? ` matching "${opts.device}"` : ''}. Targets:\n${list}`);
  }
  const info = targetInfo(target);
  const platform = platformOf(target);
  opts.log(`target: ${target.title} [${platform}]`);

  const cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
  try {
    await cdp.send('Runtime.enable').catch(() => undefined);

    // 1. environment
    const env = await cdp.evaluateJson<Env & { renderers: number[] }>(envProbe);
    raw.env = env;
    findings.push(...checkEnv(env));
    if (!env.devtoolsHook) {
      findings.push({
        id: 'devtools-hook',
        title: 'React DevTools hook',
        status: 'skip',
        value: 'not present',
        advice: 'Fiber-based checks (views, commits) need a dev build with the DevTools hook.',
      });
    }

    // 1b. park: scroll to a fixed spot first so the idle window is reproducible
    if (opts.park) {
      const m = opts.park.trim().match(/^(\d+(?:\.\d+)?)(%)?$/);
      if (!m) throw new Error(`--park expects px or percent, got "${opts.park}"`);
      const fraction = !!m[2];
      const at = fraction ? Number(m[1]) / 100 : Number(m[1]);
      opts.log(`park: scrolling main list to ${opts.park}`);
      const started = await cdp.evaluateJson<{ ok: boolean; reason?: string }>(parkProbe(at, fraction));
      if (!started.ok) throw new Error(`--park: ${started.reason}`);
      const parked = await waitFor(async () => {
        const s = await cdp.evaluateJson<{ done: boolean; y: number | null; contentHeight: number | null }>(scrollDoneProbe);
        return s.done ? s : undefined;
      }, 5000, 200);
      raw.park = parked;
      // let the list mount cells at the new offset and loaders start
      await sleep(2500);
    }

    // 2. host-view census
    if (env.devtoolsHook) {
      opts.log('census: walking the fiber tree');
      const census = await cdp.evaluateJson<Census & { error?: string }>(censusProbe(12));
      raw.census = census;
      if (!census.error) findings.push(...checkCensus(census));
    }

    // 3. Android native checks
    let serial: string | undefined;
    if (opts.android && platform === 'android') {
      const devs = await androidDevices();
      const dev = devs.find((d) => d.emulator) ?? devs[0];
      if (dev) {
        serial = dev.serial;
        const gpu = await androidGpu(dev.serial);
        raw.androidGpu = gpu;
        findings.push(...checkAndroidGpu(gpu, dev.emulator));
      } else {
        findings.push({ id: 'android-gpu', title: 'Android GPU renderer', status: 'skip', value: 'no adb device' });
      }
    }

    // 4. idle window (optionally profiled)
    opts.log(`idle: sampling ${opts.idleSeconds}s without input`);
    if (serial && info.appId) await gfxReset(serial, info.appId);
    await cdp.evaluateJson(startSamplingProbe);
    await sleep(opts.idleSeconds * 1000);
    const idle = await cdp.evaluateJson<Sample>(stopSamplingProbe);
    raw.idle = idle;
    findings.push(...checkIdle(idle));
    if (serial && info.appId) {
      const g = await gfxRead(serial, info.appId);
      raw.gfxIdle = g;
      findings.push(...checkGfx('idle', g, env));
    }

    // 5. scroll window (JS-driven), profiled if requested
    if (opts.scroll) {
      opts.log('scroll: driving the first mounted list/ScrollView');
      // Hermes rejects Profiler.enable ('Unsupported method') but supports start/stop.
      if (opts.profile) await cdp.send('Profiler.enable').catch(() => undefined);
      await cdp.evaluateJson(startSamplingProbe);
      if (opts.profile) await cdp.send('Profiler.start');
      const started = await cdp.evaluateJson<{ ok: boolean; reason?: string; kind?: string; subtreeHostViews?: number }>(
        startScrollProbe({ passes: opts.scrollPasses, stepMs: opts.scrollStepMs }),
      );
      raw.scrollDriver = started;
      if (!started.ok) {
        await cdp.evaluateJson(stopSamplingProbe);
        if (opts.profile) await cdp.send('Profiler.stop').catch(() => undefined);
        findings.push({ id: 'scroll-js', title: 'JS thread while scrolling', status: 'skip', value: started.reason });
      } else {
        // Step count is known only after the content is measured; allow up to 200 steps.
        const status = await waitFor(async () => {
          const s = await cdp.evaluateJson<{ done: boolean; steps: number; total: number; contentHeight: number | null }>(scrollDoneProbe);
          return s.done ? s : undefined;
        }, 200 * opts.scrollStepMs + 15000);
        raw.scrollDone = status;
        let profile: CpuProfile | undefined;
        if (opts.profile) profile = (await cdp.send('Profiler.stop', {}, 60000)).result?.profile as CpuProfile;
        const scroll = await cdp.evaluateJson<Sample>(stopSamplingProbe);
        raw.scroll = scroll;
        findings.push(...checkScroll(scroll, env));
        if (profile) {
          if (opts.profileOut) {
            writeFileSync(opts.profileOut, JSON.stringify(profile));
            opts.log(`profile written: ${opts.profileOut} (open in Chrome DevTools → Performance)`);
          }
          const summary = summarizeProfile(profile);
          raw.profile = summary;
          findings.push(...checkProfile(summary, env));
        }
      }
    }

    // 6. Android real-input fling (gfxinfo), independent of the JS driver
    if (serial && info.appId && opts.scroll) {
      opts.log('android: adb input fling + gfxinfo');
      await gfxReset(serial, info.appId);
      await androidFling(serial, 8, 4);
      await sleep(800);
      const g = await gfxRead(serial, info.appId);
      raw.gfxFling = g;
      findings.push(...checkGfx('fling', g, env));
    }

    if (platform === 'ios') {
      const sims = await bootedIosSims();
      raw.iosSims = sims;
    }
  } finally {
    cdp.close();
  }

  return {
    tool: 'react-native-perfkit',
    version: VERSION,
    createdAt: new Date().toISOString(),
    target: { title: target.title, ...info, platform },
    findings,
    raw,
  };
}

export type RecordOptions = {
  metro: string;
  device?: string;
  seconds: number;
  /** adb shell commands run (in order, `;`-separated) at the start of the window. */
  adb?: string;
  android: boolean;
  log: (msg: string) => void;
};

/**
 * Sample one interaction window: JS frame pacing + React commits (and their
 * origins) + Android gfxinfo, for `seconds`. Something else drives the
 * interaction: `--adb "input tap 500 1200; sleep 1; input swipe ..."` on Android,
 * or a human on any platform. This is how you measure things the scroll driver
 * can't reach (opening a sheet, dragging it, a navigation transition).
 */
export async function runRecord(opts: RecordOptions): Promise<Report> {
  const findings: Finding[] = [];
  const raw: Record<string, unknown> = {};
  const targets = await listTargets(opts.metro);
  const target = pickTarget(targets, opts.device);
  if (!target) throw new Error(`No React Native runtime target${opts.device ? ` matching "${opts.device}"` : ''}.`);
  const info = targetInfo(target);
  const platform = platformOf(target);
  opts.log(`target: ${target.title} [${platform}]`);

  const cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
  try {
    await cdp.send('Runtime.enable').catch(() => undefined);
    const env = await cdp.evaluateJson<Env & { renderers: number[] }>(envProbe);
    raw.env = env;
    findings.push(...checkEnv(env));

    let serial: string | undefined;
    if (opts.android && platform === 'android') {
      const devs = await androidDevices();
      serial = (devs.find((d) => d.emulator) ?? devs[0])?.serial;
    }
    if (opts.adb && !serial) throw new Error('--adb needs an Android target with an adb device');

    if (serial && info.appId) await gfxReset(serial, info.appId);
    await cdp.evaluateJson(startSamplingProbe);
    const t0 = Date.now();
    if (opts.adb && serial) {
      opts.log(`record: running adb script`);
      for (const step of opts.adb.split(';').map((s) => s.trim()).filter(Boolean)) {
        const sl = step.match(/^sleep\s+(\d+(?:\.\d+)?)$/);
        if (sl) await sleep(Number(sl[1]) * 1000);
        else await exec(adbPath(), ['-s', serial, 'shell', ...step.split(/\s+/)]);
      }
    } else {
      opts.log(`record: interact with the app now (${opts.seconds}s)`);
    }
    const left = opts.seconds * 1000 - (Date.now() - t0);
    if (left > 0) await sleep(left);
    const sample = await cdp.evaluateJson<Sample>(stopSamplingProbe);
    raw.record = sample;
    findings.push(...checkInteraction(sample, env));
    if (serial && info.appId) {
      const g = await gfxRead(serial, info.appId);
      raw.gfxRecord = g;
      findings.push(...checkGfx('interaction', g, env));
    }
  } finally {
    cdp.close();
  }
  return {
    tool: 'react-native-perfkit',
    version: VERSION,
    createdAt: new Date().toISOString(),
    target: { title: target.title, deviceName: info.deviceName, appId: info.appId, platform },
    findings,
    raw,
  };
}
