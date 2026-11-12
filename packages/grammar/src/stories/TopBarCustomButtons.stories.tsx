import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * TOPBAR-CUSTOM-BUTTONS (0.37.15): `TopBar customButtons` are round outline icon buttons in the end cluster BEFORE the app's fixed cluster (language, theme, account), with an
 * attention dot when `badge`. At phone width only the first stays in the bar; the rest are the entries `useTopBarOverflowEntries()` gives the account menu.
 */
const meta: Meta = { title: 'Surfaces/Top bar custom buttons' };
export default meta;
type Story = StoryObj;

const noop = () => undefined;

const Account = () => {
  const overflow = G.useTopBarOverflowEntries();
  return (
    <G.DropdownMenu
      placement="bottom end"
      entries={[{ id: 'account', label: 'Account' }, ...overflow]}
      trigger={<G.AvatarButton name="Alex Morgan" size="control" />}
    />
  );
};

const Bar = () => (
  <G.TopBar
    position="static"
    brand={<G.IdentityLockup title="Acme" subtitle="Store" />}
    customButtons={[
      { id: 'bell', glyph: 'bell', label: 'Notifications', badge: true, onPress: noop },
      { id: 'help', glyph: 'info', label: 'Help', href: '/help' },
    ]}
    actions={<Account />}
  />
);

export const TopBarCustomButtons: Story = {
  render: () => <Bar />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const items = Array.from(canvasElement.querySelectorAll<HTMLElement>('[data-grammar-top-bar-custom-item]'));
      expect(items.length).toBe(2);
      expect(items[0]!.querySelector('[data-grammar-top-bar-dot]')).not.toBeNull();
      expect(items[1]!.querySelector('[data-grammar-top-bar-dot]')).toBeNull();
      expect(items[0]!.querySelector('button')!.getAttribute('aria-label')).toBe('Notifications');
      expect(items[1]!.querySelector('a')!.getAttribute('aria-label')).toBe('Help');
      // The custom cluster stands before the app's fixed cluster (the account avatar).
      const custom = canvasElement.querySelector<HTMLElement>('[data-grammar-top-bar-custom]')!.getBoundingClientRect();
      const avatar = canvasElement.querySelector<HTMLElement>('.starci-core-avatar-button, [data-component="AvatarButton"]')!.getBoundingClientRect();
      expect(custom.right).toBeLessThanOrEqual(avatar.left + 1);
      // At phone width only the first custom button stays visible.
      if (window.matchMedia('(max-width: 47.99rem)').matches) expect(getComputedStyle(items[1]!).display).toBe('none');
    });
  },
};
