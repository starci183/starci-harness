import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import * as G from '../common/index.js';

/**
 * A section's filter row (0.43.1): `Tabs kind="filter"`, a `SearchField` and two `Select`s share ONE flat wrapping row, the controls on one
 * bottom edge, in the order given. Below the narrow step (the row's own width under 48rem, 0.44.0) the tabs and the search each take a full
 * line, and two `compact` selects keep their content width and share the next line; a `field` select takes a full line. A list's
 * `filter` and a region's draw the same row. `Headless` is a catalog region under the page title, named by `ariaLabel` with no heading of
 * its own.
 */
const meta: Meta = {
  title: 'Surfaces/Section filter row (0.43.1)',
  parameters: { grammar: { bleed: true } },
};
export default meta;
type Story = StoryObj;

const noop = () => undefined;

const ROWS: readonly G.SectionRow[] = [
  { id: 'a', title: 'Request lifecycle', description: 'System Design, module 1', onPress: noop },
  { id: 'b', title: 'Caching layers', description: 'System Design, module 2', onPress: noop },
  { id: 'c', title: 'Message queues', description: 'System Design, module 3', onPress: noop },
];

const LEVELS = [
  { id: 'all', label: 'All' },
  { id: 'basic', label: 'Basic' },
  { id: 'middle', label: 'Intermediate' },
  { id: 'advanced', label: 'Advanced' },
];

const TRACKS = [
  { id: 'all', label: 'Every track' },
  { id: 'backend', label: 'Backend' },
  { id: 'frontend', label: 'Frontend' },
];

const STATES = [
  { id: 'any', label: 'Any progress' },
  { id: 'todo', label: 'Not started' },
  { id: 'done', label: 'Completed' },
];

type Appearance = 'compact' | 'field';

const Toolbar = ({ appearance = 'compact' }: { readonly appearance?: Appearance }) => {
  const [level, setLevel] = useState('all');
  return (
    <>
      <G.Tabs label="Level" kind="filter" selectedKey={level} onSelect={setLevel} items={LEVELS} />
      <G.SearchField label="Search topics" isLabelHidden placeholder="Search topics" clearLabel="Clear search" />
      <G.Select label="Track" isLabelHidden appearance={appearance} options={TRACKS} defaultValue="all" />
      <G.Select label="Progress" isLabelHidden appearance={appearance} options={STATES} defaultValue="any" />
    </>
  );
};

/** A region's filter: the catalog toolbar over two lists. */
export const Region: Story = {
  render: () => (
    <G.Page header={{ title: 'Essentials', description: 'Every topic, by group.' }}>
      <G.Section title="Catalog" filter={<Toolbar />}>
        <G.Stack gap="section">
          <G.Section kind="list" title="Backend foundations" count={3} items={ROWS} empty={null} />
          <G.Section kind="list" title="Data stores" count={3} items={ROWS} empty={null} />
        </G.Stack>
      </G.Section>
    </G.Page>
  ),
};

/** A list's own filter: the same row. */
export const List: Story = {
  render: () => (
    <G.Page header={{ title: 'Essentials' }}>
      <G.Section kind="list" title="Topics" count={3} items={ROWS} empty={null} filter={<Toolbar />} />
    </G.Page>
  ),
};

/** A headless region: the page title is its heading, so the region is named by `ariaLabel` and draws none. */
export const Headless: Story = {
  render: () => (
    <G.Page header={{ title: 'Essentials', description: 'Every topic, by group.' }}>
      <G.Section ariaLabel="Find a topic" filter={<Toolbar />}>
        <G.Stack gap="section">
          <G.Section kind="list" title="Backend foundations" count={3} items={ROWS} empty={null} />
          <G.Section kind="list" title="Data stores" count={3} items={ROWS} empty={null} />
        </G.Stack>
      </G.Section>
    </G.Page>
  ),
};

/** The region loading: the skeleton keeps the row's layout. */
export const RegionLoading: Story = {
  render: () => (
    <G.Page header={{ title: 'Essentials' }}>
      <G.Section title="Catalog" isLoading filter={<Toolbar />}>
        <G.Section kind="list" title="Backend foundations" items={[]} empty={null} />
      </G.Section>
    </G.Page>
  ),
};

/** `field` selects in the row: one row when wide; narrow, each select takes a full line like the search. */
export const FieldSelects: Story = {
  render: () => (
    <G.Page header={{ title: 'Essentials' }}>
      <G.Section kind="list" title="Topics" count={3} items={ROWS} empty={null} filter={<Toolbar appearance="field" />} />
    </G.Page>
  ),
};
