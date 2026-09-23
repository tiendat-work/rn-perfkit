import rule from '../src/rules/no-fractional-pixel-unit';
import { ruleTester } from './ruleTester';

ruleTester.run('no-fractional-pixel-unit', rule, {
  valid: [
    `export function PixelToggle({ value, unit = 3 }) {}`,
    `<PixelToggle unit={3} />`,
    `const frame = { unit: 3, borderWidth: 2 };`,
    `<Box opacity={0.5} />`,
    `const { unit = 2.5 } = props;`.replace('2.5', '2'),
  ],
  invalid: [
    {
      // The historical PixelToggle default (broken on Android Skia).
      code: `export function PixelToggle({ value, unit = 2.4 }) {}`,
      errors: [{ messageId: 'fractionalUnit' }],
    },
    { code: `<PixelFrame unit={1.6} />`, errors: [{ messageId: 'fractionalUnit' }] },
    { code: `const theme = { frame: { unit: 2.5 } };`, errors: [{ messageId: 'fractionalUnit' }] },
    {
      code: `<Grid gridSize={1.5} />`,
      options: [{ names: ['gridSize'] }],
      errors: [{ messageId: 'fractionalUnit' }],
    },
  ],
});
