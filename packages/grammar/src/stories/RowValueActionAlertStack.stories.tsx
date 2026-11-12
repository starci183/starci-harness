import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * Two layout fixes. A list row that carries a `value`, `badges` and an end `action` is one line (name block, value, badge, command at the end,
 * vertically centred); the value is a grid track of its own, so the command no longer drops under it. An Alert's stacked action button (below 30rem)
 * stays inside the banner's box and padding, and the banner grows to contain it.
 */
const meta: Meta = { title: 'Row value and Alert stack (0.37.36)', parameters: { grammar: { bleed: false } } };
export default meta;
type Story = StoryObj;

const noop = () => undefined;
const muted = (text: string) => <span style={{ display: 'block', color: 'var(--muted)', fontSize: 'var(--grammar-text-sm)' }}>{text}</span>;

const ROWS = [
  { id: 'fee', title: 'Phí giao hàng nội thành', description: <G.Text as="span" size="xs" tone="muted">Tài liệu · Quy định Tiệm hoa</G.Text>, value: <span>30.000 đ một đơn</span>, badges: [{ label: '1 đề nghị', tone: 'warning' }] as const, actionPlacement: 'end' as const, action: { label: 'Sửa', press: noop } },
  { id: 'fast', title: 'Giao hỏa tốc sau 18:00', description: <G.Text as="span" size="xs" tone="muted">Chưa có nguồn</G.Text>, value: <span>Chưa đặt</span>, badges: [{ label: '1 đề nghị', tone: 'warning' }] as const, actionPlacement: 'end' as const, action: { label: 'Đặt', press: noop } },
  { id: 'two', title: 'Đổi trả', description: <G.Text as="span" size="xs" tone="muted">Chính sách đổi trả</G.Text>, value: <span>Trong 7 ngày{muted('từ 01/11')}</span>, actionPlacement: 'end' as const, action: { label: 'Sửa', press: noop } },
];

const rowsAreOneLine = (canvasElement: HTMLElement) => {
  const rows = Array.from(canvasElement.querySelectorAll<HTMLElement>('[data-grammar-row-value="true"]')).map((value) => value.closest('li') as HTMLElement);
  expect(rows.length).toBe(ROWS.length);
  for (const row of rows) {
    const box = row.getBoundingClientRect();
    const value = row.querySelector<HTMLElement>('[data-grammar-row-value="true"]')!.getBoundingClientRect();
    const button = row.querySelector<HTMLElement>('.starci-core-list-row-actions [data-component="Button"]')!.getBoundingClientRect();
    // The command stands after the value on the same line, inside the row padding, at the end.
    expect(button.left).toBeGreaterThanOrEqual(value.right - 1);
    expect(Math.abs((button.top + button.bottom) / 2 - (value.top + value.bottom) / 2)).toBeLessThan(box.height / 2);
    expect(button.right).toBeLessThanOrEqual(box.right - 15);
    expect(button.bottom).toBeLessThanOrEqual(box.bottom - 11);
  }
};

export const ValueBadgeAndEndAction: Story = {
  name: 'List row: value, badge and end action at 1440',
  render: () => (
    <div data-host style={{ inlineSize: 1440 }}>
      <G.SurfaceCard kind="list" label="Giao hàng" items={ROWS} empty={<G.EmptyNotice message="Trống" />} />
    </div>
  ),
  play: async ({ canvasElement }) => { await waitFor(() => rowsAreOneLine(canvasElement)); },
};

export const ValueBadgeAndEndActionAt390: Story = {
  name: 'List row: value, badge and end action at 390',
  render: () => (
    <div data-host style={{ inlineSize: 390 }}>
      <G.SurfaceCard kind="list" label="Giao hàng" items={ROWS} empty={<G.EmptyNotice message="Trống" />} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      for (const button of Array.from(canvasElement.querySelectorAll<HTMLElement>('.starci-core-list-row-actions [data-component="Button"]'))) {
        const row = button.closest('li')!.getBoundingClientRect();
        expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(row.right - 15);
      }
    });
  },
};

// The Stack is given a definite height (a page well that is height-bound): the banner's own height is then definite too, the case that drew the button outside the box.
const StackedAlert = () => (
  <div style={{ display: 'grid', gridTemplateRows: '260px' }}>
  <G.Stack gap="section">
    <G.Alert tone="neutral" title="Chưa suy ra chính sách" description="Tiệm đã hết credit. Nạp thêm rồi thử lại." action={{ label: 'Thử lại', onAction: noop }} />
    <G.SurfaceCard kind="list" label="Giao hàng" items={ROWS.slice(0, 1)} empty={<G.EmptyNotice message="Trống" />} />
  </G.Stack>
  </div>
);

const alertContainsItsAction = (canvasElement: HTMLElement) => {
  const alert = canvasElement.querySelector<HTMLElement>('[data-component="Alert"]')!.getBoundingClientRect();
  const button = canvasElement.querySelector<HTMLElement>('[data-component="Alert"] [data-component="Button"]')!.getBoundingClientRect();
  expect(button.bottom).toBeLessThanOrEqual(alert.bottom - 11);
  expect(button.left).toBeGreaterThanOrEqual(alert.left + 11);
  expect(button.right).toBeLessThanOrEqual(alert.right - 11);
};

export const AlertStackedActionAt390: Story = {
  name: 'Alert: stacked action stays in the banner at 390',
  render: () => <div data-host style={{ inlineSize: 390 }}><StackedAlert /></div>,
  play: async ({ canvasElement }) => { await waitFor(() => alertContainsItsAction(canvasElement)); },
};

export const AlertActionAt1440: Story = {
  name: 'Alert: action at the end at 1440',
  render: () => <div data-host style={{ inlineSize: 1440 }}><StackedAlert /></div>,
};
