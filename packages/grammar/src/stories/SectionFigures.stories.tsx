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

const trendFigures: readonly G.Figure[] = [
  { id: 'revenue', term: 'Revenue', value: '48.2M', meta: '12% vs last month', trend: 'up', trendLine: [12, 14, 13, 18, 17, 22, 21, 27, 25, 31] },
  { id: 'churn', term: 'Churn', value: '3.1', unit: '%', meta: '0.4 pt vs last month', trend: 'up', trendSense: 'lower-is-better', trendLine: [2, 2.4, 2.2, 2.9, 3.1] },
  { id: 'cost', term: 'Cost per lead', value: '92k', meta: '8% vs last month', trend: 'down', trendSense: 'lower-is-better' },
  { id: 'orders', term: 'Orders', value: 310, meta: 'Same as last month', trend: 'flat' },
];

/** `Figure.trend` marks the meta line (decorative triangle in the tone, direction also in words); `trendLine` draws a Sparkline under the cell. */
export const TrendAndSparkline: Story = {
  render: () => (
    <Matrix maxWidth={960}>
      <State label="Up (success), up but lower is better (danger), down but lower is better (success), flat; two cells carry a trend line" direction="column"><G.Section kind="figures" title="Overview" items={trendFigures} /></State>
      <State label="Loading keeps the cells, the meta and the line's box" direction="column"><G.Section kind="figures" title="Overview" items={trendFigures} isLoading /></State>
    </Matrix>
  ),
};
