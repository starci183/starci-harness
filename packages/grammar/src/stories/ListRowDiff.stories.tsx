import type { Meta, StoryObj } from '@storybook/react-vite';
import * as G from '../common/index.js';

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

export const VersionDiff: Story = {
  name: 'Version 3 vs version 2: added, removed, changed and a plain row',
  render: () => (
    <div data-diff-story style={{ display: 'flex', flexDirection: 'column', gap: 24, width: 'min(100%, 640px)' }}>
      <G.Section kind="list" title="Steps that differ" items={steps} empty={<G.EmptyNotice message="No steps differ" />} />
      <G.Section kind="list" title="Rights and tools" count={3} items={rights} empty={<G.EmptyNotice message="Unchanged" />} />
    </div>
  ),
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
};
