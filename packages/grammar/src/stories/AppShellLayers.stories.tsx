import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import { EllipsisGlyph, HomeGlyph } from './fixtures.js';

const meta: Meta = {
  title: 'Compositions/App shell layers',
  parameters: { layout: 'fullscreen', grammar: { bleed: true } },
};
export default meta;
type Story = StoryObj;

/** Header paint supplies secondary fields while the shell's page content keeps the primary default. */
export const ShellHeader: Story = {
  render: () => (
    <G.WorkspaceShell
      viewport="fixed"
      header={<G.Input id="shell-search" name="query" label="Search in header" size="control" />}
      navigation={<G.Text>Desktop navigation</G.Text>}
      navigationLabel="Workspace"
      navigationDrawer={{ title: 'Navigation', openLabel: 'Open navigation', closeLabel: 'Close navigation', source: EllipsisGlyph, content: <G.Text>Mobile navigation</G.Text> }}
      primaryLabel="Page"
      primary={<G.Input id="page-query" name="page-query" label="Page query" />}
    />
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(canvasElement.querySelector('[data-grammar-workspace-header] [data-component="Input"]')).toHaveAttribute('data-grammar-variant', 'secondary');
      expect(canvasElement.querySelector('[data-grammar-workspace-primary] [data-component="Input"]')).toHaveAttribute('data-grammar-variant', 'primary');
      expect(canvasElement.querySelector('[data-grammar-workspace-navigation-track]')).toHaveAttribute('data-grammar-workspace-navigation-track', 'intrinsic');
      expect(canvasElement.querySelector('[data-grammar-workspace-navigation-visibility]')).toHaveAttribute('data-grammar-workspace-navigation-visibility', 'wide');
      expect(canvasElement.querySelector('[data-grammar-workspace-opener] [data-component="IconButton"]')).toHaveAttribute('data-size', 'control');
    });
  },
};

/** A client-owned drawer opener defaults the fixed shell to wide-only inline navigation. */
export const ShellSlotHeader: Story = {
  render: () => (
    <G.WorkspaceShell
      viewport="fixed"
      compactHeader={<G.Drawer title="Navigation" closeLabel="Close navigation" placement="left" trigger={<G.IconButton label="Open navigation" source={EllipsisGlyph} size="control" variant="tertiary" />}><G.Sidebar label="Mobile navigation" presentation="drawer" groups={[]} selectedKey="home" /></G.Drawer>}
      navigation={<G.Sidebar label="Desktop navigation" groups={[]} selectedKey="home" />}
      navigationLabel="Workspace"
      primaryLabel="Page"
      primary={<G.Text>Page content</G.Text>}
    />
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(canvasElement.querySelector('[data-grammar-workspace-navigation-visibility]')).toHaveAttribute('data-grammar-workspace-navigation-visibility', 'wide');
      expect(canvasElement.querySelector('[data-grammar-workspace-compact-header]')).toHaveAttribute('data-grammar-workspace-opener', 'true');
      expect(canvasElement.querySelector('[data-grammar-workspace-opener] [data-component="IconButton"]')).toHaveAttribute('data-size', 'control');
      const navigation = canvasElement.querySelector<HTMLElement>('[data-grammar-workspace-navigation-region]');
      const opener = canvasElement.querySelector<HTMLElement>('[data-grammar-workspace-opener]');
      const compact = window.matchMedia('(width < 48rem)').matches;
      expect(navigation).not.toBeNull();
      expect(opener).not.toBeNull();
      expect(getComputedStyle(navigation!).display === 'none').toBe(compact);
      expect(getComputedStyle(opener!).display).toBe(compact ? 'flex' : 'none');
    });
  },
};

export const TopBarSearch: Story = {
  render: () => <G.TopBar brand={<G.Text>Workspace</G.Text>} actions={<G.Input id="topbar-query" name="query" label="Search" size="control" />} />,
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('[data-component="Input"]')).toHaveAttribute('data-grammar-variant', 'secondary'));
  },
};

export const FeatureNavSearch: Story = {
  render: () => (
    <G.NavigationFeatureNav
      identity={<G.Text>Workspace</G.Text>}
      compactNavigationTrigger={<G.IconButton label="Open navigation" source={HomeGlyph} size="control" />}
      compactNavigationTriggerLabel="Navigation"
      actions={<G.Input id="feature-query" name="query" label="Search" size="control" />}
    />
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('[data-component="Input"]')).toHaveAttribute('data-grammar-variant', 'secondary'));
  },
};
