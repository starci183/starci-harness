import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import { BookGlyph, HomeGlyph, SearchGlyph, UserGlyph, noop } from './fixtures.js';

/**
 * NAVIGATION AND DATA ON A PHONE (0.48.0). A filter strip never folds into "+n": at 390 it scrolls sideways with fading edges, every group one swipe away. A
 * `TopBar` takes `startInset="sidebar"` (the brand on the sidebar icons' column) and a `search` slot that shows its wide control from 48rem and its compact one
 * below, so an app writes no media class. A standalone head link has a 44px hit area without a visual change. A table wider than its region is a focusable,
 * named scroll region with a visible edge cue. A timeline's dot is neutral unless its entry is the current one.
 */
const meta: Meta = { title: 'Navigation & Data/Phone fixes (0.48.0)', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

const one = (root: ParentNode, selector: string): HTMLElement => {
  const found = root.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`no element for ${selector}`);
  return found;
};

const GROUPS: ReadonlyArray<G.TabItem> = [
  { id: 'all', label: 'Tất cả', count: 48 },
  { id: 'new', label: 'Khách mới', count: 12 },
  { id: 'returning', label: 'Khách quay lại', count: 20 },
  { id: 'vip', label: 'Khách VIP', count: 6 },
  { id: 'paused', label: 'Tạm ngưng', count: 7 },
  { id: 'lost', label: 'Đã rời đi', count: 3 },
];

const FilterStrip = ({ shape }: { readonly shape: 'underline' | 'pill' }) => {
  const [selectedKey, setSelectedKey] = useState('all');
  return <G.Tabs label={`Nhóm khách ${shape}`} kind="filter" shape={shape} selectedKey={selectedKey} onSelect={setSelectedKey} items={GROUPS} />;
};

/** Six customer groups in a list's filter row, as an underline strip and as pills: no "+n" menu at any width, all six tabs drawn, the strip scrolls inside its own row. */
export const FilterTabsScroll: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 24, maxInlineSize: 720 }}>
      <G.Section kind="list" title="Khách hàng" filter={<FilterStrip shape="underline" />} items={[{ id: 'a', title: 'Mai Phương' }]} empty={null} />
      <G.Section kind="list" title="Khách hàng (pill)" filter={<FilterStrip shape="pill" />} items={[{ id: 'a', title: 'Mai Phương' }]} empty={null} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const frames = [...canvasElement.querySelectorAll<HTMLElement>('.starci-core-tabs-frame[data-grammar-tabs-kind="filter"]')];
      expect(frames).toHaveLength(2);
      for (const frame of frames) {
        expect(frame.querySelector('.starci-core-tabs-more')).toBeNull();
        expect(frame.querySelectorAll('[role="tab"]')).toHaveLength(GROUPS.length);
        const row = frame.closest<HTMLElement>('.starci-core-section-filter') as HTMLElement;
        expect(frame.getBoundingClientRect().right).toBeLessThanOrEqual(row.getBoundingClientRect().right + 1);
      }
      expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(canvasElement.ownerDocument.documentElement.clientWidth);
    }, { timeout: 4000 });
  },
};

const SIDEBAR: ReadonlyArray<G.SidebarGroup> = [
  { id: 'main', label: 'Chính', items: [{ id: 'home', label: 'Tổng quan', source: HomeGlyph }, { id: 'docs', label: 'Tài liệu', source: BookGlyph }, { id: 'team', label: 'Đội ngũ', source: UserGlyph }] },
];

/** A TopBar over a sidebar: from 48rem the brand starts on the column of the sidebar's icons; the wide search shows from 48rem and the compact search below it. */
export const TopBarStartInsetAndSearch: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => (
    <G.WorkspaceShell
      viewport="fixed"
      header={
        <G.TopBar
          position="static"
          startInset="sidebar"
          brand={<G.IdentityLockup title="NIVO" subtitle="Studio" size="control" />}
          search={{
            wide: <G.Button intent="dismiss" endContent={<G.Kbd keys={['Ctrl', 'K']} />} onPress={noop}>Tìm kiếm</G.Button>,
            compact: <G.IconButton label="Tìm kiếm" source={SearchGlyph} onPress={noop} />,
          }}
          actions={<G.AvatarButton name="Mai Phương" size="control" />}
        />
      }
      navigation={<G.Sidebar label="Không gian" groups={SIDEBAR} selectedKey="home" onAction={noop} />}
      navigationLabel="Điều hướng"
      navigationTrack="intrinsic"
      navigationVisibility="wide"
      primaryLabel="Nội dung"
      primary={<G.Page header={{ title: 'Tổng quan' }}><G.Text>Nội dung trang.</G.Text></G.Page>}
    />
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const wide = (canvasElement.ownerDocument.defaultView?.innerWidth ?? 0) >= 768;
      const wideSlot = one(canvasElement, '[data-grammar-top-bar-search-slot="wide"] [data-component="Button"]');
      const compactSlot = one(canvasElement, '[data-grammar-top-bar-search-slot="compact"] [data-component="IconButton"]');
      expect(wideSlot.getBoundingClientRect().width > 0).toBe(wide);
      expect(compactSlot.getBoundingClientRect().width > 0).toBe(!wide);
      if (wide) {
        const brand = one(canvasElement, '.starci-core-top-bar-brand').getBoundingClientRect();
        const icon = one(canvasElement, '.starci-core-sidebar-item svg').getBoundingClientRect();
        expect(Math.abs(brand.left - icon.left)).toBeLessThanOrEqual(2);
      }
    }, { timeout: 4000 });
  },
};

