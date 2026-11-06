import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import * as G from '../common/index.js';
import { Matrix, State, noop } from './fixtures.js';

/**
 * The parts a conversation inbox, a board and an accounting page are drawn from in the Nivo canvas: the soft AI bubble, the compact
 * time, Grammar's own glyphs, filter tabs in a list pane, page tabs that fold, a compact search, a pane that closes, list rows with a
 * time and marks, a table with no container paint, and a proportion bar.
 */
const meta: Meta = { title: 'Nivo canvas parts' };
export default meta;
type Story = StoryObj;

const ago = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();

/** The AI's own words are the brand tint (`--accent-soft`), the reader's the solid fill, the customer's the surface. */
export const MessageBubbleTones: Story = {
  render: () => (
    <Matrix maxWidth={520}>
      <State label="Incoming, outgoing brand, outgoing soft" direction="column">
        <G.MessageBubble side="incoming" author="Chi Thu" meta="09:41" body="Is the spa open on the second day of Tet?" />
        <G.MessageBubble side="outgoing" author="You" meta="09:42" body="Yes, from 9:00 to 17:00." />
        <G.MessageBubble side="outgoing" tone="soft" author="Chatbot (AI)" meta="09:41" body="Please wait while I check the Tet schedule." />
      </State>
    </Matrix>
  ),
};

/** `style="compact"` is the amount and its unit alone, for the end of a row's title line. */
export const CompactRelativeTime: Story = {
  render: () => (
    <Matrix>
      <State label="Long and compact, English" direction="column">
        <G.RelativeTime dateTime={ago(2)} locale="en" />
        <G.RelativeTime dateTime={ago(2)} locale="en" style="compact" />
        <G.RelativeTime dateTime={ago(90)} locale="en" style="compact" />
        <G.RelativeTime dateTime={ago(60 * 24 * 3)} locale="en" style="compact" />
      </State>
      <State label="Compact, Vietnamese" direction="column">
        <G.RelativeTime dateTime={ago(2)} locale="vi" style="compact" />
        <G.RelativeTime dateTime={ago(90)} locale="vi" style="compact" />
        <G.RelativeTime dateTime={ago(60 * 24 * 3)} locale="vi" style="compact" />
      </State>
    </Matrix>
  ),
};

/** The closed glyph vocabulary: icon-only buttons with an accessible label, and a glyph at the start of a button. */
export const Glyphs: Story = {
  render: () => (
    <Matrix>
      <State label="IconButton glyph: more, panel-end, pencil, send, close" direction="row">
        <G.IconButton intent="neutral" glyph="more" label="More actions" />
        <G.IconButton intent="neutral" glyph="panel-end" label="Hide the customer pane" />
        <G.IconButton intent="neutral" glyph="pencil" label="Edit" />
        <G.IconButton intent="commit" glyph="send" label="Send" />
        <G.IconButton intent="dismiss" label="Close" />
      </State>
      <State label="Button startGlyph" direction="row">
        <G.Button intent="commit" startGlyph="send">Send</G.Button>
        <G.Button intent="alternative" startGlyph="pencil">Edit</G.Button>
        <G.Button intent="commit" startGlyph="send" isDisabled>Send</G.Button>
      </State>
    </Matrix>
  ),
};

const filterTabs: ReadonlyArray<G.TabItem> = [
  { id: 'all', label: 'All', count: 12 },
  { id: 'needs', label: 'Needs a person', count: 3, isAttention: true },
  { id: 'today', label: 'Today', count: 8 },
];

const FilterTabsDemo = () => {
  const [selectedKey, setSelectedKey] = useState('all');
  return <G.Tabs kind="filter" label="Filter" inset="none" selectedKey={selectedKey} onSelect={setSelectedKey} items={filterTabs} />;
};

const viewTabs: ReadonlyArray<G.TabItem> = [
  { id: 'attention', label: 'Needs attention', count: 4 },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'decisions', label: 'Decisions' },
  { id: 'accounting', label: 'Hand over to accounting' },
  { id: 'contracts', label: 'Contracts' },
  { id: 'automatic', label: 'Automatic activity' },
  { id: 'rules', label: 'Rules' },
];

const ViewTabsDemo = ({ width }: { readonly width: number }) => {
  const [selectedKey, setSelectedKey] = useState('pipeline');
  return (
    <div style={{ width }}>
      <G.Tabs label="Views" inset="none" overflowLabel="More" moreLabel={(count) => `${count} more views`} selectedKey={selectedKey} onSelect={setSelectedKey} items={viewTabs} />
    </div>
  );
};

/** Three filter tabs with count chips fit a 336px list pane; page tabs fold into "More" and the selected one stays in view. */
export const TabsInAPane: Story = {
  render: () => (
    <Matrix>
      <State label="Filter tabs in a 336px pane with its 16px padding (three fit, no fold)" direction="column">
        <div style={{ width: 304 }}><FilterTabsDemo /></div>
      </State>
      <State label="Page tabs folding into More at 640px" direction="column"><ViewTabsDemo width={640} /></State>
      <State label="Page tabs that all fit" direction="column"><ViewTabsDemo width={1200} /></State>
    </Matrix>
  ),
};

/** A search field of `measure="compact"` spans up to 26rem and stays at the start. */
export const CompactSearch: Story = {
  render: () => (
    <Matrix>
      <State label="Fill and compact in a wide container" direction="column">
        <div style={{ width: 720 }}>
          <G.SearchField label="Search customers" placeholder="Search by name or need" clearLabel="Clear" />
          <G.SearchField label="Search customers" placeholder="Search by name or need" clearLabel="Clear" measure="compact" />
        </div>
      </State>
    </Matrix>
  ),
};

