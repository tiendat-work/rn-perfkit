import type { TSESTree } from '@typescript-eslint/utils';
import { AST_NODE_TYPES } from '@typescript-eslint/utils';

/** Name of a JSX element: `FlashList`, `Svg.Path` -> `Path`, `Animated.View` -> `View`. */
export function jsxName(node: TSESTree.JSXOpeningElement): string | undefined {
  const n = node.name;
  if (n.type === AST_NODE_TYPES.JSXIdentifier) return n.name;
  if (n.type === AST_NODE_TYPES.JSXMemberExpression) return n.property.name;
  return undefined;
}

export function getJsxAttribute(
  node: TSESTree.JSXOpeningElement,
  name: string,
): TSESTree.JSXAttribute | undefined {
  for (const a of node.attributes) {
    if (a.type === AST_NODE_TYPES.JSXAttribute && a.name.type === AST_NODE_TYPES.JSXIdentifier && a.name.name === name) {
      return a;
    }
  }
  return undefined;
}

export function hasSpreadAttribute(node: TSESTree.JSXOpeningElement): boolean {
  return node.attributes.some((a) => a.type === AST_NODE_TYPES.JSXSpreadAttribute);
}

/** Static key of an object property (`foo`, `'foo'`), or undefined if computed. */
export function propertyKey(p: TSESTree.Property): string | undefined {
  if (p.computed) return undefined;
  if (p.key.type === AST_NODE_TYPES.Identifier) return p.key.name;
  if (p.key.type === AST_NODE_TYPES.Literal && typeof p.key.value === 'string') return p.key.value;
  return undefined;
}

/** Callee name of a call: `foo()` -> foo, `a.b.foo()` -> foo. */
export function calleeName(node: TSESTree.CallExpression): string | undefined {
  const c = node.callee;
  if (c.type === AST_NODE_TYPES.Identifier) return c.name;
  if (c.type === AST_NODE_TYPES.MemberExpression && !c.computed && c.property.type === AST_NODE_TYPES.Identifier) {
    return c.property.name;
  }
  return undefined;
}

/** Unwrap `x as T`, `x!`, `(x)` wrappers. */
export function unwrap(node: TSESTree.Node): TSESTree.Node {
  let n = node;
  while (
    n.type === AST_NODE_TYPES.TSAsExpression ||
    n.type === AST_NODE_TYPES.TSNonNullExpression ||
    n.type === AST_NODE_TYPES.TSSatisfiesExpression
  ) {
    n = n.expression;
  }
  return n;
}
