import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import * as G from '../common/index.js';
import { Matrix, State, noop } from './fixtures.js';

/**
 * A collection stands flat in a `Section`: the head (title, count, fact, one action), the filter row (`Tabs kind="filter"`, a `SearchField`, `Select`s), the body (a flat
 * `DataTable`, a list, a figures ribbon) and the pager in the table's `footer`. No card holds a collection. The stories measure the parts in their order and in every state.
 */
const meta: Meta = { title: 'Surfaces/Section filter table' };
export default meta;
type Story = StoryObj;

const WIDE = 'min(100%, 1800px)';
const PHONE = 358; // a 390px phone less its 16px page inset on each side

type Member = G.DataTableRow & { readonly name: string; readonly role: string; readonly status: 'active' | 'invited' };
const MEMBERS: readonly Member[] = [
  { id: 'm1', name: 'Alex Morgan', role: 'Owner', status: 'active' },
  { id: 'm2', name: 'Sam Lee', role: 'Sales agent', status: 'active' },
  { id: 'm3', name: 'Maria Garcia', role: 'Booking agent', status: 'invited' },
  { id: 'm4', name: 'Jordan Kim', role: 'Content agent', status: 'active' },
  { id: 'm5', name: 'Taylor Fox', role: 'Support agent', status: 'invited' },
];

const COLUMNS: readonly G.DataTableColumn<Member>[] = [
  { id: 'name', label: 'Name', isRowHeader: true },
  { id: 'role', label: 'Role' },
  { id: 'status', label: 'Status', width: 'fit' },
];
const cellOf = (member: Member, columnId: string) => (columnId === 'name' ? member.name : columnId === 'role' ? member.role : member.status === 'active' ? 'Active' : 'Invited');
const rowOf = (member: Member): G.ListRowData => ({ id: member.id, title: member.name, description: member.role });
const failure: G.ErrorData = { message: 'Could not load the members.', actionLabel: 'Try again', onAction: noop };

const box = (element: Element) => element.getBoundingClientRect();

const tabsOf = (query: string): readonly G.TabItem[] => {
  const matching = MEMBERS.filter((member) => member.name.toLowerCase().includes(query.toLowerCase()));
  return [
    { id: 'all', label: 'All', count: matching.length },
    { id: 'active', label: 'Active', count: matching.filter((member) => member.status === 'active').length },
    { id: 'invited', label: 'Invited', count: matching.filter((member) => member.status === 'invited').length, isAttention: true },
  ];
};

const visibleMembers = (tab: string, query: string): readonly Member[] =>
  MEMBERS.filter((member) => member.name.toLowerCase().includes(query.toLowerCase())).filter((member) => tab === 'all' || member.status === tab);

const MemberTable = ({ mode = 'ready' }: { readonly mode?: 'ready' | 'loading' | 'error' | 'empty' }) => {
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  const shown = mode === 'empty' ? [] : visibleMembers(tab, query);
  return (
    <div data-story-mode={mode}>
      <G.Section
        title="Members"
        count={MEMBERS.length}
        fact="Team plan"
        action={<G.Link variant="head" href="#invite">Invite</G.Link>}
        filter={(
          <>
            <G.Tabs label="Member status" kind="filter" selectedKey={tab} onSelect={setTab} items={tabsOf(query)} />
            <G.SearchField label="Search members" isLabelHidden placeholder="Search members" clearLabel="Clear search" value={query} onValueChange={setQuery} />
          </>
        )}
        {...(mode === 'loading' ? { isLoading: true } : {})}
        {...(mode === 'error' ? { error: failure } : {})}
      >
        <G.DataTable<Member>
          label="Members"
          columns={COLUMNS}
          rows={shown}
          renderCell={cellOf}
          emptyContent={<G.EmptyNotice message="Nobody matches." />}
          footer={<G.Pagination label="Member pages" page={1} pageCount={3} onPageChange={noop} previousLabel="Previous" nextLabel="Next" pageLabel={(page) => `Page ${page}`} summary={`1-${shown.length} of 12`} />}
        />
      </G.Section>
    </div>
  );
};

