import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import { noop, quietProbe } from './fixtures.js';

/**
 * A table is flat: a white body with no frame, no grey gutters and no grey header strip, the column labels 12 muted, 1px full-width row dividers, the pager behind a
 * full-width line. A section head is one row (label and count chip at the start, at most one Link or IconButton at the end, the description as a caption below the body).
 */
const meta: Meta = { title: 'Surfaces/Table flat and section head' };
export default meta;

type Story = StoryObj;

type Item = G.DataTableRow & { readonly name: string; readonly status: string; readonly date: string; readonly amount: string };

const itemRows: ReadonlyArray<Item> = [
  { id: 'a', name: 'Acme', status: 'Paid', date: '02/11/2026', amount: '$490.00' },
  { id: 'b', name: 'Globex', status: 'Pending', date: '03/11/2026', amount: '$1,250.00' },
  { id: 'c', name: 'Initech', status: 'Paid', date: '04/11/2026', amount: '$320.00' },
  { id: 'd', name: 'Umbrella', status: 'Overdue', date: '05/11/2026', amount: '$2,100.00' },
  { id: 'e', name: 'Hooli', status: 'Paid', date: '06/11/2026', amount: '$780.00' },
  { id: 'f', name: 'Stark', status: 'Pending', date: '07/11/2026', amount: '$150.00' },
  { id: 'g', name: 'Wayne Corp', status: 'Paid', date: '08/11/2026', amount: '$3,400.00' },
  { id: 'h', name: 'Wonka', status: 'Paid', date: '09/11/2026', amount: '$210.00' },
];

const columns: ReadonlyArray<G.DataTableColumn<Item>> = [
  { id: 'name', label: 'Customer', isRowHeader: true },
  { id: 'status', label: 'Status' },
  { id: 'date', label: 'Date' },
  { id: 'amount', label: 'Amount', align: 'end', isNumeric: true },
];

const cell = (row: Item, columnId: string) => row[columnId as 'name' | 'status' | 'date' | 'amount'];

const PAGE_SIZE = 4;

const PagedItems = () => {
  const [page, setPage] = useState(1);
  const from = (page - 1) * PAGE_SIZE;
  const rows = itemRows.slice(from, from + PAGE_SIZE);
  return (
    <G.DataTable
      label="Items"
      columns={columns}
      rows={rows}
      renderCell={cell}
      emptyContent="No items yet."
      footer={
        <G.Pagination
          label="Item pages"
          page={page}
          pageCount={Math.ceil(itemRows.length / PAGE_SIZE)}
          onPageChange={setPage}
          previousLabel="Previous"
          nextLabel="Next"
          pageLabel={(n) => `Page ${n}`}
          summary={`${from + 1}–${from + rows.length} of ${itemRows.length} results`}
        />
      }
    />
  );
};

export const TablePlain: Story = {
  render: () => (
    <div style={{ maxInlineSize: '64rem' }}>
      <G.DataTable label="Items" columns={columns} rows={itemRows.slice(0, 4)} renderCell={cell} emptyContent="No items yet." />
    </div>
  ),
};

export const TablePaginated: Story = {
  render: () => (
    <div style={{ maxInlineSize: '64rem' }}>
      <PagedItems />
    </div>
  ),
};

export const SectionHeadCountLinkCaption: Story = {
  render: () => (
    <div style={{ maxInlineSize: '64rem' }}>
      <G.Section
        title="Recent items"
        count={8}
        action={<G.Link variant="head" href="#itemRows">View all</G.Link>}
        description="Updated at 10:00, November 9, 2026."
      >
        <PagedItems />
      </G.Section>
    </div>
  ),
};

export const SectionHeadInfoButton: Story = {
  render: () => (
    <div style={{ maxInlineSize: '64rem' }}>
      <G.Section kind="list" title="Members" count={2} action={<G.IconButton label="Explain" glyph="more" onPress={noop} />} caption="Everyone on the team." empty="Nobody yet." items={[
        { id: '1', title: 'Alex', description: 'Shop owner' },
        { id: '2', title: 'Sam', description: 'Cashier' },
      ]} />
    </div>
  ),
};

const people: ReadonlyArray<G.SectionRow> = [
  { id: '1', title: 'Needs your approval', description: '3 orders waiting' },
  { id: '2', title: 'Running', description: '5 workflows' },
  { id: '3', title: 'Done', description: '12 workflows this week' },
];

