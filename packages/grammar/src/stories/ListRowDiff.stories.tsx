import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * LIST-ROW-DIFF (0.37.28, owner drawing "So sánh phiên bản", GitHub-style): `ListRowData.diff` marks a row of a version diff. A gutter mark at the row's start (`+` added,
 * `−` removed, `~` changed, monospace, in the tone's ink), the row's ground in the tone's soft pair, a removed title struck through, a changed row's "from → to" as the 12 muted
 * line. The meaning is the glyph and the label read before the title (`diffLabel`), never the colour alone. In `SurfaceCard kind="list"` and `Section kind="list"`; the row padding holds.
 */
const meta: Meta = { title: 'Surfaces/List row diff (0.37.28)', parameters: { grammar: { bleed: false } } };
export default meta;
type Story = StoryObj;

const steps: readonly G.ListRowData[] = [
  { id: 'qr', title: 'Gửi QR thanh toán', description: 'gửi QR và mã đơn', diff: 'added', diffLabel: 'Thêm' },
  { id: 'notify', title: 'Báo đội đơn mới', description: 'nhắn đơn mới vào chat', diff: 'added', diffLabel: 'Thêm' },
  { id: 'address', title: 'Hỏi lại địa chỉ', description: 'bước cũ, đã gộp vào Tư vấn', diff: 'removed', diffLabel: 'Bỏ' },
  { id: 'order', title: 'Tạo đơn', diff: 'changed', diffLabel: 'Đổi', change: { from: 'Hỏi', to: 'Tự động' } },
  { id: 'consult', title: 'Tư vấn khách', description: 'món, địa chỉ, giờ giao' },
];
const rights: readonly G.ListRowData[] = [
  { id: 'send', title: 'Gửi tin cho khách', diff: 'added', diffLabel: 'Thêm' },
  { id: 'qr-tool', title: 'Tạo mã QR thanh toán', diff: 'added', diffLabel: 'Thêm' },
  { id: 'write', title: 'Ghi dữ liệu khác của doanh nghiệp', diff: 'removed', diffLabel: 'Bỏ' },
];

const pad = (element: Element, side: 'Top' | 'Bottom' | 'Left' | 'Right'): number => Number.parseFloat(getComputedStyle(element)[`padding${side}`]);
const colourOf = (root: Element, token: string): string => {
  const probe = document.createElement('span');
  probe.style.backgroundColor = `var(${token})`;
  root.append(probe);
  const value = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return value;
};