/** The filter row stands between the head and the table, flat; choosing a tab narrows the rows. */
export const TableWithFilter: Story = {
  render: () => <div style={{ width: 'min(100%, 720px)' }}><MemberTable /></div>,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const section = canvasElement.querySelector<HTMLElement>('[data-component="Section"]');
      const filter = canvasElement.querySelector<HTMLElement>('.starci-core-section-filter');
      const table = canvasElement.querySelector<HTMLElement>('[data-component="DataTable"]');
      if (section === null || filter === null || table === null) throw new Error('the section, its filter row and its table render');
      const head = section.querySelector<HTMLElement>('.starci-core-section-header');
      if (head === null) throw new Error('the head renders');
      expect(box(head).bottom).toBeLessThanOrEqual(box(filter).top + 0.5);
      expect(box(filter).bottom).toBeLessThanOrEqual(box(table).top + 0.5);
      expect(getComputedStyle(filter).boxShadow).toBe('none');
      expect(canvasElement.querySelectorAll('[data-grammar-table-row="true"]').length).toBe(5);
    }, { timeout: 4000 });
    await userEvent.click(within(canvasElement).getByRole('tab', { name: /Invited/ }));
    await waitFor(() => expect(canvasElement.querySelectorAll('[data-grammar-table-row="true"]').length).toBe(2), { timeout: 4000 });
  },
};

/** A figures ribbon over a list: the strip ends before the rows begin. */
export const FiguresAndList: Story = {
  render: () => (
    <div style={{ maxWidth: 720 }}>
      <G.Stack gap="region">
        <G.Section kind="figures" title="Team" items={[{ id: 'a', term: 'People', value: 5 }, { id: 'b', term: 'Active', value: 3 }, { id: 'c', term: 'Invited', value: 2 }]} />
        <G.Section kind="list" title="Members" count={MEMBERS.length} items={MEMBERS.map(rowOf)} empty={<G.EmptyNotice message="Nobody yet." />} />
      </G.Stack>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const strip = canvasElement.querySelector<HTMLElement>('[data-grammar-description-layout="stat-strip"]');
      const rows = canvasElement.querySelector<HTMLElement>('.starci-core-section-list');
      if (strip === null || rows === null) throw new Error('the strip and the rows render');
      expect(box(rows).top).toBeGreaterThanOrEqual(box(strip).bottom - 0.5);
    }, { timeout: 4000 });
  },
};

const figureCells = (count: number): readonly G.Figure[] =>
  [
    { id: 'a', term: 'People', value: 5 },
    { id: 'b', term: 'Active', value: 3 },
    { id: 'c', term: 'Invited', value: 2 },
    { id: 'd', term: 'Owners', value: 1 },
  ].slice(0, count);

/**
 * The cells of a ribbon tile the strip exactly: no inset, no gap. A vertical hairline goes from the strip's top edge to its bottom edge and, wrapped, a row spans the strip from
 * its left edge to its right edge. Returns the number of rows.
 */
const assertFullBleed = (strip: HTMLElement) => {
  const cells = Array.from(strip.querySelectorAll<HTMLElement>('[data-grammar-description-pair]'));
  expect(cells.length).toBeGreaterThan(1);
  const edge = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(0.5);
  const rows: HTMLElement[][] = [];
  for (const cell of cells) {
    const row = rows.find((candidate) => Math.abs(box(candidate[0] as HTMLElement).top - box(cell).top) <= 0.5);
    if (row === undefined) rows.push([cell]);
    else row.push(cell);
  }
  rows.forEach((row, index) => {
    const first = row[0] as HTMLElement;
    const last = row[row.length - 1] as HTMLElement;
    edge(box(first).left, box(strip).left);
    edge(box(last).right, box(strip).right);
    row.forEach((cell, at) => {
      edge(box(cell).top, box(first).top);
      edge(box(cell).bottom, box(first).bottom);
      if (at > 0) edge(box(cell).left, box(row[at - 1] as HTMLElement).right);
    });
    if (index === 0) edge(box(first).top, box(strip).top);
    else edge(box(first).top, box((rows[index - 1] as HTMLElement[])[0] as HTMLElement).bottom);
    if (index === rows.length - 1) edge(box(first).bottom, box(strip).bottom);
  });
  return rows.length;
};

