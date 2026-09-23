# react-native-perfkit/no-font-weight-with-custom-font

Disallow `fontWeight` together with a custom `fontFamily`.

## Why

When a style object sets both a custom font and a weight, iOS ignores the weight. Android instead looks for a
"<family> bold" variant, doesn't find one, and silently falls back to the system font (Roboto). Choose the weight
through the face name (`Inter_700Bold`) and drop `fontWeight`.

By default the rule reports only when `fontFamily` and `fontWeight` are in the same object. `'normal'` and `400`
are always allowed. If your fonts are applied in a different place from the weights (theme variants), set
`customFontsOnly: true`: then every non-regular `fontWeight` is reported.

## Measured

Every heading in the app (`Handjet_700Bold` + `fontWeight: '700'`) rendered in Roboto on Android, while iOS
showed the pixel font. We found it only by comparing screenshots from both platforms side by side. The plugin
also found a leftover typography scale with the same bug that no screenshot had caught.

## Examples

```ts
// ✗
{ fontFamily: 'Handjet_700Bold', fontWeight: '700' }
// ✓
{ fontFamily: 'Handjet_700Bold' }
```
