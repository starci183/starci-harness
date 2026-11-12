import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import { noop } from './fixtures.js';

/**
 * Two card additions: a search zone that holds trailing filter selects (`filters`), and a
 * pressable table row (`onRowAction`) that opens a drawer.
 */
const meta: Meta = { title: 'Surfaces/Card search filters, description and pressable rows' };
export default meta;
type Story = StoryObj;

const STATUS: readonly G.ListOption[] = [{ id: 'all', label: 'All statuses' }, { id: 'paid', label: 'Paid' }, { id: 'due', label: 'Due' }];
const OWNER: readonly G.ListOption[] = [{ id: 'any', label: 'Anyone' }, { id: 'me', label: 'Assigned to me' }];

const SearchFiltersCard = ({ filters }: { readonly filters: number }) => {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<string | null>('all');
  const [owner, setOwner] = useState<string | null>('any');
  const fields: readonly G.SelectZoneField[] = [
    { label: 'Status', prefix: 'Status:', options: STATUS, value: status, onChange: setStatus },
    { label: 'Owner', prefix: 'Owner:', options: OWNER, value: owner, onChange: setOwner },
  ].slice(0, filters);
  return (
    <G.SurfaceCard
      kind="list"
      label="Invoices"
      items={[{ id: 'i1', title: 'INV-001', description: 'Paid' }, { id: 'i2', title: 'INV-002', description: 'Due' }]}
      empty={<G.EmptyNotice message="Nothing matches." />}
      headers={[{ kind: 'search', label: 'Search invoices', value: query, onChange: setQuery, placeholder: 'Search invoices', clearLabel: 'Clear search', filters: fields }]}
    />
  );
};

/** The search grows; each select keeps its natural width and its words stay on one line. */
export const SearchZoneWithFilters: Story = {
  render: () => <div data-story-search="wide" style={{ width: 'min(100%, 900px)' }}><SearchFiltersCard filters={2} /></div>,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const zone = canvasElement.querySelector<HTMLElement>('[data-grammar-zone="search"]');
      if (zone === null) throw new Error('the search zone renders');
      const selects = Array.from(zone.querySelectorAll<HTMLElement>('[data-grammar-zone-select="true"]'));
      expect(selects.length).toBe(2);
      for (const select of selects) expect(getComputedStyle(select.querySelector('.starci-core-select-trigger') ?? select).whiteSpace).toBe('nowrap');
    }, { timeout: 5000 });
  },
};

const assertAligned = (root: HTMLElement, filters: number) => {
  const zone = root.querySelector<HTMLElement>('[data-grammar-zone="search"]');
  if (zone === null) throw new Error('the search zone renders');
  const field = zone.querySelector<HTMLElement>('.starci-core-search-field-group');
  const triggers = Array.from(zone.querySelectorAll<HTMLElement>('.starci-core-select-trigger'));
  if (field === null || triggers.length !== filters) throw new Error('the field and its filters render');
  const middle = (box: DOMRect) => box.top + box.height / 2;
  for (const trigger of triggers) {
    // 0.37.23: the filter pill is the field's height, and its prefix and value stand on one line centred in the pill.
    expect(Math.abs(trigger.getBoundingClientRect().height - field.getBoundingClientRect().height)).toBeLessThanOrEqual(0.5);
    const prefix = trigger.querySelector<HTMLElement>('.starci-core-select-prefix')!.getBoundingClientRect();
    const value = trigger.querySelector<HTMLElement>('.select__value')!.getBoundingClientRect();
    expect(Math.abs(middle(prefix) - middle(trigger.getBoundingClientRect()))).toBeLessThanOrEqual(1);
    expect(Math.abs(middle(prefix) - middle(value))).toBeLessThanOrEqual(1);
  }
};

/** 0.37.23: one filter and two filters, wide and phone: the select pill matches the search field's height and its text is centred. */
export const SearchFiltersAligned: Story = {
  name: 'Search zone filters aligned (1 and 2 filters, 1440 and 390)',
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

/** On a phone-width card the selects wrap below the search. */
export const SearchZoneWithFiltersPhone: Story = {
  render: () => <div data-story-search="phone" style={{ width: 358 }}><SearchFiltersCard filters={2} /></div>,
};

const COLUMNS: readonly G.TableColumnData[] = [{ id: 'name', label: 'Invoice' }, { id: 'amount', label: 'Amount', numeric: true }, { id: 'act', label: 'Actions' }];

const PressableTable = ({ onOpen }: { readonly onOpen: (id: string) => void }) => (
  <G.SurfaceCard
    kind="table"
    label="Invoices"
    columns={COLUMNS}
    onRowAction={onOpen}
    empty={<G.EmptyNotice message="No invoices." />}
    rows={[
      { id: 'inv-1', cells: { name: 'INV-001', amount: '$120.00', act: <G.Button size="sm" onPress={noop}>Download</G.Button> } },
      { id: 'inv-2', cells: { name: 'INV-002', amount: '$80.00', act: <G.Button size="sm" onPress={noop}>Download</G.Button> } },
    ]}
  />
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
