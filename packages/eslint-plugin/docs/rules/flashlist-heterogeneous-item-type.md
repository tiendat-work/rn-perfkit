# rn-perfkit/flashlist-heterogeneous-item-type

Require `getItemType` on a FlashList whose items render as different component trees.

## Why

FlashList recycles cells. With no `getItemType`, every item has the same type, so a cell that rendered a
"button" section can be reused for an "icon" section. React then unmounts the whole subtree and mounts a
new one. For large sections this takes hundreds of milliseconds of JS, and while it runs the list cannot draw
new cells, so you see blank space during a fling.

The rule reports only when the file itself shows that the items are heterogeneous:
- `renderItem` calls `item.render()` (or `item.component()`, …);
- `renderItem` renders `<item.Component />`;
- `renderItem` switches on `item.type` / `kind` / `variant`;
- or `data` is an array literal where every object has its own render function.

## Measured

A 21-section component gallery on Android (Pixel emulator with a hardware GPU, debug build) was profiled with
the React Profiler: a single section remount cost up to 264ms. Blank cells appeared mid-fling. Adding
`getItemType={(s) => s.key}` plus a `memo` cell took the fling p99 frame time from 117ms to 48ms, with no blank
cells.

Trade-off: with per-section types the sections stay mounted instead of being recycled. On a Debug iOS build that
was ~10 fps slower while scrolling, but a Release build showed 58-60 fps either way. Measure Release.

## Examples

```tsx
// ✗
const SECTIONS = [{ key: 'button', render: () => <ButtonDemos /> }, { key: 'icon', render: () => <IconDemos /> }];
<FlashList data={SECTIONS} renderItem={({ item }) => item.render()} />

// ✓
const Cell = memo(({ item }) => item.render());
<FlashList data={SECTIONS} renderItem={({ item }) => <Cell item={item} />} getItemType={(s) => s.key} />
```

Options: `components` (default `['FlashList']`; add your wrappers), `renderFields`, `typeFields`.
