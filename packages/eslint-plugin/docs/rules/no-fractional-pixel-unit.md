# rn-perfkit/no-fractional-pixel-unit

Disallow fractional literals for pixel-grid cell sizes.

## Why

Pixel-art components draw a grid of cells, `unit` px each. With a fractional unit the cells fall off the
device pixel grid: on iOS they blur, and on Android Skia sub-pixel cells can drop out entirely.

The rule checks JSX props, parameter defaults and object properties named `unit`, `cell`, `cellSize`,
`pixelSize`, `blockSize` or `pixelUnit`. You can change the list with the `names` option.

## Measured

A Skia pixel toggle with `unit = 2.4` rendered correctly on iOS. On Android it showed only a broken top edge
and one corner. `unit = 3` fixed it.

## Examples

```tsx
// ✗
function PixelToggle({ unit = 2.4 }) {}
// ✓
function PixelToggle({ unit = 3 }) {}
```