/** `close` draws the round close button at the end of a side pane's head. */
export const PaneHeaderClose: Story = {
  render: () => (
    <Matrix maxWidth={420}>
      <State label="Side pane head with a count and a close button" direction="column">
        <G.PaneHeader title="Needs your approval" description="2 waiting" close={{ label: 'Close', onPress: noop }} />
      </State>
    </Matrix>
  ),
};

/** A list row's title line ends with a short fact and its marks sit in one row under the description. */
export const ListRowMetaAndMarks: Story = {
  render: () => (
    <Matrix maxWidth={336}>
      <State label="Conversation rows" direction="column">
        <G.ListBox
          label="Conversations"
          selectionMode="single"
          selectionIndicator="none"
          selectedIds={['t1']}
          items={[
            { id: 't1', label: 'Chi Thu', description: 'Is the spa open on the second day of Tet?', leading: <G.Avatar name="Chi Thu" isDecorative />, meta: <G.RelativeTime dateTime={ago(2)} locale="en" style="compact" />, footer: <><G.Badge tone="warning" isDot>Needs a person</G.Badge><G.Badge tone="neutral">Zalo</G.Badge></> },
            { id: 't2', label: 'Anh Bao', description: 'AI: We still have a slot at 16:00', leading: <G.Avatar name="Anh Bao" isDecorative />, meta: <G.RelativeTime dateTime={ago(6)} locale="en" style="compact" />, footer: <><G.Badge tone="neutral" isDot>AI is answering</G.Badge><G.Badge tone="neutral">Website</G.Badge></> },
          ]}
        />
      </State>
    </Matrix>
  ),
};

type Entry = { readonly id: string; readonly title: string; readonly sub: string; readonly date: string; readonly amount: string };
const entries: ReadonlyArray<Entry> = [
  { id: 'e1', title: 'HD-0140 · Tan Phat Co.', sub: 'Due 10/11 · Order 1087', date: '03/11', amount: '12,500,000' },
  { id: 'e2', title: 'HD-0141 · Hoa Sen Spa', sub: 'Due 12/11 · Order 1090', date: '04/11', amount: '4,200,000' },
];

/** `surface="none"` is plain hairline rows under a muted heading, with no container paint. */
export const DataTableNoSurface: Story = {
  render: () => (
    <Matrix maxWidth={640}>
      <State label="surface none" direction="column">
        <G.DataTable<Entry>
          label="Entries"
          surface="none"
          columns={[{ id: 'title', label: 'Entry', isRowHeader: true }, { id: 'date', label: 'Date' }, { id: 'amount', label: 'Amount', align: 'end' }]}
          rows={entries}
          renderCell={(row, column) => column === 'title' ? <span><strong>{row.title}</strong><br />{row.sub}</span> : column === 'date' ? row.date : row.amount}
          emptyContent="No entries"
        />
      </State>
      <State label="surface card (default)" direction="column">
        <G.DataTable<Entry>
          label="Entries"
          columns={[{ id: 'title', label: 'Entry', isRowHeader: true }, { id: 'date', label: 'Date' }, { id: 'amount', label: 'Amount', align: 'end' }]}
          rows={entries}
          renderCell={(row, column) => column === 'title' ? row.title : column === 'date' ? row.date : row.amount}
          emptyContent="No entries"
        />
      </State>
    </Matrix>
  ),
};

/** One track split by share with a legend: ready, loading, empty and error. */
export const ProportionBarStates: Story = {
  render: () => (
    <Matrix maxWidth={520}>
      <State label="Ready, three parts" direction="column">
        <G.ProportionBar label="Receivables by age" empty="Nothing owed" parts={[{ id: 'a', label: 'Under 30 days', value: 8, valueLabel: '8 invoices' }, { id: 'b', label: '30 to 60 days', value: 3, valueLabel: '3 invoices' }, { id: 'c', label: 'Over 60 days', value: 1, valueLabel: '1 invoice' }]} />
      </State>
      <State label="Loading" direction="column"><G.ProportionBar label="Receivables by age" empty="Nothing owed" parts={[]} isLoading /></State>
      <State label="Empty" direction="column"><G.ProportionBar label="Receivables by age" empty={<G.Text tone="muted">Nothing owed</G.Text>} parts={[]} /></State>
      <State label="Error" direction="column"><G.ProportionBar label="Receivables by age" empty="Nothing owed" parts={[]} error={{ message: 'Could not load', actionLabel: 'Try again', onAction: noop }} /></State>
    </Matrix>
  ),
};

const pipeline: ReadonlyArray<G.BoardColumn> = [
  { id: 'new', title: 'New', count: 2, empty: 'No customers', items: [{ id: 'a', title: 'Hoa Sen Spa', description: 'Asked for a quote' }, { id: 'b', title: 'Nha Moc', description: 'Wants two pots' }] },
  { id: 'proposal', title: 'Proposal', count: 1, empty: 'No customers', items: [{ id: 'c', title: 'Anh Quang', description: '26,000,000' }] },
  { id: 'won', title: 'Won', count: 0, empty: 'No customers', items: [] },
];

/** Each column is the tinted surface (`--surface-secondary`) with its title and a count chip in the head and its items as white cards. */
export const BoardTintedColumns: Story = {
  render: () => (
    <Matrix>
      <State label="Ready, with an empty column" direction="column"><G.Board label="Sales pipeline" columns={pipeline} /></State>
      <State label="Loading" direction="column"><G.Board label="Sales pipeline" columns={pipeline.map((column) => ({ ...column, items: [] }))} isLoading /></State>
    </Matrix>
  ),
};
