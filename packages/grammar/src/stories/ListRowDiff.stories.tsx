import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import { quietProbe } from './fixtures.js';

/**
 * LIST-ROW-DIFF (0.37.28, version comparison drawing; a block since 0.55.0, owner: "đã hình vuông rồi dấu + còn sát cạnh"): `ListRowData.diff` marks a row of a
 * version diff. Each diff row is a ROUNDED block (the control / nested-region corner) in the tone's soft pair with 12 padding on every side, a small gap from the
 * next block and no hairline; the gutter mark (`+` added, `−` removed, `~` changed, monospace, in the tone's ink) stands in a column of its own, a row gap from the
 * copy; `diffLabel` is a visible 12 label in the tone's ink over the value ("Đang dùng" over the removed value, "Sau khi duyệt" over the added one), read once.
 * A removed value is struck through, its label is not; a changed row's "from", the Grammar arrow icon, "to" is the 12 muted line. In `Section kind="list"`.
 */
const meta: Meta = { title: 'Surfaces/List row diff (0.37.28)', parameters: { grammar: { bleed: false } } };
export default meta;
type Story = StoryObj;

const steps: readonly G.ListRowData[] = [
  { id: 'qr', title: 'Send payment QR', description: 'sends the QR and the order code', diff: 'added', diffLabel: 'Sau khi duyệt' },
  { id: 'notify', title: 'Notify the team of a new order', description: 'posts the new order to chat', diff: 'added', diffLabel: 'Sau khi duyệt' },
  { id: 'address', title: 'Ask for the address again', description: 'old step, merged into Advice', diff: 'removed', diffLabel: 'Đang dùng' },
  { id: 'order', title: 'Create order', diff: 'changed', change: { from: 'Ask', to: 'Auto' } },
  { id: 'consult', title: 'Advise customer', description: 'items, address, delivery time' },
];
const rights: readonly G.ListRowData[] = [
  { id: 'send', title: 'Send a message to the customer', diff: 'added', diffLabel: 'Added' },
  { id: 'qr-tool', title: 'Create payment QR code', diff: 'added', diffLabel: 'Added' },
  { id: 'write', title: 'Write other business data', diff: 'removed', diffLabel: 'Removed' },
];

const pad = (element: Element, side: 'Top' | 'Bottom' | 'Left' | 'Right'): number => Number.parseFloat(getComputedStyle(element)[`padding${side}`]);
const colourOf = (root: Element, token: string): string => quietProbe(root, (probe) => { probe.style.backgroundColor = `var(${token})`; }, (probe) => getComputedStyle(probe).backgroundColor);

