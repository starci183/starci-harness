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
    const rows = Array.from(single.querySelectorAll<HTMLElement>('[data-grammar-select-item]'));
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

const AutoOrAsk = ({ label, value, onChange, isOff = false }: { readonly label: string; readonly value: string; readonly onChange: (id: string) => void; readonly isOff?: boolean }) => (
  <G.Tabs appearance="primary" label={label} selectedKey={value} onSelect={onChange} items={[{ id: 'auto', label: 'Tự động', isDisabled: isOff }, { id: 'ask', label: 'Hỏi', isDisabled: isOff }]} />
);

const EndCard = () => {
  const [value, setValue] = useState<readonly string[]>(['read', 'send', 'notify']);
  const [sendMode, setSendMode] = useState('auto');
  const [orderMode, setOrderMode] = useState('ask');
  const [isOn, setIsOn] = useState(true);
  return (
    <G.SurfaceCard
      kind="select"
      label="Quyền của agent"
      selectionMode="multiple"
      items={[
        { id: 'read', title: 'Đọc tin nhắn', subtitle: 'Xem hội thoại của khách để hiểu ngữ cảnh.' },
        { id: 'send', title: 'Gửi tin cho khách', subtitle: 'Trả lời khách qua Zalo, thay mặt cửa hàng.', control: <AutoOrAsk label="Gửi tin cho khách" value={sendMode} onChange={setSendMode} /> },
        { id: 'order', title: 'Cập nhật đơn hàng', subtitle: 'Đổi trạng thái và ghi chú đơn.', control: <AutoOrAsk label="Cập nhật đơn hàng" value={orderMode} onChange={setOrderMode} isOff={!value.includes('order')} /> },
        { id: 'notify', title: 'Báo cho nhóm', control: <G.Switch label="Báo ngay" size="md" isLabelHidden isSelected={isOn} onSelectedChange={setIsOn} /> },
        { id: 'plan', title: 'Gói', control: <G.Badge>Pro</G.Badge> },
        { id: 'off', title: 'Tạm dừng', isDisabled: true, control: <AutoOrAsk label="Tạm dừng" value="auto" onChange={() => undefined} /> },
      ]}
      value={value}
      onChange={setValue}
    />
  );
};

/**
 * A row can carry any Grammar content at its end as `control` (0.37.13): a primary Tabs pill ("Tự động | Hỏi"), a Switch, a chip. The slot sits at the row's end centred on the title
 * line, wraps the copy before it, is its own hit target (presses and keys inside never toggle the row) and is dimmed and blocked on a disabled row.
 */
export const SelectWithControl: Story = {
  render: () => (
    <State label="Desktop 420 and phone 320" direction="column">
      <div style={{ inlineSize: 420 }}><EndCard /></div>
      <div style={{ inlineSize: 320 }}><EndCard /></div>
    </State>
  ),
  play: async ({ canvasElement }) => {
    const card = canvasElement.querySelector<HTMLElement>('[data-grammar-select-mode="multiple"]')!;
    await waitFor(() => expect(card.querySelectorAll('[data-grammar-select-control] [role="tab"]').length).toBe(6));
    const items = Array.from(card.querySelectorAll<HTMLElement>('[data-grammar-select-item]'));
    const boxes = () => Array.from(card.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    const rowChecks = () => items.map((item) => item.querySelector<HTMLInputElement>('[data-grammar-select-row] input')!.checked);
    expect(rowChecks()).toEqual([true, true, false, true, false, false]);
    const tabsOf = (item: HTMLElement) => Array.from(item.querySelectorAll<HTMLElement>('[role="tab"]'));
    expect(items[0]!.querySelector('[data-grammar-select-control]')).toBeNull();
    expect(boxes().length).toBe(items.length);
    // Pressing a tab picks the option and never toggles the row.
    await userEvent.click(tabsOf(items[1]!).find((tab) => tab.textContent === 'Hỏi')!);
    await waitFor(() => expect(tabsOf(items[1]!).find((tab) => tab.textContent === 'Hỏi')!.getAttribute('aria-selected')).toBe('true'));
    expect(rowChecks()).toEqual([true, true, false, true, false, false]);
    // Keyboard inside the slot moves the choice and never toggles the row.
    tabsOf(items[1]!).find((tab) => tab.textContent === 'Hỏi')!.focus();
    await userEvent.keyboard('{ArrowLeft}');
    await waitFor(() => expect(tabsOf(items[1]!).find((tab) => tab.textContent === 'Tự động')!.getAttribute('aria-selected')).toBe('true'));
    expect(rowChecks()).toEqual([true, true, false, true, false, false]);
    // The control stands on the row's end beside the copy, never under it.
    for (const root of Array.from(canvasElement.querySelectorAll<HTMLElement>('[data-grammar-select-mode="multiple"]'))) {
      const row = root.querySelectorAll<HTMLElement>('[data-grammar-select-item]')[1]!;
      const end = row.querySelector<HTMLElement>('[data-grammar-select-control]')!.getBoundingClientRect();
      const copy = row.querySelector<HTMLElement>('.starci-core-select-copy')!.getBoundingClientRect();
      expect(end.left).toBeGreaterThanOrEqual(copy.right - 1);
      expect(row.getBoundingClientRect().right - end.right).toBeLessThanOrEqual(20);
    }
    // A disabled row dims and blocks its slot.
    const off = items[5]!.querySelector<HTMLElement>('[data-grammar-select-control]')!;
    expect(off.hasAttribute('inert')).toBe(true);
    expect(getComputedStyle(off).pointerEvents).toBe('none');
    // Pressing the row's own text still toggles it.
    await userEvent.click(within(items[2]!).getByText('Cập nhật đơn hàng'));
    await waitFor(() => expect(rowChecks()[2]).toBe(true));
  },
};
