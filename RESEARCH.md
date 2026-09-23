# rn-perfkit — research (phase 0)

Goal: turn what we MEASURED while fixing the English app (Sep 2026) into reusable
checks for any React Native project. Two parts:

1. `eslint-plugin-rn-perfkit`: static rules for the patterns that cost us real
   frames. These run in the editor and in CI.
2. `rn-perfkit` doctor CLI (phase 2): on-device measurement over Metro CDP, adb
   and simctl. It prints a report with pass/fail thresholds.

## What already exists (checked 2026-09-23)

| Tool | What it does | Overlap |
|---|---|---|
| Intellicode/eslint-plugin-react-native (★762, last push 2024-12) | style hygiene: no-inline-styles, no-unused-styles, no-color-literals, no-raw-text | none of our rules |
| wcandillon/eslint-plugin-reanimated (★76, last push 2023-08) | js-function-in-worklet, unsupported-syntax | our "plain JS helper inside a worklet" bug; that plugin is stale, but we won't duplicate the rule now, just recommend it |
| callstack/reassure (★1.5k) | render-count/duration regression tests in jest | complements the doctor: it measures in jest, not on the device |
| bamlab/flashlight (★1.6k) | Android FPS/CPU score from the outside (adb) | the doctor's Android fling bench overlaps; consider shelling out to it instead of reimplementing |
| callstackincubator/rozenite (★658, active) | DevTools plugin framework, including a performance-monitor plugin (react-native-performance marks), a require-profiler, and an agent SDK | a possible host for the doctor later (a plugin + agent tool) rather than raw CDP |
| margelo/react-native-release-profiler | Hermes sampling profiler in RELEASE builds | the doctor's Release measurement could use it; we saw that Debug numbers mislead |

No existing ESLint rule covers any of the measured patterns below. The npm names
`eslint-plugin-rn-perfkit` and `rn-perfkit` are free.

## Rules: each backed by a measurement

| Rule | Pattern | Evidence (English app) |
|---|---|---|
| `no-value-in-inline-style` | `style={{ x: obj.value }}` in JSX | The Reanimated babel plugin can't tell a plain object from a SharedValue, so it injects a `console.warn` per render. A swatch grid emitted 27 warnings per open plus 2 LogBox toasts. Fix: destructure. |
| `flashlist-heterogeneous-item-type` | FlashList whose items are different trees (renderItem calls `item.render()` / switches on `item.type`) without `getItemType` | Cross-type recycling remounts whole subtrees at 200-500ms of JS each, which shows as blank cells on Android fling. Adding getItemType + a memo cell moved fling p99 from 117 to 48ms. |
| `no-svg-element-per-item` | `.map()` returning react-native-svg `Rect/Path/G/Circle` elements | One native view per SVG element. A 349-icon grid was ~700 nodes and took 250-500ms to (re)mount on Android; baking it into one `<Path>` made it 1 node. Earlier, an N-Rect glyph renderer caused a 6-7s gallery freeze. |
| `no-fractional-pixel-unit` | a fractional literal for a pixel-grid prop/param (`unit`, `cell`, `cellSize`, `pixelSize`, `blockSize`) | `unit=2.4` rendered as a broken sliver on Android Skia (iOS was fine); `unit=3` fixed it. Configurable prop names. |
| `no-font-weight-with-custom-font` | `fontWeight` in a style object that sets a non-system `fontFamily` (option: flag any fontWeight when the project uses only custom fonts) | On Android, fontWeight + a custom family falls back to Roboto. All headings in the app rendered in the system font. |
| `no-unbounded-repeat` (strict config) | `withRepeat(x, -1)` / `withRepeat(x, 0)` | A mounted but off-screen infinite worklet pinned the UI thread at 7-28fps, and five visibility-gate attempts failed. Fix: discrete JS-timer frames, or unmount. This rule is a warn, because on-screen use is legitimate. |

Out of scope for lint (runtime only, so the doctor handles them):
- whether an emulator uses a CPU GPU (SwiftShader: 98% janky frames at idle)
- Debug vs Release (iOS JS 25 vs 59fps on the same code)
- host-view count and commit cost

## Design

- Monorepo (pnpm): `packages/eslint-plugin` (published as `eslint-plugin-rn-perfkit`)
  and `packages/doctor` (phase 2, `rn-perfkit`).
- TypeScript, rules built with `@typescript-eslint/utils` RuleCreator; tests use
  `@typescript-eslint/rule-tester` on vitest. Output is compiled CJS because Expo's
  `eslint.config.js` uses `require`. Flat config only (ESLint 9+).
- Configs: `recommended` (the 5 measured rules as errors or warns) and `strict`
  (adds no-unbounded-repeat).
- Every rule doc cites its measurement: numbers, symptom, fix.
- Heuristics are intentionally narrow: false positives kill adoption. Component
  names are configurable (e.g. `components: ['FlashList', 'PixelPullRefresh']`).

## Failure modes

- Heuristic false positives: `.value` on a plain object is exactly what we want
  to flag (the babel plugin warns on it too), so that rule is precise. The
  FlashList heuristic only fires when heterogeneity is visible in the same
  file; it stays silent otherwise.
- Performance of the rules themselves: single AST pass, no type info required
  (works without `parserOptions.project`).

## Verification plan

- RuleTester valid/invalid cases per rule, taken from the real code that caused
  each bug (git history of the English app).
- Dogfood: install into the English app. The rules must flag the historical
  versions (`git show <sha>^:file`) and pass on current HEAD.
