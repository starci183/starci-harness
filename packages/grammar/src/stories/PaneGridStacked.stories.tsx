import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * PANE-GRID-STACKED (0.37.14): below the stacking breakpoint (48rem of the grid's own width) the panes stop owning their scroll and grow with their content, so the page scrolls
 * once; the aside is the first block of the well (before: each pane clipped its content and the well overlapped the aside's last lines).
 */
const meta: Meta = { title: 'Surfaces/Pane grid stacked' };
export default meta;
type Story = StoryObj;

const ASIDE_ROWS = Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, title: `Item ${i + 1}`, description: 'Description of the item sits on the second line' }));
const WELL_ROWS = Array.from({ length: 6 }, (_, i) => ({ id: `w${i}`, title: `Milestone ${i + 1}`, description: '0/3 tasks done', href: `#m${i}` }));

const Detail = () => (
  <G.PaneGrid label="Details" areas={{ base: ['aside', 'main'], wide: ['main aside'] }} columns={{ base: ['fill'], wide: ['fill', 'standard'] }}>
    <G.Pane area="aside" surface label="Info">
      <G.PaneSection>
        <G.Section kind="list" title="Repository" items={ASIDE_ROWS} empty={<G.EmptyNotice message="Empty" />} />
      </G.PaneSection>
    </G.Pane>
    <G.Pane area="main" label="Content">
      <G.PaneSection>
        <G.SurfaceCard kind="list" label="Milestone" items={WELL_ROWS} empty={<G.EmptyNotice message="Empty" />} />
      </G.PaneSection>
    </G.Pane>
  </G.PaneGrid>
);

/** In a host of a fixed height, a grid narrower than 48rem (390 and 600 here; 768 and up lays the panes side by side) shows the aside first, whole, and the well below it: no pane clips, no overlap, and the host scrolls once. */
export const AsideThenWell: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div data-width="390" style={{ inlineSize: 390, blockSize: 480, overflowY: 'auto' }}><Detail /></div>
      <div data-width="600" style={{ inlineSize: 600, blockSize: 480, overflowY: 'auto' }}><Detail /></div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      for (const host of Array.from(canvasElement.querySelectorAll<HTMLElement>('[data-width]'))) {
        const aside = host.querySelector<HTMLElement>('[data-grammar-pane-area="aside"]');
        const well = host.querySelector<HTMLElement>('[data-grammar-pane-area="main"]');
        if (aside === null || well === null) throw new Error('both panes render');
        // The aside shows all its content: no clipped scroll, and the well starts at or below its bottom edge.
        expect(aside.scrollHeight).toBeLessThanOrEqual(aside.clientHeight + 1);
        expect(well.getBoundingClientRect().top).toBeGreaterThanOrEqual(aside.getBoundingClientRect().bottom - 1);
        expect(well.scrollHeight).toBeLessThanOrEqual(well.clientHeight + 1);
        // The grid grows with its content: it holds the well's bottom.
        const grid = host.querySelector<HTMLElement>('.starci-core-pane-grid')!;
        expect(grid.getBoundingClientRect().bottom).toBeGreaterThanOrEqual(well.getBoundingClientRect().bottom - 1);
        expect(host.scrollHeight).toBeGreaterThan(host.clientHeight);
      }
    });
  },
};
