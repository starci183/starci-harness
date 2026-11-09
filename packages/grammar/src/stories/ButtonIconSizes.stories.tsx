import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * A Button with an icon takes HeroUI v3's measures (0.37.5): padding-inline px-3 on sm and px-4 on md and lg on both sides, an 8px gap, the icon 16px from 640px
 * (20px on a phone) with the vendor's -2px inline margin. `sm` carries no icon in the app (owner rule) and is shown here only for the measure.
 */
const meta: Meta = { title: 'Controls/Button icon sizes' };
export default meta;
type Story = StoryObj;

export const Sizes: Story = {
  render: () => (
    <G.Stack gap="section">
      <G.Cluster gap="row">
        <G.Button intent="commit" size="md" startGlyph="plus">Thêm</G.Button>
        <G.Button intent="commit" size="lg" startGlyph="plus">Thêm</G.Button>
        <G.Button intent="commit" size="md">Thêm</G.Button>
        <G.Button intent="neutral" size="md" endArrow>Mở</G.Button>
        <G.Button intent="neutral" size="sm" endArrow>Mở</G.Button>
      </G.Cluster>
    </G.Stack>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const buttons = Array.from(canvasElement.querySelectorAll<HTMLElement>('[data-component="Button"]'));
      const expected = [
        { pad: 16, icon: 16 },
        { pad: 16, icon: 16 },
        { pad: 12, icon: 0 },
        { pad: 16, icon: 16 },
        { pad: 12, icon: 16 },
      ];
      expect(buttons.length).toBe(5);
      buttons.forEach((button, index) => {
        const want = expected[index]!;
        const style = getComputedStyle(button);
        if (want.icon > 0) {
          expect(Number.parseFloat(style.paddingInlineStart)).toBe(want.pad);
          expect(Number.parseFloat(style.paddingInlineEnd)).toBe(want.pad);
          expect(Number.parseFloat(style.columnGap)).toBe(8);
          const icon = button.querySelector<SVGElement>('svg')!.getBoundingClientRect();
          expect(Math.round(icon.width)).toBe(want.icon);
        }
      });
    });
  },
};
