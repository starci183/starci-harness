import type { Meta, StoryObj } from '@storybook/react-vite';
import * as G from '../common/index.js';
import { Matrix, State, noop } from './fixtures.js';

/**
 * IntervalChart: ranges on one scale, a point in each and one reference line. Each story draws a state, shot
 * at 1440 and at 390 (`npm run shoot`). The rows are generic (a measure, a low, a high and a point); nothing here is a product word.
 */
const meta: Meta = { title: 'Navigation & Data/Interval chart', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

const percent = (value: number) => `${value} %`;
const failure: G.ErrorData = { message: 'Could not load this', description: 'Check the connection and try again.', actionLabel: 'Try again', onAction: noop };
const emptyLine = <G.EmptyNotice message="No ranges yet" description="Rows appear here once there is something to compare." />;

const clear: readonly G.IntervalChartRow[] = [
  { label: 'Option A, control', low: 3.2, high: 5.0, point: 4.1, isReference: true },
  { label: 'Option B', low: 5.2, high: 7.4, point: 6.3, tone: 'success' },
];
const leaning: readonly G.IntervalChartRow[] = [
  { label: 'Option A, control', low: 3.2, high: 5.0, point: 4.1, isReference: true },
  { label: 'Option B', low: 3.9, high: 6.6, point: 5.2, tone: 'accent' },
  { label: 'Option C', low: 2.1, high: 4.8, point: 3.4, tone: 'danger' },
  { label: 'Option D', low: 3.0, high: 6.0, point: 4.4, tone: 'warning' },
];

const noTone: readonly G.IntervalChartRow[] = leaning.slice(1).map(({ label, low, high, point }) => ({ label, low, high, point }));

/** Two rows with the reference: the range, the point and the dashed line; every plot is one width and the line stands at one place. */
export const IntervalChartReference: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="Reference row, one tone per row" direction="column">
        <G.IntervalChart label="Rate by option, 90 % interval" rows={clear} empty={emptyLine} format={percent} />
      </State>
      <State label="Four rows, every tone, an overlap" direction="column">
        <G.IntervalChart label="Rate by option, 90 % interval" rows={leaning} empty={emptyLine} format={percent} />
      </State>
    </Matrix>
  ),
};

/** At 33rem of chart width or less the label and value sit over the plot, whatever the page; wide, the row is one line. */
export const IntervalChartStacks: Story = {
  render: () => (
    <Matrix>
      <State label="In a 22rem column (stacked)" direction="column">
        <div style={{ maxWidth: '22rem' }}><G.IntervalChart label="Rate by option, 90 % interval" rows={clear} empty={emptyLine} format={percent} /></div>
      </State>
      <State label="In a 44rem column (one line per row)" direction="column">
        <div style={{ maxWidth: '44rem' }}><G.IntervalChart label="Rate by option, 90 % interval" rows={clear} empty={emptyLine} format={percent} /></div>
      </State>
    </Matrix>
  ),
};

/** A chart with no reference row draws no line; a row without a tone takes the accent. */
export const IntervalChartNoReference: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="No reference row" direction="column">
        <G.IntervalChart label="Range by plan" rows={noTone} empty={emptyLine} format={percent} />
      </State>
      <State label="A written value label" direction="column">
        <G.IntervalChart label="Range by plan" rows={[{ label: 'Plan X', low: 10, high: 30, point: 18, valueLabel: 'about 18, between 10 and 30' }]} empty={emptyLine} />
      </State>
    </Matrix>
  ),
};

/** The four states of a region: ready, loading (rows given kept, values as geometry), empty and error. */
export const IntervalChartStates: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="Ready" direction="column"><G.IntervalChart label="Rate by option" rows={leaning} empty={emptyLine} format={percent} /></State>
      <State label="Loading (labels kept)" direction="column"><G.IntervalChart label="Rate by option" rows={leaning} empty={emptyLine} format={percent} isLoading /></State>
      <State label="Loading (no rows given)" direction="column"><G.IntervalChart label="Rate by option" rows={[]} empty={emptyLine} isLoading /></State>
      <State label="Empty" direction="column"><G.IntervalChart label="Rate by option" rows={[]} empty={emptyLine} /></State>
      <State label="Error" direction="column"><G.IntervalChart label="Rate by option" rows={leaning} empty={emptyLine} error={failure} /></State>
    </Matrix>
  ),
};
