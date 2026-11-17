import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';
import * as G from '../common/index.js';
import { Matrix, State, noop } from './fixtures.js';

/**
 * IntervalChart: ranges on one scale, a point in each and one reference line. Each story draws a state and its play function proves it,
 * at 1440 and at 390 (`npm run prove-plays`). The rows are generic (a measure, a low, a high and a point); nothing here is a product word.
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

const boxOf = (root: HTMLElement, selector: string): HTMLElement => {
  const found = root.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`no element for ${selector}`);
  return found;
};
const all = (root: ParentNode, selector: string): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(selector));
const centre = (element: HTMLElement) => {
  const rect = element.getBoundingClientRect();
  return rect.left + rect.width / 2;
};

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
  play: async ({ canvasElement }) => {
    const charts = all(canvasElement, '[data-component="IntervalChart"]');
    expect(charts.length).toBe(2);
    for (const chart of charts) {
      const widths = all(chart, '.starci-core-interval-plot').map((plot) => Math.round(plot.getBoundingClientRect().width));
      expect(new Set(widths).size).toBe(1);
      const lines = all(chart, '.starci-core-interval-reference').map((line) => Math.round(line.getBoundingClientRect().left));
      expect(lines.length).toBeGreaterThan(1);
      expect(new Set(lines).size).toBe(1);
      for (const row of all(chart, '.starci-core-interval-row')) {
        const range = boxOf(row, '.starci-core-interval-range').getBoundingClientRect();
        const pointX = centre(boxOf(row, '.starci-core-interval-point'));
        expect(pointX).toBeGreaterThanOrEqual(range.left - 1);
        expect(pointX).toBeLessThanOrEqual(range.right + 1);
      }
      const reference = boxOf(chart, '[data-grammar-interval-is-reference="true"]');
      expect(Math.abs(centre(boxOf(reference, '.starci-core-interval-point')) - (boxOf(reference, '.starci-core-interval-reference').getBoundingClientRect().left))).toBeLessThan(1.5);
      expect(reference.textContent).toContain('control');
    }
    const list = within(charts[0] as HTMLElement).getByRole('list', { name: 'Rate by option, 90 % interval' });
    expect(within(list).getAllByRole('listitem').length).toBe(2);
    expect(list.textContent).toContain('4.1 % (3.2 % – 5 %)');
  },
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
  play: async ({ canvasElement }) => {
    const [narrow, wide] = all(canvasElement, '[data-component="IntervalChart"]');
    if (narrow === undefined || wide === undefined) throw new Error('two charts expected');
    const stacked = narrow.getBoundingClientRect().width <= 33 * 16;
    expect(stacked).toBe(true);
    for (const row of all(narrow, '.starci-core-interval-row')) {
      const label = boxOf(row, '.starci-core-interval-label').getBoundingClientRect();
      const value = boxOf(row, '.starci-core-interval-value').getBoundingClientRect();
      const plot = boxOf(row, '.starci-core-interval-plot').getBoundingClientRect();
      expect(label.bottom).toBeLessThanOrEqual(plot.top + 0.5);
      expect(value.bottom).toBeLessThanOrEqual(plot.top + 0.5);
      expect(plot.width).toBeGreaterThan(label.width);
    }
    const wideWidth = wide.getBoundingClientRect().width;
    if (wideWidth > 33 * 16) {
      for (const row of all(wide, '.starci-core-interval-row')) {
        const label = boxOf(row, '.starci-core-interval-label').getBoundingClientRect();
        const plot = boxOf(row, '.starci-core-interval-plot').getBoundingClientRect();
        expect(label.right).toBeLessThanOrEqual(plot.left + 0.5);
      }
    }
  },
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
  play: async ({ canvasElement }) => {
    const [first, second] = all(canvasElement, '[data-component="IntervalChart"]');
    expect(first?.querySelectorAll('.starci-core-interval-reference').length).toBe(0);
    expect(first?.hasAttribute('data-grammar-interval-reference')).toBe(false);
    expect(all(first as HTMLElement, '.starci-core-interval-point').every((point) => point.getAttribute('data-grammar-tone') === 'accent')).toBe(true);
    expect(second?.textContent).toContain('about 18, between 10 and 30');
  },
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
  play: async ({ canvasElement }) => {
    const charts = all(canvasElement, '[data-component="IntervalChart"]');
    expect(charts.length).toBe(3);
    const [ready, kept, bare] = charts as [HTMLElement, HTMLElement, HTMLElement];
    expect(ready.hasAttribute('data-loading')).toBe(false);
    expect(kept.getAttribute('data-loading')).toBe('true');
    expect(kept.getAttribute('aria-busy')).toBe('true');
    expect(all(kept, '.starci-core-interval-label').map((label) => label.textContent)).toContain('Option B');
    expect(kept.textContent).not.toContain(' to ');
    expect(kept.querySelectorAll('.starci-core-interval-point').length).toBe(0);
    expect(all(bare, '.starci-core-interval-row').length).toBe(3);
    // Loading keeps the box: the same rows take the same height as the ready chart.
    expect(Math.round(kept.getBoundingClientRect().height)).toBeGreaterThanOrEqual(Math.round(ready.getBoundingClientRect().height) - 4);
    expect(Math.abs(kept.getBoundingClientRect().height - ready.getBoundingClientRect().height)).toBeLessThan(6);
    await waitFor(() => expect(within(canvasElement).getByText('No ranges yet')).toBeTruthy());
    expect(within(canvasElement).getByText('Could not load this')).toBeTruthy();
  },
};
