# eslint-plugin-react-native-perfkit

ESLint rules for React Native performance and rendering pitfalls. We measured each one on a device before
writing a rule for it. Every rule doc says what happened, what the numbers were and how it was fixed.

## Install

```sh
npm i -D eslint-plugin-react-native-perfkit
```

ESLint 9+ flat config (works with `eslint-config-expo/flat`):

```js
// eslint.config.js
const rnPerfkit = require('eslint-plugin-react-native-perfkit');

module.exports = [
  // ...your config
  rnPerfkit.configs.recommended,
  // optional: wrappers around FlashList, projects that use only custom fonts
  {
    rules: {
      'react-native-perfkit/flashlist-heterogeneous-item-type': ['error', { components: ['FlashList', 'MyList'] }],
      'react-native-perfkit/no-font-weight-with-custom-font': ['error', { customFontsOnly: true }],
    },
  },
];
```

## Rules

| Rule | recommended | strict | What it catches |
|---|---|---|---|
| [flashlist-heterogeneous-item-type](docs/rules/flashlist-heterogeneous-item-type.md) | error | error | FlashList of different trees without `getItemType` (remounts, blank cells on fling) |
| [no-font-weight-with-custom-font](docs/rules/no-font-weight-with-custom-font.md) | error | error | `fontWeight` + custom `fontFamily`; Android falls back to Roboto |
| [no-fractional-pixel-unit](docs/rules/no-fractional-pixel-unit.md) | error | error | fractional pixel-grid cell size (blur on iOS, dropped cells on Android Skia) |
| [no-svg-element-per-item](docs/rules/no-svg-element-per-item.md) | warn | error | `.map()` emitting one react-native-svg element per item (one native view each) |
| [no-value-in-inline-style](docs/rules/no-value-in-inline-style.md) | error | error | `.value` in an inline style (Reanimated injects a `console.warn` per render) |
| [no-unbounded-repeat](docs/rules/no-unbounded-repeat.md) | – | warn | infinite `withRepeat` (keeps ticking the UI thread while mounted off-screen) |

## Design principles

- **Evidence first.** A rule exists only for a pattern that cost real frames or a real visual bug on a device.
- **Narrow heuristics.** A rule reports only when the problem is visible in the file. False positives kill
  adoption, so the rules stay silent when they are unsure (for example with spread props).
- **No type information needed.** Every rule works without `parserOptions.project`.

## Companion

[`react-native-perfkit`](../doctor) doctor: on-device measurement over Metro CDP and adb, covering JS fps, commit cost,
host-view census, Android gfxinfo, and an emulator GPU check.

## License

MIT
