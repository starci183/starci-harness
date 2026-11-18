import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';
import * as G from '../common/index.js';
import { Matrix, State, noop } from './fixtures.js';

/**
 * FunnelChart: stages in order, a bar on one scale for each, a chip between two bars and the drop-off count. Each story draws a state
 * and its play function proves it, at 1440 and at 390 (`npm run prove-plays`). The stages are generic (a name and a count); nothing
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

const boxOf = (root: HTMLElement, selector: string): HTMLElement => {
  const found = root.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`no element for ${selector}`);
  return found;
};
const all = (root: ParentNode, selector: string): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(selector));

/** Four stages: bars on tracks of one width that start at one edge, a chip and a drop-off between every two bars. */
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
  play: async ({ canvasElement }) => {
    const charts = all(canvasElement, '[data-component="FunnelChart"]');
    expect(charts.length).toBe(2);
    for (const chart of charts) {
      const widths = all(chart, '.starci-core-funnel-track').map((track) => Math.round(track.getBoundingClientRect().width));
      expect(new Set(widths).size).toBe(1);
      const starts = all(chart, '.starci-core-funnel-bar').map((bar) => Math.round(bar.getBoundingClientRect().left));
      expect(new Set(starts).size).toBe(1);
      const stages = all(chart, '.starci-core-funnel-stage');
      expect(all(chart, '.starci-core-funnel-step').length).toBe(stages.length - 1);
      // The chip sits between its two bars: under the bar before, above its own.
      stages.forEach((stage, index) => {
        if (index === 0) return;
        const step = boxOf(stage, '.starci-core-funnel-step').getBoundingClientRect();
        const before = boxOf(stages[index - 1] as HTMLElement, '.starci-core-funnel-bar').getBoundingClientRect();
        const own = boxOf(stage, '.starci-core-funnel-bar').getBoundingClientRect();
        expect(step.top).toBeGreaterThanOrEqual(before.bottom - 0.5);
        expect(step.bottom).toBeLessThanOrEqual(own.top + 0.5);
      });
    }
    const [first] = charts as [HTMLElement];
    const bars = all(first, '.starci-core-funnel-bar').map((bar) => bar.getBoundingClientRect().width);
    for (let index = 1; index < bars.length; index += 1) expect(bars[index] as number).toBeLessThan(bars[index - 1] as number);
    const list = within(first).getByRole('list', { name: 'Leads by stage' });
    expect(within(list).getAllByRole('listitem').length).toBe(4);
    expect(first.textContent).toContain('1,240');
    expect(first.textContent).toContain('63 %');
    expect(first.textContent).toContain('−460');
    expect(all(first, '.starci-core-funnel-drop').every((drop) => drop.getAttribute('data-grammar-drop') === 'lost')).toBe(true);
    expect((charts[1] as HTMLElement).textContent).toContain('2,100 stopped here');
  },
};

/** At 33rem of chart width or less the label and value sit over the bar and the chip over the label, whatever the page. */
export const FunnelChartStacks: Story = {
  render: () => (
    <Matrix>
      <State label="In a 22rem column (stacked)" direction="column">
        <div style={{ maxWidth: '22rem' }}><G.FunnelChart label="Leads by stage" stages={four} empty={emptyLine} format={grouped} /></div>
      </State>
      <State label="In a 44rem column (one line per stage)" direction="column">
        <div style={{ maxWidth: '44rem' }}><G.FunnelChart label="Leads by stage" stages={four} empty={emptyLine} format={grouped} /></div>
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    const [narrow, wide] = all(canvasElement, '[data-component="FunnelChart"]');
    if (narrow === undefined || wide === undefined) throw new Error('two charts expected');
    expect(narrow.getBoundingClientRect().width).toBeLessThanOrEqual(33 * 16);
    for (const stage of all(narrow, '.starci-core-funnel-stage')) {
      const label = boxOf(stage, '.starci-core-funnel-label').getBoundingClientRect();
      const value = boxOf(stage, '.starci-core-funnel-value').getBoundingClientRect();
      const track = boxOf(stage, '.starci-core-funnel-track').getBoundingClientRect();
      expect(label.bottom).toBeLessThanOrEqual(track.top + 0.5);
      expect(value.bottom).toBeLessThanOrEqual(track.top + 0.5);
      expect(track.width).toBeGreaterThan(label.width);
      expect(track.right).toBeLessThanOrEqual(narrow.getBoundingClientRect().right + 0.5);
    }
    if (wide.getBoundingClientRect().width > 33 * 16) {
      for (const stage of all(wide, '.starci-core-funnel-stage')) {
        const label = boxOf(stage, '.starci-core-funnel-label').getBoundingClientRect();
        const track = boxOf(stage, '.starci-core-funnel-track').getBoundingClientRect();
        expect(label.right).toBeLessThanOrEqual(track.left + 0.5);
      }
    }
  },
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
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    const [first, second] = all(canvasElement, '[data-component="FunnelChart"]');
    const drops = all(first as HTMLElement, '.starci-core-funnel-drop').map((drop) => [drop.textContent, drop.getAttribute('data-grammar-drop')]);
    expect(drops).toEqual([['+20', 'kept'], ['0', 'kept'], ['−120', 'lost'], ['0', 'kept']]);
    expect((first as HTMLElement).textContent).toContain('–');
    expect(second?.querySelectorAll('.starci-core-funnel-step').length).toBe(0);
  },
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
  play: async ({ canvasElement }) => {
    const charts = all(canvasElement, '[data-component="FunnelChart"]');
    expect(charts.length).toBe(3);
    const [ready, kept, bare] = charts as [HTMLElement, HTMLElement, HTMLElement];
    expect(ready.hasAttribute('data-loading')).toBe(false);
    expect(kept.getAttribute('data-loading')).toBe('true');
    expect(kept.getAttribute('aria-busy')).toBe('true');
    expect(all(kept, '.starci-core-funnel-label').map((label) => label.textContent)).toContain('Stage three');
    expect(kept.textContent).not.toContain('1,240');
    expect(all(bare, '.starci-core-funnel-stage').length).toBe(4);
    // Loading keeps the box: the same stages take the same height as the ready chart.
    expect(Math.abs(kept.getBoundingClientRect().height - ready.getBoundingClientRect().height)).toBeLessThan(6);
    await waitFor(() => expect(within(canvasElement).getByText('No stages yet')).toBeTruthy());
    expect(within(canvasElement).getByText('Could not load this')).toBeTruthy();
  },
};
