import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';
import * as G from '../common/index.js';
import { Matrix, State, noop } from './fixtures.js';

/**
 * FunnelChart: stages in order, each "label · count" with the step into it (the down arrow icon and "60%") over a HeroUI ProgressBar md track (8px), the largest
 * drop in the danger ink; bars follow HeroUI ProgressBar sizes. Each story draws a state
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
  play: async ({ canvasElement }) => {
    const charts = all(canvasElement, '[data-component="FunnelChart"]');
    expect(charts.length).toBe(2);
    for (const chart of charts) {
      const tracks = all(chart, '.starci-core-funnel-track');
      expect(new Set(tracks.map((track) => Math.round(track.getBoundingClientRect().width))).size).toBe(1);
      for (const track of tracks) expect(Math.round(track.getBoundingClientRect().height)).toBe(8);
      const starts = all(chart, '.starci-core-funnel-bar').map((bar) => Math.round(bar.getBoundingClientRect().left));
      expect(new Set(starts).size).toBe(1);
      const stages = all(chart, '.starci-core-funnel-stage');
      expect(all(chart, '.starci-core-funnel-step').length).toBe(stages.length - 1);
      // Every text row sits above its own track.
      for (const stage of stages) {
        const head = boxOf(stage, '.starci-core-funnel-head').getBoundingClientRect();
        expect(head.bottom).toBeLessThanOrEqual(boxOf(stage, '.starci-core-funnel-track').getBoundingClientRect().top + 0.5);
      }
      expect(all(chart, '[data-grammar-drop="largest"]').length).toBe(1);
    }
    const [first] = charts as [HTMLElement];
    const bars = all(first, '.starci-core-funnel-bar').map((bar) => bar.getBoundingClientRect().width);
    for (let index = 1; index < bars.length; index += 1) expect(bars[index] as number).toBeLessThan(bars[index - 1] as number);
    const list = within(first).getByRole('list', { name: 'Leads by stage' });
    expect(within(list).getAllByRole('listitem').length).toBe(4);
    expect(first.textContent).toContain('Stage one · 1,240');
    expect(first.textContent).toContain('62.9%');
    expect(boxOf(first, '[data-grammar-drop="largest"]').textContent).toBe('31%');
    expect((charts[1] as HTMLElement).textContent).toContain('2,100 stopped here');
  },
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
  play: async ({ canvasElement }) => {
    for (const chart of all(canvasElement, '[data-component="FunnelChart"]')) {
      const box = chart.getBoundingClientRect();
      for (const stage of all(chart, '.starci-core-funnel-stage')) {
        const label = boxOf(stage, '.starci-core-funnel-label').getBoundingClientRect();
        const track = boxOf(stage, '.starci-core-funnel-track').getBoundingClientRect();
        expect(label.bottom).toBeLessThanOrEqual(track.top + 0.5);
        expect(Math.abs(track.width - box.width)).toBeLessThan(1);
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
      <State label="Every stage at zero (empty)" direction="column"><G.FunnelChart label="Zero" stages={[{ label: 'Stage one', count: 0 }, { label: 'Stage two', count: 0 }]} empty={emptyLine} /></State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    const [first, second] = all(canvasElement, '[data-component="FunnelChart"]');
    const steps = all(first as HTMLElement, '.starci-core-funnel-step').map((step) => [step.textContent, step.getAttribute('data-grammar-drop')]);
    expect(steps).toEqual([['120%', 'kept'], ['100%', 'kept'], ['0%', 'largest'], ['–', 'kept']]);
    expect(second?.querySelectorAll('.starci-core-funnel-step').length).toBe(0);
    expect(all(canvasElement, '[data-component="FunnelChart"]').length).toBe(2);
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