export const VersionDiff: Story = {
  name: 'Bản 3 so với Bản 2: added, removed, changed and a plain row',
  render: () => (
    <div data-diff-story style={{ display: 'flex', flexDirection: 'column', gap: 24, width: 'min(100%, 640px)' }}>
      <G.SurfaceCard kind="list" label="Các bước khác nhau" items={steps} empty={<G.EmptyNotice message="Không có bước nào khác" />} />
      <G.Section kind="list" title="Quyền và công cụ" count={3} items={rights} empty={<G.EmptyNotice message="Không đổi" />} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const root = canvasElement.querySelector<HTMLElement>('[data-diff-story]')!;
      const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-component="ListRow"]'));
      expect(rows.length).toBe(steps.length + rights.length);
      const byId = (id: string) => rows.find((row) => row.getAttribute('data-grammar-row-id') === id)!;
      // The gutter glyph carries the meaning; the label is read before the title.
      expect(byId('qr').querySelector('[data-grammar-diff-mark]')!.textContent).toBe('+');
      expect(byId('address').querySelector('[data-grammar-diff-mark]')!.textContent).toBe('−');
      expect(byId('order').querySelector('[data-grammar-diff-mark]')!.textContent).toBe('~');
      expect(byId('qr').querySelector('[data-grammar-diff-mark]')!.getAttribute('aria-hidden')).toBe('true');
      expect(byId('address').querySelector('[data-grammar-diff-label]')!.textContent).toBe('Bỏ: ');
      expect(getComputedStyle(byId('qr').querySelector('[data-grammar-diff-mark]')!).fontFamily).toMatch(/mono|Consolas|Menlo|Courier/i);
      // The ground is the tone's soft pair; a plain row keeps the surface.
      expect(getComputedStyle(byId('qr')).backgroundColor).toBe(colourOf(root, '--success-soft'));
      expect(getComputedStyle(byId('address')).backgroundColor).toBe(colourOf(root, '--danger-soft'));
      expect(getComputedStyle(byId('order')).backgroundColor).toBe(colourOf(root, '--warning-soft'));
      expect(byId('consult').querySelector('[data-grammar-diff-mark]')).toBeNull();
      expect(getComputedStyle(byId('consult')).backgroundColor).not.toBe(colourOf(root, '--success-soft'));
      // A removed title is struck through; a changed row reads "from → to" at 12, muted.
      expect(getComputedStyle(byId('address').querySelector('.starci-core-list-row-name')!).textDecorationLine).toBe('line-through');
      const change = byId('order').querySelector<HTMLElement>('[data-grammar-diff-change]')!;
      expect(change.textContent).toBe('Hỏi → Tự động');
      expect(getComputedStyle(change).fontSize).toBe('12px');
      // The row padding holds: p-4 at the card's edges, p-3 at a separator.
      const card = rows.slice(0, steps.length);
      expect(pad(card[0]!, 'Top')).toBe(16);
      expect(pad(card[0]!, 'Bottom')).toBe(12);
      expect(pad(card[card.length - 1]!, 'Bottom')).toBe(16);
      for (const row of card) expect([pad(row, 'Left'), pad(row, 'Right')]).toEqual([16, 16]);
      // The mark stands on the title's line.
      const mark = byId('qr').querySelector('[data-grammar-diff-mark]')!.getBoundingClientRect();
      const name = byId('qr').querySelector('.starci-core-list-row-name')!.getBoundingClientRect();
      expect(Math.abs((mark.top + mark.bottom) / 2 - (name.top + name.bottom) / 2)).toBeLessThanOrEqual(2);
      // The marks stand in one column.
      const marks = card.flatMap((row) => Array.from(row.querySelectorAll('[data-grammar-diff-mark]'))).map((mark) => Math.round(mark.getBoundingClientRect().left));
      expect(new Set(marks).size).toBe(1);
    });
  },
};

/** 0.37.29: a loading diff row keeps the gutter column (the mark's box, no glyph) and the change line, so it is the loaded row's box. */
export const LoadingSameBox: Story = {
  name: 'Loading diff rows keep the gutter: the same box as loaded',
  render: () => (
    <div data-diff-loading style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24, width: 'min(100%, 960px)' }}>
      <G.SurfaceCard kind="list" label="Loaded" items={steps} empty={<G.EmptyNotice message="-" />} />
      <G.SurfaceCard kind="list" label="Loading" isLoading items={steps} empty={<G.EmptyNotice message="-" />} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const [loaded, loading] = Array.from(canvasElement.querySelectorAll<HTMLElement>('[data-diff-loading] [data-component="SurfaceCard"]')) as [HTMLElement, HTMLElement];
      const rowsOf = (card: HTMLElement) => Array.from(card.querySelectorAll<HTMLElement>('[data-component="ListRow"]'));
      const ready = rowsOf(loaded);
      const busy = rowsOf(loading);
      expect(busy.length).toBe(ready.length);
      busy.forEach((row, index) => {
        expect(row.getAttribute('data-grammar-skeleton')).toBe('true');
        expect(Math.abs(row.getBoundingClientRect().height - ready[index]!.getBoundingClientRect().height)).toBeLessThanOrEqual(1);
        const mark = row.querySelector('[data-grammar-diff-mark]');
        const readyMark = ready[index]!.querySelector('[data-grammar-diff-mark]');
        expect(mark === null).toBe(readyMark === null);
        if (mark !== null && readyMark !== null) {
          expect(getComputedStyle(mark).visibility).toBe('hidden');
          expect(Math.abs((mark.getBoundingClientRect().left - loading.getBoundingClientRect().left) - (readyMark.getBoundingClientRect().left - loaded.getBoundingClientRect().left))).toBeLessThanOrEqual(0.5);
        }
      });
    });
  },
};
