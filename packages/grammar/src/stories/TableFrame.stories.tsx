import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import { noop } from './fixtures.js';
import { reconcileEdges, reconcileLegend, reconcileNodes } from './FlowGraphSteps.data.js';

/**
 * 0.37.8: a table looks like a list card (no grey frame, no grey gutters, no grey header strip: a white body, the column labels 12 muted on the white, 1px full-width
 * row dividers, the footer behind a full-width line), and a section head is one row (label and count chip at the start, at most one Link or IconButton at the end, the
 * description as a caption below the body).
 */
const meta: Meta = { title: 'Surfaces/Table frame and section head' };
export default meta;

type Story = StoryObj;

type Invoice = G.DataTableRow & { readonly name: string; readonly status: string; readonly date: string; readonly amount: string };

const invoices: ReadonlyArray<Invoice> = [
  { id: 'a', name: 'Hoa Xinh Studio', status: 'Đã thanh toán', date: '02/11/2026', amount: '490.000 đ' },
  { id: 'b', name: 'Tiệm bánh Mây', status: 'Chờ xử lý', date: '03/11/2026', amount: '1.250.000 đ' },
  { id: 'c', name: 'Nhà sách Gió', status: 'Đã thanh toán', date: '04/11/2026', amount: '320.000 đ' },
  { id: 'd', name: 'Cà phê Nắng', status: 'Quá hạn', date: '05/11/2026', amount: '2.100.000 đ' },
  { id: 'e', name: 'Studio Lụa', status: 'Đã thanh toán', date: '06/11/2026', amount: '780.000 đ' },
  { id: 'f', name: 'Vườn Sen', status: 'Chờ xử lý', date: '07/11/2026', amount: '150.000 đ' },
  { id: 'g', name: 'Gốm Bát Tràng', status: 'Đã thanh toán', date: '08/11/2026', amount: '3.400.000 đ' },
  { id: 'h', name: 'Trà Tâm', status: 'Đã thanh toán', date: '09/11/2026', amount: '210.000 đ' },
];

const columns: ReadonlyArray<G.DataTableColumn<Invoice>> = [
  { id: 'name', label: 'Khách hàng', isRowHeader: true },
  { id: 'status', label: 'Trạng thái' },
  { id: 'date', label: 'Ngày' },
  { id: 'amount', label: 'Số tiền', align: 'end', isNumeric: true },
];

const cell = (row: Invoice, columnId: string) => row[columnId as 'name' | 'status' | 'date' | 'amount'];

const PAGE_SIZE = 4;

const PagedInvoices = () => {
  const [page, setPage] = useState(1);
  const from = (page - 1) * PAGE_SIZE;
  const rows = invoices.slice(from, from + PAGE_SIZE);
  return (
    <G.DataTable
      label="Hóa đơn"
      columns={columns}
      rows={rows}
      renderCell={cell}
      emptyContent="Chưa có hóa đơn."
      footer={
        <G.Pagination
          label="Các trang hóa đơn"
          page={page}
          pageCount={Math.ceil(invoices.length / PAGE_SIZE)}
          onPageChange={setPage}
          previousLabel="Trước"
          nextLabel="Sau"
          pageLabel={(n) => `Trang ${n}`}
          summary={`${from + 1}–${from + rows.length} trong ${invoices.length} kết quả`}
        />
      }
    />
  );
};

export const TablePlain: Story = {
  render: () => (
    <div style={{ maxInlineSize: '64rem' }}>
      <G.DataTable label="Hóa đơn" columns={columns} rows={invoices.slice(0, 4)} renderCell={cell} emptyContent="Chưa có hóa đơn." />
    </div>
  ),
};

export const TablePaginated: Story = {
  render: () => (
    <div style={{ maxInlineSize: '64rem' }}>
      <PagedInvoices />
    </div>
  ),
};

export const SectionHeadCountLinkCaption: Story = {
  render: () => (
    <div style={{ maxInlineSize: '64rem' }}>
      <G.Section
        title="Hóa đơn gần đây"
        count={8}
        action={<G.Link variant="head" href="#invoices">Xem tất cả</G.Link>}
        description="Cập nhật lúc 10:00, 9 tháng 11 năm 2026."
      >
        <PagedInvoices />
      </G.Section>
    </div>
  ),
};