const workflowRows: ReadonlyArray<G.SectionRow> = [
  { id: 'w1', title: 'Send a quote', description: 'Email' },
  { id: 'w2', title: 'Appointment reminder', description: 'Daily 08:00' },
  { id: 'w3', title: 'Balance check', description: 'Friday' },
];

const listPane = (
  <G.Pane area="list" label="Workflows" surface>
    <G.PaneSection>
      <G.Section kind="list" title="Workflows" count={3} action={<G.Link variant="head" href="#all">View all</G.Link>} items={workflowRows} empty="No workflows yet." />
    </G.PaneSection>
  </G.Pane>
);

const asidePane = (
  <G.Pane area="aside" label="Needs your approval" surface>
    <G.PaneSection>
      <G.Section kind="list" title="Needs your approval" count={3} caption="Updated at 10:00." items={people} empty="Nothing here." />
    </G.PaneSection>
  </G.Pane>
);

export const WorkspaceCardsMain: Story = {
  parameters: { layout: 'fullscreen', grammar: { bleed: true } },
  render: () => (
    <G.Page chrome="panes" layout="workspace" header={{ title: 'Overview' }}>
      <G.PaneGrid label="Overview" areas={['list main aside']} columns={['standard', 'fill', 'standard']}>
        {listPane}
        <G.Pane area="main" label="Overview">
          <G.PaneSection>
            <G.Section title="Recent items" count={4} action={<G.Link variant="head" href="#itemRows">View all</G.Link>} caption="Updated at 10:00, November 9.">
              <G.DataTable label="Items" columns={columns} rows={itemRows.slice(0, 4)} renderCell={cell} emptyContent="None yet." />
            </G.Section>
          </G.PaneSection>
        </G.Pane>
        {asidePane}
      </G.PaneGrid>
    </G.Page>
  ),
};

export const WorkspaceChatMain: Story = {
  parameters: { layout: 'fullscreen', grammar: { bleed: true } },
  render: () => (
    <G.Page chrome="panes" layout="workspace" header={{ title: 'Sales assistant' }}>
      <G.PaneGrid label="Chat" areas={['list chat aside']} columns={['standard', 'fill', 'standard']}>
        {listPane}
        <G.Pane area="chat" label="Chat">
          <G.PaneSection as="header"><G.PaneHeader title="Sales assistant" description="Replies within a minute" /></G.PaneSection>
          <G.PaneSection scroll={{ label: 'Conversation', role: 'log', tone: 'background', align: 'end' }}>
            {Array.from({ length: 14 }, (_, index) => <G.MessageBubble key={index} side={index % 2 === 0 ? 'incoming' : 'outgoing'} author={index % 2 === 0 ? 'Assistant' : undefined} body={`Message ${index + 1}: customer booked a table for 4 at 19:30.`} />)}
          </G.PaneSection>
        </G.Pane>
        {asidePane}
      </G.PaneGrid>
    </G.Page>
  ),
};

/** One content per section (a Sublabel above each). */
export const CardsOneContent: Story = {
  parameters: { layout: 'fullscreen', grammar: { bleed: true } },
  render: () => (
    <G.Page header={{ title: 'One content per card' }}>
      <G.Section title="Order #1042">
        <G.Section sublabel="Ordered items" kind="list" items={workflowRows} empty="No items yet." />
        <G.Section sublabel="Details" caption="Updated at 10:00.">
          <G.DescriptionList isDivided items={[{ id: 't', term: 'Time', description: '19:30' }, { id: 'k', term: 'Guests', description: '4 people' }]} />
        </G.Section>
      </G.Section>
    </G.Page>
  ),
};

export const CardHeadCountAndLink: Story = {
  render: () => (
    <div style={{ maxInlineSize: '40rem' }}>
      <G.Section kind="list" title="Needs your approval" count={3} isAttention action={<G.Link variant="head" href="#all">View all</G.Link>} items={workflowRows} empty="Nothing here." />
    </div>
  ),
};

const SwitchRow = ({ initial }: { readonly initial: boolean }) => {
  const [on, setOn] = useState(initial);
  return (
    <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
      <G.Switch label="Dark mode" isLabelHidden size="control" isSelected={on} onSelectedChange={setOn} />
      <G.Switch description="A short description." label="Follow the diagram" isSelected={on} onSelectedChange={setOn} />
    </div>
  );
};

