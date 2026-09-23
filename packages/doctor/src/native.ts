/** Native-side checks via adb (Android) and xcrun simctl (iOS). */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type Exec = (cmd: string, args: string[], timeoutMs?: number) => Promise<{ ok: boolean; stdout: string; stderr: string }>;

export const exec: Exec = (cmd, args, timeoutMs = 20000) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout), stderr: String(stderr || (err ? err.message : '')) });
    });
  });

export function adbPath(): string {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || join(homedir(), 'Library/Android/sdk');
  const p = join(sdk, 'platform-tools', 'adb');
  return existsSync(p) ? p : 'adb';
}

export type AndroidDevice = { serial: string; emulator: boolean };

export async function androidDevices(run: Exec = exec): Promise<AndroidDevice[]> {
  const r = await run(adbPath(), ['devices']);
  if (!r.ok) return [];
  return r.stdout
    .split('\n')
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p.length >= 2 && p[1] === 'device')
    .map(([serial]) => ({ serial, emulator: serial.startsWith('emulator-') }));
}

export type GpuInfo = { renderer: string; software: boolean };

/** Software GPU renderers seen on the Android emulator (CPU rasterisation). */
const SOFTWARE_GPU = /SwiftShader|lavapipe|llvmpipe|Software Rasterizer|softpipe/i;

export function parseGles(dumpsys: string): GpuInfo | undefined {
  const line = dumpsys.split('\n').find((l) => /GLES:/.test(l));
  if (!line) return undefined;
  const renderer = line.replace(/^\s*GLES:\s*/, '').trim();
  return { renderer, software: SOFTWARE_GPU.test(renderer) };
}

export async function androidGpu(serial: string, run: Exec = exec): Promise<GpuInfo | undefined> {
  const r = await run(adbPath(), ['-s', serial, 'shell', 'dumpsys', 'SurfaceFlinger']);
  return r.ok ? parseGles(r.stdout) : undefined;
}

export type GfxStats = {
  totalFrames: number;
  jankyFrames: number;
  jankyPct: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  slowUiThread: number;
};

export function parseGfxinfo(out: string): GfxStats | undefined {
  const num = (re: RegExp) => {
    const m = out.match(re);
    return m ? Number(m[1]) : NaN;
  };
  const totalFrames = num(/Total frames rendered:\s*(\d+)/);
  if (Number.isNaN(totalFrames)) return undefined;
  const janky = out.match(/Janky frames:\s*(\d+)\s*\(([\d.]+)%\)/);
  return {
    totalFrames,
    jankyFrames: janky ? Number(janky[1]) : 0,
    jankyPct: janky ? Number(janky[2]) : 0,
    p50: num(/^\s*50th percentile:\s*(\d+)ms/m),
    p90: num(/^\s*90th percentile:\s*(\d+)ms/m),
    p95: num(/^\s*95th percentile:\s*(\d+)ms/m),
    p99: num(/^\s*99th percentile:\s*(\d+)ms/m),
    slowUiThread: num(/Number Slow UI thread:\s*(\d+)/) || 0,
  };
}

export async function gfxReset(serial: string, pkg: string, run: Exec = exec): Promise<void> {
  await run(adbPath(), ['-s', serial, 'shell', 'dumpsys', 'gfxinfo', pkg, 'reset']);
}

export async function gfxRead(serial: string, pkg: string, run: Exec = exec): Promise<GfxStats | undefined> {
  const r = await run(adbPath(), ['-s', serial, 'shell', 'dumpsys', 'gfxinfo', pkg]);
  return r.ok ? parseGfxinfo(r.stdout) : undefined;
}

/** Physical-feeling flings (real input events, unlike the JS scroll driver). */
export async function androidFling(serial: string, down: number, up: number, run: Exec = exec): Promise<void> {
  const size = await run(adbPath(), ['-s', serial, 'shell', 'wm', 'size']);
  const m = size.stdout.match(/(\d+)x(\d+)/);
  const w = m ? Number(m[1]) : 1080;
  const h = m ? Number(m[2]) : 2400;
  const x = String(Math.round(w / 2));
  const lo = String(Math.round(h * 0.8));
  const hi = String(Math.round(h * 0.2));
  for (let i = 0; i < down; i++) {
    await run(adbPath(), ['-s', serial, 'shell', 'input', 'swipe', x, lo, x, hi, '120']);
    await new Promise((r) => setTimeout(r, 400));
  }
  for (let i = 0; i < up; i++) {
    await run(adbPath(), ['-s', serial, 'shell', 'input', 'swipe', x, hi, x, lo, '120']);
    await new Promise((r) => setTimeout(r, 400));
  }
}

export type IosSim = { udid: string; name: string };

export async function bootedIosSims(run: Exec = exec): Promise<IosSim[]> {
  const r = await run('xcrun', ['simctl', 'list', 'devices', 'booted', '--json']);
  if (!r.ok) return [];
  try {
    const j = JSON.parse(r.stdout) as { devices: Record<string, Array<{ udid: string; name: string; state: string }>> };
    return Object.values(j.devices)
      .flat()
      .filter((d) => d.state === 'Booted')
      .map((d) => ({ udid: d.udid, name: d.name }));
  } catch {
    return [];
  }
}
