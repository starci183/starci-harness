import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import * as E from '../core/ext/recharts/index.js';
import { BookGlyph, noop } from './fixtures.js';

/**
 * The white ground: a card is one object (an agent, a provider, an approval) with a 1px edge and no shadow, and a collection (a table, a ribbon of figures, a list) stands flat
 * in a `Section` with no card around it. `ObjectCard` shows the cards, `SectionFilterTable` the head, the filter row, the table and its pager, `FiguresRibbon` the figures
 * above a list and `SelectedRow` a selected table row beside a list.
 */
/** A figure's trend chart: the ext Sparkline (core takes the drawn chart, never its numbers). */
const trend = (label: string, values: readonly number[]) => (
  <E.Sparkline ariaLabel={label} emptyLabel="No data yet" data={values.map((value, week) => ({ week, value }))} xKey="week" yKey="value" />
);

const meta: Meta = {
  title: 'Surfaces/White ground',
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj;

/* ---------- object cards ---------- */

const agentMenu: G.ItemMenu = {
  label: 'Actions for Sales assistant',
  entries: [{ kind: 'section', id: 'main', items: [{ id: 'pause', label: 'Pause', onAction: noop }, { id: 'remove', label: 'Remove', onAction: noop }] }],
};

const providerMenu: G.ItemMenu = {
  label: 'Actions for Google Drive',
  entries: [{ kind: 'section', id: 'main', items: [{ id: 'reconnect', label: 'Reconnect', onAction: noop }, { id: 'disconnect', label: 'Disconnect', onAction: noop }] }],
};

/** Three object cards in a grid: two tiles (an agent, a provider) and an approval body card, the recommended one drawn with the accent edge. */
export const ObjectCard: Story = {
  render: () => (
    <G.Grid kind="cards" columns={3}>
      <G.SurfaceCard
        kind="tile"
        name="Sales assistant"
        byline="Agent, answers in Vietnamese and English"
        mark={{ avatar: { name: 'Sales assistant', kind: 'agent' } }}
        description="Replies to quote requests on Zalo and Chat within a minute."
        badges={[{ label: 'Running', tone: 'success', isDot: true }, { label: '3 to approve', tone: 'warning' }]}
        action={{ label: 'Open', press: noop }}
        menu={agentMenu}
      />
      <G.SurfaceCard
        kind="tile"
        name="Google Drive"
        mark={{ icon: BookGlyph }}
        description="Reads the price lists and the contracts you share with the agents."
        badges={[{ label: 'Connected', tone: 'success', isDot: true }, { label: 'Read only', tone: 'muted' }]}
        action={{ label: 'Manage', press: noop }}
        menu={providerMenu}
      />
      <G.SurfaceCard
        ariaLabel="Refund approval"
        emphasis="accent"
        actions={(
          <G.Cluster gap="inline">
            <G.Button variant="primary" onPress={noop}>Approve refund</G.Button>
            <G.Button variant="border" onPress={noop}>Decline</G.Button>
          </G.Cluster>
        )}
      >
        <G.Stack gap="row">
          <G.Cluster gap="inline" justify="between">
            <G.Heading level={3}>Refund approval</G.Heading>
            <G.Badge tone="warning">Waiting 12 min</G.Badge>
          </G.Cluster>
          <G.Text tone="muted">The sales assistant asks to refund a paid order.</G.Text>
          <G.DescriptionList
            items={[
              { id: 'customer', term: 'Customer', description: 'Nguyen Thi Lan' },
              { id: 'order', term: 'Order', description: 'DH-1042' },
              { id: 'amount', term: 'Amount', description: '1,250,000 VND' },
              { id: 'reason', term: 'Reason', description: 'Delivered late' },
            ]}
          />
        </G.Stack>
      </G.SurfaceCard>
    </G.Grid>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const cards = Array.from(canvasElement.querySelectorAll<HTMLElement>('.starci-core-surface'));
      expect(cards.length).toBe(3);
      for (const card of cards) {
        expect(Number.parseFloat(getComputedStyle(card).borderTopWidth)).toBe(1);
        if (card.dataset.grammarSurfaceEmphasis === undefined) expect(getComputedStyle(card).boxShadow).toBe('none');
      }
      expect(canvasElement.querySelectorAll('.starci-core-surface[data-grammar-surface-emphasis="accent"]').length).toBe(1);
      expect(canvasElement.querySelectorAll('[data-grammar-surface-actions]').length).toBe(1);
    }, { timeout: 4000 });
  },
};

/* ---------- a section with a filter row over a flat table ---------- */

type Invoice = G.DataTableRow & { readonly code: string; readonly customer: string; readonly status: 'Paid' | 'Pending' | 'Overdue'; readonly amount: string };

