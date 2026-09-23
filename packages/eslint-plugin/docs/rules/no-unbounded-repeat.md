# rn-perfkit/no-unbounded-repeat

Flag infinite Reanimated `withRepeat` loops (strict config, warning).

## Why

`withRepeat(anim, -1)` runs on the UI thread for as long as the component is mounted. A list keeps rows
mounted outside the viewport (its draw buffer and recycle pool), so these loops keep ticking where nobody can see
them.

This rule is not in `recommended`: an on-screen loader that loops is fine. It warns in `strict` so that each
infinite loop is a deliberate choice.

## Measured

Pixel loaders sat just above the fold in a FlashList. With nothing animating on screen, the UI thread was
pinned at 7-28 fps. Five visibility-gate attempts failed: `onViewableItemsChanged` never fired, and
`measureInWindow` returned stale coordinates. The fix that held was to drop the worklet loop and step
precomputed frames with a JS `setInterval` at about 5-15 Hz, after which the UI ran at 60 fps.

## Examples

```ts
// ⚠ strict
phase.value = withRepeat(withTiming(1, { duration: 1000 }), -1);
// ✓ decorative loop: discrete frames on a JS timer
useEffect(() => { const id = setInterval(() => setFrame((f) => (f + 1) % N), 80); return () => clearInterval(id); }, []);
```
