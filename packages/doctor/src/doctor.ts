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
  checkProfile,
  checkScroll,
  type Env,
  type Finding,
  type Sample,
} from './checks';
import { fetchJson, type MetroTarget, pickTarget, targetInfo } from './metro';
import { androidDevices, androidFling, androidGpu, bootedIosSims, gfxRead, gfxReset } from './native';
import {
  censusProbe,
  envProbe,
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
    tool: 'rn-perfkit',
    version: VERSION,
    createdAt: new Date().toISOString(),
    target: { title: target.title, ...info, platform },
    findings,
    raw,
  };
}