/** The ribbon: one row at 40rem and over, 2 x 2 wrapped, an odd last cell growing across its row. */
export const FiguresFullBleed: Story = {
  render: () => (
    <Matrix>
      <State label="Four figures, one row" direction="column">
        <div data-story-strip="row" style={{ width: 'min(100%, 720px)' }}><G.Section kind="figures" title="Team" items={figureCells(4)} /></div>
      </State>
      <State label="Four figures, wrapped 2 x 2" direction="column">
        <div data-story-strip="wrap" style={{ width: 360 }}><G.Section kind="figures" title="Team" items={figureCells(4)} /></div>
      </State>
      <State label="Four money figures at phone width: wrapped before a value breaks" direction="column">
        <div data-story-strip="money" style={{ width: PHONE }}>
          <G.Section
            kind="figures"
            title="Revenue"
            items={[
              { id: 'a', term: 'This month', value: '12,000,000', unit: '$' },
              { id: 'b', term: 'Last month', value: '9,450,000', unit: '$' },
              { id: 'c', term: 'Outstanding', value: '3,200,000', unit: '$' },
              { id: 'd', term: 'Refunded', value: '450,000', unit: '$' },
            ]}
          />
        </div>
      </State>
      <State label="Three figures, wrapped, the odd one across its row" direction="column">
        <div data-story-strip="odd" style={{ width: 360 }}><G.Section kind="figures" title="Team" items={figureCells(3)} /></div>
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const strip = (name: string) => {
        const found = canvasElement.querySelector<HTMLElement>(`[data-story-strip="${name}"] [data-grammar-description-layout="stat-strip"]`);
        if (found === null) throw new Error(`the ${name} strip renders`);
        return found;
      };
      expect(assertFullBleed(strip('row'))).toBe(box(strip('row')).width >= 640 ? 1 : 2);
      expect(assertFullBleed(strip('wrap'))).toBe(2);
      expect(assertFullBleed(strip('odd'))).toBe(2);
      // Money figures: no value breaks inside its number. At phone width the strip is 2 x 2 or one column, never a row that crushes a value.
      const money = strip('money');
      expect([2, 4]).toContain(assertFullBleed(money));
      for (const value of Array.from(money.querySelectorAll<HTMLElement>('.starci-core-description-figure-value'))) {
        const cell = value.closest<HTMLElement>('[data-grammar-description-pair]');
        if (cell === null) throw new Error('a value stands in its cell');
        expect(getComputedStyle(value).whiteSpace).toBe('nowrap');
        expect(box(value).height).toBeLessThanOrEqual(Number.parseFloat(getComputedStyle(value).lineHeight) + 1);
        expect(box(value).right).toBeLessThanOrEqual(box(cell).right + 0.5);
      }
    }, { timeout: 4000 });
  },
};

/**
 * The five-figure ribbon at the three tiers, answering the strip's own width: 390 (a phone) is 2 + 2 + 1 with the odd last cell across its row; 700 (a tablet) is 3 + 2,
 * two balanced rows; 1000 (a desktop) is one row. Labels keep one or two lines, never a word per line, and the value stays 20 and the meta 12.
 */
