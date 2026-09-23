import { ESLintUtils } from '@typescript-eslint/utils';

export type RuleDocs = {
  description: string;
  /** Short, measured reason this rule exists (shown in docs). */
  measured?: string;
  recommended?: boolean;
};

export const createRule = ESLintUtils.RuleCreator<RuleDocs>(
  (name) => `https://github.com/tiendat-work/rn-perfkit/blob/main/packages/eslint-plugin/docs/rules/${name}.md`,
);
