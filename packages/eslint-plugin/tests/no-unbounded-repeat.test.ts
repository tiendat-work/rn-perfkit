import rule from '../src/rules/no-unbounded-repeat';
import { ruleTester } from './ruleTester';

ruleTester.run('no-unbounded-repeat', rule, {
  valid: [
    `phase.value = withRepeat(withTiming(1, { duration: 300 }), 3, true);`,
    `phase.value = withRepeat(withTiming(1));`,
    `phase.value = withRepeat(withTiming(1), count);`,
  ],
  invalid: [
    {
      code: `phase.value = withRepeat(withTiming(1, { duration: 1000 }), -1, false);`,
      errors: [{ messageId: 'unbounded' }],
    },
    { code: `x.value = withRepeat(anim, 0);`, errors: [{ messageId: 'unbounded' }] },
    { code: `x.value = Reanimated.withRepeat(anim, -1);`, errors: [{ messageId: 'unbounded' }] },
  ],
});