export const FiguresRibbonFive: Story = {
  render: () => {
    const items: readonly G.Figure[] = [
      { id: 'a', term: 'Visitors, 7 days', value: 128, meta: 'vs last week' },
      { id: 'b', term: 'Conversations', value: 342, meta: 'open 12' },
      { id: 'c', term: 'Orders created', value: 57, meta: 'today 6' },
      { id: 'd', term: 'Close rate', value: '18%', meta: 'target 20%' },
      { id: 'e', term: 'Estimated revenue', value: '12.4M', meta: 'this month' },
    ];
    return (
      <Matrix>
        <State label="Phone 390: 2 + 2 + 1" direction="column"><div data-story-strip="phone" style={{ width: 390 }}><G.Section kind="figures" title="Overview" items={items} /></div></State>
        <State label="Tablet 700: 3 + 2" direction="column"><div data-story-strip="tablet" style={{ width: 700 }}><G.Section kind="figures" title="Overview" items={items} /></div></State>
        <State label="Desktop 1000: one row" direction="column"><div data-story-strip="desktop" style={{ width: 1000 }}><G.Section kind="figures" title="Overview" items={items} /></div></State>
      </Matrix>
    );
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const strip = (name: string) => {
        const found = canvasElement.querySelector<HTMLElement>(`[data-story-strip="${name}"] [data-grammar-description-layout="stat-strip"]`);
        if (found === null) throw new Error(`the ${name} strip renders`);
        return found;
      };
      const phone = strip('phone');
      expect(assertFullBleed(phone)).toBe(3);
      const cells = Array.from(phone.querySelectorAll<HTMLElement>('[data-grammar-description-pair]'));
      // The odd last cell spans the whole row.
      expect(Math.abs(box(cells[4] as HTMLElement).width - box(phone).width)).toBeLessThan(1.5);
      expect(assertFullBleed(strip('tablet'))).toBe(2);
      expect(assertFullBleed(strip('desktop'))).toBe(1);
      for (const term of Array.from(phone.querySelectorAll<HTMLElement>('.starci-core-description-stat-term > span'))) {
        const lines = box(term).height / Number.parseFloat(getComputedStyle(term).lineHeight);
        expect(lines).toBeLessThanOrEqual(2.05);
        expect(getComputedStyle(term).fontSize).toBe('14px');
      }
      for (const meta of Array.from(phone.querySelectorAll<HTMLElement>('.starci-core-description-meta'))) expect(getComputedStyle(meta).fontSize).toBe('12px');
      for (const value of Array.from(phone.querySelectorAll<HTMLElement>('.starci-core-description-figure'))) expect(getComputedStyle(value).fontSize).toBe('20px');
    }, { timeout: 4000 });
  },
};

/** The two ends of a collection: a head link that leads to all of it, and the pager under the table. */
export const HeadLinkAndPager: Story = {
  render: () => (
    <Matrix maxWidth={560}>
      <State label="A head link" direction="column">
        <G.Section kind="list" title="Recent members" count={2} action={<G.Link variant="head" href="#directory">Open the directory</G.Link>} items={MEMBERS.slice(0, 2).map(rowOf)} empty={null} />
      </State>
      <State label="A pager in the table footer" direction="column">
        <G.Section title="All members">
          <G.DataTable<Member>
            label="All members"
            columns={COLUMNS}
            rows={MEMBERS.slice(0, 2)}
            renderCell={cellOf}
            emptyContent="Nobody yet."
            footer={<G.Pagination label="Member pages" page={2} pageCount={6} onPageChange={noop} previousLabel="Previous" nextLabel="Next" pageLabel={(page) => `Page ${page}`} summary="6-10 of 52" />}
          />
        </G.Section>
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(within(canvasElement).getByRole('navigation', { name: 'Member pages' })).toBeTruthy();
      expect(within(canvasElement).getByRole('link', { name: 'Open the directory' })).toBeTruthy();
    }, { timeout: 4000 });
  },
};

/** Loading, error and empty draw in the body; the head and the filter row stay in every state. */
export const States: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="Ready" direction="column"><MemberTable mode="ready" /></State>
      <State label="Loading" direction="column"><MemberTable mode="loading" /></State>
      <State label="Error" direction="column"><MemberTable mode="error" /></State>
      <State label="Empty" direction="column"><MemberTable mode="empty" /></State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      for (const mode of ['ready', 'loading', 'error', 'empty']) {
        const scope = canvasElement.querySelector<HTMLElement>(`[data-story-mode="${mode}"]`);
        if (scope === null) throw new Error(`the ${mode} state renders`);
        expect(scope.querySelector('.starci-core-section-filter')).not.toBeNull();
      }
      expect(canvasElement.querySelector('[data-story-mode="loading"] [aria-busy="true"]')).not.toBeNull();
      expect(within(canvasElement.querySelector<HTMLElement>('[data-story-mode="empty"]')!).getByText('Nobody matches.')).toBeTruthy();
      expect(within(canvasElement.querySelector<HTMLElement>('[data-story-mode="error"]')!).getByText('Could not load the members.')).toBeTruthy();
    }, { timeout: 4000 });
  },
};

