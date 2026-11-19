import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * ROW PADDING AND THE LABEL / VALUE TIERS (0.48.0, owner 2026-11-19).
 * A list row is a band with its own padding, px-4 (16 inline), p-4 where it touches the list's edge (the first row's top, the last row's bottom) and p-3 (12) where it touches a divider, in a list that stands on the section title's column with no border: the text is indented 16 under the title, the hairline and the
 * hover fill (the secondary surface, unchanged) run from the title's edge to the list's end. Hover and press never transform a row. A label (a row title, a key, a settings title) is 16 / 400 in the primary colour; the content under it (a description, a value, a hint) is 14 in the secondary colour; a section title is 16 / 500 and the page title 18 / 500. An empty list is an icon, a 16 title and a 12 hint.
 */
const meta: Meta = { title: 'Surfaces/Row padding and label tiers' };
export default meta;
type Story = StoryObj;

const ROWS = [
  { id: 'a', title: 'Luồng 1', description: 'Khi có tin Zalo mới', onPress: () => undefined },
  { id: 'b', title: 'Luồng 2', description: 'Mỗi sáng 8:00', href: '#flow-2' },
];

const Rows = () => (
  <div style={{ width: 460 }}>
    <G.Section kind="list" title="Luồng" count={2} items={ROWS} empty={<G.EmptyNotice message="Empty" />} />
  </div>
);

/** The row is a padded band: 12 block, 16 inline; the list stands on the title's column, so the text is indented under the title while the divider and the hover fill run from the title's edge to the list's end. No border around the list. */
export const PaddedDividedRows: Story = {
  render: () => <Rows />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const list = canvasElement.querySelector<HTMLElement>('.starci-core-section-list')!;
      const rows = Array.from(list.querySelectorAll<HTMLElement>('.starci-core-list-row'));
      expect(rows.length).toBe(2);
      const head = canvasElement.querySelector<HTMLElement>('.starci-core-section-title')!.getBoundingClientRect();
      for (const row of rows) {
        const style = getComputedStyle(row);
        expect([style.paddingLeft, style.paddingRight]).toEqual(['16px', '16px']);
        expect(style.cursor).toBe('pointer');
        const text = row.querySelector<HTMLElement>('.starci-core-list-row-name')!.getBoundingClientRect();
        // The row (hairline, hover fill) starts on the title's column; the text is indented 16 under it.
        expect(Math.abs(row.getBoundingClientRect().left - head.left)).toBeLessThanOrEqual(1);
        expect(Math.round(text.left - head.left)).toBe(16);
        expect(row.getBoundingClientRect().width).toBeGreaterThan(text.width + 31);
      }
      // p-4 where a row touches the list's edge, p-3 where it touches the divider between rows.
      expect([getComputedStyle(rows[0]!).paddingTop, getComputedStyle(rows[0]!).paddingBottom]).toEqual(['16px', '12px']);
      expect([getComputedStyle(rows[1]!).paddingTop, getComputedStyle(rows[1]!).paddingBottom]).toEqual(['12px', '16px']);
      expect(getComputedStyle(rows[1]!).borderTopWidth).toBe('1px');
      const frame = getComputedStyle(list);
      expect([frame.borderTopWidth, frame.borderLeftWidth, frame.boxShadow]).toEqual(['0px', '0px', 'none']);
    });
  },
};

export const EmptyList: Story = {
  render: () => (
    <div style={{ width: 460 }}>
      <G.Section kind="list" title="Các lượt chạy" items={[]} empty={<G.EmptyNotice message="Chưa có lượt chạy nào" description="Lượt chạy mới sẽ hiện ở đây." />} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const notice = canvasElement.querySelector<HTMLElement>('.starci-core-empty-notice')!;
      expect(getComputedStyle(notice).backgroundColor).toBe('rgba(0, 0, 0, 0)');
      const [title, hint] = Array.from(notice.querySelectorAll<HTMLElement>('.starci-core-notice-copy > .starci-core-text'));
      expect(getComputedStyle(title!).fontSize).toBe('16px');
      expect(getComputedStyle(hint!).fontSize).toBe('14px');
    });
  },
};

