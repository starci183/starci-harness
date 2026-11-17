import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * One look for a list (0.43.0): a `Section kind="list"` is plain rows on whatever it stands on, the pink well or a white aside (`Pane surface`):
 * no frame, fill, radius or shadow, the rows divided by hairlines and their text on the section title's edge. A card draws its 1px
 * `--border` edge and no shadow on every ground (see `Surfaces/Pane footer and white-ground cards`).
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
            <G.Section kind="list" title="On pink" items={ROWS} empty={<G.EmptyNotice message="Empty" />} />
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
      for (const area of ['well', 'aside']) {
        const section = canvasElement.querySelector<HTMLElement>(`[data-grammar-pane-area="${area}"] [data-component="Section"]`);
        const list = section?.querySelector<HTMLElement>('.starci-core-section-list');
        if (section == null || list == null) throw new Error(`the ${area} list renders`);
        const style = getComputedStyle(list);
        expect(style.boxShadow).toBe('none');
        expect(Number.parseFloat(style.borderTopWidth)).toBe(0);
        expect(Number.parseFloat(style.borderTopLeftRadius)).toBe(0);
        expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)');
        const rows = Array.from(list.querySelectorAll<HTMLElement>('.starci-core-list-row'));
        expect(rows.length).toBe(2);
        // The row text starts on the section title's edge, and a hairline divides the rows.
        const heading = section.querySelector<HTMLElement>('h1, h2, h3, h4')!.getBoundingClientRect();
        const title = rows[0]!.querySelector<HTMLElement>('.starci-core-list-row-name')!.getBoundingClientRect();
        expect(Math.abs(title.left - heading.left)).toBeLessThanOrEqual(1);
        expect(Number.parseFloat(getComputedStyle(rows[1]!).borderTopWidth)).toBe(1);
      }
    });
  },
};