/* ---------- a board's filter row ---------- */

const PipelineBoard = () => {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('all');
  return (
    <G.Board
      label="Sales pipeline"
      filter={(
        <>
          <G.Tabs label="Member status" kind="filter" selectedKey={tab} onSelect={setTab} items={tabsOf('')} />
          <G.SearchField label="Search members" isLabelHidden placeholder="Search members" clearLabel="Clear search" value={query} onValueChange={setQuery} />
        </>
      )}
      columns={[
        { id: 'new', title: 'New', count: 2, items: MEMBERS.slice(0, 2).map(rowOf), empty: <G.Text tone="muted">Nothing here.</G.Text> },
        { id: 'qualified', title: 'Qualified', count: 1, items: MEMBERS.slice(2, 3).map(rowOf), empty: <G.Text tone="muted">Nothing here.</G.Text> },
        { id: 'won', title: 'Won', count: 0, items: [], empty: <G.Text tone="muted">Nothing here.</G.Text> },
      ]}
    />
  );
};

/** A board's filter row is the same flat row a section draws, above the columns; it holds no card. */
export const BoardFilter: Story = {
  render: () => (
    <div style={{ maxWidth: 900, padding: '1rem', background: 'var(--background)' }}>
      <PipelineBoard />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const header = canvasElement.querySelector<HTMLElement>('[data-grammar-board-header="true"]');
      const columns = canvasElement.querySelector<HTMLElement>('.starci-core-board-columns');
      if (header === null || columns === null) throw new Error('the filter row and the columns render');
      expect(box(header).bottom).toBeLessThanOrEqual(box(columns).top);
      expect(header.querySelector('.starci-core-section-filter')).not.toBeNull();
      expect(header.querySelector('[data-component="SurfaceCard"]')).toBeNull();
    }, { timeout: 4000 });
  },
};

/* ---------- the ledger: a flat table with day groups ---------- */

type Entry = G.DataTableRow & { readonly what: string; readonly account: string; readonly income: string; readonly expense: string; readonly balance: string };

const LEDGER_COLUMNS: readonly G.DataTableColumn<Entry>[] = [
  { id: 'what', label: 'Description', isRowHeader: true },
  { id: 'account', label: 'Account', priority: 'low' },
  { id: 'income', label: 'In', isNumeric: true, priority: 'low' },
  { id: 'expense', label: 'Out', isNumeric: true, priority: 'low' },
  { id: 'balance', label: 'Balance', isNumeric: true, priority: 'low' },
];

const ledgerCell = (entry: Entry, columnId: string) => entry[columnId as 'what' | 'account' | 'income' | 'expense' | 'balance'];

type EntryGroup = { readonly id: string; readonly label: string; readonly fact?: string; readonly rows: readonly Entry[] };

const LEDGER_GROUPS: readonly EntryGroup[] = [
  { id: 'd1', label: 'Thu 6 Nov', fact: '48,250,000', rows: [
    { id: 'r1', what: 'Annual plan, Sam Lee', account: 'Cash', income: '12,000,000', expense: '', balance: '48,250,000' },
    { id: 'r2', what: 'Supplies', account: 'Cash', income: '', expense: '1,850,000', balance: '36,250,000' },
    { id: 'r3', what: 'Deposit, Maria Garcia', account: 'Bank', income: '3,200,000', expense: '', balance: '38,100,000' },
  ] },
  { id: 'd2', label: 'Wed 5 Nov', fact: '35,050,000', rows: [
    { id: 'r4', what: 'Rent', account: 'Bank', income: '', expense: '15,000,000', balance: '35,050,000' },
    { id: 'r5', what: 'Support hours, Jordan Kim', account: 'Cash', income: '450,000', expense: '', balance: '50,050,000' },
  ] },
  { id: 'd3', label: 'Tue 4 Nov', fact: '49,600,000', rows: [
    { id: 'r6', what: 'Wages', account: 'Bank', income: '', expense: '9,450,000', balance: '49,600,000' },
  ] },
];

