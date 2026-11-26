import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { userEvent, within } from 'storybook/test';
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
    await userEvent.click(within(canvasElement).getByRole('tab', { name: /Invited/ }));
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
};

const figureCells = (count: number): readonly G.Figure[] =>
  [
    { id: 'a', term: 'People', value: 5 },
    { id: 'b', term: 'Active', value: 3 },
    { id: 'c', term: 'Invited', value: 2 },
    { id: 'd', term: 'Owners', value: 1 },
  ].slice(0, count);

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
};