const INVOICES: readonly Invoice[] = [
  { id: 'i1', code: 'HD-2041', customer: 'Nguyen Thi Lan', status: 'Paid', amount: '1,250,000' },
  { id: 'i2', code: 'HD-2042', customer: 'Tran Van Minh', status: 'Pending', amount: '3,400,000' },
  { id: 'i3', code: 'HD-2043', customer: 'Le Hoang Anh', status: 'Paid', amount: '780,000' },
  { id: 'i4', code: 'HD-2044', customer: 'Pham Quoc Bao', status: 'Overdue', amount: '5,900,000' },
  { id: 'i5', code: 'HD-2045', customer: 'Vo Thanh Tam', status: 'Paid', amount: '420,000' },
  { id: 'i6', code: 'HD-2046', customer: 'Dang Thu Ha', status: 'Pending', amount: '2,150,000' },
  { id: 'i7', code: 'HD-2047', customer: 'Bui Gia Han', status: 'Paid', amount: '960,000' },
  { id: 'i8', code: 'HD-2048', customer: 'Do Ngoc Mai', status: 'Overdue', amount: '1,800,000' },
];

const INVOICE_TONE = { Paid: 'success', Pending: 'warning', Overdue: 'danger' } as const;

const invoiceColumns: readonly G.DataTableColumn<Invoice>[] = [
  { id: 'code', label: 'Invoice', isRowHeader: true, width: 'fit' },
  { id: 'customer', label: 'Customer', truncate: true },
  { id: 'status', label: 'Status', width: 'fit' },
  { id: 'amount', label: 'Amount (VND)', isNumeric: true, align: 'end', width: 'fit' },
];

const invoiceCell = (row: Invoice, columnId: string) => {
  if (columnId === 'status') return <G.Badge tone={INVOICE_TONE[row.status]} isDot>{row.status}</G.Badge>;
  return columnId === 'code' ? row.code : columnId === 'customer' ? row.customer : row.amount;
};

const MONTHS: readonly G.ListOption[] = [
  { id: 'nov', label: 'November 2026' },
  { id: 'oct', label: 'October 2026' },
  { id: 'sep', label: 'September 2026' },
];

const InvoiceSection = () => {
  const [tab, setTab] = useState('all');
  const [month, setMonth] = useState<string | null>('nov');
  const shown = INVOICES.filter((row) => tab === 'all' || row.status.toLowerCase() === tab);
  const countOf = (status: Invoice['status']) => INVOICES.filter((row) => row.status === status).length;
  return (
    <G.Section
      title="Invoices"
      count={42}
      fact="VND"
      action={<G.Button variant="border" size="sm" onPress={noop}>Export</G.Button>}
      caption="Amounts include 10% VAT. Updated at 10:00."
      filter={(
        <>
          <G.Tabs
            label="Invoice status"
            kind="filter"
            selectedKey={tab}
            onSelect={setTab}
            items={[
              { id: 'all', label: 'All', count: INVOICES.length },
              { id: 'paid', label: 'Paid', count: countOf('Paid') },
              { id: 'pending', label: 'Pending', count: countOf('Pending') },
              { id: 'overdue', label: 'Overdue', count: countOf('Overdue'), isAttention: true },
            ]}
          />
          <G.SearchField label="Search invoices" isLabelHidden size="sm" placeholder="Search invoices" clearLabel="Clear search" />
          <G.Select label="Month" isLabelHidden size="sm" prefix="Month:" appearance="compact" options={MONTHS} value={month} onValueChange={setMonth} />
        </>
      )}
    >
      <G.DataTable<Invoice>
        label="Invoices"
        columns={invoiceColumns}
        rows={shown}
        renderCell={invoiceCell}
        emptyContent={<G.EmptyNotice message="No invoice matches." />}
        footer={<G.Pagination label="Invoice pages" page={1} pageCount={6} onPageChange={noop} previousLabel="Previous" nextLabel="Next" pageLabel={(page) => `Page ${page}`} summary="1-8 of 42" />}
      />
    </G.Section>
  );
};

/** A section head with its count, fact and one action, a filter row (tabs with counts, a search, a select with a prefix), a flat table and its pager under the last row. */
export const SectionFilterTable: Story = {
  render: () => <InvoiceSection />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const section = canvasElement.querySelector<HTMLElement>('[data-component="Section"]');
      const table = canvasElement.querySelector<HTMLElement>('[data-component="DataTable"]');
      if (section === null || table === null) throw new Error('the section and its table render');
      expect(section.querySelector('.starci-core-section-filter')).not.toBeNull();
      // At phone width the table is its list of rows (`phone="list"`).
      expect(table.querySelectorAll('[data-grammar-table-row="true"], .starci-core-data-table-list-row').length).toBe(8);
      expect(getComputedStyle(table).boxShadow).toBe('none');
    }, { timeout: 4000 });
  },
};

/* ---------- a figures ribbon above a list ---------- */

const MONTH_FIGURES: readonly G.Figure[] = [
  { id: 'revenue', term: 'Revenue', value: '48.2M', unit: 'VND', meta: '12% vs last month', trend: 'up', trendChart: trend('Revenue, last weeks', [12, 14, 13, 18, 17, 22, 21, 27, 25, 31]) },
  { id: 'orders', term: 'Orders', value: 310, meta: 'Same as last month', trend: 'flat' },
  { id: 'refunds', term: 'Refund rate', value: '4.6', unit: '%', meta: '1.2 pt vs last month', trend: 'up', trendSense: 'lower-is-better' },
  { id: 'overdue', term: 'Overdue invoices', value: 7, meta: 'Oldest 18 days' },
];

