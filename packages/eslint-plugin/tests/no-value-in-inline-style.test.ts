import rule from '../src/rules/no-value-in-inline-style';
import { ruleTester } from './ruleTester';

ruleTester.run('no-value-in-inline-style', rule, {
  valid: [
    // Destructured first — the English app fix.
    `swatches.map(({ name, value: hex }) => <View key={name} style={[styles.chip, { backgroundColor: hex }]} />)`,
    // SharedValue read inside useAnimatedStyle is the right way.
    `const s = useAnimatedStyle(() => ({ opacity: progress.value })); <Animated.View style={s} />`,
    // .value outside style is fine.
    `<Text>{s.value}</Text>`,
    `<Input value={field.value} />`,
    // computed access is not what the babel plugin flags
    `<View style={{ width: obj['value'] }} />`,
  ],
  invalid: [
    {
      // The historical ColorDemos code (English app, before a21fa7e).
      code: `swatches.map((s) => <View key={s.name} style={[styles.chip, { backgroundColor: s.value }]} />)`,
      errors: [{ messageId: 'valueInStyle' }],
    },
    {
      code: `<View style={{ opacity: progress.value, width: w.value }} />`,
      errors: [{ messageId: 'valueInStyle' }, { messageId: 'valueInStyle' }],
    },
    {
      code: `<View style={{ transform: [{ translateY: offset.value }] }} />`,
      errors: [{ messageId: 'valueInStyle' }],
    },
    {
      code: `<View style={{ height: (h as any).value }} />`,
      errors: [{ messageId: 'valueInStyle' }],
    },
  ],
});