const Ledger = ({ mode }: { readonly mode: 'ready' | 'empty' | 'loading' | 'error' }) => (
  <G.Section
    title="Cash book"
    action={<G.Link variant="head" href="#older">See older entries</G.Link>}
    filter={<G.SearchField label="Search entries" isLabelHidden placeholder="Search entries" clearLabel="Clear search" />}
    {...(mode === 'loading' ? { isLoading: true } : {})}
    {...(mode === 'error' ? { error: { message: 'Could not load the cash book.', actionLabel: 'Try again', onAction: noop } } : {})}
  >
    <G.DataTable<Entry>
      label="Cash book"
      columns={LEDGER_COLUMNS}
      groups={mode === 'ready' || mode === 'loading' ? LEDGER_GROUPS : []}
      renderCell={ledgerCell}
      emptyContent={<G.EmptyNotice message="No entries yet." />}
    />
  </G.Section>
);

/** The ledger with three day groups: one column header, group rows; at phone width the rows fold into a title and muted amounts. */
const ledgerStory = (width: string | number, isPhone: boolean): Story => ({
  render: () => <div data-story-ledger="true" style={{ width }}><Ledger mode="ready" /></div>,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const table = canvasElement.querySelector<HTMLElement>('[data-story-ledger="true"] [data-component="DataTable"]');
      if (table === null) throw new Error('the ledger renders');
      // One column header, three group rows, six entries.
      expect(table.querySelectorAll('.starci-core-data-table-header').length).toBe(1);
      expect(table.querySelectorAll('[data-grammar-table-group="true"]').length).toBe(3);
      expect(table.querySelectorAll('[data-grammar-table-row="true"]').length).toBe(6);
      expect(table.getAttribute('data-grammar-table-narrow')).toBe(isPhone ? 'true' : 'false');
      if (isPhone) expect(table.querySelectorAll('[data-grammar-table-secondary="true"]').length).toBe(6);
      // Amounts never wrap and read in tabular numerals.
      for (const cell of Array.from(table.querySelectorAll<HTMLElement>('[data-grammar-table-numeric="true"]'))) {
        expect(getComputedStyle(cell).whiteSpace).toBe('nowrap');
        expect(getComputedStyle(cell).fontVariantNumeric).toContain('tabular-nums');
      }
    }, { timeout: 5000 });
  },
});

/** The ledger at 1920px. */
export const LedgerWide: Story = ledgerStory(WIDE, false);
/** The ledger at 390px. */
export const LedgerPhone: Story = ledgerStory(PHONE, true);

/** Empty, loading and error states of the ledger: the section keeps its head and filter row, the table draws the state in its body. */
export const LedgerStates: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="Empty" direction="column"><div data-story-ledger="empty"><Ledger mode="empty" /></div></State>
      <State label="Loading" direction="column"><div data-story-ledger="loading"><Ledger mode="loading" /></div></State>
      <State label="Error" direction="column"><div data-story-ledger="error"><Ledger mode="error" /></div></State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const of = (name: string) => {
        const found = canvasElement.querySelector<HTMLElement>(`[data-story-ledger="${name}"]`);
        if (found === null) throw new Error(`the ${name} ledger renders`);
        return found;
      };
      expect(of('empty').querySelector('[data-grammar-table-empty="true"]')).not.toBeNull();
      expect(of('loading').querySelector('[data-grammar-skeleton="true"]')).not.toBeNull();
      expect(within(of('error')).getByText('Could not load the cash book.')).toBeTruthy();
      for (const name of ['empty', 'loading', 'error']) expect(of(name).querySelector('.starci-core-section-filter')).not.toBeNull();
    }, { timeout: 5000 });
  },
};
