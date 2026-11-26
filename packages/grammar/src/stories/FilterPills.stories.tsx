import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import * as G from '../common/index.js';
import { Matrix, State } from './fixtures.js';

/**
 * FILTER PRESETS AS PILLS (0.46.2). `Tabs kind="filter" shape="pill"` draws a filter strip in the one pill look the `appearance="primary"` switch has (HeroUI's primary variant:
 * pills on a track). The underline stays the default of a filter strip; the pill is for a short row of presets that narrow a list. It keeps the count chip and, since 0.48.0, scrolls
 * sideways when it is wider than its row (no "+n" menu), and draws no line.
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

/** The same presets as the underline (default) and as pills; the pill strip has the track, no line, and keeps each count chip. At a narrow width the pills scroll sideways, every preset kept (0.48.0). */
export const Presets: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="underline (the default filter look)" direction="column"><Strip label="Underline presets" shape="underline" /></State>
      <State label="pill" direction="column"><Strip label="Pill presets" shape="pill" /></State>
      <State label="pill that scrolls" direction="column"><div style={{ maxInlineSize: 300 }}><Strip label="Scrolling pill presets" shape="pill" /></div></State>
    </Matrix>
  ),
};

/** A filter strip in a `Section`'s filter row, as pills beside a search field: one flat wrapping row. */
export const InASectionFilterRow: Story = {
  render: () => (
    <div style={{ maxInlineSize: '64rem' }}>
      <G.Section kind="list" title="Tasks" count={24} filter={<><Strip label="Task presets" shape="pill" /><G.SearchField label="Search tasks" /></>} items={[{ id: 't1', title: 'Call Mai Phuong back' }]} empty={null} />
    </div>
  ),
};
