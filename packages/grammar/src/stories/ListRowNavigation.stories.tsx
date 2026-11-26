import type { Meta, StoryObj } from '@storybook/react-vite';
import * as G from '../common/index.js';

/** LIST-ROW-NAVIGATION (0.37.6): a list row that opens something is pressable as a WHOLE row and ends in a chevron, by `href` or `onPress`; no per-row "View" button. */
const meta: Meta = { title: 'Surfaces/List row navigation' };
export default meta;
type Story = StoryObj;

export const WholeRowAndChevron: Story = {
  render: () => (
    <div style={{ width: 420 }}>
      <G.Section
        kind="list"
        title="Connections"
        items={[
          { id: 'a', title: 'Chat', description: 'Receives customer messages', href: '#chat' },
          { id: 'b', title: 'Email', description: 'Receives customer messages', onPress: () => undefined },
        ]}
        empty={<G.EmptyNotice message="Empty" />}
      />
    </div>
  ),
};

/** 0.37.14: an internal `href` row is a navigation row: the title is NOT link-coloured and has no external icon, the chevron ends the row, the real anchor stays. */
export const InternalHrefHasNoArrow: Story = {
  render: () => (
    <div style={{ width: 420 }}>
      <G.Section
        kind="list"
        title="Documents"
        items={[{ id: 'a', title: 'Introduction to HTTP', description: 'Part 1', href: '/docs/http' }]}
        empty={<G.EmptyNotice message="Empty" />}
      />
    </div>
  ),
};

/** 0.37.14: the external icon belongs to `kind="external"` only; an internal text link has none and keeps the accent colour; `variant="plain"` has neither colour nor icon. */
export const LinkArrowOnlyWhenExternal: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <G.Link href="/in-app">Internal link</G.Link>
      <G.Link href="https://example.com" kind="external">External link</G.Link>
      <G.Link href="/home" variant="plain">Brand</G.Link>
    </div>
  ),
};