export const VersionDiff: Story = {
  name: 'Version 3 vs version 2: added, removed, changed and a plain row',
  render: () => (
    <div data-diff-story style={{ display: 'flex', flexDirection: 'column', gap: 24, width: 'min(100%, 640px)' }}>
      <G.Section kind="list" title="Steps that differ" items={steps} empty={<G.EmptyNotice message="No steps differ" />} />
      <G.Section kind="list" title="Rights and tools" count={3} items={rights} empty={<G.EmptyNotice message="Unchanged" />} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const root = canvasElement.querySelector<HTMLElement>('[data-diff-story]')!;
      const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-component="ListRow"]'));
      expect(rows.length).toBe(steps.length + rights.length);
      const byId = (id: string) => rows.find((row) => row.getAttribute('data-grammar-row-id') === id)!;
      const diffRows = rows.filter((row) => row.hasAttribute('data-grammar-diff'));
      // The gutter glyph carries the meaning, hidden from the reader (the label is read instead).
      expect(byId('qr').querySelector('[data-grammar-diff-mark]')!.textContent).toBe('+');
      expect(byId('address').querySelector('[data-grammar-diff-mark]')!.textContent).toBe('−');
      expect(byId('order').querySelector('[data-grammar-diff-mark]')!.textContent).toBe('~');
      expect(byId('qr').querySelector('[data-grammar-diff-mark]')!.getAttribute('aria-hidden')).toBe('true');
      expect(getComputedStyle(byId('qr').querySelector('[data-grammar-diff-mark]')!).fontFamily).toMatch(/mono|Consolas|Menlo|Courier/i);
      // 1. A rounded block at the control / nested-region corner (RADIUS-5).
      const corner = quietProbe(root, (probe) => { probe.style.borderTopLeftRadius = 'var(--starci-core-control-radius)'; }, (probe) => getComputedStyle(probe).borderTopLeftRadius);
      expect(Number.parseFloat(corner)).toBeGreaterThan(0);
      for (const row of diffRows) {
        expect(getComputedStyle(row).borderTopLeftRadius).toBe(corner);
        expect(getComputedStyle(row).borderBottomRightRadius).toBe(corner);
      }
      // 2. 12 padding on every side.
      for (const row of diffRows) expect([pad(row, 'Top'), pad(row, 'Right'), pad(row, 'Bottom'), pad(row, 'Left')]).toEqual([12, 12, 12, 12]);
      // Consecutive blocks stand a small gap apart, with no hairline between them.
      expect(byId('notify').getBoundingClientRect().top - byId('qr').getBoundingClientRect().bottom).toBeGreaterThanOrEqual(8);
      expect(getComputedStyle(byId('notify')).borderTopColor).toBe('rgba(0, 0, 0, 0)');
      // 3. The mark keeps its own column: 12 from the block's edge, a row gap (12) from the copy, on the value's line, one column for the list.
      for (const row of diffRows) {
        const mark = row.querySelector('[data-grammar-diff-mark]')!.getBoundingClientRect();
        const copy = row.querySelector('.starci-core-list-row-copy')!.getBoundingClientRect();
        const name = row.querySelector('.starci-core-list-row-name')!.getBoundingClientRect();
        expect(Math.round(mark.left - row.getBoundingClientRect().left)).toBe(12);
        expect(Math.round(copy.left - mark.right)).toBeGreaterThanOrEqual(12);
        expect(Math.abs((mark.top + mark.bottom) / 2 - (name.top + name.bottom) / 2)).toBeLessThanOrEqual(2);
      }
      const marks = diffRows.slice(0, 4).map((row) => Math.round(row.querySelector('[data-grammar-diff-mark]')!.getBoundingClientRect().left));
      expect(new Set(marks).size).toBe(1);
      // 4. The label is visible text over the value: 12, in the tone's ink, never struck through, and no hidden duplicate is read.
      const ink = (token: string) => quietProbe(root, (probe) => { probe.style.color = `var(${token})`; }, (probe) => getComputedStyle(probe).color);
      const labelOf = (id: string) => byId(id).querySelector<HTMLElement>('[data-grammar-diff-label]')!;
      expect(labelOf('address').textContent).toBe('Đang dùng');
      expect(labelOf('qr').textContent).toBe('Sau khi duyệt');
      expect(labelOf('order').textContent).toBe('Changed');
      expect(byId('address').querySelectorAll('.starci-core-visually-hidden').length).toBe(0);
      expect(labelOf('address').getBoundingClientRect().height).toBeGreaterThan(0);
      expect(getComputedStyle(labelOf('qr')).fontSize).toBe('12px');
      expect(getComputedStyle(labelOf('qr')).color).toBe(ink('--success-soft-foreground'));
      expect(getComputedStyle(labelOf('address')).color).toBe(ink('--danger-soft-foreground'));
      expect(getComputedStyle(labelOf('order')).color).toBe(ink('--warning-soft-foreground'));
      expect(getComputedStyle(labelOf('address')).textDecorationLine).toBe('none');
      for (const id of ['qr', 'address', 'order']) {
        expect(labelOf(id).getBoundingClientRect().bottom).toBeLessThanOrEqual(byId(id).querySelector('.starci-core-list-row-name')!.getBoundingClientRect().top + 0.5);
      }
      // The ground is the tone's soft pair; a plain row keeps the surface, the row padding and no label.
      expect(getComputedStyle(byId('qr')).backgroundColor).toBe(colourOf(root, '--success-soft'));
      expect(getComputedStyle(byId('address')).backgroundColor).toBe(colourOf(root, '--danger-soft'));
      expect(getComputedStyle(byId('order')).backgroundColor).toBe(colourOf(root, '--warning-soft'));
      expect(byId('consult').querySelector('[data-grammar-diff-mark]')).toBeNull();
      expect(byId('consult').querySelector('[data-grammar-diff-label]')).toBeNull();
      expect(getComputedStyle(byId('consult')).backgroundColor).not.toBe(colourOf(root, '--success-soft'));
      expect([pad(byId('consult'), 'Left'), pad(byId('consult'), 'Right')]).toEqual([16, 16]);
      // A removed value is struck through; a changed row reads "from", the Grammar arrow icon, "to" at 12, muted (no typed arrow).
      expect(getComputedStyle(byId('address').querySelector('.starci-core-list-row-name')!).textDecorationLine).toBe('line-through');
      const change = byId('order').querySelector<HTMLElement>('[data-grammar-diff-change]')!;
      expect(change.textContent?.replace(/\s+/gu, ' ').trim()).toBe('Ask Auto');
      expect(change.querySelector('[data-component="Icon"]')).not.toBeNull();
      expect(getComputedStyle(change).fontSize).toBe('12px');
    });
  },
};

/** 0.37.29: a loading diff row keeps the gutter column (the mark's box, no glyph), the label's line and the change line, so it is the loaded block's box. */
export const LoadingSameBox: Story = {
  name: 'Loading diff rows keep the gutter: the same box as loaded',
  render: () => (
    <div data-diff-loading style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24, width: 'min(100%, 960px)' }}>
      <G.Section kind="list" title="Loaded" items={steps} empty={<G.EmptyNotice message="-" />} />
      <G.Section kind="list" title="Loading" isLoading items={steps} empty={<G.EmptyNotice message="-" />} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const [loaded, loading] = Array.from(canvasElement.querySelectorAll<HTMLElement>('[data-diff-loading] [data-component="Section"]')) as [HTMLElement, HTMLElement];
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