export const SectionHeadInfoButton: Story = {
  render: () => (
    <div style={{ maxInlineSize: '64rem' }}>
      <G.Section kind="list" title="Thành viên" count={2} action={<G.IconButton label="Giải thích" glyph="more" onPress={noop} />} caption="Mọi người trong nhóm." empty="Chưa có ai." items={[
        { id: '1', title: 'Hoa', description: 'Chủ cửa hàng' },
        { id: '2', title: 'Minh', description: 'Thu ngân' },
      ]} />
    </div>
  ),
};

export const TableCard: Story = {
  render: () => (
    <div style={{ maxInlineSize: '64rem' }}>
      <G.SurfaceCard
        kind="table"
        label="Hóa đơn"
        columns={[{ id: 'name', label: 'Khách hàng' }, { id: 'status', label: 'Trạng thái' }, { id: 'amount', label: 'Số tiền', align: 'end', numeric: true }]}
        rows={invoices.slice(0, 4).map((row) => ({ id: row.id, cells: { name: row.name, status: row.status, amount: row.amount } }))}
        empty="Chưa có hóa đơn."
        footers={[{ kind: 'paging', page: 1, pageCount: 2, onPage: noop, labels: { nav: 'Các trang', previous: 'Trước', next: 'Sau', page: (n: number) => `Trang ${n}`, summary: '1–4 trong 8 kết quả' } }]}
      />
    </div>
  ),
};

const people: ReadonlyArray<G.SectionRow> = [
  { id: '1', title: 'Cần bạn duyệt', description: '3 đơn hàng đang chờ' },
  { id: '2', title: 'Đang chạy', description: '5 luồng công việc' },
  { id: '3', title: 'Đã xong', description: '12 luồng trong tuần' },
];

const workflowRows: ReadonlyArray<G.SectionRow> = [
  { id: 'w1', title: 'Gửi báo giá', description: 'Zalo OA' },
  { id: 'w2', title: 'Nhắc lịch hẹn', description: 'Hằng ngày 08:00' },
  { id: 'w3', title: 'Đối soát công nợ', description: 'Thứ sáu' },
];

const listPane = (
  <G.Pane area="list" label="Luồng công việc" surface>
    <G.PaneSection>
      <G.Section kind="list" title="Luồng công việc" count={3} action={<G.Link variant="head" href="#all">Xem tất cả</G.Link>} items={workflowRows} empty="Chưa có luồng nào." />
    </G.PaneSection>
  </G.Pane>
);

const asidePane = (
  <G.Pane area="aside" label="Cần bạn duyệt" surface>
    <G.PaneSection>
      <G.Section kind="list" title="Cần bạn duyệt" count={3} caption="Cập nhật lúc 10:00." items={people} empty="Không có gì." />
    </G.PaneSection>
  </G.Pane>
);

export const WorkspaceCardsMain: Story = {
  parameters: { layout: 'fullscreen', grammar: { bleed: true } },
  render: () => (
    <G.Page chrome="panes" layout="workspace" header={{ title: 'Tổng quan' }}>
      <G.PaneGrid label="Tổng quan" areas={['list main aside']} columns={['standard', 'fill', 'standard']}>
        {listPane}
        <G.Pane area="main" label="Tổng quan">
          <G.PaneSection>
            <G.Section title="Hóa đơn gần đây" count={4} action={<G.Link variant="head" href="#invoices">Xem tất cả</G.Link>} caption="Cập nhật lúc 10:00, 9 tháng 11.">
              <G.DataTable label="Hóa đơn" columns={columns} rows={invoices.slice(0, 4)} renderCell={cell} emptyContent="Chưa có." />
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
    <G.Page chrome="panes" layout="workspace" header={{ title: 'Trợ lý bán hàng' }}>
      <G.PaneGrid label="Trò chuyện" areas={['list chat aside']} columns={['standard', 'fill', 'standard']}>
        {listPane}
        <G.Pane area="chat" label="Trò chuyện">
          <G.PaneSection as="header"><G.PaneHeader title="Trợ lý bán hàng" description="Trả lời trong một phút" /></G.PaneSection>
          <G.PaneSection scroll={{ label: 'Cuộc trò chuyện', role: 'log', tone: 'background', align: 'end' }}>
            {Array.from({ length: 14 }, (_, index) => <G.MessageBubble key={index} side={index % 2 === 0 ? 'incoming' : 'outgoing'} author={index % 2 === 0 ? 'Trợ lý' : undefined} body={`Tin nhắn số ${index + 1}: khách đặt bàn 4 lúc 19:30.`} />)}
          </G.PaneSection>
        </G.Pane>
        {asidePane}
      </G.PaneGrid>
    </G.Page>
  ),
};

