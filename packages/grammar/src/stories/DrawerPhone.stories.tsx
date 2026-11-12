import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/** A side Drawer is FULL width under 768 (0.37.8): at a phone width no strip of the page stays visible beside it. */
const meta: Meta = { title: 'Overlays/Drawer on a phone' };
export default meta;
type Story = StoryObj;

export const FullWidthOnPhone: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  render: () => (
    <G.Drawer title="Parameters" closeLabel="Close" placement="right" isOpen onOpenChange={() => undefined} trigger={<G.Button>Open</G.Button>}>
      <G.Text>Drawer content.</G.Text>
    </G.Drawer>
  ),
  play: async () => {
    await waitFor(() => {
      const content = document.querySelector<HTMLElement>('.starci-core-drawer-content');
      if (content === null) throw new Error('the drawer renders');
      const box = content.getBoundingClientRect();
      if (window.innerWidth < 768) {
        expect(Math.round(box.left)).toBe(0);
        expect(Math.round(box.width)).toBe(window.innerWidth);
      } else {
        expect(box.width).toBeLessThanOrEqual(24 * 16 + 1);
      }
    });
  },
};
