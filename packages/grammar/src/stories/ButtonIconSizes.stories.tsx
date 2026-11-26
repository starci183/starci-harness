import type { Meta, StoryObj } from '@storybook/react-vite';
import * as G from '../common/index.js';

/**
 * A Button with an icon takes HeroUI v3's padding (0.37.5): padding-inline px-3 on sm and px-4 on md and lg on both sides, an 8px gap, the vendor's -2px inline margin.
 * Its icon follows the Button's height (the icon size table, owner 2026-11-23): 20 in a 40 (md) or 48 (lg) button at every width, 16 in a 32 (sm) one. `sm` carries no
 * start icon in the app and is shown here only for the measure.
 */
const meta: Meta = { title: 'Controls/Button icon sizes' };
export default meta;
type Story = StoryObj;

export const Sizes: Story = {
  parameters: { grammar: { catalog: true } },
  render: () => (
    <G.Stack gap="section">
      <G.Cluster gap="row">
        <G.Button variant="primary" size="md" startGlyph="plus">Add</G.Button>
        <G.Button variant="primary" size="lg" startGlyph="plus">Add</G.Button>
        <G.Button variant="primary" size="md">Add</G.Button>
        <G.Button variant="border" size="md" endArrow>Open</G.Button>
        <G.Button variant="border" size="sm" endArrow>Open</G.Button>
      </G.Cluster>
    </G.Stack>
  ),
};
