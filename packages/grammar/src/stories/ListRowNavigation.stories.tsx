import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/** LIST-ROW-NAVIGATION (0.37.6): a list row that opens something is pressable as a WHOLE row and ends in a chevron, by `href` or `onPress`; no per-row "View" button. */
const meta: Meta = { title: 'Surfaces/List row navigation' };
export default meta;
type Story = StoryObj;

export const WholeRowAndChevron: Story = {
  render: () => (
    <div style={{ width: 420 }}>
      <G.SurfaceCard
        kind="list"
        label="Connections"
        items={[
          { id: 'a', title: 'Chat', description: 'Receives customer messages', href: '#chat' },
          { id: 'b', title: 'Email', description: 'Receives customer messages', onPress: () => undefined },
        ]}
        empty={<G.EmptyNotice message="Empty" />}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const rows = Array.from(canvasElement.querySelectorAll<HTMLElement>('.starci-core-list-row'));
      expect(rows.length).toBe(2);
      for (const row of rows) {
        expect(row.getAttribute('data-grammar-row-pressable')).toBe('true');
        expect(row.querySelector('[data-grammar-row-chevron="true"]')).not.toBeNull();
        const target = row.querySelector<HTMLElement>('.starci-core-list-row-name > *')!;
        const after = getComputedStyle(target, '::after');
        expect(after.position).toBe('absolute');
      }
    });
  },
};

/** 0.37.14: an internal `href` row is a navigation row: the title is NOT link-coloured and has no ↗, the chevron ends the row, the real anchor stays. */
export const InternalHrefHasNoArrow: Story = {
  render: () => (
    <div style={{ width: 420 }}>
      <G.SurfaceCard
        kind="list"
        label="Documents"
        items={[{ id: 'a', title: 'Introduction to HTTP', description: 'Part 1', href: '/docs/http' }]}
        empty={<G.EmptyNotice message="Empty" />}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const anchor = canvasElement.querySelector<HTMLAnchorElement>('.starci-core-list-row-name a')!;
      expect(anchor.getAttribute('href')).toBe('/docs/http');
      expect(anchor.querySelector('[data-grammar-link-icon]')).toBeNull();
      expect(getComputedStyle(anchor).color).toBe(getComputedStyle(anchor.closest('.starci-core-list-row')!).color);
      expect(canvasElement.querySelector('[data-grammar-row-chevron="true"]')).not.toBeNull();
    });
  },
};

/** 0.37.14: the ↗ belongs to `kind="external"` only; an internal text link has none and keeps the accent colour; `variant="plain"` has neither colour nor icon. */
export const LinkArrowOnlyWhenExternal: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <G.Link href="/in-app">Internal link</G.Link>
      <G.Link href="https://example.com" kind="external">External link</G.Link>
      <G.Link href="/home" variant="plain">Brand</G.Link>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const links = Array.from(canvasElement.querySelectorAll<HTMLAnchorElement>('a'));
      expect(links.map((link) => link.querySelector('[data-grammar-link-icon]') !== null)).toEqual([false, true, false]);
      expect(getComputedStyle(links[2]!).color).not.toBe(getComputedStyle(links[0]!).color);
    });
  },
};
