import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import * as G from '../common/index.js';
import { Matrix, State } from './fixtures.js';

/**
 * Legend: a one-line key that maps each tone to its words. Each story draws a state and its play function proves it, at 1440 and
 * at 390 (`npm run prove-plays`). The words are generic (a status of any record); nothing here is a product word.
 */
const meta: Meta = { title: 'Navigation & Data/Legend', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

const statuses: readonly G.LegendItem[] = [
  { id: 'planned', label: 'Planned', tone: 'neutral' },
  { id: 'active', label: 'In progress', tone: 'accent' },
  { id: 'done', label: 'Done', tone: 'success' },
  { id: 'risk', label: 'At risk', tone: 'warning' },
  { id: 'late', label: 'Late', tone: 'danger' },
  { id: 'milestone', label: 'Milestone', tone: 'accent', form: 'milestone' },
];

const all = (root: ParentNode, selector: string): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(selector));

/** Every tone and the milestone form; each item reads its label, and the marks keep one size. */
export const LegendTones: Story = {
  render: () => (
    <Matrix>
      <State label="Five tones and a milestone" direction="column">
        <G.Legend label="Status colours" items={statuses} />
      </State>
      <State label="Two keys" direction="column">
        <G.Legend label="Plan colours" items={statuses.slice(0, 2)} />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    const [full, short] = all(canvasElement, '[data-component="Legend"]');
    expect(full?.getAttribute('aria-label')).toBe('Status colours');
    expect(all(full as HTMLElement, 'li').length).toBe(6);
    expect(all(full as HTMLElement, '.starci-core-legend-mark[data-grammar-form="milestone"]').length).toBe(1);
    expect(all(short as HTMLElement, 'li').map((item) => item.textContent)).toEqual(['Planned', 'In progress']);
    const tones = all(full as HTMLElement, '.starci-core-legend-mark').map((mark) => mark.getAttribute('data-grammar-tone'));
    expect(tones).toEqual(['neutral', 'accent', 'success', 'warning', 'danger', 'accent']);
  },
};

/** In a narrow column the key wraps onto more lines instead of scrolling or clipping; wide, one line. */
export const LegendWraps: Story = {
  render: () => (
    <Matrix>
      <State label="In a 15rem column (wraps)" direction="column">
        <div style={{ maxWidth: '15rem' }}><G.Legend label="Status colours" items={statuses} /></div>
      </State>
      <State label="In a 60rem column (one line)" direction="column">
        <div style={{ maxWidth: '60rem' }}><G.Legend label="Status colours" items={statuses} /></div>
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    const [narrow, wide] = all(canvasElement, '[data-component="Legend"]') as [HTMLElement, HTMLElement];
    const rows = (legend: HTMLElement) => new Set(all(legend, 'li').map((item) => Math.round(item.getBoundingClientRect().top))).size;
    expect(rows(narrow)).toBeGreaterThan(1);
    expect(narrow.scrollWidth).toBeLessThanOrEqual(narrow.clientWidth + 1);
    if (wide.getBoundingClientRect().width > 560) expect(rows(wide)).toBe(1);
  },
};

/** Loading keeps the words it was given and shimmers the marks; with none given, three placeholders; no keys draws nothing. */
export const LegendStates: Story = {
  render: () => (
    <Matrix>
      <State label="Ready" direction="column"><G.Legend label="Status colours" items={statuses.slice(0, 3)} /></State>
      <State label="Loading (labels kept)" direction="column"><G.Legend label="Status colours" items={statuses.slice(0, 3)} isLoading /></State>
      <State label="Loading (no keys yet)" direction="column"><G.Legend label="Status colours" items={[]} isLoading /></State>
      <State label="No keys (draws nothing)" direction="column"><G.Legend label="Status colours" items={[]} /></State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    const legends = all(canvasElement, '[data-component="Legend"]');
    expect(legends.length).toBe(3);
    const [ready, kept, bare] = legends as [HTMLElement, HTMLElement, HTMLElement];
    expect(ready.hasAttribute('data-loading')).toBe(false);
    expect(kept.getAttribute('aria-busy')).toBe('true');
    expect(all(kept, 'li').map((item) => item.textContent)).toEqual(['Planned', 'In progress', 'Done']);
    expect(all(kept, '.starci-core-legend-mark').every((mark) => mark.getAttribute('data-grammar-skeleton') === 'true')).toBe(true);
    expect(all(bare, 'li').length).toBe(3);
    expect(Math.abs(kept.getBoundingClientRect().height - ready.getBoundingClientRect().height)).toBeLessThan(4);
  },
};
