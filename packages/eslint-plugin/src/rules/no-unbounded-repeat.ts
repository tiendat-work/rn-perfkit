import { AST_NODE_TYPES } from '@typescript-eslint/utils';

import { calleeName, unwrap } from '../utils/ast';
import { createRule } from '../utils/createRule';

export default createRule({
  name: 'no-unbounded-repeat',
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Flag infinite Reanimated `withRepeat` loops: they keep ticking the UI thread while mounted, even when off-screen',
      measured:
        'Loaders just above the fold in a FlashList pinned the UI thread at 7-28fps while nothing animated on screen; five visibility-gate attempts failed. Fixed by discrete JS-timer frames (no worklet loop).',
      recommended: false,
    },
    messages: {
      unbounded:
        'Infinite `withRepeat(..., {{ reps }})` keeps running on the UI thread for as long as the component is mounted, including off-screen in a list buffer. For decorative loops prefer a JS setInterval stepping a frame index (~5-15Hz), or make sure the component unmounts / cancels when not visible.',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node) {
        if (calleeName(node) !== 'withRepeat') return;
        const reps = node.arguments[1];
        if (!reps) return; // default numberOfReps is 2
        let n = unwrap(reps);
        let negative = false;
        if (n.type === AST_NODE_TYPES.UnaryExpression && n.operator === '-') {
          negative = true;
          n = unwrap(n.argument);
        }
        if (n.type !== AST_NODE_TYPES.Literal || typeof n.value !== 'number') return;
        const value = negative ? -n.value : n.value;
        if (value <= 0) {
          context.report({ node, messageId: 'unbounded', data: { reps: String(value) } });
        }
      },
    };
  },
});
