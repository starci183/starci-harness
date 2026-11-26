import type { Meta, StoryObj } from '@storybook/react-vite';
import * as G from '../common/index.js';

/** A count of 0 is drawn on a section head and a card label as a grey "0" chip, right after the label (0.37.8, owner: only PAGE tabs hide 0). */
const meta: Meta = { title: 'Surfaces/Section count zero' };
export default meta;
type Story = StoryObj;

export const ZeroChip: Story = {
  render: () => (
    <div style={{ width: 420, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <G.Section kind="list" title="Needs attention" count={0} items={[]} empty={<G.EmptyNotice message="Nothing needs your attention" />} />
      <G.Section kind="list" title="Orders" count={0} items={[]} empty={<G.EmptyNotice message="No orders yet" />} />
    </div>
  ),
};
