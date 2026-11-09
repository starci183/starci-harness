import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/** LIST-ROW-NAVIGATION (0.37.6): a list row that opens something is pressable as a WHOLE row and ends in a chevron, by `href` or `onPress`; no per-row "Xem" button. */
const meta: Meta = { title: 'Surfaces/List row navigation' };
export default meta;
type Story = StoryObj;

export const WholeRowAndChevron: Story = {
  render: () => (
    <div style={{ width: 420 }}>
      <G.SurfaceCard
        kind="list"
        label="Kết nối"
        items={[
          { id: 'a', title: 'Telegram', description: 'Nhận tin khách', href: '#telegram' },
          { id: 'b', title: 'Zalo OA', description: 'Nhận tin khách', onPress: () => undefined },
        ]}
        empty={<G.EmptyNotice message="Trống" />}
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
