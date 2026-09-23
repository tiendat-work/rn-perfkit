# rn-perfkit/no-value-in-inline-style

Disallow `.value` reads inside inline JSX styles.

## Why

Reanimated's babel plugin (`react-native-worklets/plugin`) scans every JSX `style` attribute. When it finds a
property whose value is `something.value`, it wraps that property in `console.warn(...)`. It cannot tell a
SharedValue from a plain object, so a plain object's `.value` is flagged too. In dev builds the warning runs on
every render, on the JS thread, and LogBox shows it as a toast.

This rule flags the same shapes the plugin does: top-level properties, array elements and
`transform: [{ ... }]` entries.

## Measured

A colour-swatch grid rendered `style={[styles.chip, { backgroundColor: s.value }]}` for 27 tokens. That was 27
warnings and 2 LogBox toasts every time the gallery opened. After destructuring (`({ value: hex })`), the count
was 0.

## Examples

```tsx
// ✗
swatches.map((s) => <View style={{ backgroundColor: s.value }} />)
<View style={{ transform: [{ translateY: offset.value }] }} />

// ✓ plain objects: destructure first
swatches.map(({ value: hex }) => <View style={{ backgroundColor: hex }} />)
// ✓ shared values: useAnimatedStyle
const style = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }] }));
```
