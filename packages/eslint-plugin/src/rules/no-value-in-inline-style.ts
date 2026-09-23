import type { TSESTree } from '@typescript-eslint/utils';
import { AST_NODE_TYPES } from '@typescript-eslint/utils';

import { propertyKey, unwrap } from '../utils/ast';
import { createRule } from '../utils/createRule';

/**
 * Mirrors what react-native-worklets' babel plugin flags (lib/inlineStylesWarning):
 * inside a JSX `style` attribute, an object property whose value is a non-computed
 * member access `.value` — top level, inside an array element, or inside a
 * `transform: [{ ... }]` entry. The plugin can't tell a SharedValue from a plain
 * object, so it wraps each hit in `console.warn(getUseOfValueInStyleWarning())`
 * on every render in dev.
 */
export default createRule({
  name: 'no-value-in-inline-style',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow `.value` reads in inline JSX styles (Reanimated injects a console.warn per render, even for plain objects)',
      measured: 'A 27-swatch colour grid emitted 27 warnings + LogBox toasts every time the screen opened.',
      recommended: true,
    },
    messages: {
      valueInStyle:
        'Inline style reads `{{ text }}`. Reanimated\'s babel plugin warns on every render here (it cannot tell a SharedValue from a plain object). Use useAnimatedStyle for SharedValues, or destructure plain fields first (e.g. `({ value: hex }) => ...`).',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const source = context.sourceCode;

    function checkValue(node: TSESTree.Node) {
      const n = unwrap(node);
      if (
        n.type === AST_NODE_TYPES.MemberExpression &&
        !n.computed &&
        n.property.type === AST_NODE_TYPES.Identifier &&
        n.property.name === 'value'
      ) {
        context.report({ node: n, messageId: 'valueInStyle', data: { text: source.getText(n) } });
      }
    }

    function checkObject(obj: TSESTree.ObjectExpression) {
      for (const p of obj.properties) {
        if (p.type !== AST_NODE_TYPES.Property) continue;
        if (propertyKey(p) === 'transform') {
          const v = unwrap(p.value);
          if (v.type === AST_NODE_TYPES.ArrayExpression) {
            for (const el of v.elements) {
              if (el && el.type === AST_NODE_TYPES.ObjectExpression) checkObject(el);
            }
          }
          continue;
        }
        checkValue(p.value);
      }
    }

    return {
      JSXAttribute(attr) {
        if (attr.name.type !== AST_NODE_TYPES.JSXIdentifier || attr.name.name !== 'style') return;
        if (!attr.value || attr.value.type !== AST_NODE_TYPES.JSXExpressionContainer) return;
        const expr = unwrap(attr.value.expression as TSESTree.Node);
        if (expr.type === AST_NODE_TYPES.ObjectExpression) checkObject(expr);
        else if (expr.type === AST_NODE_TYPES.ArrayExpression) {
          for (const el of expr.elements) {
            if (el && el.type === AST_NODE_TYPES.ObjectExpression) checkObject(el);
          }
        }
      },
    };
  },
});
