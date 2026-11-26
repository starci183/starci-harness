import type { Meta, StoryObj } from '@storybook/react-vite';
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
};