/** 0.36.0: one content per card (a Sublabel above each), shadow and no border on the well, a graph card with its legend under it. */
export const CardsOneContent: Story = {
  parameters: { layout: 'fullscreen', grammar: { bleed: true } },
  render: () => (
    <G.Page header={{ title: 'Một nội dung mỗi thẻ' }}>
      <G.Section title="Đơn hàng #1042">
        <G.Sublabel>Món đã đặt</G.Sublabel>
        <G.SurfaceCard kind="list" ariaLabel="Món đã đặt" items={workflowRows} empty="Chưa có món." />
        <G.Sublabel>Thông tin</G.Sublabel>
        <G.SurfaceCard kind="details" ariaLabel="Thông tin" items={[{ id: 't', term: 'Giờ', description: '19:30' }, { id: 'k', term: 'Khách', description: '4 người' }]} note="Cập nhật lúc 10:00." />
        <G.Sublabel>Luồng xử lý</G.Sublabel>
        <G.SurfaceCard
          ariaLabel="Luồng xử lý"
          note={<G.FlowGraphLegend items={reconcileLegend} />}
        >
          <G.FlowGraph label="Luồng" layout="steps" nodes={reconcileNodes} edges={reconcileEdges} />
        </G.SurfaceCard>
      </G.Section>
    </G.Page>
  ),
};

export const CardHeadCountAndLink: Story = {
  render: () => (
    <div style={{ maxInlineSize: '40rem' }}>
      <G.SurfaceCard kind="list" label="Cần bạn duyệt" count={3} isAttention labelEnd={<G.Link variant="head" href="#all">Xem tất cả</G.Link>} items={workflowRows} empty="Không có gì." />
    </div>
  ),
};

const SwitchRow = ({ initial }: { readonly initial: boolean }) => {
  const [on, setOn] = useState(initial);
  return (
    <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
      <G.Switch label="Dark mode" isLabelHidden size="control" isSelected={on} onSelectedChange={setOn} />
      <G.Switch description="Mô tả ngắn." label="Theo sơ đồ" isSelected={on} onSelectedChange={setOn} />
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

/** 0.36.2: a Section fact is the grey chip; five cards balance as 3 + 2; an EmptyNotice navigation action is a head Link. */
export const FactBalancedAndNoticeLink: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: '1.5rem', maxInlineSize: '64rem' }}>
      <G.Section title="Workspace của tôi" fact="1" action={<G.Link variant="head" href="#w">Mở</G.Link>}>
        <G.EmptyNotice message="Chưa có dự án" description="Tạo dự án đầu tiên." actionLabel="Về tổng quan" actionHref="#home" />
      </G.Section>
      <G.Grid kind="cards" columns="balanced">
        {['Free', 'Basic', 'Pro', 'Team', 'Max'].map((name) => <G.SurfaceCard key={name} kind="details" ariaLabel={name} items={[{ id: name, term: name, description: '199.000 đ' }]} />)}
      </G.Grid>
    </div>
  ),
};

const salesNodes: ReadonlyArray<G.FlowGraphNode> = [
  { id: 's1', kind: 'event', label: 'Khách nhắn tin', description: 'Zalo OA', tag: 'Kích hoạt' },
  { id: 's2', kind: 'action', label: 'Đọc yêu cầu', description: 'Hiểu khách cần gì' },
  { id: 's3', kind: 'condition', label: 'Khách cần gì?', description: 'Phân loại', outputs: [
    { id: 'quote', label: 'Báo giá' }, { id: 'book', label: 'Đặt lịch' }, { id: 'pay', label: 'Khách báo, Tiền về' }, { id: 'ask', label: 'Hỏi thông tin sản phẩm' }, { id: 'other', label: 'Khác' },
  ] },
  { id: 's4', kind: 'action', label: 'Gửi báo giá', description: 'Từ bảng giá' },
  { id: 's5', kind: 'action', label: 'Giữ chỗ', description: 'Trong lịch' },
  { id: 's6', kind: 'action', label: 'Đối soát', description: 'Khớp đơn' },
  { id: 's7', kind: 'ask', label: 'Hỏi chủ', description: 'Cần duyệt', tag: 'Cần chủ' },
  { id: 's8', kind: 'wait', label: 'Chờ khách', description: 'Trả lời trong 1 ngày' },
  { id: 's9', kind: 'action', label: 'Nhắc khách', description: 'Sau 24 giờ' },
  { id: 's10', kind: 'event', label: 'Báo Sales', description: 'Gửi nhóm' },
  { id: 's11', kind: 'end', label: 'Xong' },
  { id: 's12', kind: 'end', label: 'Dừng' },
];
const salesEdges: ReadonlyArray<G.FlowGraphEdge> = [
  { id: 'a', source: 's1', target: 's2' }, { id: 'b', source: 's2', target: 's3' },
  { id: 'c1', source: 's3', target: 's4', sourcePort: 'quote' }, { id: 'c2', source: 's3', target: 's5', sourcePort: 'book' },
  { id: 'c3', source: 's3', target: 's6', sourcePort: 'pay' }, { id: 'c4', source: 's3', target: 's7', sourcePort: 'ask' }, { id: 'c5', source: 's3', target: 's8', sourcePort: 'other' },
  { id: 'd1', source: 's4', target: 's10' }, { id: 'd2', source: 's5', target: 's10' }, { id: 'd3', source: 's6', target: 's10' }, { id: 'd4', source: 's7', target: 's9' }, { id: 'd5', source: 's8', target: 's12' },
  { id: 'e1', source: 's10', target: 's11' }, { id: 'e2', source: 's9', target: 's12' },
];

