import rule from '../src/rules/no-svg-element-per-item';
import { ruleTester } from './ruleTester';

ruleTester.run('no-svg-element-per-item', rule, {
  valid: [
    // One concatenated path (the fix).
    `import { Path, Svg } from 'react-native-svg';
     <Svg><Path d={allGlyphsPath()} fill={color} /></Svg>`,
    // Small static arrays are fine (a 4-layer sprite).
    `import { Path } from 'react-native-svg';
     const LAYERS = ['o', 'd', 'b', 'l'];
     LAYERS.map((l) => <Path key={l} d={paths[l]} fill={ramp[l]} />)`,
    // Mapping to non-SVG components.
    `import { Path } from 'react-native-svg';
     items.map((i) => <Row key={i.id} />)`,
    // Skia Path is not react-native-svg.
    `import { Path } from '@shopify/react-native-skia';
     cells.map((c) => <Path key={c.id} path={c.p} />)`,
  ],
  invalid: [
    {
      // The historical IconDemos (before a21fa7e): <G> + <Path> per glyph.
      code: `import { G, Path, Svg } from 'react-native-svg';
        GLYPH_NAMES.map((name, i) => (
          <G key={name} transform={t(i)}><Path d={glyphPath(name)} fill={color} /></G>
        ))`,
      errors: [{ messageId: 'svgPerItem', data: { element: 'G' } }],
    },
    {
      // N <Rect> per glyph run (the 6-7s freeze).
      code: `import Svg, { Rect } from 'react-native-svg';
        runs.map((r) => <Rect key={r.x + '-' + r.y} x={r.x} y={r.y} width={r.w} height={1} />)`,
      errors: [{ messageId: 'svgPerItem', data: { element: 'Rect' } }],
    },
    {
      code: `import * as Svg from 'react-native-svg';
        dots.map((d) => { return <Svg.Circle key={d.id} cx={d.x} cy={d.y} r={1} />; })`,
      errors: [{ messageId: 'svgPerItem', data: { element: 'Circle' } }],
    },
  ],
});
