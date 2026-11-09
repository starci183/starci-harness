import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import * as G from '../common/index.js';
import { noop } from './fixtures.js';
import { reconcileEdges, reconcileLegend, reconcileNodes } from './FlowGraphSteps.data.js';

/**
 * 0.36.0: the table is HeroUI v3's native look (the grey frame IS the card: the heading row on the grey, a white rounded body with hairline rows,
 * the footer in the grey) and a section head is one row (label and count chip at the start, at most one Link or IconButton at the end, the
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
