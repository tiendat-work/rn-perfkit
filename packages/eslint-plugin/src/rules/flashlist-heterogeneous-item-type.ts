import type { TSESLint, TSESTree } from '@typescript-eslint/utils';
import { AST_NODE_TYPES } from '@typescript-eslint/utils';

import { getJsxAttribute, hasSpreadAttribute, jsxName, unwrap } from '../utils/ast';
import { createRule } from '../utils/createRule';

type Options = [{ components?: string[]; renderFields?: string[]; typeFields?: string[] }];

const DEFAULT_COMPONENTS = ['FlashList'];
// `item.render()` / `<item.Component />` / `item.component` => every item is its own tree.
const DEFAULT_RENDER_FIELDS = ['render', 'renderItem', 'component', 'Component', 'element'];
// `switch (item.type)` => a few distinct row kinds.
const DEFAULT_TYPE_FIELDS = ['type', 'kind', 'variant'];

type Fn = TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression | TSESTree.FunctionDeclaration;

function isFn(n: TSESTree.Node | null | undefined): n is Fn {
  return (
    !!n &&
    (n.type === AST_NODE_TYPES.ArrowFunctionExpression ||
      n.type === AST_NODE_TYPES.FunctionExpression ||
      n.type === AST_NODE_TYPES.FunctionDeclaration)
  );
}

/** Resolve an identifier to its initializer / declaration in scope. */
function resolve(context: TSESLint.RuleContext<string, Options>, node: TSESTree.Node): TSESTree.Node | undefined {
  const n = unwrap(node);
  if (n.type !== AST_NODE_TYPES.Identifier) return n;
  let scope: TSESLint.Scope.Scope | null = context.sourceCode.getScope(n);
  while (scope) {
    const v = scope.set.get(n.name);
    if (v && v.defs.length) {
      const def = v.defs[0].node as TSESTree.Node;
      if (def.type === AST_NODE_TYPES.VariableDeclarator) return def.init ? unwrap(def.init) : undefined;
      return def;
    }
    scope = scope.upper;
  }
  return undefined;
}

/** Local name bound to the item in `renderItem({ item })` / `renderItem(info)` (-> `info.item`). */
function itemNames(fn: Fn): { item?: string; info?: string } {
  const p = fn.params[0];
  if (!p) return {};
  if (p.type === AST_NODE_TYPES.Identifier) return { info: p.name };
  if (p.type === AST_NODE_TYPES.ObjectPattern) {
    for (const prop of p.properties) {
      if (
        prop.type === AST_NODE_TYPES.Property &&
        prop.key.type === AST_NODE_TYPES.Identifier &&
        prop.key.name === 'item' &&
        prop.value.type === AST_NODE_TYPES.Identifier
      ) {
        return { item: prop.value.name };
      }
    }
  }
  return {};
}

/** Does `node` refer to the render item? (`item` or `info.item`). */
function isItemRef(node: TSESTree.Node, names: { item?: string; info?: string }): boolean {
  const n = unwrap(node);
  if (n.type === AST_NODE_TYPES.Identifier) return n.name === names.item;
  return (
    n.type === AST_NODE_TYPES.MemberExpression &&
    !n.computed &&
    n.object.type === AST_NODE_TYPES.Identifier &&
    n.object.name === names.info &&
    n.property.type === AST_NODE_TYPES.Identifier &&
    n.property.name === 'item'
  );
}

function walk(node: TSESTree.Node, visit: (n: TSESTree.Node) => boolean | void): boolean {
  if (visit(node)) return true;
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue;
    const v = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof c === 'object' && 'type' in c && walk(c as TSESTree.Node, visit)) return true;
    } else if (v && typeof v === 'object' && 'type' in (v as object)) {
      if (walk(v as TSESTree.Node, visit)) return true;
    }
  }
  return false;
}

