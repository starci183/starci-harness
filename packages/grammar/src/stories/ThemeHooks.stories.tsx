import type { Meta, StoryObj } from '@storybook/react-vite';
import type { CSSProperties } from 'react';
import * as G from '../common/index.js';

/**
 * ONE LOOK, THE RIBBON, THE FLAT TABLE AND THE THEME HOOKS (0.40.0). A field has one look wherever it stands (no vendor `*--secondary`
 * field class anywhere, DNA-COMMON-FIELD-ONE-LOOK); `Section kind="figures"` is a band between two hairlines with open ends; a
 * standalone `DataTable` is flat by default; the theme hooks (`src/common/theme-hooks.json`) restyle a part when an app sets them and leave
 * it as it was when it sets none. The `Hooked` story sets a neutral set of hooks on its wrapper, as an app's theme layer would on `:root`.
 */
const meta: Meta = {
  title: 'Surfaces/Theme hooks (0.40.0)',
  parameters: { grammar: { bleed: false } },
};
export default meta;
type Story = StoryObj;

const figures: readonly G.Figure[] = [
  { id: 'a', term: 'Visitors, 7 days', value: 128, meta: 'vs last week' },
  { id: 'b', term: 'Conversations', value: 342, meta: 'open 12' },
  { id: 'c', term: 'Orders created', value: 57, meta: 'today 6' },
  { id: 'd', term: 'Close rate', value: '18%', meta: 'target 20%' },
  { id: 'e', term: 'Estimated revenue', value: '12.4M', meta: 'this month' },
];

type Member = G.DataTableRow & { readonly name: string; readonly role: string };
const members: ReadonlyArray<Member> = [
  { id: 'a', name: 'Ann Lee', role: 'Owner' },
  { id: 'b', name: 'Ben Ito', role: 'Member' },
  { id: 'c', name: 'Cora Diaz', role: 'Member' },
];

const MembersTable = () => (
  <G.DataTable<Member>
    label="Members"
    columns={[{ id: 'name', label: 'Name', isRowHeader: true }, { id: 'role', label: 'Role' }]}
    rows={members}
    renderCell={(row, column) => (column === 'name' ? row.name : row.role)}
    emptyContent="No members"
  />
);

const Parts = () => (
  <G.Stack gap="section">
    <div data-story-ribbon="phone" style={{ width: 390 }}><G.Section kind="figures" ariaLabel="Overview" items={figures} /></div>
    <div data-story-ribbon="desktop" style={{ width: 1000 }}><G.Section kind="figures" ariaLabel="Overview" items={figures} /></div>
    <div data-story-table="true"><G.Section title="Members"><MembersTable /></G.Section></div>
    <G.SurfaceCard label="Profile" kind="body">
      <G.Input id="hook-name" name="name" label="Name" />
    </G.SurfaceCard>
    <G.Input id="hook-page" name="page" label="On the page" />
    <G.SearchField label="Search" />
    <G.RadioGroup label="Repeat on" appearance="rows" options={['Mon', 'Tue', 'Wed'].map((day) => ({ value: day, label: day }))} defaultValue="Mon" />
    <div style={{ width: 280 }}>
      <G.Sidebar label="Workspace" selectedKey="inbox" groups={[{ id: 'main', items: [{ id: 'home', label: 'Home' }, { id: 'inbox', label: 'Inbox' }] }]} />
    </div>
    <G.Stack gap="row">
      <G.MessageBubble author="Sam" meta="09:12" body="Can the order move to 19:30?" />
      <G.MessageBubble side="outgoing" meta="09:14" body="Yes, I moved it." />
    </G.Stack>
  </G.Stack>
);

/** No hook set: the default look of every part, with the ribbon and the flat table. */
export const Defaults: Story = {
  render: () => <Parts />,
};

const NEUTRAL_HOOKS = {
  '--starci-core-sidebar-selected': 'var(--default)',
  '--starci-core-sidebar-selected-foreground': 'var(--foreground)',
  '--starci-core-sidebar-weight': 'var(--grammar-weight-regular)',
  '--starci-core-tabs-indicator': 'var(--foreground)',
  '--starci-core-plate': 'var(--surface)',
  '--starci-core-plate-border': '1px solid var(--border)',
  '--starci-core-plate-selected': 'var(--default)',
  '--starci-core-plate-selected-foreground': 'var(--foreground)',
} as CSSProperties;

/** The same parts under a neutral set of hooks, as an app's theme layer sets them. */
export const Hooked: Story = {
  render: () => <div data-story-hooked="true" style={NEUTRAL_HOOKS}><Parts /></div>,
};
