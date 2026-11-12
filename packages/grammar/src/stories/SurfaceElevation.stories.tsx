import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * SURFACE-ELEVATION is automatic (0.37.5): a list card on the pink well draws a shadow and no border; the same list in a white aside (`Pane surface`) draws a 1px
 * border, the card radius and no shadow (0.37.24 reverts the flat aside list of 0.37.14), its rows divided full width and keeping the card's inline padding. The app never picks: a list is a `Section kind="list"` or a `SurfaceCard kind="list"` and the ground decides. (A `SurfaceCard` stands in a
 * `Pane surface` too, bordered the same way: see `Surfaces/Pane footer and white-ground cards`.)
 */
const meta: Meta = { title: 'Surfaces/Surface elevation' };
export default meta;
type Story = StoryObj;

const ROWS = [
  { id: 'a', title: 'Email', description: 'Receives customer messages' },
  { id: 'b', title: 'Chat', description: 'Receives customer messages' },
];

export const WellAndAside: Story = {
  render: () => (
    <div style={{ height: 360 }}>
      <G.PaneGrid label="Elevation" areas={['well aside']} columns={['fill', 'standard']}>
        <G.Pane area="well" label="Well">
          <G.PaneSection>
            <G.SurfaceCard kind="list" label="On pink" items={ROWS} empty={<G.EmptyNotice message="Empty" />} />
          </G.PaneSection>
        </G.Pane>
        <G.Pane area="aside" surface label="Aside">
          <G.PaneSection>
            <G.Section kind="list" title="On white" items={ROWS} empty={<G.EmptyNotice message="Empty" />} />
          </G.PaneSection>
        </G.Pane>
      </G.PaneGrid>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const well = canvasElement.querySelector<HTMLElement>('[data-grammar-pane-area="well"] .starci-core-surface[data-grammar-surface-kind="list"]');
      const aside = canvasElement.querySelector<HTMLElement>('[data-grammar-pane-area="aside"] .starci-core-section-list');
      if (well === null || aside === null) throw new Error('both lists render');
      const onWell = getComputedStyle(well);
      expect(onWell.boxShadow).not.toBe('none');
      expect(Number.parseFloat(onWell.borderTopWidth)).toBe(0);
      const onWhite = getComputedStyle(aside);
      expect(onWhite.boxShadow).toBe('none');
      expect(Number.parseFloat(onWhite.borderTopWidth)).toBe(1);
      expect(Number.parseFloat(onWhite.borderTopLeftRadius)).toBeGreaterThan(0);
      const rows = Array.from(aside.querySelectorAll<HTMLElement>('.starci-core-list-row'));
      expect(rows.length).toBe(2);
      // The rows keep the card's inline padding: their text stands inside the frame, not on the pane's edge.
      const title = rows[1]!.querySelector<HTMLElement>('.starci-core-list-row-name')!.getBoundingClientRect();
      expect(title.left).toBeGreaterThan(aside.getBoundingClientRect().left + 8);
      // A divider runs the frame's full width between the rows.
      expect(rows[1]!.getBoundingClientRect().left).toBeCloseTo(aside.getBoundingClientRect().left + 1, 0);
    });
  },
};
