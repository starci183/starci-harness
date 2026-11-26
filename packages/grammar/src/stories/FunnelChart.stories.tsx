import type { Meta, StoryObj } from '@storybook/react-vite';
import * as G from '../common/index.js';
import { Matrix, State, noop } from './fixtures.js';

/**
 * FunnelChart: stages in order, each "label · count" with the step into it (the down arrow icon and "60%") over a HeroUI ProgressBar md track (8px), the largest
 * drop in the danger ink; bars follow HeroUI ProgressBar sizes. Each story draws a state
 * shot at 1440 and at 390 (`npm run shoot`). The stages are generic (a name and a count); nothing
 * here is a product word.
 */
const meta: Meta = { title: 'Navigation & Data/Funnel chart', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

const grouped = (value: number) => value.toLocaleString('en-US');
const failure: G.ErrorData = { message: 'Could not load this', description: 'Check the connection and try again.', actionLabel: 'Try again', onAction: noop };
const emptyLine = <G.EmptyNotice message="No stages yet" description="Stages appear here once something has gone through." />;

const four: readonly G.FunnelChartStage[] = [
  { label: 'Stage one', count: 1240, value: '100 %' },
  { label: 'Stage two', count: 780, value: '63 %' },
  { label: 'Stage three', count: 310, value: '25 %' },
  { label: 'Stage four', count: 96, value: '8 %', tone: 'success' },
];
const toned: readonly G.FunnelChartStage[] = [
  { label: 'Stage one', count: 5000, tone: 'neutral' },
  { label: 'Stage two', count: 3200, tone: 'accent' },
  { label: 'Stage three', count: 1100, tone: 'warning', stepLabel: '2,100 stopped here' },
  { label: 'Stage four', count: 40, tone: 'danger' },
  { label: 'Stage five', count: 0 },
];

/** Four stages: tracks of one width at HeroUI ProgressBar's md height (8px), fills from one edge, the step text above each track. */
export const FunnelChartSteps: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="Four stages, a value at the end" direction="column">
        <G.FunnelChart label="Leads by stage" stages={four} empty={emptyLine} format={grouped} />
      </State>
      <State label="Every tone, a written step, a stage of zero" direction="column">
        <G.FunnelChart label="Orders by stage" stages={toned} empty={emptyLine} format={grouped} />
      </State>
    </Matrix>
  ),
};

/** At any width the text row sits over the track and the track keeps the chart's whole width. */
export const FunnelChartStacks: Story = {
  render: () => (
    <Matrix>
      <State label="In a 22rem column" direction="column">
        <div style={{ maxWidth: '22rem' }}><G.FunnelChart label="Leads by stage" stages={four} empty={emptyLine} format={grouped} /></div>
      </State>
      <State label="In a 44rem column" direction="column">
        <div style={{ maxWidth: '44rem' }}><G.FunnelChart label="Leads by stage" stages={four} empty={emptyLine} format={grouped} /></div>
      </State>
    </Matrix>
  ),
};

/** Edge counts: a stage that gained, an equal one, a stage after zero and a single stage draw their steps without a wrong number. */
export const FunnelChartEdges: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="A stage gains, one holds, one follows zero" direction="column">
        <G.FunnelChart
          label="Counts by stage"
          stages={[
            { label: 'Stage one', count: 100 },
            { label: 'Stage two', count: 120 },
            { label: 'Stage three', count: 120 },
            { label: 'Stage four', count: 0 },
            { label: 'Stage five', count: 0 },
          ]}
          empty={emptyLine}
        />
      </State>
      <State label="One stage" direction="column"><G.FunnelChart label="One count" stages={[{ label: 'Only stage', count: 12 }]} empty={emptyLine} /></State>
      <State label="Every stage at zero (empty)" direction="column"><G.FunnelChart label="Zero" stages={[{ label: 'Stage one', count: 0 }, { label: 'Stage two', count: 0 }]} empty={emptyLine} /></State>
    </Matrix>
  ),
};

/** The four states of a region: ready, loading (stages given kept, counts as geometry), empty and error. */
export const FunnelChartStates: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="Ready" direction="column"><G.FunnelChart label="Leads by stage" stages={four} empty={emptyLine} format={grouped} /></State>
      <State label="Loading (labels kept)" direction="column"><G.FunnelChart label="Leads by stage" stages={four} empty={emptyLine} format={grouped} isLoading /></State>
      <State label="Loading (no stages given)" direction="column"><G.FunnelChart label="Leads by stage" stages={[]} empty={emptyLine} isLoading /></State>
      <State label="Empty" direction="column"><G.FunnelChart label="Leads by stage" stages={[]} empty={emptyLine} /></State>
      <State label="Error" direction="column"><G.FunnelChart label="Leads by stage" stages={four} empty={emptyLine} error={failure} /></State>
    </Matrix>
  ),
};

/**
 * The compact funnel of ONE ROW (`layout="steps"`): a column per stage with its name, its count and the share that came through from the stage before, a short track under it, and
 * a side bucket (`lost`) for what left the funnel. From 36rem of chart width the columns stand side by side, every column one width; narrower, the same markup is the rows layout.
 * `quiet` takes the fills to the ink so a screen with its one accent keeps to the 10% budget.
 */
export const FunnelChartOneRow: Story = {
  render: () => (
    <Matrix maxWidth={900}>
      <State label="Steps with a lost bucket" direction="column">
        <G.FunnelChart
          label="Leads, last 7 days"
          layout="steps"
          stages={[
            { label: 'Came in', count: 42 },
            { label: 'Talked to', count: 32 },
            { label: 'Booked', count: 15 },
            { label: 'Closed', count: 6 },
          ]}
          lost={{ label: 'Not closed', count: 6, note: 'price 3 · no answer 2 · too far 1' }}
          empty={emptyLine}
          format={grouped}
        />
      </State>
      <State label="Steps, quiet" direction="column">
        <G.FunnelChart label="Leads, last 7 days" layout="steps" quiet stages={four} empty={emptyLine} format={grouped} />
      </State>
    </Matrix>
  ),
};
