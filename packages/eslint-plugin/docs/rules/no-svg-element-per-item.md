# react-native-perfkit/no-svg-element-per-item

Disallow `.map()` that emits one react-native-svg element per item.

## Why

react-native-svg creates a native view for every element (`RNSVGPath`, `RNSVGGroup`, …). If you map a list
to `<Rect>`/`<Path>`/`<G>`, the node count grows with the list, and so do the mount and commit cost. Merging the
geometry into one `d` string keeps it to one native view.

Only elements imported from `react-native-svg` are checked, so Skia's `Path` is ignored. Mapping over a small
static array (at most `maxStaticItems`, default 8) is allowed: for example, the 4 colour layers of a sprite.

## Measured

A 349-glyph icon preview used a `<G transform><Path/></G>` per glyph, about 700 native views. It cost
250-500ms to (re)mount on Android. With one concatenated `<Path>` it became 1 view. An earlier glyph renderer
drew one `<Rect>` per pixel run, which put thousands of nodes on a gallery screen and froze it for 6-7s on
open.

## Examples

```tsx
// ✗
runs.map((r) => <Rect key={r.id} x={r.x} y={r.y} width={r.w} height={1} />)

// ✓ build once, cache at module level
const d = runs.map((r) => `M${r.x} ${r.y}h${r.w}v1h${-r.w}z`).join('');
<Path d={d} fill={color} />
```