/** 0.36.2: no border on any Switch; off and on. */
export const SwitchNoBorder: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: '1.5rem' }}>
      <SwitchRow initial={false} />
      <SwitchRow initial />
    </div>
  ),
};

/** 0.36.2: a Section fact is the grey chip; five object cards balance as 3 + 2; an EmptyNotice navigation action is a head Link. */
export const FactBalancedAndNoticeLink: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: '1.5rem', maxInlineSize: '64rem' }}>
      <G.Section title="My workspace" fact="1" action={<G.Link variant="head" href="#w">Open</G.Link>}>
        <G.EmptyNotice message="No projects yet" description="Create the first project." actionLabel="Back to overview" actionHref="#home" />
      </G.Section>
      <G.Grid kind="cards" columns="balanced">
        {['Free', 'Basic', 'Pro', 'Team', 'Max'].map((name) => <G.SurfaceCard key={name} label={name}><G.Text role="figure">$199.00</G.Text></G.SurfaceCard>)}
      </G.Grid>
    </div>
  ),
};

/** 0.37.3 column sizing: Customer `fill` + `truncate` (one line, ellipsis, tooltip), Status and Amount `fit`, Date hidden under 768; `resizable` remembers the widths; under 768 it is a list. */
export const TableColumnSizing: Story = {
  render: () => (
    <G.DataTable<Item>
      label="Customers in progress"
      id="story-column-sizing"
      resizable
      columns={[
        { id: 'name', label: 'Customer', isRowHeader: true, width: 'fill', minWidth: 160, truncate: true },
        { id: 'status', label: 'Status', width: 'fit' },
        { id: 'date', label: 'Date', width: 'fit', hideBelow: 'tablet' },
        { id: 'amount', label: 'Amount', width: 'fit', align: 'end', isNumeric: true },
      ]}
      rows={itemRows}
      renderCell={cell}
      emptyContent={<G.EmptyNotice message="No customers yet" />}
    />
  ),
};

/**
 * 0.37.3 equal heights: a `Grid kind="cards"` (the 24 card gap, `align="stretch"` by default) holds three cells that are `Section fill`s, each filling its cell:
 * a table whose white body grows and whose footer sticks to the bottom (`DataTable fill`), and two lists. The head is one fixed 32px row
 * in every section, with the info button inside it.
 */
export const EqualHeightRow: Story = {
  render: () => (
    <div style={{ maxInlineSize: '80rem' }}>
      <G.Grid kind="cards" columns={3}>
        <G.Section fill title="Items" count={8} action={<G.Link variant="head" href="#itemRows">View all</G.Link>}>
          <G.DataTable<Item> fill label="Items" columns={columns.slice(0, 2)} rows={itemRows.slice(0, 3)} renderCell={cell} emptyContent="No items yet." footer={<G.Text tone="muted">1–3 of 8</G.Text>} />
        </G.Section>
        <G.Section kind="list" fill title="Savings" items={[{ id: 'a', title: 'Working hours', description: '12 hours this week' }]} empty={<G.EmptyNotice message="None yet" />} />
        <G.Section kind="list" fill title="Channels" items={[{ id: 'a', title: 'Chat' }, { id: 'b', title: 'Webhook' }, { id: 'c', title: 'Email' }, { id: 'd', title: 'Web' }]} empty={<G.EmptyNotice message="None yet" />} />
      </G.Grid>
    </div>
  ),
};

/* ---------- columns never collapse (0.37.5) ---------- */

type Order = G.DataTableRow & { readonly code: string; readonly customer: string; readonly product: string; readonly total: string; readonly status: string; readonly date: string; readonly channel: string };

const orders: ReadonlyArray<Order> = [
  { id: 'o1', code: 'OR-1001', customer: 'Alex Chen Design Studio Partners', product: 'Large sunflower bouquet with a handwritten card', total: '$1,250.00', status: 'Paid', date: '02/11/2026', channel: 'Chat' },
  { id: 'o2', code: 'OR-1002', customer: 'Globex', product: 'Cake 20cm', total: '$490.00', status: 'Pending', date: '03/11/2026', channel: 'Webhook' },
];

const orderCell = (row: Order, columnId: string) => row[columnId as keyof Order];

