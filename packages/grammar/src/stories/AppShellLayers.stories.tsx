import type { Meta, StoryObj } from '@storybook/react-vite';
import * as G from '../common/index.js';
import { EllipsisGlyph } from './fixtures.js';

const meta: Meta = {
  title: 'Compositions/App shell layers',
  parameters: { layout: 'fullscreen', grammar: { bleed: true } },
};
export default meta;
type Story = StoryObj;

/** A field has one look (0.40.0): the header and the page content draw the same primary field, with no vendor secondary class anywhere. */
export const ShellHeader: Story = {
  render: () => (
    <G.WorkspaceShell
      viewport="fixed"
      header={<G.Input id="shell-search" name="query" label="Search in header" />}
      navigation={<G.Text>Desktop navigation</G.Text>}
      navigationLabel="Workspace"
      navigationDrawer={{ title: 'Navigation', openLabel: 'Open navigation', closeLabel: 'Close navigation', source: EllipsisGlyph, content: <G.Text>Mobile navigation</G.Text> }}
      primaryLabel="Page"
      primary={<G.Input id="page-query" name="page-query" label="Page query" />}
    />
  ),
};

/** A short page in a page-scrolling shell: the shell is one viewport tall, so the root's canvas runs to the screen's bottom. */
export const ShortPageFillsViewport: Story = {
  render: () => (
    <G.WorkspaceShell
      navigation={<G.Text>Desktop navigation</G.Text>}
      navigationLabel="Workspace"
      navigationDrawer={{ title: 'Navigation', openLabel: 'Open navigation', closeLabel: 'Close navigation', source: EllipsisGlyph, content: <G.Text>Mobile navigation</G.Text> }}
      primaryLabel="Page"
      primary={<G.Text>One short line.</G.Text>}
    />
  ),
};

/** A client-owned drawer opener defaults the fixed shell to wide-only inline navigation. */
export const ShellSlotHeader: Story = {
  render: () => (
    <G.WorkspaceShell
      viewport="fixed"
      compactHeader={<G.Drawer title="Navigation" closeLabel="Close navigation" placement="left" trigger={<G.IconButton label="Open navigation" source={EllipsisGlyph} variant="border" />}><G.Sidebar label="Mobile navigation" presentation="drawer" groups={[]} selectedKey="home" /></G.Drawer>}
      navigation={<G.Sidebar label="Desktop navigation" groups={[]} selectedKey="home" />}
      navigationLabel="Workspace"
      primaryLabel="Page"
      primary={<G.Text>Page content</G.Text>}
    />
  ),
};

export const TopBarSearch: Story = {
  render: () => <G.TopBar brand={<G.Text>Workspace</G.Text>} actions={<G.Input id="topbar-query" name="query" label="Search" />} />,
};
