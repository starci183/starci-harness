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
  { id: 'auto', title: 'Automatic', subtitle: 'The assistant replies and works, you review later.' },
  { id: 'ask', title: 'Ask first', subtitle: 'The assistant drafts and waits for your approval before sending.' },
  { id: 'off', title: 'Paused', isDisabled: true },
  { id: 'plain', title: 'Title only' },
];

const Single = () => {
  const [value, setValue] = useState<string | null>('auto');
  return <G.SurfaceCard kind="select" label="Mode" selectionMode="single" items={MODES} value={value} onChange={setValue} />;
};

const Multiple = () => {
  const [value, setValue] = useState<readonly string[]>(['read']);
  return (
    <G.SurfaceCard
      kind="select"
      label="Permissions"
      selectionMode="multiple"
      items={[
        { id: 'read', title: 'Read orders', subtitle: 'View the list and order details.' },
        { id: 'write', title: 'Edit orders', subtitle: 'Change status, add notes.' },
        { id: 'refund', title: 'Refund' },
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
    await userEvent.click(canvas.getByText('Ask first'));
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
    await userEvent.click(within(multiple).getByText('Edit orders'));
    await waitFor(() => expect(Array.from(multiple.querySelectorAll<HTMLInputElement>('input')).map((box) => box.checked)).toEqual([true, true, false]));
  },
};

const modeItems = (isOff: boolean) => [{ id: 'auto', label: 'Auto', isDisabled: isOff }, { id: 'ask', label: 'Ask', isDisabled: isOff }] as const;

const EndCard = () => {
  const [value, setValue] = useState<readonly string[]>(['read', 'send', 'notify']);
  const [sendMode, setSendMode] = useState('auto');
  const [orderMode, setOrderMode] = useState('ask');
  const [isOn, setIsOn] = useState(true);
  return (
    <G.SurfaceCard
      kind="select"
      label="Assistant permissions"
      selectionMode="multiple"
      items={[
        { id: 'read', title: 'Read messages', subtitle: 'View the conversation of the customer for context.' },
        { id: 'send', title: 'Message customers', subtitle: 'Reply to customers over Chat, on behalf of the shop.', control: <G.Tabs appearance="primary" label="Message customers" selectedKey={sendMode} onSelect={setSendMode} items={modeItems(false)} /> },
        { id: 'order', title: 'Update orders', subtitle: 'Change status and add order notes.', control: <G.Tabs appearance="primary" label="Update orders" selectedKey={orderMode} onSelect={setOrderMode} items={modeItems(!value.includes('order'))} /> },
        { id: 'notify', title: 'Notify team', control: <G.Switch label="Notify now" size="md" isLabelHidden isSelected={isOn} onSelectedChange={setIsOn} /> },
        { id: 'plan', title: 'Plan', control: <G.Badge>Team</G.Badge> },
        { id: 'off', title: 'Paused', isDisabled: true, control: <G.Tabs appearance="primary" label="Paused" selectedKey="auto" onSelect={() => undefined} items={modeItems(false)} /> },
      ]}
      value={value}
      onChange={setValue}
    />
  );
};

/**
 * A row can carry any Grammar content at its end as `control` (0.37.13): a primary Tabs pill ("Auto | Ask"), a Switch, a chip. The slot sits at the row's end centred on the title
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
    await userEvent.click(tabsOf(items[1]!).find((tab) => tab.textContent === 'Ask')!);
    await waitFor(() => expect(tabsOf(items[1]!).find((tab) => tab.textContent === 'Ask')!.getAttribute('aria-selected')).toBe('true'));
    expect(rowChecks()).toEqual([true, true, false, true, false, false]);
    // Keyboard inside the slot moves the choice and never toggles the row.
    tabsOf(items[1]!).find((tab) => tab.textContent === 'Ask')!.focus();
    await userEvent.keyboard('{ArrowLeft}');
    await waitFor(() => expect(tabsOf(items[1]!).find((tab) => tab.textContent === 'Auto')!.getAttribute('aria-selected')).toBe('true'));
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
    await userEvent.click(within(items[2]!).getByText('Update orders'));
    await waitFor(() => expect(rowChecks()[2]).toBe(true));
  },
};