/** A Bento tile's head link: a 14 line that looks the same, with a hit area of at least 44 x 44 around it. */
export const LinkHitArea: Story = {
  render: () => (
    <G.SurfaceCard label="Tự động hoá">
      <G.Text size="sm">Để NIVO làm thay những việc lặp lại.</G.Text>
      <G.Link variant="head" href="#automation">Tìm hiểu thêm</G.Link>
    </G.SurfaceCard>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const link = one(canvasElement, '.starci-core-link[data-grammar-link-variant="head"]');
      expect(link.getBoundingClientRect().height).toBeLessThan(44);
      const layer = getComputedStyle(link, '::before');
      expect(Number.parseFloat(layer.height)).toBeGreaterThanOrEqual(44);
      expect(Number.parseFloat(layer.width)).toBeGreaterThanOrEqual(44);
      const rect = link.getBoundingClientRect();
      const hit = canvasElement.ownerDocument.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2 - 20);
      expect(hit === link || link.contains(hit)).toBe(true);
    });
  },
};

type Order = { readonly id: string; readonly customer: string; readonly product: string; readonly status: string; readonly date: string; readonly amount: string };
const ORDERS: ReadonlyArray<Order> = [
  { id: 'o1', customer: 'Mai Phương', product: 'Gói chăm sóc da mùa xuân', status: 'Đã thanh toán', date: '12/11/2026', amount: '1.250.000 ₫' },
  { id: 'o2', customer: 'Quốc Bảo', product: 'Liệu trình 10 buổi', status: 'Chờ xác nhận', date: '13/11/2026', amount: '8.640.000 ₫' },
];
const ORDER_COLUMNS: ReadonlyArray<G.DataTableColumn<Order>> = [
  { id: 'customer', label: 'Khách hàng', isRowHeader: true, width: 180 },
  { id: 'product', label: 'Sản phẩm', width: 240 },
  { id: 'status', label: 'Trạng thái', width: 160 },
  { id: 'date', label: 'Ngày', width: 140 },
  { id: 'amount', label: 'Số tiền', align: 'end', isNumeric: true, width: 160 },
];

/** A five-column table in a phone-wide region: its scroll region is focusable and named, with the edge cue at the end. */
export const DataTableScrollFocus: Story = {
  render: () => (
    <div style={{ maxInlineSize: 360 }}>
      <G.DataTable label="Đơn hàng" columns={ORDER_COLUMNS} rows={ORDERS} phone="table" renderCell={(row, id) => row[id as keyof Order]} emptyContent="Chưa có đơn hàng." />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const scroller = one(canvasElement, '.starci-core-data-table-scroll');
      expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);
      expect(scroller.getAttribute('data-grammar-table-overflows')).toBe('true');
      expect(scroller.tabIndex).toBe(0);
      expect(scroller.getAttribute('role')).toBe('region');
      expect(scroller.getAttribute('aria-label')).toBe('Đơn hàng');
    }, { timeout: 4000 });
  },
};

/** A history: the past entries' dots are neutral whatever their outcome; only the current entry's dot takes a colour. */
export const TimelineNeutralDot: Story = {
  render: () => (
    <G.Timeline
      label="Lịch sử đơn"
      items={[
        { id: 'a', title: 'Đã đặt hàng', timeLabel: '09:12', state: 'affirmative' },
        { id: 'b', title: 'Thanh toán thất bại', timeLabel: '09:20', state: 'negative' },
        { id: 'c', title: 'Đang giao', timeLabel: '11:40', isCurrent: true },
        { id: 'd', title: 'Đã giao', timeLabel: 'Dự kiến 15:00' },
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const markers = [...canvasElement.querySelectorAll<HTMLElement>('.starci-core-timeline-marker')];
      expect(markers).toHaveLength(4);
      const colours = markers.map((marker) => getComputedStyle(marker).color);
      expect(new Set([colours[0], colours[1], colours[3]]).size).toBe(1);
      expect(colours[2]).not.toBe(colours[0]);
    });
  },
};
