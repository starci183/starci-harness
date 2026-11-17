import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import { noop } from './fixtures.js';

/**
 * A section's filter row holds a search field with trailing filter selects over a flat table, and a pressable table row (`onRowAction`) opens a drawer.
 */
const meta: Meta = { title: 'Surfaces/Section search filters and pressable rows' };
export default meta;
type Story = StoryObj;

const STATUS: readonly G.ListOption[] = [{ id: 'all', label: 'All statuses' }, { id: 'paid', label: 'Paid' }, { id: 'due', label: 'Due' }];
const OWNER: readonly G.ListOption[] = [{ id: 'any', label: 'Anyone' }, { id: 'me', label: 'Assigned to me' }];

type Invoice = G.DataTableRow & { readonly name: string; readonly status: string };

const SearchFiltersCard = ({ filters }: { readonly filters: number }) => {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<string | null>('all');
  const [owner, setOwner] = useState<string | null>('any');
  const selects = [
    <G.Select key="status" label="Status" isLabelHidden prefix="Status:" options={STATUS} value={status} onValueChange={setStatus} />,
    <G.Select key="owner" label="Owner" isLabelHidden prefix="Owner:" options={OWNER} value={owner} onValueChange={setOwner} />,
  ].slice(0, filters);
  return (
    <G.Section
      title="Invoices"
      filter={(
        <>
          <G.SearchField label="Search invoices" isLabelHidden placeholder="Search invoices" clearLabel="Clear search" value={query} onValueChange={setQuery} />
          {selects}
        </>
      )}
    >
      <G.DataTable<Invoice>
        label="Invoices"
        columns={[{ id: 'name', label: 'Invoice', isRowHeader: true }, { id: 'status', label: 'Status' }]}
        rows={[{ id: 'i1', name: 'INV-001', status: 'Paid' }, { id: 'i2', name: 'INV-002', status: 'Due' }]}
        renderCell={(row, column) => column === 'name' ? row.name : row.status}
        emptyContent={<G.EmptyNotice message="Nothing matches." />}
      />
    </G.Section>
  );
};

/** Each select keeps its natural width and its words stay on one line. */
export const SearchWithFilters: Story = {
  render: () => <div data-story-search="wide" style={{ width: 'min(100%, 900px)' }}><SearchFiltersCard filters={2} /></div>,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const row = canvasElement.querySelector<HTMLElement>('.starci-core-section-filter');
      if (row === null) throw new Error('the filter row renders');
      const triggers = Array.from(row.querySelectorAll<HTMLElement>('.starci-core-select-trigger'));
      expect(triggers.length).toBe(2);
      for (const trigger of triggers) expect(getComputedStyle(trigger).whiteSpace).toBe('nowrap');
    }, { timeout: 5000 });
  },
};

const assertAligned = (root: HTMLElement, filters: number) => {
  const row = root.querySelector<HTMLElement>('.starci-core-section-filter');
  if (row === null) throw new Error('the filter row renders');
  const triggers = Array.from(row.querySelectorAll<HTMLElement>('.starci-core-select-trigger'));
  if (triggers.length !== filters) throw new Error('the filters render');
  const middle = (box: DOMRect) => box.top + box.height / 2;
  for (const trigger of triggers) {
    // The prefix and the value stand on one line centred in the pill.
    const prefix = trigger.querySelector<HTMLElement>('.starci-core-select-prefix')!.getBoundingClientRect();
    const value = trigger.querySelector<HTMLElement>('.select__value')!.getBoundingClientRect();
    expect(Math.abs(middle(prefix) - middle(trigger.getBoundingClientRect()))).toBeLessThanOrEqual(1);
    expect(Math.abs(middle(prefix) - middle(value))).toBeLessThanOrEqual(1);
  }
};

/** One filter and two filters, wide and phone: the prefix and the value of a select pill are centred on one line. */
export const SearchFiltersAligned: Story = {
  name: 'Section search filters aligned (1 and 2 filters, 1440 and 390)',
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div data-story-aligned="one" style={{ width: 'min(100%, 900px)' }}><SearchFiltersCard filters={1} /></div>
      <div data-story-aligned="two" style={{ width: 'min(100%, 900px)' }}><SearchFiltersCard filters={2} /></div>
      <div data-story-aligned="phone" style={{ width: 358 }}><SearchFiltersCard filters={2} /></div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      assertAligned(canvasElement.querySelector<HTMLElement>('[data-story-aligned="one"]')!, 1);
      assertAligned(canvasElement.querySelector<HTMLElement>('[data-story-aligned="two"]')!, 2);
      assertAligned(canvasElement.querySelector<HTMLElement>('[data-story-aligned="phone"]')!, 2);
    }, { timeout: 5000 });
  },
};

/** On a phone-width section the selects wrap below the search. */
export const SearchWithFiltersPhone: Story = {
  render: () => <div data-story-search="phone" style={{ width: 358 }}><SearchFiltersCard filters={2} /></div>,
};

type Row = G.DataTableRow & { readonly name: string; readonly amount: string };
const COLUMNS: readonly G.DataTableColumn<Row>[] = [{ id: 'name', label: 'Invoice', isRowHeader: true }, { id: 'amount', label: 'Amount', isNumeric: true }, { id: 'act', label: 'Actions' }];

const PressableTable = ({ onOpen }: { readonly onOpen: (id: string) => void }) => (
  <G.Section title="Invoices">
    <G.DataTable<Row>
      label="Invoices"
      columns={COLUMNS}
      onRowAction={onOpen}
      emptyContent={<G.EmptyNotice message="No invoices." />}
      renderCell={(row, column) => column === 'name' ? row.name : column === 'amount' ? row.amount : <G.Button size="sm" onPress={noop}>Download</G.Button>}
      rows={[
        { id: 'inv-1', name: 'INV-001', amount: '$120.00' },
        { id: 'inv-2', name: 'INV-002', amount: '$80.00' },
      ]}
    />
  </G.Section>
);

/** The whole row opens the drawer on a click or on Enter at the focused row; the row command inside stays its own press. */
export const PressableTableRows: Story = {
  render: () => {
    const [opened, setOpened] = useState<string>('none');
    return (
      <div data-story-pressable="true" style={{ width: 'min(100%, 720px)' }}>
        <PressableTable onOpen={setOpened} />
        <p data-story-opened="true">{opened}</p>
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const rows = canvasElement.querySelectorAll('[data-grammar-table-row-pressable="true"]');
      expect(rows.length).toBe(2);
    }, { timeout: 5000 });
    const opened = () => canvasElement.querySelector('[data-story-opened="true"]')?.textContent;
    const row = canvasElement.querySelector<HTMLElement>('[data-grammar-table-row="true"]');
    if (row === null) throw new Error('a row renders');
    await userEvent.click(row.querySelector('[role="rowheader"], [role="gridcell"]') ?? row);
    await waitFor(() => expect(opened()).toBe('inv-1'));
    const second = canvasElement.querySelectorAll<HTMLElement>('[data-grammar-table-row="true"]')[1];
    if (second === undefined) throw new Error('a second row renders');
    second.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(opened()).toBe('inv-2'));
    // The command inside a row is its own press: it does not open the drawer.
    await userEvent.click(canvasElement.querySelectorAll<HTMLElement>('button')[0] as HTMLElement);
    expect(opened()).toBe('inv-2');
  },
};
