import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * A labelled Switch is ONE row (0.37.5, owner): the label (14, weight 500) and the description (12, muted) at the start filling the row, the control at the end edge,
 * centred vertically, the whole row the hit target. A switch with a hidden label is the bare control.
 */
const meta: Meta = { title: 'Controls/Switch row' };
export default meta;
type Story = StoryObj;

export const LabelledRow: Story = {
  render: () => (
    <div style={{ width: 420 }}>
      <G.Switch label="Tự động trả lời" description="Agent trả lời khách ngay, bạn xem lại sau." defaultSelected />
      <G.Switch description="Mô tả ngắn." label="Chỉ nhãn" />
      <G.Switch label="Giao diện tối" isLabelHidden />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const [row] = Array.from(canvasElement.querySelectorAll<HTMLElement>('[data-component="Switch"][data-grammar-switch-labelled="true"]'));
      if (row === undefined) throw new Error('the labelled switch renders');
      const box = row.getBoundingClientRect();
      const text = row.querySelector<HTMLElement>('.starci-core-switch-text')!.getBoundingClientRect();
      const control = row.querySelector<HTMLElement>('[data-grammar-switch-track="true"]')!.getBoundingClientRect();
      expect(text.left).toBeLessThan(control.left);
      expect(Math.abs(control.right - box.right)).toBeLessThanOrEqual(1);
      expect(Math.abs((control.top + control.bottom) / 2 - (box.top + box.bottom) / 2)).toBeLessThanOrEqual(2);
    });
  },
};