/** 0.36.2: a 12-step graph with a 5-way branch fits its pane (or starts at the trigger at 0.75 and pans); ports truncate; the kinds carry their own tones. */
export const FlowStepsWideBranch: Story = {
  parameters: { layout: 'fullscreen', grammar: { bleed: true } },
  render: () => (
    <div style={{ padding: '1rem', maxInlineSize: '56rem' }}>
      <G.FlowGraph label="Quy trình bán hàng" layout="steps" nodes={salesNodes} edges={salesEdges} />
    </div>
  ),
};

/** 0.37.3 column sizing: Khách `fill` + `truncate` (one line, ellipsis, tooltip), Trạng thái and Số tiền `fit`, Ngày hidden under 768; `resizable` remembers the widths; under 768 it is a list. */
export const TableColumnSizing: Story = {
  render: () => (
    <G.DataTable<Invoice>
      label="Khách đang xử lý"
      id="story-column-sizing"
      resizable
      columns={[
        { id: 'name', label: 'Khách hàng', isRowHeader: true, width: 'fill', minWidth: 160, truncate: true },
        { id: 'status', label: 'Trạng thái', width: 'fit' },
        { id: 'date', label: 'Ngày', width: 'fit', hideBelow: 'tablet' },
        { id: 'amount', label: 'Số tiền', width: 'fit', align: 'end', isNumeric: true },
      ]}
      rows={invoices}
      renderCell={cell}
      emptyContent={<G.EmptyNotice message="Chưa có khách" />}
    />
  ),
};

/**
 * 0.37.3 equal heights: a `Grid kind="cards"` (the 24 card gap, `align="stretch"` by default) holds three cells that are `Section fill`s, each filling its cell:
 * a table whose white body grows and whose footer sticks to the bottom (`DataTable fill`), and two cards that stretch (`SurfaceCard height="fill"`). The head is one fixed 32px row
 * in every section, with the info button inside it.
 */
export const EqualHeightRow: Story = {
  render: () => (
    <div style={{ maxInlineSize: '80rem' }}>
      <G.Grid kind="cards" columns={3}>
        <G.Section fill title="Hóa đơn" count={8} action={<G.Link variant="head" href="#invoices">Xem tất cả</G.Link>}>
          <G.DataTable<Invoice> fill label="Hóa đơn" columns={columns.slice(0, 2)} rows={invoices.slice(0, 3)} renderCell={cell} emptyContent="Chưa có hóa đơn." footer={<G.Text tone="muted">1–3 trong 8</G.Text>} />
        </G.Section>
        <G.Section fill title="Tiết kiệm">
          <G.SurfaceCard kind="list" height="fill" label="Tiết kiệm" items={[{ id: 'a', title: 'Giờ làm việc', description: '12 giờ tuần này' }]} empty={<G.EmptyNotice message="Chưa có" />} />
        </G.Section>
        <G.Section fill title="Kênh">
          <G.SurfaceCard kind="list" height="fill" label="Kênh" items={[{ id: 'a', title: 'Zalo OA' }, { id: 'b', title: 'Telegram' }, { id: 'c', title: 'Email' }, { id: 'd', title: 'Web' }]} empty={<G.EmptyNotice message="Chưa có" />} />
        </G.Section>
      </G.Grid>
    </div>
  ),
};