/** renderItem body renders the item as its own tree (item.render(), <item.Component/>, switch(item.type)). */
function renderItemIsHeterogeneous(fn: Fn, renderFields: string[], typeFields: string[]): string | undefined {
  const names = itemNames(fn);
  if (!names.item && !names.info) return undefined;
  let why: string | undefined;
  walk(fn.body, (n) => {
    if (
      n.type === AST_NODE_TYPES.MemberExpression &&
      !n.computed &&
      n.property.type === AST_NODE_TYPES.Identifier &&
      isItemRef(n.object, names)
    ) {
      const field = n.property.name;
      const parent = n.parent;
      if (renderFields.includes(field) && parent?.type === AST_NODE_TYPES.CallExpression && parent.callee === n) {
        why = `renderItem calls \`item.${field}()\``;
        return true;
      }
      if (typeFields.includes(field) && parent?.type === AST_NODE_TYPES.SwitchStatement) {
        why = `renderItem switches on \`item.${field}\``;
        return true;
      }
    }
    if (
      n.type === AST_NODE_TYPES.JSXMemberExpression &&
      n.object.type === AST_NODE_TYPES.JSXIdentifier &&
      n.object.name === names.item &&
      renderFields.includes(n.property.name)
    ) {
      why = `renderItem renders \`<item.${n.property.name} />\``;
      return true;
    }
    return false;
  });
  return why;
}

/** data is an array literal whose object items each carry a render function. */
function dataIsHeterogeneous(data: TSESTree.Node | undefined, renderFields: string[]): string | undefined {
  if (!data || data.type !== AST_NODE_TYPES.ArrayExpression) return undefined;
  let withRender = 0;
  let objects = 0;
  for (const el of data.elements) {
    if (!el || el.type !== AST_NODE_TYPES.ObjectExpression) continue;
    objects++;
    const has = el.properties.some(
      (p) =>
        p.type === AST_NODE_TYPES.Property &&
        !p.computed &&
        p.key.type === AST_NODE_TYPES.Identifier &&
        renderFields.includes(p.key.name) &&
        (isFn(p.value as TSESTree.Node) || (p.value as TSESTree.Node).type === AST_NODE_TYPES.Identifier),
    );
    if (has) withRender++;
  }
  return objects >= 2 && withRender === objects ? 'each `data` item carries its own render function' : undefined;
}

export default createRule<Options, 'missingItemType'>({
  name: 'flashlist-heterogeneous-item-type',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require `getItemType` on a FlashList whose items render as different component trees (sections, mixed row kinds)',
      measured:
        'Without it FlashList recycles a "button" cell into an "icon" cell and React remounts the whole subtree (200-500ms JS on Android): blank cells while flinging. Adding getItemType + a memo cell took fling p99 from 117ms to 48ms.',
      recommended: true,
    },
    messages: {
      missingItemType:
        '{{ component }} items are heterogeneous ({{ why }}) but there is no `getItemType`. Recycling will remount whole subtrees across types. Add `getItemType={(item) => item.key /* or kind */}` and render through a memo component.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          components: { type: 'array', items: { type: 'string' } },
          renderFields: { type: 'array', items: { type: 'string' } },
          typeFields: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
  },
  defaultOptions: [{}],
  create(context, [opts]) {
    const components = opts.components ?? DEFAULT_COMPONENTS;
    const renderFields = opts.renderFields ?? DEFAULT_RENDER_FIELDS;
    const typeFields = opts.typeFields ?? DEFAULT_TYPE_FIELDS;

    return {
      JSXOpeningElement(node) {
        const name = jsxName(node);
        if (!name || !components.includes(name)) return;
        if (getJsxAttribute(node, 'getItemType') || hasSpreadAttribute(node)) return;

        const exprOf = (attr: string) => {
          const a = getJsxAttribute(node, attr);
          return a?.value?.type === AST_NODE_TYPES.JSXExpressionContainer &&
            a.value.expression.type !== AST_NODE_TYPES.JSXEmptyExpression
            ? a.value.expression
            : undefined;
        };

        let why: string | undefined;
        const renderExpr = exprOf('renderItem');
        if (renderExpr) {
          const fn = resolve(context, renderExpr);
          if (isFn(fn)) why = renderItemIsHeterogeneous(fn, renderFields, typeFields);
        }
        if (!why) {
          const dataExpr = exprOf('data');
          if (dataExpr) why = dataIsHeterogeneous(resolve(context, dataExpr), renderFields);
        }
        if (why) context.report({ node, messageId: 'missingItemType', data: { component: name, why } });
      },
    };
  },
});
