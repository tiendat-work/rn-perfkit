#!/bin/bash
# Dogfood: run the built plugin against the English app.
#  1) HEAD must be clean (no false positives on fixed code)
#  2) the historical buggy versions must be flagged (true positives)
set -e
APP=/Users/lycan/Projects/English/apps/mobile
PLUGIN=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
cat > "$WORK/eslint.config.cjs" <<EOF
const tsParser = require(require.resolve('@typescript-eslint/parser', { paths: ['$PLUGIN'] }));
const perf = require('$PLUGIN/dist/index.js');
const stub = { meta: { schema: false }, create: () => ({}) };
module.exports = [
  { plugins: { '@typescript-eslint': { rules: { 'no-require-imports': stub, 'no-empty-object-type': stub } } } },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    plugins: { 'react-native-perfkit': perf },
    rules: {
      ...perf.configs.strict.rules,
      'react-native-perfkit/flashlist-heterogeneous-item-type': ['error', { components: ['FlashList', 'PixelPullRefresh'] }],
      'react-native-perfkit/no-font-weight-with-custom-font': ['error', { customFontsOnly: true }],
    },
  },
];
EOF
ESL="$PLUGIN/node_modules/.bin/eslint --no-config-lookup -c $WORK/eslint.config.cjs --format stylish"

echo "== 1) English HEAD (src/) =="
(cd "$APP" && $ESL src 2>&1 | sed "s#$APP/##" | grep -v '^$' || true) | tail -40

echo
echo "== 2) historical versions =="
mkdir -p "$WORK/hist"
cd "$APP"
hist() { # sha file label
  git show "$1^:apps/mobile/$2" > "$WORK/hist/$3.tsx"
}
hist a21fa7e src/features/gallery/components/ColorDemos.tsx ColorDemos_before_a21fa7e
hist a21fa7e src/features/gallery/components/IconDemos.tsx IconDemos_before_a21fa7e
hist a21fa7e src/features/gallery/screens/ComponentGalleryScreen.tsx Gallery_before_a21fa7e
hist 2e2bc7d src/components/pixel/PixelToggle.tsx PixelToggle_before_2e2bc7d
hist 2e2bc7d src/components/ui/Text/Text.tsx Text_before_2e2bc7d
(cd "$WORK/hist" && $ESL . 2>&1 | sed "s#$WORK/hist/##" | grep -v '^$' || true)
rm -rf "$WORK"