/** Cells whose text is one line: the fit, numeric and chip columns never wrap below their content, whatever the container. */
const assertNoWrap = (root: HTMLElement) => {
  const cells = Array.from(root.querySelectorAll<HTMLElement>('[data-grammar-table-width="fit"], [data-grammar-table-numeric="true"]'));
  expect(cells.length).toBeGreaterThan(0);
  for (const cellEl of cells) {
    const text = (cellEl.textContent ?? '').trim();
    if (text === '') continue;
    // Read through a probe in the cell's shadow root (quietProbe): a probe appended to the document inside the waitFor re-runs its callback on every mutation, and a first run that failed froze the browser of the DNA check (FourColumnsNeverWrap at 390).
    const one = quietProbe(
      cellEl,
      (probe) => { probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:inherit;'; probe.textContent = text; },
      (probe) => probe.getBoundingClientRect().width,
    );
    const pad = Number.parseFloat(getComputedStyle(cellEl).paddingInlineStart) + Number.parseFloat(getComputedStyle(cellEl).paddingInlineEnd);
    expect(cellEl.getBoundingClientRect().width).toBeGreaterThanOrEqual(one + pad - 1);
    expect(cellEl.scrollHeight).toBeLessThanOrEqual(cellEl.clientHeight + 1);
  }
};

const NeverCollapse = ({ width }: { readonly width: number }) => (
  <div style={{ width, display: 'grid', gap: 24 }} data-grammar-never-collapse={width}>
    <G.DataTable<Order>
      label="Customers in progress"
      columns={[
        { id: 'customer', label: 'Customer', isRowHeader: true, width: 'fill', minWidth: 160, truncate: true },
        { id: 'status', label: 'Status', width: 'fit' },
        { id: 'channel', label: 'Channel', width: 'fit', hideBelow: 'tablet' },
      ]}
      rows={orders}
      renderCell={orderCell}
      emptyContent="Empty"
    />
    <G.DataTable<Order>
      label="Orders"
      columns={[
        { id: 'code', label: 'Order code', isRowHeader: true, width: 'fit' },
        { id: 'customer', label: 'Customer', width: 'fill', minWidth: 120, truncate: true },
        { id: 'product', label: 'Product', truncate: true, hideBelow: 'desktop' },
        { id: 'total', label: 'Total', isNumeric: true },
        { id: 'status', label: 'Status', width: 'fit' },
        { id: 'date', label: 'Date', width: 'fit', hideBelow: 'tablet' },
      ]}
      rows={orders}
      renderCell={orderCell}
      emptyContent="Empty"
    />
  </div>
);

/**
 * 0.37.5: the fit, numeric and chip columns of a table never wrap below their content (a letter per line was `overflow-wrap: anywhere` on a fitting table), at 1100, 800
 * and 600px; the fill column truncates, and a table too narrow for its columns scrolls inside its frame.
 */
export const ColumnsNeverCollapse: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 32 }}>
      {[1100, 800, 600].map((width) => <NeverCollapse key={width} width={width} />)}
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      for (const width of [1100, 800, 600]) {
        const root = canvasElement.querySelector<HTMLElement>(`[data-grammar-never-collapse="${width}"]`);
        if (root === null) throw new Error(`the ${width}px tables render`);
        assertNoWrap(root);
      }
    });
  },
};

/**
 * 0.37.9 (owner law): short columns NEVER wrap. A 4-column table with no widths given: the first text column fills and truncates, the status, date and money columns are `fit`
 * (nowrap, as wide as their content), at a 1440 and a 1024 container ("Paid" stays on one line).
 */
const FourColumns = ({ width }: { readonly width: number }) => (
  <div style={{ width }} data-grammar-never-collapse={width}>
    <G.DataTable<Order>
      label={`Items ${width}`}
      columns={[
        { id: 'customer', label: 'Customer', isRowHeader: true },
        { id: 'status', label: 'Status' },
        { id: 'date', label: 'Date' },
        { id: 'total', label: 'Total', isNumeric: true },
      ]}
      rows={[...orders, { id: 'o3', code: 'OR-1003', customer: 'Initech Limited Liability Company Southern Branch Office Number Three', product: '', total: '$12,500.00', status: 'Paid', date: '04/11/2026', channel: '' }]}
      renderCell={orderCell}
      emptyContent="Empty"
    />
  </div>
);

