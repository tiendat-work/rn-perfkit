/**
 * Pure analysis of a CDP `.cpuprofile` (Hermes sampling profile via
 * `Profiler.start/stop`). No I/O, so it is unit-tested with fixtures.
 */

export type CpuProfileNode = {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number; columnNumber?: number };
  children?: number[];
};

export type CpuProfile = {
  nodes: CpuProfileNode[];
  samples: number[];
  timeDeltas: number[];
  startTime?: number;
  endTime?: number;
};

export type ProfileSummary = {
  totalMs: number;
  idleMs: number;
  busyMs: number;
  /** Self time per bucket: an npm package, `app` (your bundle code), `host` (native host functions), `gc`. */
  byBucket: Array<[string, number]>;
  topSelf: Array<[string, number]>;
  /** Fabric commit (`completeRoot`) runs, the JS-thread cost of committing React trees on the new arch. */
  commit: { runs: number; totalMs: number; p50: number; p90: number; max: number };
};

const IDLE = new Set(['(idle)', '[root]', '(root)', '(program)']);

function bucketOf(node: CpuProfileNode): string {
  const fn = node.callFrame.functionName || '';
  const url = node.callFrame.url || '';
  if (/^\[GC|garbage/i.test(fn)) return 'gc';
  if (/^\[Host Function\]/.test(fn) || url === '[host]') return 'host';
  if (/^\[Native\]/.test(fn) || url === '[native]') return 'native';
  const pkg = url.match(/node_modules\/((?:@[^/]+\/)?[^/?]+)/);
  if (pkg) return pkg[1];
  if (/\.bundle|localhost:\d+|\/src\//.test(url)) return 'app bundle';
  return url ? 'other' : '(unknown)';
}

function label(node: CpuProfileNode): string {
  const fn = node.callFrame.functionName || '(anonymous)';
  const b = bucketOf(node);
  return b === 'host' || b === 'native' || b === 'gc' ? fn : `${fn} [${b}]`;
}

function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

export function summarizeProfile(profile: CpuProfile, topN = 12): ProfileSummary {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map<number, number>();
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));

  let total = 0;
  let idle = 0;
  const bucket = new Map<string, number>();
  const fns = new Map<string, number>();
  for (const [id, us] of self) {
    const node = byId.get(id);
    if (!node) continue;
    total += us;
    if (IDLE.has(node.callFrame.functionName)) {
      idle += us;
      continue;
    }
    const b = bucketOf(node);
    bucket.set(b, (bucket.get(b) ?? 0) + us);
    const l = label(node);
    fns.set(l, (fns.get(l) ?? 0) + us);
  }

  // Contiguous sample runs of completeRoot = one Fabric commit each (approx.).
  const runs: number[] = [];
  let cur = 0;
  profile.samples.forEach((id, i) => {
    const hit = (byId.get(id)?.callFrame.functionName ?? '').includes('completeRoot');
    if (hit) cur += profile.timeDeltas[i] ?? 0;
    else if (cur) {
      runs.push(cur / 1000);
      cur = 0;
    }
  });
  if (cur) runs.push(cur / 1000);
  runs.sort((a, b) => a - b);

  const ms = (us: number) => us / 1000;
  const sortDesc = (m: Map<string, number>) =>
    [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, ms(v)] as [string, number]);

  return {
    totalMs: ms(total),
    idleMs: ms(idle),
    busyMs: ms(total - idle),
    byBucket: sortDesc(bucket).slice(0, topN),
    topSelf: sortDesc(fns).slice(0, topN),
    commit: {
      runs: runs.length,
      totalMs: runs.reduce((s, x) => s + x, 0),
      p50: quantile(runs, 0.5),
      p90: quantile(runs, 0.9),
      max: runs.length ? runs[runs.length - 1] : 0,
    },
  };
}
