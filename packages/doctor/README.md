# react-native-perfkit (doctor)

`react-native-perfkit` measures a running React Native app on a device or simulator and reports pass/warn/fail findings.
Each finding comes with advice based on something we measured ourselves.

```sh
npx react-native-perfkit doctor                    # first RN runtime connected to Metro
npx react-native-perfkit doctor --device iPhone --profile run.cpuprofile --out report.json
npx react-native-perfkit targets                   # list Metro inspector targets
```

It talks to the app through Metro's inspector (Chrome DevTools Protocol, the same channel React Native
DevTools uses), and through `adb` on Android. The app code needs no changes and no dependency is added to it.

## What it checks

| Check | How | Threshold (warn / fail) |
|---|---|---|
| Build mode | `__DEV__` | Debug is reported as info. Debug JS timings overstate cost (measured: 25-28 vs 58-60 JS fps on the same code) |
| Engine | Hermes / Fabric / bridgeless / RN version | non-Hermes → warn |
| Mounted native views | walks the fiber tree via the DevTools hook, groups host views by owning component | 1500 / 3000 |
| React commits while idle | wraps `onCommitFiberRoot` and names the component whose state changed | 2/s / 10/s |
| JS frame pacing while idle | `requestAnimationFrame` loop | < 55 / < 45 fps |
| Dev warnings / errors | wraps `console.warn/error` while sampling | any warn → warn, any error → fail. Recognises the Reanimated inline-style warning |
| JS thread while scrolling | scrolls the largest mounted vertical ScrollView/list to the end and back | < 50 / < 35 fps, or a stall ≥ 100 / 250 ms |
| Fabric commit cost | Hermes CPU profile (`--profile`), duration of the `completeRoot` runs | p50 ≥ 16 / 33 ms |
| Android GPU renderer | `dumpsys SurfaceFlinger` | SwiftShader/lavapipe (CPU rasteriser) → fail |
| Android frames idle / fling | `dumpsys gfxinfo` + real `adb input swipe` flings | p50 ≥ 20 / 34 ms, p99 ≥ 50 / 100 ms |

## Options

```
--metro <url>        Metro dev server (default http://localhost:8081)
--device <text>      pick a target by device name / app id
--idle <seconds>     idle sampling window (default 5)
--no-scroll          skip the scroll benchmark
--passes <n>         scroll passes down+up (default 1)
--step <ms>          delay between scroll steps (default 450)
--profile [file]     Hermes CPU profile during the scroll (optionally save .cpuprofile)
--no-android         skip adb checks
--json / --out <f>   JSON report to stdout / file
--fail-on <level>    exit 1 on: fail (default) | warn | never
```

Exit codes: 0 = ok, 1 = findings at or above `--fail-on`, 2 = usage error or no app reachable.

## Caveats

- The app must be a **dev build connected to Metro**. Fiber checks need the React DevTools hook, which only
  dev builds have.
- For that reason JS numbers come from a Debug build, and every JS finding says so. Confirm a JS-thread finding
  in a Release build before optimising it. The Android gfxinfo and GPU checks don't depend on the build type.
- The scroll driver calls `scrollTo` on the underlying ScrollView. On FlashList v2, `scrollToOffset` on the list
  ref is a no-op, so the driver goes through the ScrollView instead.
- Probes are removed after each window (hooks and `console` are restored). Running the doctor doesn't leave the
  app instrumented.

## Pairs with

[`eslint-plugin-react-native-perfkit`](../eslint-plugin): the static half. Doctor advice links to the rule that prevents a
pattern from coming back.

MIT
