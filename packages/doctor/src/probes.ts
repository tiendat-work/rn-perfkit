/**
 * JS probes evaluated INSIDE the app runtime over CDP. Each is a self-contained
 * expression string (no closures over Node values) that returns a JSON string.
 * State lives on `globalThis.__rnPerfkit` so a later evaluate can read it back
 * (awaitPromise does not work against RN's promise polyfill).
 *
 * Sources of truth, all measured on RN 0.81 bridgeless / Hermes:
 * - fibers via `__REACT_DEVTOOLS_GLOBAL_HOOK__.getFiberRoots(rendererId)`
 * - commits via wrapping `hook.onCommitFiberRoot` (nativeFabricUIManager is a
 *   HostObject and cannot be wrapped)
 * - JS frame pacing via a requestAnimationFrame loop
 * - dev warnings via wrapping console.warn / console.error
 */

const NS = 'globalThis.__rnPerfkit';

/** Is this a React Native JS runtime we can probe? */
export const envProbe = `JSON.stringify((() => {
  const g = globalThis;
  const hook = g.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const renderers = hook && hook.renderers ? [...hook.renderers.keys()] : [];
  return {
    dev: typeof __DEV__ !== 'undefined' ? !!__DEV__ : null,
    hermes: typeof g.HermesInternal === 'object' && g.HermesInternal !== null,
    hermesVersion: g.HermesInternal && g.HermesInternal.getRuntimeProperties ? (g.HermesInternal.getRuntimeProperties()['OSS Release Version'] || null) : null,
    fabric: typeof g.nativeFabricUIManager !== 'undefined',
    bridgeless: !!g.RN$Bridgeless,
    devtoolsHook: !!hook,
    renderers,
    rnVersion: (() => { try { const v = require('react-native').Platform.constants.reactNativeVersion; return v.major + '.' + v.minor + '.' + v.patch; } catch (e) {} const h = g.HermesInternal && g.HermesInternal.getRuntimeProperties ? String(g.HermesInternal.getRuntimeProperties()['OSS Release Version'] || '') : ''; const m = h.match(/RN (\\d+\\.\\d+\\.\\d+)/); return m ? m[1] : null; })(),
  };
})())`;

/**
 * Host-view census: count host fibers (string type = native view) in the
 * mounted tree, by host type and by nearest named composite owner.
 */
export const censusProbe = (topN = 15) => `JSON.stringify((() => {
  const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook || !hook.getFiberRoots) return { error: 'no devtools hook' };
  const byType = {}; const byOwner = {};
  let fibers = 0, host = 0, composites = 0, maxDepth = 0;
  const nameOf = (f) => { const t = f.type; if (!t || typeof t === 'string') return null;
    return t.displayName || t.name || (t.render && (t.render.displayName || t.render.name)) || (t.type && (t.type.displayName || t.type.name)) || null; };
  const IGNORE = /^(View|Text|Animated\\(.*\\)|AnimatedComponent.*|Wrapper|Unknown|Fragment|Context|Provider|Consumer|Memo|ForwardRef)$/;
  for (const rid of hook.renderers.keys()) {
    const roots = hook.getFiberRoots(rid);
    if (!roots) continue;
    for (const root of roots) {
      const stack = [[root.current, null, 0]];
      while (stack.length) {
        const [f, owner, depth] = stack.pop();
        if (!f) continue;
        fibers++;
        if (depth > maxDepth) maxDepth = depth;
        let own = owner;
        const n = nameOf(f);
        if (n) { composites++; if (!IGNORE.test(n)) own = n; }
        if (typeof f.type === 'string') {
          host++;
          byType[f.type] = (byType[f.type] || 0) + 1;
          const o = own || '(root)';
          byOwner[o] = (byOwner[o] || 0) + 1;
        }
        if (f.sibling) stack.push([f.sibling, owner, depth]);
        if (f.child) stack.push([f.child, own, depth + 1]);
      }
    }
  }
  const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, ${topN});
  return { fibers, host, composites, maxDepth, byType: top(byType), byOwner: top(byOwner) };
})())`;

