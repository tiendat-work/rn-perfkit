import rule from '../src/rules/no-font-weight-with-custom-font';
import { ruleTester } from './ruleTester';

ruleTester.run('no-font-weight-with-custom-font', rule, {
  valid: [
    `const s = { fontFamily: 'Handjet_700Bold', fontSize: 20 };`,
    `const s = { fontFamily: 'System', fontWeight: '700' };`,
    `const s = { fontFamily: 'Inter_400Regular', fontWeight: '400' };`,
    `const s = { fontFamily: 'Inter_400Regular', fontWeight: 'normal' };`,
    // No family in the same object and customFontsOnly off: unknown, stay silent.
    `const s = { fontWeight: '700' };`,
  ],
  invalid: [
    {
      code: `const s = { fontFamily: 'Handjet_700Bold', fontWeight: '700' };`,
      errors: [{ messageId: 'weightWithCustomFont' }],
    },
    {
      code: `const s = { fontFamily: theme.fonts.heading, fontWeight: 'bold' };`,
      errors: [{ messageId: 'weightWithCustomFont' }],
    },
    {
      // The historical English Text variants: family applied elsewhere, weight in variants.
      code: `const styles = StyleSheet.create({ heading: { fontSize: 22, fontWeight: '700' } });`,
      options: [{ customFontsOnly: true }],
      errors: [{ messageId: 'weightInCustomFontProject' }],
    },
  ],
});
