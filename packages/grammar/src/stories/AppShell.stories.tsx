import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import * as G from '../common/index.js';
import { AppShellDemo } from './AppShellDemo.js';
import { familyScope } from './fixtures.js';

const meta: Meta = {
  title: 'Compositions/App shell',
  parameters: { layout: 'fullscreen', grammar: { bleed: true } },
};
export default meta;
type Story = StoryObj;

export const Expanded: Story = { render: (_, { globals }) => <AppShellDemo initialCollapsed={false} initialDark={globals['grammarTheme'] === 'dark'} scope={familyScope(globals)} /> };
export const IconRail: Story = { render: (_, { globals }) => <AppShellDemo initialCollapsed initialDark={globals['grammarTheme'] === 'dark'} scope={familyScope(globals)} /> };
export const MobileDrawer: Story = { parameters: { viewport: { defaultViewport: 'mobile1' } }, render: (_, { globals }) => <AppShellDemo initialCollapsed={false} initialDrawerOpen initialDark={globals['grammarTheme'] === 'dark'} scope={familyScope(globals)} /> };
export const CompactHeaderSlot: Story = { parameters: { viewport: { defaultViewport: 'mobile1' } }, render: (_, { globals }) => <AppShellDemo initialCollapsed={false} navigationMode="slot" initialDark={globals['grammarTheme'] === 'dark'} scope={familyScope(globals)} /> };

/** The Drawer owns state and focus return; Sidebar only announces the destination and closes its overlay. */
export const UncontrolledDrawerDestination: Story = {
  render: () => <G.Drawer title="Workspace destinations" closeLabel="Close destinations" placement="left" trigger={<G.Button>Open destinations</G.Button>}>
    <G.Sidebar presentation="drawer" label="Workspace destinations" groups={[{ id: 'workspace', items: [{ id: 'home', label: 'Home' }, { id: 'inbox', label: 'Inbox' }] }]} />
  </G.Drawer>,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const opener = within(canvasElement).getByRole('button', { name: 'Open destinations' });
    await userEvent.click(opener);
    const dialog = await page.findByRole('dialog', { name: 'Workspace destinations' });
    await userEvent.click(await within(dialog).findByText('Inbox'));
    await waitFor(() => expect(page.queryByRole('dialog', { name: 'Workspace destinations' })).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  },
};
