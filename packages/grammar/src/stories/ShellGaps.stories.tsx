import type { Meta, StoryObj } from '@storybook/react-vite';
import * as G from '../common/index.js';
import { BellGlyph, ChartGlyph, GroupGlyph, HomeGlyph, MenuGlyph, SearchGlyph, SettingsGlyph } from './fixtures.js';

/**
 * SHELL GAPS (0.46.0), each from NIVO's console shell canvas (`nivoos-lite` at `8759c8ab`, `.starcistacks/canvas/pages/01-shell-app.html`): a strong and a solid avatar plate and an
 * `AvatarButton` (`:20-24`, the account avatar), `IdentityLockup markTone="solid"` (`:9`, the brand mark), a `TopBar density="adaptive"` (`:71`, `:186`, `:216`: 56px at 1440, 52px at 390) and a quiet `Meter` reading (`:208`, "Credit thang nay").
 */
const meta: Meta = { title: 'Navigation/Shell gaps (0.46.0)', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

/** Four plates side by side: generated, accent soft, solid brand, neutral strong; the account `AvatarButton` carries `tone="strong"`. */
export const AvatarPlates: Story = {
  render: () => (
    <G.Cluster gap="inline">
      <G.Avatar name="Hoa Moc Spa" tone="accent" />
      <G.Avatar name="Hoa Moc Spa" tone="solid" />
      <G.Avatar name="Le Nguyen" tone="strong" />
      <G.AvatarButton name="Le Nguyen" tone="strong" size="md" />
      <G.IdentityLockup title="NIVO" subtitle="Owner" markTone="solid" size="control" />
    </G.Cluster>
  ),
};

const GROUPS: ReadonlyArray<G.SidebarGroup> = [
  { id: 'work', items: [{ id: 'overview', label: 'Overview', source: HomeGlyph }, { id: 'office', label: 'Office', source: BellGlyph, badge: 4, badgeTone: 'danger', badgeLabel: '4 waiting' }, { id: 'reports', label: 'Reports', source: ChartGlyph }] },
  { id: 'setup', placement: 'end', items: [{ id: 'team', label: 'Team', source: GroupGlyph }, { id: 'settings', label: 'Settings', source: SettingsGlyph }] },
];

const Bar = () => (
  <G.TopBar
    density="adaptive"
    brand={<G.IdentityLockup title="Hoa Moc Spa" markTone="solid" size="control" />}
    actions={<G.Cluster gap="inline"><G.IconButton label="Search" source={SearchGlyph} /><G.IconButton label="Notifications" source={BellGlyph} badge={7} badgeLabel="7 unread" /><G.AvatarButton name="Le Nguyen" tone="strong" size="md" /></G.Cluster>}
  />
);

/** An adaptive bar is 64 from 48rem and 52 below it; its controls stay 40. */
export const AdaptiveBar: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => <Bar />,
};

/** The same bar as the shell's header: below 48rem the opener band under it keeps its height (52). */
export const AdaptiveBarInTheShell: Story = {
  parameters: { layout: 'fullscreen', grammar: { bleed: true } },
  render: () => (
    <G.WorkspaceShell
      viewport="fixed"
      header={<Bar />}
      navigation={<G.Sidebar label="Workspace" groups={GROUPS} selectedKey="overview" />}
      navigationLabel="Workspace navigation"
      navigationVisibility="wide"
      navigationDrawer={{ title: 'Navigation', openLabel: 'Open navigation', closeLabel: 'Close navigation', source: MenuGlyph, content: <G.Sidebar presentation="drawer" label="Workspace" groups={GROUPS} selectedKey="overview" /> }}
      primaryLabel="Content"
      primary={<G.Page header={{ title: 'Overview' }}><G.Text>Content</G.Text></G.Page>}
    />
  ),
};

/** The quiet reading: label and value muted, 12 regular; the default keeps the foreground label at 14 medium. */
export const QuietMeter: Story = {
  render: () => (
    <G.Stack gap="section">
      <G.Meter label="Storage" valueLabel="3.2 of 5 GB" value={64} />
      <G.Meter label="Credit this month" valueLabel="7,200 / 10,000" value={72} labelTone="muted" tone="foreground" size="sm" />
    </G.Stack>
  ),
};
