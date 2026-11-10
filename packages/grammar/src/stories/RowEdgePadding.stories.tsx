import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import { useState } from 'react';
import * as G from '../common/index.js';
import { noop } from './fixtures.js';

/**
 * ROW-EDGE-PADDING (0.37.25, owner): a side of a row that touches the card's edge is p-4 (`--grammar-card-padding-block`, 16): the left and right, the FIRST row's top and the LAST row's bottom. A side that
 * touches a separator (between rows, under a header zone's divider) is p-3 (`--grammar-row-gap`, 12). Controls included: a row grows around a tall control (the Tabs pill), it never touches a
 * separator. Select, list, details and table rows; a single-row card has p-4 above and below.
 */
const meta: Meta = { title: 'Surfaces/Row edge padding (0.37.25)', parameters: { grammar: { bleed: false } } };
export default meta;
type Story = StoryObj;

const INSET = 16;
const GAP = 12;
const pad = (element: Element, side: 'Top' | 'Bottom'): number => Number.parseFloat(getComputedStyle(element)[`padding${side}`]);

const OPTIONS: readonly G.ListOption[] = [{ id: 'a', label: 'Tất cả' }, { id: 'b', label: 'Đang chạy' }];
const MODES = [{ id: 'auto', label: 'Tự động' }, { id: 'ask', label: 'Hỏi' }] as const;

/** The padding a row's own box carries on its first and last row, and between rows. */
const assertRows = (rows: readonly Element[], first: number, last: number, between: number) => {
  expect(rows.length).toBeGreaterThanOrEqual(2);
  expect(pad(rows[0]!, 'Top')).toBe(first);
  expect(pad(rows[rows.length - 1]!, 'Bottom')).toBe(last);
  for (const row of rows.slice(0, -1)) expect(pad(row, 'Bottom')).toBe(between);
  for (const row of rows.slice(1)) expect(pad(row, 'Top')).toBe(between);
};

const Everything = () => {
  const [mode, setMode] = useState('auto');
  const [on, setOn] = useState(true);
  const [pick, setPick] = useState<string | null>('a');
  return (
    <div data-row-clearance style={{ display: 'flex', flexDirection: 'column', gap: 24, width: 'min(100%, 720px)' }}>
      <G.SurfaceCard
        kind="select"
        label="Select rows"
        selectionMode="multiple"
        value={['a']}
        onChange={noop}
        items={[
          { id: 'a', title: 'Gửi tin cho khách', control: <G.Tabs appearance="primary" label="Chế độ" selectedKey={mode} onSelect={setMode} items={MODES} /> },
          { id: 'b', title: 'Báo cho nhóm', control: <G.Switch label="Báo ngay" size="md" isLabelHidden isSelected={on} onSelectedChange={setOn} /> },
          { id: 'c', title: 'Trạng thái', control: <G.Select label="Trạng thái" isLabelHidden size="sm" options={OPTIONS} value={pick} onValueChange={setPick} /> },
          { id: 'd', title: 'Nhãn', control: <G.Badge tone="success">Đang chạy</G.Badge> },
        ]}
      />
      <G.SurfaceCard
        kind="list"
        label="List rows"
        items={[
          { id: 'l1', title: 'Nền tảng', control: <G.Tabs appearance="primary" label="Chế độ" selectedKey={mode} onSelect={setMode} items={MODES} /> },
          { id: 'l2', title: 'Bật', control: <G.Switch label="Bật" size="md" isLabelHidden isSelected={on} onSelectedChange={setOn} /> },
          { id: 'l3', title: 'Lọc', control: <G.Select label="Lọc" isLabelHidden size="sm" options={OPTIONS} value={pick} onValueChange={setPick} /> },
          { id: 'l4', title: 'Cài đặt', action: { label: 'Mở', press: noop } },
        ]}
        empty={<G.EmptyNotice message="Trống" />}
      />
      <G.SurfaceCard
        kind="table"
        label="Table rows"
        columns={[{ id: 'name', label: 'Tên' }, { id: 'act', label: 'Hành động' }]}
        rows={[{ id: 't1', cells: { name: 'INV-001', act: <G.Button size="sm" onPress={noop}>Tải về</G.Button> } }, { id: 't2', cells: { name: 'INV-002', act: <G.Button size="md" onPress={noop}>Tải về</G.Button> } }]}
        empty={<G.EmptyNotice message="Trống" />}
      />
    </div>
  );
};

