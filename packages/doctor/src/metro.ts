/** Metro inspector target discovery (`GET <metro>/json/list`). */
import http from 'node:http';
import https from 'node:https';

export type MetroTarget = {
  id: string;
  title: string;
  description?: string;
  appId?: string;
  deviceName?: string;
  webSocketDebuggerUrl: string;
};

export function fetchJson<T>(url: string, timeoutMs = 3000): Promise<T> {
  const lib = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body) as T);
        } catch (e) {
          reject(new Error(`bad JSON from ${url}: ${(e as Error).message}`));
        }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout fetching ${url}`)));
    req.on('error', reject);
  });
}

/**
 * The JS runtime target: RN registers several pages per device (the React
 * runtime plus e.g. "UI" / worklet runtimes). The React one's description
 * contains "Bridgeless" (new arch) or "Hermes"/"React Native" (old arch).
 */
export function isReactRuntime(t: MetroTarget): boolean {
  const d = `${t.description ?? ''} ${t.title}`;
  return /Bridgeless|React Native|Hermes/i.test(d) && !/\bUI\b|worklet|video-metadata/i.test(t.description ?? '');
}

export function pickTarget(targets: MetroTarget[], match?: string): MetroTarget | undefined {
  const runtimes = targets.filter(isReactRuntime);
  if (!match) return runtimes[0];
  const m = match.toLowerCase();
  return runtimes.find(
    (t) =>
      t.title.toLowerCase().includes(m) ||
      (t.deviceName ?? '').toLowerCase().includes(m) ||
      (t.appId ?? '').toLowerCase().includes(m),
  );
}

export function describeTarget(t: MetroTarget): string {
  return `${t.title}${t.description ? ` — ${t.description}` : ''}`;
}

/** App id and device name from a target (title is "com.app (Device Name)"). */
export function targetInfo(t: MetroTarget): { appId?: string; deviceName?: string } {
  const m = t.title.match(/^(\S+)\s+\((.+)\)$/);
  return { appId: t.appId ?? m?.[1], deviceName: t.deviceName ?? m?.[2] };
}
