import type { Meta, StoryObj } from '@storybook/react-vite';
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
      trigger={<G.AvatarButton name="Alex Morgan" size="md" />}
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
};