export const RowEdgePadding: Story = {
  name: 'Rows: p-4 on the card edge, p-3 on a separator (select, list, table)',
  render: () => <Everything />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const root = canvasElement.querySelector<HTMLElement>('[data-row-clearance]')!;
      const cards = Array.from(root.querySelectorAll<HTMLElement>('[data-component="SurfaceCard"]'));
      const [select, list, table] = cards as [HTMLElement, HTMLElement, HTMLElement];
      // Select rows: the row's label box and its control slot both keep the padding.
      const items = Array.from(select.querySelectorAll<HTMLElement>('.starci-core-select-item'));
      assertRows(items.map((item) => item.querySelector('.starci-core-select-row')!), INSET, INSET, GAP);
      for (const item of items) {
        const control = item.querySelector('.starci-core-select-control');
        if (control !== null) expect(pad(control, 'Top')).toBe(item === items[0] ? INSET : GAP);
      }
      // A tall control (the Tabs pill) never touches the separators: the row grew around it.
      const pill = items[0]!.querySelector('.starci-core-tabs-frame')!.getBoundingClientRect();
      expect(items[0]!.getBoundingClientRect().height).toBeGreaterThanOrEqual(pill.height + INSET + GAP - 0.5);
      // List rows.
      assertRows(Array.from(list.querySelectorAll('.starci-core-list-row')), INSET, INSET, GAP);
      // Table body rows: p-3 between, p-4 under the last.
      const cells = Array.from(table.querySelectorAll('.starci-core-data-table-body .starci-core-data-table-row')).map((row) => row.querySelector('.starci-core-data-table-cell')!);
      assertRows(cells, GAP, INSET, GAP);
      // The left and right sides touch the card's edges: p-4 for the select row and its control, the list row, the first and last table column.
      const side = (element: Element, edge: 'Left' | 'Right'): number => Number.parseFloat(getComputedStyle(element)[`padding${edge}`]);
      expect(side(items[0]!.querySelector('.starci-core-select-row')!, 'Left')).toBe(INSET);
      expect(side(items[0]!.querySelector('.starci-core-select-control')!, 'Right')).toBe(INSET);
      const listRow = list.querySelector('.starci-core-list-row')!;
      expect([side(listRow, 'Left'), side(listRow, 'Right')]).toEqual([INSET, INSET]);
      for (const row of Array.from(table.querySelectorAll('tr'))) expect([side(row.firstElementChild!, 'Left'), side(row.lastElementChild!, 'Right')]).toEqual([INSET, INSET]);
    });
  },
};

const FIRST_SINGLE = [{ id: 's', title: 'Một hàng duy nhất' }];
export const SingleRowAndHeaded: Story = {
  name: 'A single-row card is p-4 above and below; a header zone makes the first row p-3',
  render: () => (
    <div data-row-single style={{ display: 'flex', flexDirection: 'column', gap: 24, width: 'min(100%, 720px)' }}>
      <G.SurfaceCard kind="list" label="Một hàng" items={FIRST_SINGLE} empty={<G.EmptyNotice message="Trống" />} />
      <G.SurfaceCard
        kind="list"
        label="Có vùng đầu"
        items={[{ id: 'a', title: 'Hàng A' }, { id: 'b', title: 'Hàng B' }]}
        headers={[{ kind: 'search', label: 'Tìm', value: '', onChange: noop, placeholder: 'Tìm', clearLabel: 'Xoá' }]}
        empty={<G.EmptyNotice message="Trống" />}
      />
      <G.SurfaceCard kind="details" ariaLabel="Chi tiết" items={[{ id: 't', term: 'Giờ', description: '19:30' }, { id: 'k', term: 'Khách', description: '4 người' }]} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const [single, headed, details] = Array.from(canvasElement.querySelectorAll<HTMLElement>('[data-component="SurfaceCard"]')) as [HTMLElement, HTMLElement, HTMLElement];
      const only = single.querySelector('.starci-core-list-row')!;
      expect(pad(only, 'Top')).toBe(INSET);
      expect(pad(only, 'Bottom')).toBe(INSET);
      const rows = Array.from(headed.querySelectorAll('.starci-core-list-row'));
      assertRows(rows, GAP, INSET, GAP);
      // The header zone is the card's first row: p-4 to the card's top, p-3 to its divider.
      const zone = headed.querySelector('.starci-core-surface-zone')!;
      expect(pad(zone, 'Top')).toBe(INSET);
      expect(pad(zone, 'Bottom')).toBe(GAP);
      assertRows(Array.from(details.querySelectorAll('.starci-core-description-pair')), INSET, INSET, GAP);
    });
  },
};

const QUYEN_MODES = [{ id: 'auto', label: 'Tự động' }, { id: 'ask', label: 'Hỏi' }] as const;

