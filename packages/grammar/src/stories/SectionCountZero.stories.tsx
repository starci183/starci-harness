import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/** A count of 0 is drawn on a section head and a card label as a grey "0" chip, right after the label (0.37.8, owner: only PAGE tabs hide 0). */
const meta: Meta = { title: 'Surfaces/Section count zero' };
export default meta;
type Story = StoryObj;

export const ZeroChip: Story = {
  render: () => (
    <div style={{ width: 420, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <G.Section kind="list" title="Needs attention" count={0} items={[]} empty={<G.EmptyNotice message="Nothing needs your attention" />} />
      <G.SurfaceCard kind="list" label="Orders" count={0} items={[]} empty={<G.EmptyNotice message="No orders yet" />} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const chips = Array.from(canvasElement.querySelectorAll<HTMLElement>('[data-grammar-section-count="0"]'));
      expect(chips.length).toBe(2);
      for (const chip of chips) {
        expect(chip.textContent).toBe('0');
        expect(chip.getAttribute('data-grammar-attention')).toBeNull();
        expect(getComputedStyle(chip).fontSize).toBe('12px');
        const label = chip.previousElementSibling ?? chip.parentElement?.firstElementChild;
        expect(label).not.toBeNull();
      }
    });
  },
};
