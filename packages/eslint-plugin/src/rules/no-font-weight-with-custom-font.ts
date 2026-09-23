import type { TSESTree } from '@typescript-eslint/utils';
import { AST_NODE_TYPES } from '@typescript-eslint/utils';

import { propertyKey, unwrap } from '../utils/ast';
import { createRule } from '../utils/createRule';

type Options = [{ customFontsOnly?: boolean; systemFonts?: string[] }];

const SYSTEM_FONTS = [
  'System', 'sans-serif', 'serif', 'monospace', 'Roboto', 'sans-serif-medium', 'sans-serif-light',
  'sans-serif-condensed', 'Helvetica', 'Helvetica Neue', 'Arial', 'Courier', 'Menlo', 'Georgia', 'Times New Roman',
];
// Regular weight never triggers the bold-variant lookup.
const HARMLESS_WEIGHTS = new Set(['normal', '400', 400]);

export default createRule<Options, 'weightWithCustomFont' | 'weightInCustomFontProject'>({
  name: 'no-font-weight-with-custom-font',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow `fontWeight` together with a custom `fontFamily`: Android looks up a "<family> bold" variant and silently falls back to the system font',
      measured:
        'Every heading (Handjet_700Bold + fontWeight 700) rendered in Roboto on Android while iOS showed the pixel font.',
      recommended: true,
    },
    messages: {
      weightWithCustomFont:
        '`fontWeight: {{ weight }}` next to custom `fontFamily` {{ family }}. On Android this falls back to the system font. Select the weight by face name (e.g. `Inter_700Bold`) and drop fontWeight.',
      weightInCustomFontProject:
        '`fontWeight: {{ weight }}` in a project that uses only custom fonts (customFontsOnly). On Android a custom family + fontWeight falls back to the system font. Select the weight by face name.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          customFontsOnly: { type: 'boolean' },
          systemFonts: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
  },
  defaultOptions: [{}],
  create(context, [opts]) {
    const system = new Set(opts.systemFonts ?? SYSTEM_FONTS);
    const text = (n: TSESTree.Node) => context.sourceCode.getText(n);

    return {
      ObjectExpression(obj) {
        let weight: TSESTree.Property | undefined;
        let family: TSESTree.Property | undefined;
        for (const p of obj.properties) {
          if (p.type !== AST_NODE_TYPES.Property) continue;
          const k = propertyKey(p);
          if (k === 'fontWeight') weight = p;
          else if (k === 'fontFamily') family = p;
        }
        if (!weight) return;
        const w = unwrap(weight.value);
        if (w.type === AST_NODE_TYPES.Literal && HARMLESS_WEIGHTS.has(w.value as string)) return;

        if (family) {
          const f = unwrap(family.value);
          const isSystem = f.type === AST_NODE_TYPES.Literal && typeof f.value === 'string' && system.has(f.value);
          if (!isSystem) {
            context.report({
              node: weight,
              messageId: 'weightWithCustomFont',
              data: { weight: text(weight.value), family: text(family.value) },
            });
          }
          return;
        }
        if (opts.customFontsOnly) {
          context.report({ node: weight, messageId: 'weightInCustomFontProject', data: { weight: text(weight.value) } });
        }
      },
    };
  },
});