export const FourColumnsNeverWrap: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 32 }}>
      {[1440, 1024].map((width) => <FourColumns key={width} width={width} />)}
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      for (const width of [1440, 1024]) {
        const root = canvasElement.querySelector<HTMLElement>(`[data-grammar-never-collapse="${width}"]`);
        if (root === null) throw new Error(`the ${width}px table renders`);
        assertNoWrap(root);
        const fill = root.querySelector<HTMLElement>('[data-grammar-table-width="fill"]');
        if (fill === null) throw new Error('the first text column fills');
        for (const status of Array.from(root.querySelectorAll<HTMLElement>('[data-grammar-table-width="fit"]'))) {
          expect(status.scrollHeight).toBeLessThanOrEqual(status.clientHeight + 1);
        }
      }
    });
  },
};

const TableOnTheWell = () => (
  <div data-story-well="true" style={{ maxInlineSize: '48rem' }}>
    <G.Section
      title="Items"
      filter={(
        <>
          <G.Tabs label="Status" kind="filter" selectedKey="all" onSelect={noop} items={[{ id: 'all', label: 'All' }, { id: 'paid', label: 'Paid' }]} />
          <G.SearchField label="Search items" isLabelHidden placeholder="Search items" clearLabel="Clear search" />
        </>
      )}
    >
      <G.DataTable
        label="Items"
        columns={[{ id: 'name', label: 'Customer' }, { id: 'status', label: 'Status' }, { id: 'amount', label: 'Amount', align: 'end', isNumeric: true }]}
        rows={itemRows.slice(0, 4)}
        renderCell={cell}
        emptyContent="No items yet."
        footer={<G.Pagination label="Item pages" page={1} pageCount={2} onPageChange={noop} previousLabel="Previous" nextLabel="Next" pageLabel={(n) => `Page ${n}`} summary="1–4 of 8 results" />}
      />
    </G.Section>
  </div>
);

/** One probe painted with a token, appended ONCE before a `waitFor` (a probe added inside the callback mutates the DOM the `waitFor` watches and loops forever). */
const probeOf = (host: HTMLElement, property: 'background-color' | 'color', token: string) => {
  const probe = document.createElement('span');
  probe.style.setProperty(property, `var(${token})`);
  host.append(probe);
  return probe;
};

/**
 * A table is flat on the well and on a white aside alike: no painted frame or shadow, its column labels are 12px muted, its rows are divided by 1px lines.
 */
export const TableLooksFlat: Story = {
  render: () => (
    <G.PaneGrid label="Table looks" areas={{ base: ['main', 'aside'], medium: ['main aside'] }} columns={{ base: ['fill'], medium: ['fill', 'standard'] }}>
      <G.Pane area="main" label="Well"><G.PaneSection><TableOnTheWell /></G.PaneSection></G.Pane>
      <G.Pane area="aside" surface label="Table on white">
        <G.PaneSection>
          <G.DataTable label="Items" columns={columns} rows={itemRows.slice(0, 3)} renderCell={cell} emptyContent="No items yet." />
        </G.PaneSection>
      </G.Pane>
    </G.PaneGrid>
  ),
  play: async ({ canvasElement }) => {
    const mutedProbe = probeOf(canvasElement, 'color', '--muted');
    await waitFor(() => {
      const table = canvasElement.querySelector<HTMLElement>('[data-story-well="true"] [data-component="DataTable"]');
      if (table === null) throw new Error('the table renders');
      const muted = getComputedStyle(mutedProbe).color;
      const labels = Array.from(table.querySelectorAll<HTMLElement>('.starci-core-data-table-column'));
      expect(labels.length).toBe(3);
      for (const label of labels) {
        expect(getComputedStyle(label).fontSize).toBe('12px');
        expect(getComputedStyle(label).color).toBe(muted);
      }
      const rows = Array.from(table.querySelectorAll<HTMLElement>('.starci-core-data-table-row'));
      expect(rows.length).toBe(4);
      for (const row of rows.slice(0, -1)) {
        expect(Number.parseFloat(getComputedStyle(row.querySelector<HTMLElement>('.starci-core-data-table-cell')!).borderBottomWidth)).toBe(1);
      }
      for (const flat of [table, canvasElement.querySelector<HTMLElement>('[data-grammar-pane-area="aside"] [data-component="DataTable"]')]) {
        if (flat === null) throw new Error('both tables render');
        expect(getComputedStyle(flat).boxShadow).toBe('none');
      }
    });
    mutedProbe.remove();
  },
};
