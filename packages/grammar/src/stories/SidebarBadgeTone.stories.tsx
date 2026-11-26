import type { Meta, StoryObj } from '@storybook/react-vite';
import * as G from '../common/index.js';
import { BellGlyph, BookGlyph, ChartGlyph, GroupGlyph, HomeGlyph, SettingsGlyph, UserGlyph } from './fixtures.js';

/**
 * THE TONE OF A SIDEBAR COUNT (0.46.0). A count on a `Sidebar` item is `neutral` by default (a number to know) and takes `badgeTone` (`accent`, `success`, `warning`, `danger`) for work
 * waiting for the person: a tone on its tint is `x-soft` with `x-soft-foreground`, neutral is `default` with `default-foreground`, as a `Badge` of that tone. The count is always printed and
 * `badgeLabel` carries its words, so the tone is never the only signal. In the icon rail the count keeps its tone over the glyph. Evidence: NIVO console shell canvas, `GRAMMAR-GAPS.md` G2.
 */
const meta: Meta = { title: 'Navigation/Sidebar count tone (0.46.0)', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

const GROUPS: ReadonlyArray<G.SidebarGroup> = [
  {
    id: 'work',
    label: 'Work',
    items: [
      { id: 'office', label: 'Office', source: BellGlyph, badge: 4, badgeTone: 'danger', badgeLabel: '4 waiting for you' },
      { id: 'overview', label: 'Overview', source: HomeGlyph, badge: 12, badgeLabel: '12 updates' },
      { id: 'duties', label: 'Duties', source: UserGlyph, badge: 3, badgeTone: 'warning', badgeLabel: '3 due this week' },
      { id: 'reports', label: 'Reports', source: ChartGlyph, badge: 1, badgeTone: 'success', badgeLabel: '1 report ready' },
      { id: 'inbox', label: 'Inputs', source: BookGlyph, badge: 7, badgeTone: 'accent', badgeLabel: '7 new inputs' },
    ],
  },
  { id: 'rest', label: 'Rest', items: [{ id: 'customers', label: 'Customers', source: GroupGlyph }, { id: 'connections', label: 'Connections', source: SettingsGlyph, badge: 99, badgeMax: 9 }] },
];

const Rail = ({ isCollapsed }: { readonly isCollapsed: boolean }) => (
  <div style={{ width: isCollapsed ? undefined : '16rem', height: '30rem', display: 'flex' }}>
    <G.Sidebar label="Workspace" groups={GROUPS} selectedKey="overview" isCollapsed={isCollapsed} />
  </div>
);

/** Expanded: five tones of one rule, the capped count (`9+`) neutral. */
export const Expanded: Story = {
  render: () => <Rail isCollapsed={false} />,
};

/** The icon rail: the count keeps its tone and covers the glyph (the tint sits over the surface, never translucent over the glyph). */
export const IconRail: Story = {
  render: () => <Rail isCollapsed />,
};

/** The drawer presentation (the compact width's sheet and navigation drawer): the same counts. */
export const InADrawer: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  render: () => (
    <G.Drawer title="Navigation" closeLabel="Close" placement="bottom" defaultOpen trigger={<G.Button>Open</G.Button>}>
      <G.Sidebar presentation="drawer" label="Workspace" groups={GROUPS} selectedKey="overview" />
    </G.Drawer>
  ),
};