export const FactsGrid: Story = {
  render: () => (
    <div style={{ width: 560 }}>
      <G.Section title="Thông tin">
        <G.DescriptionList
          layout="grid"
          items={[
            { id: 'a', term: 'Người được giao', description: 'Tất cả · 1 người' },
            { id: 'b', term: 'Kết nối đã gắn', description: 'Zalo OA · 1 tài khoản' },
            { id: 'c', term: 'Nguồn', description: 'nivo-web.webdesk · v7' },
            { id: 'd', term: 'Lượt chạy hôm nay', description: '12' },
          ]}
        />
      </G.Section>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const pairs = Array.from(canvasElement.querySelectorAll<HTMLElement>('[data-grammar-description-layout="grid"] .starci-core-description-pair'));
      expect(pairs.length).toBe(4);
      expect(pairs[1]!.getBoundingClientRect().left).toBeGreaterThan(pairs[0]!.getBoundingClientRect().right - 1);
    });
  },
};

export const LabelOverValue: Story = {
  render: () => (
    <div style={{ width: 460, display: 'grid', gap: 24 }}>
      <G.Section title="Người được giao">
        <G.DescriptionList
          layout="stacked"
          items={[
            { id: 'a', term: 'Được giao cho', description: 'Tất cả · 1 người' },
            { id: 'b', term: 'Kích hoạt', description: 'Khi có tin Zalo mới' },
            { id: 'c', term: 'Nguồn', description: 'nivo-web.webdesk · v7' },
          ]}
        />
      </G.Section>
      <G.Section kind="list" layout="keyValue" title="Chi tiết" items={[{ id: 'k', title: 'Khách hàng', value: 'Maria Garcia' }]} empty={<G.EmptyNotice message="Empty" />} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const term = getComputedStyle(canvasElement.querySelector<HTMLElement>('.starci-core-description-term')!);
      const value = getComputedStyle(canvasElement.querySelector<HTMLElement>('.starci-core-description-value')!);
      const title = getComputedStyle(canvasElement.querySelector<HTMLElement>('.starci-core-section-title')!);
      expect([term.fontSize, term.fontWeight]).toEqual(['16px', '400']);
      expect([value.fontSize, value.fontWeight]).toEqual(['14px', '400']);
      expect(term.color).not.toBe(value.color);
      expect([title.fontSize, title.fontWeight]).toEqual(['16px', '500']);
      const key = getComputedStyle(canvasElement.querySelector<HTMLElement>('[data-grammar-list-layout="keyValue"] .starci-core-list-row-name')!);
      const kv = getComputedStyle(canvasElement.querySelector<HTMLElement>('[data-grammar-list-layout="keyValue"] .starci-core-list-row-value')!);
      expect(key.fontSize).toBe('16px');
      expect(kv.fontSize).toBe('14px');
      expect(key.color).not.toBe(kv.color);
    });
  },
};

/** A settings list: rows flush with the section title (no indent), a 16 title, its 14 hint and a control at the end. */
export const SettingsRows: Story = {
  render: () => (
    <div style={{ width: 460 }}>
      <G.Section
        kind="list"
        layout="settings"
        title="Cài đặt"
        items={[{ id: 's', title: 'Hiện lượt chạy thử', description: 'Gồm cả các lượt chạy do bạn bấm thử.', control: <G.Switch label="Hiện lượt chạy thử" isLabelHidden /> }]}
        empty={<G.EmptyNotice message="Empty" />}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const head = canvasElement.querySelector<HTMLElement>('.starci-core-section-title')!.getBoundingClientRect();
      const name = canvasElement.querySelector<HTMLElement>('.starci-core-list-row-name')!;
      const hint = canvasElement.querySelector<HTMLElement>('.starci-core-list-row-description')!;
      expect(Math.abs(name.getBoundingClientRect().left - head.left)).toBeLessThanOrEqual(1);
      expect(getComputedStyle(name).fontSize).toBe('16px');
      expect(getComputedStyle(hint).fontSize).toBe('14px');
    });
  },
};
