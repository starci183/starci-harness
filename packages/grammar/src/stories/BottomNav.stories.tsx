import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
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

    await userEvent.click(scope.getByRole('button', { name: 'More' }));
    const sheet = await page.findByRole('dialog', { name: 'More' });
    const rest = within(sheet);
    await userEvent.click(rest.getByRole('option', { name: 'Customers' }));
  },
};

/** The sheet of the rest, open: the same sidebar rows as the navigation drawer, a count with its tone. */
export const MoreSheet: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  render: () => <Shell />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(await page.findByRole('button', { name: 'More' }));
    await page.findByRole('dialog', { name: 'More' });
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
    await userEvent.click(flow);
  },
};

/** At 1440 the navigation is the sidebar and the bottom bar is not drawn (it is the compact width's). */
export const Wide: Story = {
  parameters: { viewport: { defaultViewport: 'desktop' } },
  render: () => <Shell />,
};

/** The sheet of the rest under group headings (`more.groups`): each group's `label` heads its rows, in both families; flat `more.items` still works. */
export const MoreSheetGroups: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  render: () => {
    const [selected, setSelected] = useState('overview');
    const more: G.BottomNavMore = {
      label: 'More',
      source: MenuGlyph,
      closeLabel: 'Close',
      groups: [
        { id: 'run', label: 'Operate', items: REST.slice(0, 3) },
        { id: 'setup', label: 'Set up', items: REST.slice(3) },
      ],
    };
    return (
      <G.WorkspaceShell
        viewport="fixed"
        navigation={<G.Sidebar label="Workspace" groups={SIDEBAR_GROUPS} selectedKey={selected} onAction={setSelected} />}
        navigationLabel="Workspace navigation"
        navigationVisibility="wide"
        primaryLabel="Workspace content"
        primary={<G.Page header={{ title: 'Overview' }}><G.Text>Below 48rem the places stand at the foot of the screen.</G.Text></G.Page>}
        compactNavigation={<G.BottomNav items={PLACES} more={more} selectedKey={selected} onAction={setSelected} />}
        compactNavigationLabel="Workspace places"
      />
    );
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(await page.findByRole('button', { name: 'More' }));
    await page.findByRole('dialog', { name: 'More' });
  },
};