/**
 * Start a sampling window: rAF loop for JS frame pacing, React commit counter
 * (attributed to the topmost component that performed work), dev warning
 * counter. Idempotent: restarts cleanly if a previous window was left open.
 */
export const startSamplingProbe = `JSON.stringify((() => {
  const g = globalThis;
  const prev = ${NS};
  if (prev && prev.stop) prev.stop();
  const hook = g.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const s = { gaps: [], run: true, t0: performance.now(), last: performance.now(), commits: 0, commitOrigins: {}, warnings: {}, warnCount: 0, errorCount: 0 };
  const loop = () => { if (!s.run) return; const n = performance.now(); s.gaps.push(n - s.last); s.last = n; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  const nameOf = (f) => { const t = f.type; if (!t || typeof t === 'string') return null;
    return t.displayName || t.name || (t.type && (t.type.displayName || t.type.name)) || (t.render && (t.render.displayName || t.render.name)) || null; };
  let origOnCommit = null;
  if (hook && typeof hook.onCommitFiberRoot === 'function') {
    origOnCommit = hook.onCommitFiberRoot;
    hook.onCommitFiberRoot = function (rid, root) {
      s.commits++;
      // Walk like React DevTools: descend only where the child pointer changed
      // vs the alternate (untouched subtrees keep the same child object, so
      // stale PerformedWork flags there are never read). A commit ORIGIN is a
      // rendered composite whose own state changed (it called setState /
      // a hook updated) — not its children that merely re-rendered.
      try {
        const seen = new Set();
        const stack = [root.current];
        let visited = 0;
        while (stack.length && visited < 20000) {
          const f = stack.pop();
          if (!f) continue;
          visited++;
          const alt = f.alternate;
          if (alt && (f.flags & 1) === 1 && f.memoizedState !== alt.memoizedState) {
            const n = nameOf(f);
            if (n && !seen.has(n)) { seen.add(n); s.commitOrigins[n] = (s.commitOrigins[n] || 0) + 1; }
          }
          if (!alt || f.child !== alt.child) { let c = f.child; while (c) { stack.push(c); c = c.sibling; } }
        }
      } catch (e) {}
      return origOnCommit.apply(this, arguments);
    };
  }
  const ow = console.warn, oe = console.error;
  const key = (a) => String(a && a[0] !== undefined ? a[0] : '').replace(/\\s+/g, ' ').slice(0, 90);
  console.warn = function () { s.warnCount++; const k = key(arguments); s.warnings[k] = (s.warnings[k] || 0) + 1; return ow.apply(this, arguments); };
  console.error = function () { s.errorCount++; const k = 'ERROR: ' + key(arguments); s.warnings[k] = (s.warnings[k] || 0) + 1; return oe.apply(this, arguments); };
  s.stop = () => {
    s.run = false;
    if (origOnCommit && hook) hook.onCommitFiberRoot = origOnCommit;
    console.warn = ow; console.error = oe;
  };
  ${NS} = s;
  return { started: true, commitHook: !!origOnCommit };
})())`;

/** Stop the window and return stats. */
export const stopSamplingProbe = `JSON.stringify((() => {
  const s = ${NS};
  if (!s) return { error: 'no sampling window' };
  s.stop();
  const secs = (performance.now() - s.t0) / 1000;
  const gaps = s.gaps.slice(1).sort((a, b) => a - b);
  const q = (p) => gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))] : 0;
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
  ${NS} = null;
  return {
    seconds: secs,
    frames: s.gaps.length,
    jsFps: s.gaps.length / secs,
    p50: q(0.5), p90: q(0.9), p99: q(0.99), max: gaps.length ? gaps[gaps.length - 1] : 0,
    over33: gaps.filter((x) => x > 33.4).length,
    over100: gaps.filter((x) => x > 100).length,
    commits: s.commits,
    commitsPerSec: s.commits / secs,
    commitOrigins: top(s.commitOrigins, 10),
    warnCount: s.warnCount,
    errorCount: s.errorCount,
    warnings: top(s.warnings, 10),
  };
})())`;

