import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * TOPBAR-FIT (0.47.5): `TopBar fit` carries a site header's links and actions as data on one line. What does not fit the row's width moves, whole, into the menu opened by the
 * three-line trigger; an action label is never broken over two lines, every control is the 40px step and the header never overflows the page sideways. The DNA laws
 * `DNA-COMMON-CONTROLS-PHONE-40`, `DNA-COMMON-BUTTON-ONE-LINE`, `DNA-COMMON-HEADER-NO-OVERFLOW` and `DNA-COMMON-HEADER-FIT-ONE-LINE` judge these stories at 320, 360 and 390.
 */
const meta: Meta = { title: 'Surfaces/Top bar fit' };
export default meta;
type Story = StoryObj;

const noop = () => undefined;

const NAVIGATION = [
  { id: 'product', label: 'Sản phẩm', href: '/product', isCurrent: true },
  { id: 'pricing', label: 'Bảng giá', href: '/pricing' },
  { id: 'docs', label: 'Tài liệu', href: '/docs' },
  { id: 'customers', label: 'Khách hàng', href: '/customers' },
];

const ACTIONS = [
  { id: 'contact', label: 'Liên hệ bán hàng', href: '/contact' },
  { id: 'login', label: 'Đăng nhập', href: '/login' },
  { id: 'download', label: 'Tải xuống miễn phí', emphasis: 'primary' as const, onPress: noop },
];

const Header = ({ many }: { many: boolean }) => (
  <G.TopBar
    position="static"
    density="compact"
    brand={<G.IdentityLockup title="NIVO" subtitle="Hệ điều hành doanh nghiệp" />}
    fit={{ navigationItems: many ? NAVIGATION : NAVIGATION.slice(0, 2), actionItems: many ? ACTIONS : ACTIONS.slice(1), overflowLabel: 'Menu' }}
  />
);

const checkHeader = (canvasElement: HTMLElement) => {
  const header = canvasElement.querySelector<HTMLElement>('[data-component="TopBar"]')!;
  const row = header.querySelector<HTMLElement>('[data-grammar-top-bar-fit]')!;
  // The header never overflows sideways, and the row neither clips nor scrolls what it keeps.
  expect(header.scrollWidth).toBeLessThanOrEqual(header.clientWidth + 1);
  expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
  for (const label of Array.from(row.querySelectorAll<HTMLElement>('.starci-core-button, a'))) {
    // One line: the box is no taller than the 40px step plus a hairline, the label is not broken.
    expect(label.getBoundingClientRect().height).toBeLessThanOrEqual(41);
    expect(getComputedStyle(label).whiteSpace).toBe('nowrap');
  }
  for (const control of Array.from(header.querySelectorAll<HTMLElement>('.starci-core-button, .starci-core-icon-button'))) expect(control.getBoundingClientRect().height).toBeGreaterThanOrEqual(39.5);
  const trigger = row.querySelector('.starci-core-icon-button');
  expect(row.dataset['grammarTopBarFitOverflow'] === 'true').toBe(trigger !== null);
};

/** Four links and three actions: at a phone width the row keeps what fits (the primary action last) and the rest sit in the menu. */
export const TopBarFitManyActions: Story = {
  render: () => <Header many />,
  play: async ({ canvasElement }) => {
    await waitFor(() => checkHeader(canvasElement));
  },
};

/** Two links and two actions: short enough that a phone keeps them in the row, or moves only the links. */
export const TopBarFitFewActions: Story = {
  render: () => <Header many={false} />,
  play: async ({ canvasElement }) => {
    await waitFor(() => checkHeader(canvasElement));
  },
};