const CentredRows = () => {
  const [send, setSend] = useState('auto');
  const [qr, setQr] = useState('ask');
  const [on, setOn] = useState(true);
  return (
    <div data-row-centre style={{ display: 'flex', flexDirection: 'column', gap: 24, width: 'min(100%, 720px)' }}>
      <G.SurfaceCard
        kind="select"
        label="Quyền"
        selectionMode="multiple"
        value={['send', 'qr']}
        onChange={noop}
        items={[
          { id: 'send', title: 'Gửi tin cho khách qua Zalo', control: <G.Tabs appearance="primary" label="Gửi tin cho khách qua Zalo" selectedKey={send} onSelect={setSend} items={QUYEN_MODES} /> },
          { id: 'qr', title: 'Tạo mã QR thanh toán', subtitle: 'Mã QR cho đơn của khách', control: <G.Tabs appearance="primary" label="Tạo mã QR thanh toán" selectedKey={qr} onSelect={setQr} items={QUYEN_MODES} /> },
          { id: 'tell', title: 'Báo cho nhóm', subtitle: 'Nhắn vào khung trò chuyện của đội', control: <G.Switch label="Báo cho nhóm" size="md" isLabelHidden isSelected={on} onSelectedChange={setOn} /> },
          { id: 'plain', title: 'Đọc tin nhắn của khách', subtitle: 'Không có điều khiển: giữ căn trên' },
        ]}
      />
      <G.SurfaceCard
        kind="list"
        label="Hàng danh sách"
        items={[
          { id: 'l1', title: 'Gửi tin cho khách qua Zalo', description: 'Zalo OA', control: <G.Tabs appearance="primary" label="Chế độ" selectedKey={send} onSelect={setSend} items={QUYEN_MODES} /> },
          { id: 'l2', title: 'Báo cho nhóm', control: <G.Switch label="Báo cho nhóm" size="md" isLabelHidden isSelected={on} onSelectedChange={setOn} /> },
        ]}
        empty={<G.EmptyNotice message="Trống" />}
      />
    </div>
  );
};

const middle = (element: Element): number => { const box = element.getBoundingClientRect(); return (box.top + box.bottom) / 2; };

/** ROW-CONTROL-CENTRE (0.37.29, owner "căn center cho control và checkbox + text"): the checkbox + text group and the control are centred on each other within 1px; the padding holds. */
export const RowControlCentre: Story = {
  name: 'A row control and its checkbox + text are centred on each other',
  render: () => <CentredRows />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const root = canvasElement.querySelector<HTMLElement>('[data-row-centre]')!;
      const [select, list] = Array.from(root.querySelectorAll<HTMLElement>('[data-component="SurfaceCard"]')) as [HTMLElement, HTMLElement];
      const items = Array.from(select.querySelectorAll<HTMLElement>('.starci-core-select-item'));
      for (const item of items.slice(0, 3)) {
        const group = item.querySelector('.starci-core-choice-content')!;
        const control = item.querySelector('.starci-core-select-control > *')!;
        expect(Math.abs(middle(group) - middle(control))).toBeLessThanOrEqual(1);
        // The checkbox centres on the text block.
        expect(Math.abs(middle(item.querySelector('[data-grammar-choice-control]')!) - middle(item.querySelector('.starci-core-select-copy')!))).toBeLessThanOrEqual(1);
        // Never touching the separator: p-3 (p-4 on the card's edge) above and below the control.
        const box = item.getBoundingClientRect();
        const pill = control.getBoundingClientRect();
        expect(pill.top - box.top).toBeGreaterThanOrEqual((item === items[0] ? INSET : GAP) - 0.5);
        expect(box.bottom - pill.bottom).toBeGreaterThanOrEqual(GAP - 0.5);
      }
      // A row without a control keeps its top alignment: the text starts at the row padding.
      const plain = items[3]!;
      expect(Math.abs(plain.querySelector('.starci-core-select-copy')!.getBoundingClientRect().top - plain.getBoundingClientRect().top - GAP)).toBeLessThanOrEqual(1);
      expect(pad(plain.querySelector('.starci-core-select-row')!, 'Bottom')).toBe(INSET);
      // A list row centres its copy and its control (on a narrow card a tall control may wrap under the copy, the list row's own text-first rule; then there is no line to share).
      for (const row of Array.from(list.querySelectorAll<HTMLElement>('.starci-core-list-row'))) {
        const copy = row.querySelector('.starci-core-list-row-copy')!;
        const control = row.querySelector('.starci-core-list-row-control > *')!;
        if (control.getBoundingClientRect().top >= copy.getBoundingClientRect().bottom) continue;
        expect(Math.abs(middle(copy) - middle(control))).toBeLessThanOrEqual(1);
      }
    });
  },
};
