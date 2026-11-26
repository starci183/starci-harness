import type { Meta, StoryObj } from '@storybook/react-vite';
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
};
