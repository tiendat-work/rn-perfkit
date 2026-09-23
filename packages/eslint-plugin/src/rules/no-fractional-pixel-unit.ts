import type { TSESTree } from '@typescript-eslint/utils';
import { AST_NODE_TYPES } from '@typescript-eslint/utils';

import { propertyKey, unwrap } from '../utils/ast';
import { createRule } from '../utils/createRule';

type Options = [{ names?: string[] }];

const DEFAULT_NAMES = ['unit', 'cell', 'cellSize', 'pixelSize', 'blockSize', 'pixelUnit'];

function fractional(node: TSESTree.Node | null | undefined): number | undefined {
  if (!node) return undefined;
  const n = unwrap(node);
  if (n.type === AST_NODE_TYPES.Literal && typeof n.value === 'number' && !Number.isInteger(n.value)) return n.value;
  return undefined;
}

export default createRule<Options, 'fractionalUnit'>({
  name: 'no-fractional-pixel-unit',
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow fractional literals for pixel-grid cell sizes (props, defaults, style keys)',
      measured:
        'A Skia pixel toggle with unit=2.4 rendered on Android as a broken sliver (most sub-pixel cells dropped); iOS looked fine. unit=3 fixed it.',
      recommended: true,
    },
    messages: {
      fractionalUnit:
        '`{{ name }}` = {{ value }} is not a whole number. Pixel-grid cells off the device pixel grid blur on iOS and drop out on Android Skia. Use an integer and resize by changing the grid size.',
    },
    schema: [
      {
        type: 'object',
        properties: { names: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    ],
  },
  defaultOptions: [{}],
  create(context, [opts]) {
    const names = new Set(opts.names ?? DEFAULT_NAMES);
    const report = (node: TSESTree.Node, name: string, value: number) =>
      context.report({ node, messageId: 'fractionalUnit', data: { name, value: String(value) } });

    return {
      // <PixelToggle unit={2.4} />
      JSXAttribute(node) {
        if (node.name.type !== AST_NODE_TYPES.JSXIdentifier || !names.has(node.name.name)) return;
        if (node.value?.type !== AST_NODE_TYPES.JSXExpressionContainer) return;
        const v = fractional(node.value.expression as TSESTree.Node);
        if (v !== undefined) report(node, node.name.name, v);
      },
      // function X({ unit = 2.4 }) / (unit = 2.4) => ...
      AssignmentPattern(node) {
        if (node.left.type !== AST_NODE_TYPES.Identifier || !names.has(node.left.name)) return;
        const v = fractional(node.right);
        if (v !== undefined) report(node, node.left.name, v);
      },
      // { unit: 2.4 }  (config objects, theme tokens) — skip destructuring patterns
      Property(node) {
        if (node.parent?.type === AST_NODE_TYPES.ObjectPattern) return;
        const key = propertyKey(node);
        if (!key || !names.has(key)) return;
        const v = fractional(node.value);
        if (v !== undefined) report(node, key, v);
      },
    };
  },
});
