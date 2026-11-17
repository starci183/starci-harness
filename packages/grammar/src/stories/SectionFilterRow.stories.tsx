import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * A section's filter row (0.43.1): `Tabs kind="filter"`, a `SearchField` and two `Select`s share ONE flat wrapping row, the controls on one
 * bottom edge, in the order given; below the narrow step (the row's own width under 48rem) they stack, each the full width. A list's
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

const Toolbar = () => {
  const [level, setLevel] = useState('all');
  return (
    <>
      <G.Tabs label="Level" kind="filter" selectedKey={level} onSelect={setLevel} items={LEVELS} />
      <G.SearchField label="Search topics" isLabelHidden placeholder="Search topics" clearLabel="Clear search" />
      <G.Select label="Track" isLabelHidden options={TRACKS} defaultValue="all" />
      <G.Select label="Progress" isLabelHidden options={STATES} defaultValue="any" />
    </>
  );
};

const NARROW = 48 * 16;

/** The row's peers in order: one shared line (bottoms on one edge, left to right) when the row is wide, one per line, full width, when it is narrow. */
const expectRow = (row: HTMLElement) => {
  // A Select keeps its vendor's hidden `template` beside it; it is no peer.
  const peers = [...row.children].filter((node): node is HTMLElement => node instanceof HTMLElement && node.tagName !== 'TEMPLATE');
  expect(peers.map((node) => node.dataset.component ?? (node.classList.contains('starci-core-tabs-frame') ? 'Tabs' : node.className))).toEqual(['Tabs', 'SearchField', 'Select', 'Select']);
  const boxes = peers.map((node) => node.getBoundingClientRect());
  const rowBox = row.getBoundingClientRect();
  if (rowBox.width > NARROW) {
    const bottom = Math.round(boxes[0]?.bottom ?? 0);
    for (const box of boxes) expect(Math.abs(Math.round(box.bottom) - bottom)).toBeLessThanOrEqual(1);
    for (let index = 1; index < boxes.length; index += 1) expect(boxes[index]?.left ?? 0).toBeGreaterThan(boxes[index - 1]?.right ?? 0);
  } else {
    for (let index = 1; index < boxes.length; index += 1) expect(boxes[index]?.top ?? 0).toBeGreaterThanOrEqual(boxes[index - 1]?.bottom ?? 0);
    for (const box of boxes) expect(Math.round(box.width)).toBe(Math.round(rowBox.width));
  }
};

const rowOf = (canvasElement: HTMLElement, kind: 'region' | 'list') => {
  const row = canvasElement.querySelector<HTMLElement>(`[data-grammar-section-kind="${kind}"] > .starci-core-section-filter`);
  if (row === null) throw new Error(`the ${kind} filter row renders`);
  return row;
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
  play: async ({ canvasElement }) => {
    await waitFor(() => expectRow(rowOf(canvasElement, 'region')));
  },
};

/** A list's own filter: the same row. */
export const List: Story = {
  render: () => (
    <G.Page header={{ title: 'Essentials' }}>
      <G.Section kind="list" title="Topics" count={3} items={ROWS} empty={null} filter={<Toolbar />} />
    </G.Page>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => expectRow(rowOf(canvasElement, 'list')));
  },
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
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const row = rowOf(canvasElement, 'region');
      const region = row.parentElement;
      if (region === null) throw new Error('the region renders');
      expect(region.getAttribute('aria-label')).toBe('Find a topic');
      expect(region.getAttribute('aria-labelledby')).toBeNull();
      expect(region.firstElementChild).toBe(row);
      expectRow(row);
    });
  },
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
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const skeleton = rowOf(canvasElement, 'region').querySelector<HTMLElement>(':scope > .starci-core-skeleton-placeholder');
      if (skeleton === null) throw new Error('the loading row renders its skeleton');
      expectRow(skeleton);
    });
  },
};