/**
 * Scroll driver. Collects every mounted ScrollView-like instance (stateNode with
 * scrollTo + getScrollResponder — this also reaches the ScrollView inside a
 * FlashList/FlatList) and picks the one owning the LARGEST subtree (the main
 * list, not a drawer/header scroller). Measures its content height, then steps
 * scrollTo() down to the end and back up.
 *
 * FlashList v2 note: scrollToOffset/scrollToEnd on its ref are no-ops, but
 * scrollTo on the underlying ScrollView works.
 */
export const startScrollProbe = (opts: { passes: number; stepMs: number }) => `JSON.stringify((() => {
  const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook) return { ok: false, reason: 'no devtools hook' };
  const candidates = [];
  const countHost = (fiber) => {
    let n = 0; const st = [fiber.child];
    while (st.length && n < 50000) { const f = st.pop(); if (!f) continue; if (typeof f.type === 'string') n++; if (f.sibling) st.push(f.sibling); if (f.child) st.push(f.child); }
    return n;
  };
  for (const rid of hook.renderers.keys()) {
    const roots = hook.getFiberRoots(rid); if (!roots) continue;
    for (const root of roots) {
      const stack = [root.current];
      while (stack.length) {
        const f = stack.pop(); if (!f) continue;
        const sn = f.stateNode;
        if (sn && typeof sn.scrollTo === 'function' && typeof sn.getScrollResponder === 'function') {
          const horizontal = !!(f.memoizedProps && f.memoizedProps.horizontal);
          if (!horizontal) candidates.push({ sn, size: countHost(f) });
        }
        if (f.sibling) stack.push(f.sibling);
        if (f.child) stack.push(f.child);
      }
    }
  }
  if (!candidates.length) return { ok: false, reason: 'no mounted vertical ScrollView/list found' };
  candidates.sort((a, b) => b.size - a.size);
  const target = candidates[0].sn;
  const st = { done: false, steps: 0, total: 0, contentHeight: null };
  globalThis.__rnPerfkitScroll = st;
  const passes = ${opts.passes}, stepMs = ${opts.stepMs};
  const run = (contentHeight, viewport) => {
    const step = Math.max(200, Math.round(viewport * 0.8));
    const maxY = Math.max(step, contentHeight - viewport);
    const seq = [];
    for (let p = 0; p < passes; p++) {
      for (let y = 0; y <= maxY; y += step) seq.push(y);
      seq.push(maxY);
      for (let y = maxY; y >= 0; y -= step) seq.push(y);
      seq.push(0);
    }
    st.total = seq.length; st.contentHeight = contentHeight;
    let k = 0;
    const tick = () => {
      if (k >= seq.length) { st.done = true; return; }
      try { target.scrollTo({ y: seq[k], animated: true }); } catch (e) { st.error = String(e); st.done = true; return; }
      st.steps = ++k;
      setTimeout(tick, stepMs);
    };
    tick();
  };
  let viewport = 800;
  try { const d = require('react-native').Dimensions; viewport = d.get('window').height; } catch (e) {}
  const inner = typeof target.getInnerViewRef === 'function' ? target.getInnerViewRef() : null;
  if (inner && typeof inner.measure === 'function') {
    let started = false;
    inner.measure((x, y, w, h) => { if (started) return; started = true; run(h > 0 ? h : 20000, viewport); });
    setTimeout(() => { if (!started) { started = true; run(20000, viewport); } }, 1000);
  } else run(20000, viewport);
  return { ok: true, kind: 'scrollview', candidates: candidates.length, subtreeHostViews: candidates[0].size };
})())`;

export const scrollDoneProbe = `JSON.stringify(globalThis.__rnPerfkitScroll ? { done: !!globalThis.__rnPerfkitScroll.done, steps: globalThis.__rnPerfkitScroll.steps, total: globalThis.__rnPerfkitScroll.total, contentHeight: globalThis.__rnPerfkitScroll.contentHeight, error: globalThis.__rnPerfkitScroll.error || null } : { done: true, steps: 0 })`;
