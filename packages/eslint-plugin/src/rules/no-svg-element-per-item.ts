import type { TSESLint, TSESTree } from '@typescript-eslint/utils';
import { AST_NODE_TYPES } from '@typescript-eslint/utils';

import { calleeName, unwrap } from '../utils/ast';
import { createRule } from '../utils/createRule';

type Options = [{ maxStaticItems?: number; source?: string[] }];

// react-native-svg elements; each one is a native view (RNSVG*), unlike Skia.
const SVG_ELEMENTS = new Set([
  'Rect', 'Path', 'Circle', 'Ellipse', 'Line', 'Polygon', 'Polyline', 'G', 'Text', 'TSpan', 'Use', 'Image',
]);

/** JSX elements returned by a map callback (expression body or `return` statements). */
function returnedJsx(fn: TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression): TSESTree.JSXElement[] {
  const out: TSESTree.JSXElement[] = [];
  const take = (n: TSESTree.Node | null | undefined) => {
    if (!n) return;
    const u = unwrap(n);
    if (u.type === AST_NODE_TYPES.JSXElement) out.push(u);
    else if (u.type === AST_NODE_TYPES.ConditionalExpression) {
      take(u.consequent);
      take(u.alternate);
    } else if (u.type === AST_NODE_TYPES.LogicalExpression) take(u.right);
  };
  if (fn.body.type !== AST_NODE_TYPES.BlockStatement) take(fn.body);
  else {
    for (const s of fn.body.body) if (s.type === AST_NODE_TYPES.ReturnStatement) take(s.argument);
  }
  return out;
}

function staticLength(context: TSESLint.RuleContext<string, Options>, node: TSESTree.Node): number | undefined {
  const n = unwrap(node);
  if (n.type === AST_NODE_TYPES.ArrayExpression) return n.elements.length;
  if (n.type !== AST_NODE_TYPES.Identifier) return undefined;
  let scope: TSESLint.Scope.Scope | null = context.sourceCode.getScope(n);
  while (scope) {
    const v = scope.set.get(n.name);
    if (v?.defs[0]?.node.type === AST_NODE_TYPES.VariableDeclarator) {
      const init = v.defs[0].node.init;
      const u = init ? unwrap(init) : undefined;
      return u?.type === AST_NODE_TYPES.ArrayExpression ? u.elements.length : undefined;
    }
    if (v) return undefined;
    scope = scope.upper;
  }
  return undefined;
}

export default createRule<Options, 'svgPerItem'>({
  name: 'no-svg-element-per-item',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow `.map()` that emits one react-native-svg element per item (each SVG element is a native view); merge into one <Path d>',
      measured:
        'A 349-icon preview as <G>+<Path> per glyph was ~700 native views and 250-500ms to (re)mount on Android; one concatenated <Path> made it 1 view. An N-<Rect> glyph renderer froze a gallery for 6-7s.',
      recommended: true,
    },
    messages: {
      svgPerItem:
        '`.map()` returns a react-native-svg <{{ element }}> per item: one native view each. Concatenate the geometry into a single <Path d="..."> (or one path per colour) built once and cached.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          maxStaticItems: { type: 'integer', minimum: 0 },
          source: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
  },
  defaultOptions: [{}],
  create(context, [opts]) {
    const maxStatic = opts.maxStaticItems ?? 8;
    const sources = opts.source ?? ['react-native-svg'];
    // Local names bound to SVG elements imported from react-native-svg.
    const local = new Map<string, string>();
    let namespace: string | undefined;

    return {
      ImportDeclaration(node) {
        if (!sources.includes(String(node.source.value))) return;
        for (const s of node.specifiers) {
          if (s.type === AST_NODE_TYPES.ImportSpecifier) {
            const imported = s.imported.type === AST_NODE_TYPES.Identifier ? s.imported.name : String(s.imported.value);
            if (SVG_ELEMENTS.has(imported)) local.set(s.local.name, imported);
          } else if (s.type === AST_NODE_TYPES.ImportNamespaceSpecifier || s.type === AST_NODE_TYPES.ImportDefaultSpecifier) {
            namespace = s.local.name;
          }
        }
      },
      CallExpression(node) {
        if (calleeName(node) !== 'map' || node.callee.type !== AST_NODE_TYPES.MemberExpression) return;
        const cb = node.arguments[0];
        if (!cb || (cb.type !== AST_NODE_TYPES.ArrowFunctionExpression && cb.type !== AST_NODE_TYPES.FunctionExpression)) {
          return;
        }
        const len = staticLength(context, node.callee.object);
        if (len !== undefined && len <= maxStatic) return;
        for (const el of returnedJsx(cb)) {
          const nm = el.openingElement.name;
          let element: string | undefined;
          if (nm.type === AST_NODE_TYPES.JSXIdentifier) element = local.get(nm.name);
          else if (
            nm.type === AST_NODE_TYPES.JSXMemberExpression &&
            nm.object.type === AST_NODE_TYPES.JSXIdentifier &&
            nm.object.name === namespace &&
            SVG_ELEMENTS.has(nm.property.name)
          ) {
            element = nm.property.name;
          }
          if (element) {
            context.report({ node: el.openingElement, messageId: 'svgPerItem', data: { element } });
            return;
          }
        }
      },
    };
  },
});