const ATTENTION: readonly G.SectionRow[] = [
  { id: 'a1', title: 'Refund for DH-1042', description: 'Waiting for your approval', meta: { text: '12 min' }, onPress: noop },
  { id: 'a2', title: 'Invoice HD-2044 is overdue', description: 'Pham Quoc Bao, 5,900,000 VND', meta: { text: 'Overdue 18 days', tone: 'danger' }, onPress: noop },
  { id: 'a3', title: 'Zalo OA needs to be reconnected', description: 'The token expires tomorrow', meta: { text: '1 day' }, onPress: noop },
];

/** The figures stand as a ribbon between two hairlines, one with a trend line, one whose rise is bad news (the danger tone), above a short list. */
export const FiguresRibbon: Story = {
  render: () => (
    <G.Stack gap="region">
      <G.Section kind="figures" title="This month" items={MONTH_FIGURES} />
      <G.Section
        kind="list"
        title="Needs attention"
        count={ATTENTION.length}
        isAttention
        action={<G.Link variant="head" href="#all">View all</G.Link>}
        items={ATTENTION}
        empty={<G.EmptyNotice message="Nothing needs your attention." />}
      />
    </G.Stack>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const strip = canvasElement.querySelector<HTMLElement>('[data-grammar-description-layout="stat-strip"]');
      if (strip === null) throw new Error('the ribbon renders');
      expect(strip).toHaveAttribute('data-grammar-figures-placement', 'ribbon');
      expect(strip.querySelectorAll('[data-grammar-description-pair]').length).toBe(4);
    }, { timeout: 4000 });
  },
};

/* ---------- a selected table row ---------- */

type Customer = G.DataTableRow & { readonly name: string; readonly plan: string; readonly seats: number; readonly city: string };

const CUSTOMERS: readonly Customer[] = [
  { id: 'c1', name: 'Sao Mai Studio', plan: 'Team', seats: 8, city: 'Ho Chi Minh City' },
  { id: 'c2', name: 'Hoa Sen Cafe', plan: 'Solo', seats: 1, city: 'Da Nang' },
  { id: 'c3', name: 'Tre Xanh Co-op', plan: 'Team', seats: 12, city: 'Hanoi' },
  { id: 'c4', name: 'Lac Hong Clinic', plan: 'Business', seats: 25, city: 'Can Tho' },
  { id: 'c5', name: 'Bien Dong Travel', plan: 'Team', seats: 6, city: 'Nha Trang' },
];

const customerColumns: readonly G.DataTableColumn<Customer>[] = [
  { id: 'name', label: 'Customer', isRowHeader: true, truncate: true },
  { id: 'plan', label: 'Plan', width: 'fit' },
  { id: 'seats', label: 'Seats', isNumeric: true, align: 'end', width: 'fit' },
  { id: 'city', label: 'City', hideBelow: 'tablet' },
];

const CONTACTS: readonly G.SectionRow[] = [
  { id: 'k1', title: 'Hoa Sen Cafe', description: 'Owner: Tran Thi Hoa', meta: { text: 'Today' } },
  { id: 'k2', title: 'Hoa Sen Cafe', description: 'Billing: accounts@hoasen.example', meta: { text: '3 days ago' } },
];

const CustomerTable = () => {
  const [selected, setSelected] = useState<ReadonlyArray<string> | 'all'>(['c2']);
  return (
    <G.Stack gap="region">
      <G.Section title="Customers" count={CUSTOMERS.length}>
        <G.DataTable<Customer>
          label="Customers"
          columns={customerColumns}
          rows={CUSTOMERS}
          renderCell={(row, columnId) => (columnId === 'name' ? row.name : columnId === 'plan' ? row.plan : columnId === 'seats' ? row.seats : row.city)}
          emptyContent={<G.EmptyNotice message="No customers yet." />}
          selectionMode="single"
          selectedIds={selected}
          onSelectionChange={setSelected}
        />
      </G.Section>
      <G.Section kind="list" title="Contacts of Hoa Sen Cafe" count={CONTACTS.length} items={CONTACTS} empty={<G.EmptyNotice message="No contacts yet." />} />
    </G.Stack>
  );
};

/** One row of the table is selected: the grey ground and the 2px accent bar at its start edge; a list of the selected customer's contacts stands below. */
export const SelectedRow: Story = {
  render: () => <CustomerTable />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const rows = ':is([data-grammar-table-row="true"], .starci-core-data-table-list-row)';
      const selected = canvasElement.querySelectorAll<HTMLElement>(`${rows}[data-grammar-selected="true"]`);
      expect(selected.length).toBe(1);
      expect(selected[0]?.textContent).toContain('Hoa Sen Cafe');
      expect(canvasElement.querySelectorAll(`${rows}[data-grammar-selected="false"]`).length).toBe(4);
    }, { timeout: 4000 });
  },
};
