# rn-perfkit

React Native performance tooling. Every check comes from something we measured on a device.

| Package | Status | What |
|---|---|---|
| [`eslint-plugin-rn-perfkit`](packages/eslint-plugin) | 0.1.0 | Static rules for patterns that cost real frames or caused visual bugs |
| [`rn-perfkit`](packages/doctor) | 0.1.0 | Doctor CLI: measures on the device over Metro CDP + adb (views, commits, JS fps, CPU profile, gfxinfo, emulator GPU) and prints a pass/fail report |

Background and prior-art survey: [RESEARCH.md](RESEARCH.md).

## Develop

```sh
pnpm install
pnpm test        # builds, then runs the plugin RuleTester suites + doctor unit/CLI tests
node packages/doctor/dist/cli.js doctor --device iPhone   # against a running dev app
pnpm --filter eslint-plugin-rn-perfkit exec bash scripts/dogfood-english.sh   # true/false positives on a real app
```

MIT
