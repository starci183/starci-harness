import type { Meta, StoryObj } from '@storybook/react-vite';
import type { CSSProperties } from 'react';
import { expect, waitFor } from 'storybook/test';
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
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      for (const name of ['phone', 'desktop']) {
        const strip = canvasElement.querySelector<HTMLElement>(`[data-story-ribbon="${name}"] [data-grammar-description-layout="stat-strip"]`);
        if (strip === null) throw new Error(`the ${name} ribbon renders`);
        expect(strip).toHaveAttribute('data-grammar-figures-placement', 'ribbon');
        const style = getComputedStyle(strip);
        expect(style.borderTopWidth).toBe('1px');
        expect(style.borderBottomWidth).toBe('1px');
        expect(style.borderLeftWidth).toBe('0px');
        expect(style.borderRightWidth).toBe('0px');
        expect(style.borderTopLeftRadius).toBe('0px');
        expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)');
      }
      const table = canvasElement.querySelector<HTMLElement>('[data-story-table] [data-component="DataTable"]');
      if (table === null) throw new Error('the table renders');
      expect(getComputedStyle(table).boxShadow).toBe('none');
      // One field look: nothing draws the vendor secondary field, in a card or on the page.
      expect(canvasElement.querySelectorAll('.input--secondary, .input-group--secondary, .search-field--secondary, .textarea--secondary, .select--secondary')).toHaveLength(0);
      const bar = canvasElement.querySelector<HTMLElement>('.starci-core-sidebar-item[data-grammar-current="true"], .starci-core-sidebar-item[data-selected="true"]');
      if (bar !== null) expect(getComputedStyle(bar, '::before').width).toBe('0px');
    });
  },
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
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const item = canvasElement.querySelector<HTMLElement>('.starci-core-sidebar-item[data-grammar-current="true"], .starci-core-sidebar-item[data-selected="true"]');
      if (item === null) throw new Error('the selected item renders');
      expect(getComputedStyle(item, '::before').width).toBe('2px');
      const row = canvasElement.querySelector<HTMLElement>('[data-grammar-radio-appearance="rows"] .starci-core-radio:not([data-selected="true"])');
      if (row === null) throw new Error('an unselected radio row renders');
      expect(getComputedStyle(row).borderTopWidth).toBe('1px');
      const outgoing = canvasElement.querySelector<HTMLElement>('[data-grammar-bubble-side="outgoing"] .starci-core-message-bubble-body');
      if (outgoing === null) throw new Error('the outgoing bubble renders');
      expect(getComputedStyle(outgoing).borderTopWidth).toBe('1px');
      const card = canvasElement.querySelector<HTMLElement>('.starci-core-surface');
      if (card === null) throw new Error('the card renders');
      expect(getComputedStyle(card).borderTopWidth).toBe('1px');
    });
  },
};
