import type { Meta, StoryObj } from '@storybook/react-vite';
import * as G from '../common/index.js';
import { Matrix, State } from './fixtures.js';

const meta: Meta = { title: 'Surfaces/Section figures' };
export default meta;
type Story = StoryObj;
const figures: readonly G.Figure[] = [
  { id: 'waiting', term: 'Awaiting review', value: 3, meta: 'Open the current requests', href: '#requests' },
  { id: 'completed', term: 'Completed', value: 24, meta: 'This month' },
  { id: 'coverage', term: 'Coverage', value: 97, unit: '%' },
];

export const HeadlessInPane: Story = {
  render: () => (
    <Matrix maxWidth={960}>
      <State label="The pane keeps its heading; the figures add no surface or second heading" direction="column">
        <G.PaneGrid label="Connection details" areas={['main']} columns={['fill']}>
          <G.Pane area="main" surface>
            <G.PaneSection>
              <G.Heading level={2}>Connection overview</G.Heading>
              <G.Section kind="figures" ariaLabel="Connection activity" items={figures} />
            </G.PaneSection>
          </G.Pane>
        </G.PaneGrid>
      </State>
    </Matrix>
  ),
};

export const States: Story = {
  render: () => (
    <Matrix maxWidth={960}>
      <State label="Known rows retain their geometry while loading" direction="column"><G.Section kind="figures" title="Activity" items={figures} isLoading /></State>
      <State label="Unknown loading shape uses the shared three-cell owner" direction="column"><G.Section kind="figures" ariaLabel="Activity loading" items={[]} isLoading /></State>
      <State label="Failure keeps the visible heading" direction="column"><G.Section kind="figures" title="Activity" items={figures} error={{ message: 'The activity could not be loaded.' }} /></State>
    </Matrix>
  ),
};
