import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import * as G from '../common/index.js';
import { State } from './fixtures.js';

/**
 * SurfaceCard kind="select" (0.37.5): a choice list. Each row is a HeroUI Checkbox with a title and, under it, a subtitle; the whole row is the hit target,
 * the dividers span the full card width. `single` keeps one row checked with the same checkbox look; `multiple` toggles each row.
 */
const meta: Meta = { title: 'Surfaces/Select card' };
export default meta;
type Story = StoryObj;

const MODES = [
  { id: 'auto', title: 'Tự làm', subtitle: 'Agent trả lời và làm việc, bạn xem lại sau.' },
  { id: 'ask', title: 'Hỏi trước', subtitle: 'Agent soạn sẵn, chờ bạn duyệt rồi mới gửi.' },
  { id: 'off', title: 'Tạm dừng', isDisabled: true },
  { id: 'plain', title: 'Chỉ có tiêu đề' },
];

const Single = () => {
  const [value, setValue] = useState<string | null>('auto');
  return <G.SurfaceCard kind="select" label="Chế độ" selectionMode="single" items={MODES} value={value} onChange={setValue} />;
};

const Multiple = () => {
  const [value, setValue] = useState<readonly string[]>(['read']);
  return (
    <G.SurfaceCard
      kind="select"
      label="Quyền"
      selectionMode="multiple"
      items={[
        { id: 'read', title: 'Đọc đơn hàng', subtitle: 'Xem danh sách và chi tiết đơn.' },
        { id: 'write', title: 'Sửa đơn hàng', subtitle: 'Đổi trạng thái, ghi chú.' },
        { id: 'refund', title: 'Hoàn tiền' },
      ]}
      value={value}
      onChange={setValue}
    />
  );
};

/** Single and multiple, on the well and on a white surface. Single: checking one unchecks the others; the dividers run edge to edge. */
export const SelectCard: Story = {
  render: () => (
    <>
      <State label="On the well" direction="column"><div style={{ inlineSize: 420 }}><Single /></div><div style={{ inlineSize: 420 }}><Multiple /></div></State>
    </>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvasElement.querySelectorAll('[data-grammar-select-mode="single"] input[type="checkbox"]').length).toBe(4));
    const single = canvasElement.querySelector<HTMLElement>('[data-grammar-select-mode="single"]')!;
    const boxes = () => Array.from(single.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    expect(boxes().map((box) => box.checked)).toEqual([true, false, false, false]);
    await userEvent.click(canvas.getByText('Hỏi trước'));
    await waitFor(() => expect(boxes().map((box) => box.checked)).toEqual([false, true, false, false]));
    expect(boxes()[2]!.disabled).toBe(true);
    const rows = Array.from(single.querySelectorAll<HTMLElement>('[data-grammar-select-row]'));
    const card = single.closest<HTMLElement>('.starci-core-surface')!.getBoundingClientRect();
    const second = rows[1]!.getBoundingClientRect();
    expect(Math.abs(second.left - card.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(second.right - card.right)).toBeLessThanOrEqual(1);
    expect(getComputedStyle(rows[1]!).borderTopWidth).not.toBe('0px');
    expect(single.querySelectorAll('[data-grammar-field-description]').length).toBe(2);
    const multiple = canvasElement.querySelector<HTMLElement>('[data-grammar-select-mode="multiple"]')!;
    await userEvent.click(within(multiple).getByText('Sửa đơn hàng'));
    await waitFor(() => expect(Array.from(multiple.querySelectorAll<HTMLInputElement>('input')).map((box) => box.checked)).toEqual([true, true, false]));
  },
};
