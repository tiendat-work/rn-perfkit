/**
 * Minimal Chrome DevTools Protocol client for Metro's inspector proxy
 * (`ws://<metro>/inspector/debug?device=..&page=..`).
 *
 * Notes from measuring RN 0.81 bridgeless / Hermes:
 * - `Runtime.evaluate` with `awaitPromise` does NOT resolve against RN's promise
 *   polyfill (you get the raw `{_h,_i,_j,_k}` object). Probes therefore stash
 *   results on `globalThis` and the caller polls — see `waitFor`.
 * - Always `returnByValue`; probes return JSON strings to keep payloads flat.
 */
import WebSocket from 'ws';

type Pending = { resolve: (v: CdpMessage) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };
export type CdpMessage = { id?: number; result?: any; error?: { message: string } };

/**
 * Metro in RN 0.86 answers a debugger WebSocket without an `Origin` header with HTTP 401
 * (measured on the Dogspotting app, Metro on :8082). Its own base URL is
 * `http://127.0.0.1:<port>`. With `Origin: http://localhost:<port>` the socket opens but
 * `Runtime.evaluate` never answers (3/3 runs); with `http://127.0.0.1:<port>` it answers at once.
 * So a local Metro gets the 127.0.0.1 origin, anything else its own host.
 */
export const devtoolsOrigin = (wsUrl: string): string => {
  const u = new URL(wsUrl);
  const scheme = u.protocol === 'wss:' ? 'https:' : 'http:';
  const host = u.hostname === 'localhost' ? `127.0.0.1${u.port ? `:${u.port}` : ''}` : u.host;
  return `${scheme}//${host}`;
};

export class CdpClient {
  private ws: WebSocket;
  private nextId = 0;
  private pending = new Map<number, Pending>();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (raw) => {
      let msg: CdpMessage;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.id === undefined) return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg);
    });
    ws.on('close', () => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('CDP connection closed'));
      }
      this.pending.clear();
    });
  }

  static connect(url: string, timeoutMs = 5000): Promise<CdpClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { origin: devtoolsOrigin(url) });
      const t = setTimeout(() => {
        ws.terminate();
        reject(new Error(`CDP connect timeout: ${url}`));
      }, timeoutMs);
      ws.once('open', () => {
        clearTimeout(t);
        resolve(new CdpClient(ws));
      });
      ws.once('error', (e) => {
        clearTimeout(t);
        reject(e);
      });
    });
  }

  send(method: string, params: Record<string, unknown> = {}, timeoutMs = 15000): Promise<CdpMessage> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Evaluate an expression; returns the by-value result or throws with the JS exception text. */
  async evaluate<T = unknown>(expression: string, timeoutMs = 15000): Promise<T> {
    const msg = await this.send('Runtime.evaluate', { expression, returnByValue: true }, timeoutMs);
    const r = msg.result;
    if (r?.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(`JS exception: ${d.exception?.description ?? d.text ?? 'unknown'}`);
    }
    return r?.result?.value as T;
  }

  /** Evaluate a probe that returns a JSON string, parse it. */
  async evaluateJson<T>(expression: string, timeoutMs = 15000): Promise<T> {
    const raw = await this.evaluate<string>(expression, timeoutMs);
    if (typeof raw !== 'string') throw new Error(`probe returned ${typeof raw}, expected JSON string`);
    return JSON.parse(raw) as T;
  }

  close(): void {
    this.ws.close();
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Poll `check` until it returns a truthy value or the timeout passes. */
export async function waitFor<T>(check: () => Promise<T | undefined | null | false>, timeoutMs: number, everyMs = 500): Promise<T | undefined> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await check();
    if (v) return v;
    await sleep(everyMs);
  }
  return undefined;
}
