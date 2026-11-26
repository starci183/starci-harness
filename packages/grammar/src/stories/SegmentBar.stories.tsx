import type { Meta, StoryObj } from '@storybook/react-vite';
import * as G from '../common/index.js';
import { Matrix, State, noop } from './fixtures.js';

/**
 * SegmentBar: rows of bars on ONE scale (the longest row is the full track), each split into the series' segments, with the row's own reading at its end and a legend of the series
 * under the rows. Where `ProportionBar` is one whole, this is several wholes told against each other (leads by channel and how many booked). The track is HeroUI ProgressBar's. The
 * quiet colour mode makes the first series the ink and the rest the muted step, so the chart adds no accent.
 */
const meta: Meta = { title: 'Navigation & Data/Segment bar', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

const series: readonly G.SegmentBarSeries[] = [
  { id: 'booked', label: 'Booked' },
  { id: 'open', label: 'Not yet' },
];
const rows: readonly G.SegmentBarRow[] = [
  { id: 'web', label: 'Web form', values: { booked: 4, open: 6 }, valueLabel: '4 / 10' },
  { id: 'chat', label: 'Chat', values: { booked: 1, open: 6 }, valueLabel: '1 / 7' },
  { id: 'phone', label: 'Phone', values: { booked: 2, open: 2 }, valueLabel: '2 / 4' },
  { id: 'walk', label: 'Walk-in', values: { booked: 1, open: 1 }, valueLabel: '1 / 2' },
];
const emptyLine = <G.EmptyNotice message="No leads yet" />;
const failure: G.ErrorData = { message: 'Could not load this', description: 'Check the connection and try again.', actionLabel: 'Try again', onAction: noop };

/** Ready (tones in order), quiet (ink and muted), loading, empty and error. */
export const SegmentBarStates: Story = {
  render: () => (
    <Matrix maxWidth={480}>
      <State label="Ready" direction="column"><G.SegmentBar label="Leads by channel" series={series} rows={rows} empty={emptyLine} /></State>
      <State label="Quiet" direction="column"><G.SegmentBar label="Leads by channel" series={series} rows={rows} empty={emptyLine} quiet /></State>
      <State label="Loading" direction="column"><G.SegmentBar label="Leads by channel" series={series} rows={rows} empty={emptyLine} isLoading /></State>
      <State label="Empty" direction="column"><G.SegmentBar label="Leads by channel" series={series} rows={[]} empty={emptyLine} /></State>
      <State label="Error" direction="column"><G.SegmentBar label="Leads by channel" series={series} rows={rows} empty={emptyLine} error={failure} /></State>
    </Matrix>
  ),
};
