import rule from '../src/rules/flashlist-heterogeneous-item-type';
import { ruleTester } from './ruleTester';

// The English gallery shape: a static array of sections, each with its own render().
const SECTIONS = `
const SECTIONS = [
  { key: 'button', render: () => <ButtonDemos /> },
  { key: 'icon', render: () => <IconDemos /> },
];`;

ruleTester.run('flashlist-heterogeneous-item-type', rule, {
  valid: [
    // Fixed version: getItemType present.
    `${SECTIONS}
     function renderSection({ item }) { return <SectionCell item={item} />; }
     const getItemType = (s) => s.key;
     <FlashList data={SECTIONS} renderItem={renderSection} getItemType={getItemType} />`,
    // Homogeneous list: same row component for every item.
    `<FlashList data={decks} renderItem={({ item }) => <DeckRow deck={item} />} />`,
    // Spread props: can't know, stay silent.
    `<FlashList {...listProps} />`,
    // Not a configured component.
    `<FlatList data={rows} renderItem={({ item }) => item.render()} />`,
  ],
  invalid: [
    {
      // The historical ComponentGalleryScreen (before a21fa7e).
      code: `${SECTIONS}
        function renderSection({ item }) {
          return <View>{item.render()}</View>;
        }
        <FlashList data={SECTIONS} renderItem={renderSection} />`,
      errors: [{ messageId: 'missingItemType' }],
    },
    {
      code: `<FlashList data={rows} renderItem={({ item }) => { switch (item.type) { case 'a': return <A />; default: return <B />; } }} />`,
      errors: [{ messageId: 'missingItemType' }],
    },
    {
      code: `<FlashList data={rows} renderItem={(info) => info.item.render()} />`,
      errors: [{ messageId: 'missingItemType' }],
    },
    {
      code: `<FlashList data={rows} renderItem={({ item }) => <item.Component />} />`,
      errors: [{ messageId: 'missingItemType' }],
    },
    {
      // Detected from data alone when renderItem is opaque.
      code: `${SECTIONS}
        <FlashList data={SECTIONS} renderItem={renderOpaque} />`,
      errors: [{ messageId: 'missingItemType' }],
    },
    {
      // Wrapper components are configurable.
      code: `<PixelPullRefresh data={rows} renderItem={({ item }) => item.render()} />`,
      options: [{ components: ['FlashList', 'PixelPullRefresh'] }],
      errors: [{ messageId: 'missingItemType' }],
    },
  ],
});