/* ---------- columns never collapse (0.37.5) ---------- */

type Order = G.DataTableRow & { readonly code: string; readonly customer: string; readonly product: string; readonly total: string; readonly status: string; readonly date: string; readonly channel: string };

const orders: ReadonlyArray<Order> = [
  { id: 'o1', code: 'DH-1001', customer: 'Nguyễn Thị Hoa Xinh Studio', product: 'Bó hoa hướng dương cỡ lớn kèm thiệp viết tay', total: '1.250.000 đ', status: 'Đã thanh toán', date: '02/11/2026', channel: 'Zalo OA' },
  { id: 'o2', code: 'DH-1002', customer: 'Tiệm bánh Mây', product: 'Bánh kem 20cm', total: '490.000 đ', status: 'Chờ xử lý', date: '03/11/2026', channel: 'Telegram' },
];

const orderCell = (row: Order, columnId: string) => row[columnId as keyof Order];

/** Cells whose text is one line: the fit, numeric and chip columns never wrap below their content, whatever the container. */
const assertNoWrap = (root: HTMLElement) => {
  const cells = Array.from(root.querySelectorAll<HTMLElement>('[data-grammar-table-width="fit"], [data-grammar-table-numeric="true"]'));
  expect(cells.length).toBeGreaterThan(0);
  for (const cellEl of cells) {
    const text = (cellEl.textContent ?? '').trim();
    if (text === '') continue;
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:inherit;';
    probe.textContent = text;
    cellEl.append(probe);
    const one = probe.getBoundingClientRect().width;
    probe.remove();
    const pad = Number.parseFloat(getComputedStyle(cellEl).paddingInlineStart) + Number.parseFloat(getComputedStyle(cellEl).paddingInlineEnd);
    expect(cellEl.getBoundingClientRect().width).toBeGreaterThanOrEqual(one + pad - 1);
    expect(cellEl.scrollHeight).toBeLessThanOrEqual(cellEl.clientHeight + 1);
  }
};

