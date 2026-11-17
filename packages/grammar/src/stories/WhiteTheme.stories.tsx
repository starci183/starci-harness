import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type CSSProperties } from 'react';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * THE WHITE-THEME FIXES (0.41.0). One page that shows every part the white-theme reshoot named: the page head sharing the body's start edge
 * (MEASURE-8), an inline link underlined at rest, a list section (framed by default, flat under the list hooks with its rows on the title's
 * edge), the catalog toolbar as a flat `Section filter` row, the measures' empty track (`--starci-core-track`), the card radius hook and a
 * disabled commit with its reason. `Defaults` sets no hook; `White` sets the hooks on the root, as an app's brand.css sets them on `:root`.
 */
const meta: Meta = {
  title: 'Surfaces/White theme (0.41.0)',
  parameters: { grammar: { bleed: true } },
};
export default meta;
type Story = StoryObj;

const noop = () => undefined;

const ROWS: readonly G.SectionRow[] = [
  { id: 'a', title: 'Request lifecycle', description: 'Source: System Design module 1', onPress: noop },
  { id: 'b', title: 'Caching layers', description: 'Source: System Design module 2', onPress: noop },
  { id: 'c', title: 'Message queues', description: 'Source: System Design module 3', onPress: noop },
];

const LEVELS = [
  { id: 'all', label: 'All' },
  { id: 'basic', label: 'Basic' },
  { id: 'middle', label: 'Intermediate' },
  { id: 'advanced', label: 'Advanced' },
];

const Toolbar = () => {
  const [level, setLevel] = useState('all');
  return (
    <>
      <G.Tabs label="Level" kind="filter" selectedKey={level} onSelect={setLevel} items={LEVELS} />
      <G.SearchField label="Search topics" isLabelHidden placeholder="Search topics" clearLabel="Clear search" />
    </>
  );
};

const Body = () => (
  <G.Stack gap="section">
    <G.Text>
      No account yet? <G.Link href="#sign-up">Sign up</G.Link>, or <G.Link href="#forgot">reset a forgotten password</G.Link>. A link in a sentence is underlined at rest.
    </G.Text>
    <G.Section title="Catalog" filter={<Toolbar />}>
      <G.Stack gap="section">
        <G.Section kind="list" title="Backend foundations" count={3} items={ROWS} empty={null} />
        <G.Section kind="list" title="Data stores" count={3} items={ROWS} empty={null} />
      </G.Stack>
    </G.Section>
    <G.Section title="Measures">
      <G.Stack gap="row">
        <G.Progress label="Course" value={0} valueText="0 of 12 lessons" />
        <G.Progress label="Course" value={35} valueText="4 of 12 lessons" />
        <G.Progress label="Setup" steps={{ total: 5, completed: 2 }} valueText="Step 2 of 5" />
        <G.Meter label="Storage" value={18} valueLabel="1.8 of 10 GB" />
        <G.Meter label="Checks" value={1} maxValue={4} segments={4} valueLabel="1 of 4" />
        <G.ProportionBar label="Time spent" parts={[{ id: 'read', label: 'Reading', value: 30 }]} empty={null} />
        <G.Cluster gap="inline"><G.ProgressCircle label="Uploading" value={25} /></G.Cluster>
      </G.Stack>
    </G.Section>
    <G.SurfaceCard label="Plan" kind="body">
      <G.Stack gap="row">
        <G.Text>A card: its radius follows the card radius hook.</G.Text>
        <div data-story-disabled="true"><G.Button intent="commit" isDisabled disabledReason="Pick a plan first." onPress={noop}>Continue</G.Button></div>
      </G.Stack>
    </G.SurfaceCard>
  </G.Stack>
);

const PageView = () => (
  <G.Page header={{ title: 'Essentials', description: 'Every topic, by group.' }}>
    <Body />
  </G.Page>
);

/** No hook set: the default look. The page head's content takes the body's measure, so both start on one edge at every width. */
export const Defaults: Story = {
  render: () => <PageView />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const head = canvasElement.querySelector<HTMLElement>('[data-component="PageHeader"] > [data-component="PageContainer"]');
      const body = canvasElement.querySelector<HTMLElement>('[data-grammar-page-body]');
      if (head === null || body === null) throw new Error('the page renders');
      expect(Math.round(head.getBoundingClientRect().left)).toBe(Math.round(body.getBoundingClientRect().left));
      const link = canvasElement.querySelector<HTMLElement>('[data-component="Link"][data-grammar-link-variant="inline"]');
      if (link === null) throw new Error('the link renders');
      expect(getComputedStyle(link).textDecorationLine).toBe('underline');
      const filter = canvasElement.querySelector<HTMLElement>('[data-grammar-section-kind="region"] > .starci-core-section-filter');
      if (filter === null) throw new Error('the region filter row renders');
      expect(getComputedStyle(filter).boxShadow).toBe('none');
    });
  },
};

const WHITE_HOOKS = {
  '--surface-shadow': 'none',
  '--starci-core-card-border': '1px solid var(--border)',
  '--starci-core-card-radius': '0.75rem',
  '--starci-core-list-frame': 'transparent',
  '--starci-core-list-frame-border': '0',
  '--starci-core-list-radius': '0',
  '--starci-core-list-inset': '0',
  '--starci-core-tabs-indicator': 'var(--foreground)',
} as CSSProperties;

/** The white-theme hooks on the root: tighter cards, flat lists whose rows start on the title's edge, the default track. */
export const White: Story = {
  parameters: { grammar: { bleed: true, rootStyle: WHITE_HOOKS } },
  render: () => <PageView />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const list = canvasElement.querySelector<HTMLElement>('.starci-core-section-list');
      const title = list?.closest('[data-component="Section"]')?.querySelector<HTMLElement>('h2, h3, h4');
      const row = list?.querySelector<HTMLElement>('.starci-core-list-row-copy');
      if (list === null || list === undefined || title === null || title === undefined || row === null || row === undefined) throw new Error('the list renders');
      expect(getComputedStyle(list).borderTopLeftRadius).toBe('0px');
      expect(getComputedStyle(list).backgroundColor).toBe('rgba(0, 0, 0, 0)');
      expect(Math.round(row.getBoundingClientRect().left)).toBe(Math.round(title.getBoundingClientRect().left));
      const card = canvasElement.querySelector<HTMLElement>('.starci-core-surface');
      if (card === null) throw new Error('the card renders');
      expect(getComputedStyle(card).borderTopLeftRadius).toBe('12px');
    });
  },
};
