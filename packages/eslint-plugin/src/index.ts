import type { TSESLint } from '@typescript-eslint/utils';

import flashlistHeterogeneousItemType from './rules/flashlist-heterogeneous-item-type';
import noFontWeightWithCustomFont from './rules/no-font-weight-with-custom-font';
import noFractionalPixelUnit from './rules/no-fractional-pixel-unit';
import noSvgElementPerItem from './rules/no-svg-element-per-item';
import noUnboundedRepeat from './rules/no-unbounded-repeat';
import noValueInInlineStyle from './rules/no-value-in-inline-style';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { name, version } = require('../package.json') as { name: string; version: string };

const rules = {
  'flashlist-heterogeneous-item-type': flashlistHeterogeneousItemType,
  'no-font-weight-with-custom-font': noFontWeightWithCustomFont,
  'no-fractional-pixel-unit': noFractionalPixelUnit,
  'no-svg-element-per-item': noSvgElementPerItem,
  'no-unbounded-repeat': noUnboundedRepeat,
  'no-value-in-inline-style': noValueInInlineStyle,
} satisfies Record<string, TSESLint.RuleModule<string, readonly unknown[]>>;

type Plugin = {
  meta: { name: string; version: string };
  rules: typeof rules;
  configs: Record<'recommended' | 'strict', TSESLint.FlatConfig.Config>;
};

const plugin: Plugin = {
  meta: { name, version },
  rules,
  configs: {} as Plugin['configs'],
};

const recommendedRules: TSESLint.FlatConfig.Rules = {
  'react-native-perfkit/flashlist-heterogeneous-item-type': 'error',
  'react-native-perfkit/no-font-weight-with-custom-font': 'error',
  'react-native-perfkit/no-fractional-pixel-unit': 'error',
  'react-native-perfkit/no-svg-element-per-item': 'warn',
  'react-native-perfkit/no-value-in-inline-style': 'error',
};

plugin.configs.recommended = {
  name: 'react-native-perfkit/recommended',
  plugins: { 'react-native-perfkit': plugin as unknown as TSESLint.FlatConfig.Plugin },
  rules: recommendedRules,
};

plugin.configs.strict = {
  name: 'react-native-perfkit/strict',
  plugins: { 'react-native-perfkit': plugin as unknown as TSESLint.FlatConfig.Plugin },
  rules: {
    ...recommendedRules,
    'react-native-perfkit/no-svg-element-per-item': 'error',
    'react-native-perfkit/no-unbounded-repeat': 'warn',
  },
};

export = plugin;