const NeverCollapse = ({ width }: { readonly width: number }) => (
  <div style={{ width, display: 'grid', gap: 24 }} data-grammar-never-collapse={width}>
    <G.DataTable<Order>
      label="Khách đang xử lý"
      columns={[
        { id: 'customer', label: 'Khách', isRowHeader: true, width: 'fill', minWidth: 160, truncate: true },
        { id: 'status', label: 'Trạng thái', width: 'fit' },
        { id: 'channel', label: 'Kênh', width: 'fit', hideBelow: 'tablet' },
      ]}
      rows={orders}
      renderCell={orderCell}
      emptyContent="Trống"
    />
    <G.DataTable<Order>
      label="Đơn hàng"
      columns={[
        { id: 'code', label: 'Mã đơn', isRowHeader: true, width: 'fit' },
        { id: 'customer', label: 'Khách', width: 'fill', minWidth: 120, truncate: true },
        { id: 'product', label: 'Sản phẩm', truncate: true, hideBelow: 'desktop' },
        { id: 'total', label: 'Tổng', isNumeric: true },
        { id: 'status', label: 'Trạng thái', width: 'fit' },
        { id: 'date', label: 'Ngày', width: 'fit', hideBelow: 'tablet' },
      ]}
      rows={orders}
      renderCell={orderCell}
      emptyContent="Trống"
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

const zoneProps = [
  { kind: 'search', label: 'Tìm hóa đơn', value: '', onChange: noop, placeholder: 'Tìm hóa đơn' },
  { kind: 'filter', label: 'Trạng thái', items: [{ id: 'all', label: 'Tất cả' }, { id: 'paid', label: 'Đã thanh toán' }], selectedKey: 'all', onSelect: noop, overflowLabel: 'Thêm', moreLabel: (count: number) => `${count} bộ lọc` },
] as const;

const TableOnTheWell = () => (
  <div data-story-well="true" style={{ maxInlineSize: '48rem' }}>
    <G.SurfaceCard
      kind="table"
      label="Hóa đơn"
      headers={[...zoneProps]}
      columns={[{ id: 'name', label: 'Khách hàng' }, { id: 'status', label: 'Trạng thái' }, { id: 'amount', label: 'Số tiền', align: 'end', numeric: true }]}
      rows={invoices.slice(0, 4).map((row) => ({ id: row.id, cells: { name: row.name, status: row.status, amount: row.amount } }))}
      empty="Chưa có hóa đơn."
      footers={[{ kind: 'paging', page: 1, pageCount: 2, onPage: noop, labels: { nav: 'Các trang', previous: 'Trước', next: 'Sau', page: (n: number) => `Trang ${n}`, summary: '1–4 trong 8 kết quả' } }]}
    />
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
 * 0.37.8 TABLE LOOKS LIKE A LIST CARD: a table card holds one white body (no grey frame, gutter or header strip), its column labels are 12px muted on the white,
 * its rows are divided by 1px lines, its zones by full-width seams; on the pink well it has the shadow and no border, and the same table in a white aside has a 1px
 * border and no shadow.
 */
export const TableLooksLikeAList: Story = {
  render: () => (
    <G.PaneGrid label="Table looks" areas={['main aside']} columns={['fill', 'standard']}>
      <G.Pane area="main" label="Giếng"><G.PaneSection><TableOnTheWell /></G.PaneSection></G.Pane>
      <G.Pane area="aside" surface label="Bảng trên nền trắng">
        <G.PaneSection>
          <G.DataTable label="Hóa đơn" columns={columns} rows={invoices.slice(0, 3)} renderCell={cell} emptyContent="Chưa có hóa đơn." />
        </G.PaneSection>
      </G.Pane>
    </G.PaneGrid>
  ),
  play: async ({ canvasElement }) => {
    const surfaceProbe = probeOf(canvasElement, 'background-color', '--surface');
    const mutedProbe = probeOf(canvasElement, 'color', '--muted');
    await waitFor(() => {
      const card = canvasElement.querySelector<HTMLElement>('[data-story-well="true"] [data-grammar-surface-kind="table"]');
      if (card === null) throw new Error('the table card renders');
      const surface = getComputedStyle(surfaceProbe).backgroundColor;
      // No element of the card paints a grey: every painted ground is the card's own white.
      for (const element of Array.from(card.querySelectorAll<HTMLElement>('*'))) {
        if (element.closest('[data-component="Button"], [data-component="Input"], [data-component="SearchField"], [data-component="Select"], [role="tablist"], [role="tab"]') !== null) continue;
        const ground = getComputedStyle(element).backgroundColor;
        if (ground === 'rgba(0, 0, 0, 0)' || ground === 'transparent') continue;
        if (element.closest('[role="tablist"]') !== null) continue;
        expect(ground).toBe(surface);
      }
      expect(getComputedStyle(card).backgroundColor).toBe(surface);
      // The column labels: 12px, muted, on the white; the rows: a 1px line under each but the last.
      const muted = getComputedStyle(mutedProbe).color;
      const labels = Array.from(card.querySelectorAll<HTMLElement>('.starci-core-data-table-column'));
      expect(labels.length).toBe(3);
      for (const label of labels) {
        expect(getComputedStyle(label).fontSize).toBe('12px');
        expect(getComputedStyle(label).color).toBe(muted);
      }
      const rows = Array.from(card.querySelectorAll<HTMLElement>('.starci-core-data-table-row'));
      expect(rows.length).toBe(4);
      for (const row of rows.slice(0, -1)) {
        expect(Number.parseFloat(getComputedStyle(row.querySelector<HTMLElement>('.starci-core-data-table-cell')!).borderBottomWidth)).toBe(1);
      }
      // The zones' seams run the card's full width.
      const box = card.getBoundingClientRect();
      for (const zone of Array.from(card.querySelectorAll<HTMLElement>('.starci-core-surface-zone'))) {
        expect(Math.abs(zone.getBoundingClientRect().width - box.width)).toBeLessThanOrEqual(1);
        expect(Number.parseFloat(getComputedStyle(zone).borderBlockStartWidth) + Number.parseFloat(getComputedStyle(zone).borderBlockEndWidth)).toBeGreaterThan(0);
      }
      // The well: the shadow and no border.
      expect(getComputedStyle(card).boxShadow).not.toBe('none');
      expect(getComputedStyle(card).borderTopWidth).toBe('0px');
      // The white aside: the same face has a 1px border and no shadow.
      const aside = canvasElement.querySelector<HTMLElement>('[data-grammar-pane-area="aside"] [data-component="DataTable"]');
      if (aside === null) throw new Error('the aside table renders');
      expect(getComputedStyle(aside).boxShadow).toBe('none');
      expect(getComputedStyle(aside).borderTopWidth).toBe('1px');
      expect(getComputedStyle(aside).backgroundColor).toBe(surface);
    });
    surfaceProbe.remove();
    mutedProbe.remove();
  },
};
