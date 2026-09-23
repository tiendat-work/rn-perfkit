# rn-perfkit

React Native performance tooling. Every check comes from something we measured on a device.

| Package | Status | What |
|---|---|---|
| [`eslint-plugin-rn-perfkit`](packages/eslint-plugin) | 0.1.0 | Static rules for patterns that cost real frames or caused visual bugs |
| `rn-perfkit` (doctor CLI) | planned | Measures on the device over Metro CDP, adb and simctl, and prints a pass/fail report |

Background and prior-art survey: [RESEARCH.md](RESEARCH.md).

## Develop

```sh
pnpm install
pnpm test        # builds, then runs RuleTester suites + checks the built plugin
pnpm --filter eslint-plugin-rn-perfkit exec bash scripts/dogfood-english.sh   # true/false positives on a real app
```

MIT
