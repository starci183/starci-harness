import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import * as G from '../common/index.js';
import { BellGlyph, BookGlyph, ChartGlyph, GroupGlyph, HomeGlyph, MenuGlyph, MemoryRouterRoot, SettingsGlyph, StarGlyph, UserGlyph } from './fixtures.js';

/**
 * THE BOTTOM NAV (0.46.0). The compact width's bar of the places used every day, in `WorkspaceShell` `compactNavigation`: a glyph, its name and an optional count each, one current
 * (`aria-current="page"`), and a last place, "more", that opens a bottom sheet of the rest. The shell shows it below 48rem and names the landmark (`compactNavigationLabel`); above
 * it the navigation is the sidebar and the bar is not drawn. The bar keeps the device's bottom safe area. Evidence: NIVO console shell canvas (`01-shell-app.html`, the five
 * places and the sheet of the rest at 390).
 */
const meta: Meta = { title: 'Compositions/Bottom nav (0.46.0)', parameters: { layout: 'fullscreen', grammar: { bleed: true } } };
export default meta;
type Story = StoryObj;

const REST: ReadonlyArray<G.SidebarItem> = [
  { id: 'customers', label: 'Customers', source: GroupGlyph },
  { id: 'inputs', label: 'Inputs', source: BookGlyph },
  { id: 'knowledge', label: 'Knowledge', source: StarGlyph },
  { id: 'connections', label: 'Connections', source: SettingsGlyph, badge: 1, badgeTone: 'warning', badgeLabel: '1 connection needs attention' },
  { id: 'team', label: 'Team', source: UserGlyph },
  { id: 'billing', label: 'Credits and plan', source: ChartGlyph },
];

const PLACES: ReadonlyArray<G.BottomNavItem> = [
  { id: 'office', label: 'Office', source: BellGlyph, badge: 4, badgeTone: 'danger', badgeLabel: '4 waiting for you' },
  { id: 'overview', label: 'Overview', source: HomeGlyph },
  { id: 'flow', label: 'Work flow', source: ChartGlyph },
  { id: 'duties', label: 'Duties', source: UserGlyph, badge: 3 },
];

const SIDEBAR_GROUPS: ReadonlyArray<G.SidebarGroup> = [{ id: 'all', items: [...PLACES.map(({ id, label, source }) => ({ id, label, source })), ...REST] }];

const Shell = ({ links = false }: { readonly links?: boolean }) => {
  const [selected, setSelected] = useState('overview');
  const items = links ? PLACES.map((place) => ({ ...place, href: `/${place.id}` })) : PLACES;
  const more: G.BottomNavMore = { label: 'More', source: MenuGlyph, closeLabel: 'Close', items: links ? REST.map((item) => ({ ...item, href: `/${item.id}` })) : REST };
  return (
    <G.WorkspaceShell
      viewport="fixed"
      navigation={<G.Sidebar label="Workspace" groups={SIDEBAR_GROUPS} selectedKey={selected} onAction={setSelected} />}
      navigationLabel="Workspace navigation"
      navigationVisibility="wide"
      primaryLabel="Workspace content"
      primary={<G.Page header={{ title: 'Overview', description: `Current place: ${selected}` }}><G.Text>Below 48rem the places stand at the foot of the screen.</G.Text></G.Page>}
      compactNavigation={<G.BottomNav items={items} more={more} selectedKey={selected} onAction={setSelected} />}
      compactNavigationLabel="Workspace places"
    />
  );
};

/** At 390: five places, the count on Office danger and on Duties neutral, Overview current; "More" opens the sheet of the rest and a chosen place closes it and becomes current. */
export const Phone: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  render: () => <Shell />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const bar = await page.findByRole('navigation', { name: 'Workspace places' });
    const scope = within(bar);
    await waitFor(() => expect(getComputedStyle(bar).display).not.toBe('none'));
    expect(bar.querySelectorAll('[data-grammar-bottom-nav-item]')).toHaveLength(5);
    expect(bar.querySelectorAll('nav')).toHaveLength(0);
    await expect(scope.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    await expect(scope.getByRole('button', { name: 'Office, 4 waiting for you' })).not.toHaveAttribute('aria-current');
    const tones = [...bar.querySelectorAll<HTMLElement>('[data-grammar-badge-tone]')];
    expect(tones.map((tone) => tone.dataset['grammarBadgeTone'])).toEqual(['danger', 'neutral']);
    const look = (element: HTMLElement) => `${getComputedStyle(element).backgroundImage}|${getComputedStyle(element).color}`;
    expect(look(tones[0] as HTMLElement)).not.toBe(look(tones[1] as HTMLElement));
    const items = [...bar.querySelectorAll<HTMLElement>('[data-grammar-bottom-nav-item]')];
    const widths = items.map((item) => Math.round(item.getBoundingClientRect().width));
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
    for (const item of items) expect(item.getBoundingClientRect().height).toBeGreaterThanOrEqual(40);
    const bottom = bar.getBoundingClientRect().bottom;
    expect(Math.round(bottom)).toBeLessThanOrEqual(window.innerHeight);

    await userEvent.click(scope.getByRole('button', { name: 'More' }));
    const sheet = await page.findByRole('dialog', { name: 'More' });
    expect(sheet.getAttribute('data-placement')).toBe('bottom');
    const rest = within(sheet);
    expect(rest.getAllByRole('option')).toHaveLength(REST.length);
    await userEvent.click(rest.getByRole('option', { name: 'Customers' }));
    await waitFor(() => expect(page.queryByRole('dialog', { name: 'More' })).not.toBeInTheDocument());
    await waitFor(() => expect(scope.getByRole('button', { name: 'More' }).getAttribute('data-grammar-current')).toBe('true'));
    expect(scope.getByRole('button', { name: 'Overview' })).not.toHaveAttribute('aria-current');
  },
};

/** The sheet of the rest, open: the same sidebar rows as the navigation drawer, a count with its tone. */
export const MoreSheet: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  render: () => <Shell />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(await page.findByRole('button', { name: 'More' }));
    const sheet = await page.findByRole('dialog', { name: 'More' });
    await waitFor(() => expect(within(sheet).getByRole('option', { name: 'Connections, 1 connection needs attention' })).toBeVisible());
  },
};

/** Places that are links: the app root's router opens them; the current one carries `aria-current="page"`. */
export const Links: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  render: (_, { globals }) => <MemoryRouterRoot globals={globals}><Shell links /></MemoryRouterRoot>,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const bar = await page.findByRole('navigation', { name: 'Workspace places' });
    const flow = within(bar).getByRole('link', { name: 'Work flow' });
    expect(flow).toHaveAttribute('href', '/flow');
    await userEvent.click(flow);
    await waitFor(() => expect(canvasElement.ownerDocument.querySelector('[data-story-router-path]')?.getAttribute('data-story-router-path')).toBe('/flow'));
  },
};

/** At 1440 the navigation is the sidebar and the bottom bar is not drawn (it is the compact width's). */
export const Wide: Story = {
  parameters: { viewport: { defaultViewport: 'desktop' } },
  render: () => <Shell />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await page.findByRole('navigation', { name: 'Workspace navigation' });
    await waitFor(() => {
      const bar = canvasElement.ownerDocument.querySelector('.starci-core-workspace-shell-compact-navigation');
      expect(bar === null ? 'none' : getComputedStyle(bar).display).toBe('none');
    });
  },
};
