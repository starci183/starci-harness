import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import { Matrix, State } from './fixtures.js';

/**
 * FILTER PRESETS AS PILLS (0.46.2). `Tabs kind="filter" shape="pill"` draws a filter strip in the one pill look the `appearance="primary"` switch has (HeroUI's primary variant:
 * pills on a track). The underline stays the default of a filter strip; the pill is for a short row of presets that narrow a list. It keeps the count chip and the fold into a
 * "+n" menu, and draws no line.
 */
const meta: Meta = { title: 'Navigation & Data/Filter pills (0.46.2)', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

const PRESETS: ReadonlyArray<G.TabItem> = [
  { id: 'all', label: 'All', count: 24 },
  { id: 'mine', label: 'Mine', count: 7 },
  { id: 'overdue', label: 'Overdue', count: 3, isAttention: true },
  { id: 'week', label: 'This week', count: 9 },
  { id: 'archived', label: 'Archived', count: 0 },
];

const Strip = ({ shape, label }: { readonly shape: 'underline' | 'pill'; readonly label: string }) => {
  const [selectedKey, setSelectedKey] = useState('all');
  return <G.Tabs label={label} kind="filter" shape={shape} selectedKey={selectedKey} onSelect={setSelectedKey} items={PRESETS} moreLabel={(count) => `${count} more presets`} />;
};

const boxOf = (root: ParentNode, selector: string): HTMLElement => {
  const found = root.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`no element for ${selector}`);
  return found;
};

/** The same presets as the underline (default) and as pills; the pill strip has the track, no line, and keeps each count chip. At a narrow width the pills fold into a "+n" menu. */
export const Presets: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="underline (the default filter look)" direction="column"><Strip label="Underline presets" shape="underline" /></State>
      <State label="pill" direction="column"><Strip label="Pill presets" shape="pill" /></State>
      <State label="pill that folds" direction="column"><div style={{ maxInlineSize: 300 }}><Strip label="Folding pill presets" shape="pill" /></div></State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const frames = [...canvasElement.querySelectorAll<HTMLElement>('.starci-core-tabs-frame[data-grammar-tabs-client="ready"]')];
      expect(frames).toHaveLength(3);
      const [underline, pill, folding] = frames as [HTMLElement, HTMLElement, HTMLElement];
      expect(underline.getAttribute('data-grammar-tabs-variant')).toBe('secondary');
      expect(underline.getAttribute('data-grammar-tabs-shape')).toBeNull();
      // The pill strip is the primary variant's drawing: a track holds the tabs, and there is no line under it.
      expect(pill.getAttribute('data-grammar-tabs-kind')).toBe('filter');
      expect(pill.getAttribute('data-grammar-tabs-variant')).toBe('primary');
      expect(pill.getAttribute('data-grammar-tabs-shape')).toBe('pill');
      expect(pill.getAttribute('data-grammar-tabs-line')).toBe('none');
      expect(pill.querySelector('[data-grammar-tabs-track="true"]')).not.toBeNull();
      expect(getComputedStyle(pill).borderBottomWidth).toBe('0px');
      expect(underline.querySelector('[data-grammar-tabs-track="true"]')).toBeNull();
      // The count chips stay, the attention one in the accent soft pair.
      // On a phone the strip folds some pills into its menu, so every count is drawn only where all five pills fit.
      expect(pill.querySelectorAll('.starci-core-tab-count').length).toBe(window.innerWidth >= 768 ? 5 : pill.querySelectorAll('[role="tab"]').length);
      expect(pill.querySelectorAll('.starci-core-tab-count').length).toBeGreaterThan(0);
      if (window.innerWidth >= 768) expect(boxOf(pill, '.starci-core-tab-count[data-grammar-attention="true"]').textContent).toBe('3');
      const tabs = [...pill.querySelectorAll<HTMLElement>('[role="tab"]')];
      expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
      // A narrow pill strip folds what does not fit into a menu and keeps the selected pill visible.
      expect(folding.querySelector('.starci-core-tabs-more')).not.toBeNull();
      expect(boxOf(folding, '[role="tab"][aria-selected="true"]').textContent).toContain('All');
      expect(folding.scrollWidth).toBeLessThanOrEqual(folding.clientWidth + 1);
    }, { timeout: 4000 });
  },
};

/** A filter strip in a `Section`'s filter row, as pills beside a search field: one flat wrapping row. */
export const InASectionFilterRow: Story = {
  render: () => (
    <div style={{ maxInlineSize: '64rem' }}>
      <G.Section kind="list" title="Tasks" count={24} filter={<><Strip label="Task presets" shape="pill" /><G.SearchField label="Search tasks" /></>} items={[{ id: 't1', title: 'Call Mai Phuong back' }]} empty={null} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const strip = boxOf(canvasElement, '.starci-core-section-filter .starci-core-tabs-frame[data-grammar-tabs-shape="pill"]');
      expect(strip.querySelectorAll('[role="tab"]').length).toBeGreaterThan(0);
    }, { timeout: 4000 });
  },
};
