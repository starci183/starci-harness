import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * Outline glyphs inside vendor slots (0.37.5): the Select chevron, the search icon and the number steppers are sized by the Icon usage box and never stretch to their
 * slot (0.37.4 shipped them with no size, and a chevron filled a whole search row). A Select, a SearchField and a NumberField stand in a card header and every svg is a 16px glyph.
 */
const meta: Meta = { title: 'Surfaces/Glyph sizing' };
export default meta;
type Story = StoryObj;

const OPTIONS = [
  { id: 'all', label: 'All' },
  { id: 'paid', label: 'Paid' },
];

export const InCardHeaders: Story = {
  render: () => (
    <div style={{ width: 'min(100%, 720px)' }}>
      <G.SurfaceCard
        kind="list"
        label="Orders"
        headers={[
          {
            kind: 'custom',
            children: (
              <G.Cluster gap="row">
                <G.Select label="Status" isLabelHidden options={OPTIONS} defaultValue="all" />
                <G.SearchField label="Search orders" isLabelHidden />
                <G.NumberField label="Quantity" isLabelHidden defaultValue={1} />
              </G.Cluster>
            ),
          },
        ]}
        items={[{ id: 'a', title: 'DH-1001' }]}
        empty={<G.EmptyNotice message="Empty" />}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const svgs = Array.from(canvasElement.querySelectorAll<SVGSVGElement>('svg'));
      expect(svgs.length).toBeGreaterThan(2);
      for (const svg of svgs) {
        const box = svg.getBoundingClientRect();
        expect(box.width).toBeLessThanOrEqual(24);
        expect(box.height).toBeLessThanOrEqual(24);
      }
    });
  },
};
