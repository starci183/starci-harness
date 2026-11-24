import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';
import * as G from '../common/index.js';
import { BellGlyph, ChartGlyph, GroupGlyph, HomeGlyph, MenuGlyph, SearchGlyph, SettingsGlyph } from './fixtures.js';

/**
 * SHELL GAPS (0.46.0), each from NIVO's console shell canvas (`nivoos-lite` at `8759c8ab`, `.starcistacks/canvas/pages/01-shell-app.html`): a strong and a solid avatar plate and an
 * `AvatarButton` (`:20-24`, the account avatar), `IdentityLockup markTone="solid"` (`:9`, the brand mark), a `TopBar density="adaptive"` (`:71`, `:186`, `:216`: 56px at 1440, 52px at 390) and a quiet `Meter` reading (`:208`, "Credit thang nay").
 */
const meta: Meta = { title: 'Navigation/Shell gaps (0.46.0)', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

const plate = (root: ParentNode, tone: string): HTMLElement => {
  const element = root.querySelector<HTMLElement>(`[data-grammar-avatar-tone="${tone}"] [data-grammar-avatar-fallback="true"]`);
  if (element === null) throw new Error(`no ${tone} plate`);
  return element;
};

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
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelectorAll('[data-grammar-avatar-fallback="true"]').length).toBeGreaterThanOrEqual(5));
    const solid = plate(canvasElement, 'solid');
    const strong = plate(canvasElement, 'strong');
    const accent = plate(canvasElement, 'accent');
    const css = (element: HTMLElement) => `${getComputedStyle(element).backgroundColor}|${getComputedStyle(element).color}`;
    expect(new Set([css(solid), css(strong), css(accent)]).size).toBe(3);
    expect(getComputedStyle(solid).backgroundColor).not.toBe(getComputedStyle(solid).color);
    expect(getComputedStyle(strong).backgroundColor).not.toBe(getComputedStyle(strong).color);
    const button = within(canvasElement).getByRole('button', { name: /Le Nguyen/ });
    expect(button.querySelector('[data-grammar-avatar-tone="strong"]')).not.toBeNull();
    expect(button.querySelector('.starci-core-avatar-letters')?.textContent).toBe('LN');
    expect(canvasElement.querySelector('[data-component="IdentityLockup"] [data-grammar-avatar-tone="solid"]')).not.toBeNull();
  },
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
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const main = canvasElement.querySelector<HTMLElement>('.starci-core-top-bar-main');
      expect(main).not.toBeNull();
      const height = Math.round((main as HTMLElement).getBoundingClientRect().height);
      expect(height).toBe(window.innerWidth < 768 ? 51 : 63);
      for (const button of canvasElement.querySelectorAll<HTMLElement>('[data-component="IconButton"]')) expect(Math.round(button.getBoundingClientRect().height)).toBe(40);
    });
  },
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
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const main = canvasElement.querySelector<HTMLElement>('.starci-core-top-bar-main');
      expect(main).not.toBeNull();
      const opener = canvasElement.querySelector<HTMLElement>('.starci-core-workspace-shell-opener');
      if (window.innerWidth < 768) {
        expect(opener).not.toBeNull();
        expect(Math.round((opener as HTMLElement).getBoundingClientRect().height)).toBe(52);
        expect(Math.round((main as HTMLElement).getBoundingClientRect().height) + 1).toBe(52);
      } else {
        expect(Math.round((main as HTMLElement).getBoundingClientRect().height) + 1).toBe(64);
      }
    });
  },
};

/** The quiet reading: label and value muted, 12 regular; the default keeps the foreground label at 14 medium. */
export const QuietMeter: Story = {
  render: () => (
    <G.Stack gap="section">
      <G.Meter label="Storage" valueLabel="3.2 of 5 GB" value={64} />
      <G.Meter label="Credit this month" valueLabel="7,200 / 10,000" value={72} labelTone="muted" tone="foreground" size="sm" />
    </G.Stack>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelectorAll('[data-component="Meter"]').length).toBe(2));
    const [normal, quiet] = [...canvasElement.querySelectorAll<HTMLElement>('[data-component="Meter"]')];
    const label = (meter: HTMLElement) => getComputedStyle(meter.querySelector('.starci-core-meter-label') as HTMLElement);
    expect(label(quiet as HTMLElement).fontSize).toBe('12px');
    expect(label(normal as HTMLElement).fontSize).toBe('14px');
    expect(label(quiet as HTMLElement).fontWeight).toBe('400');
    expect(label(normal as HTMLElement).fontWeight).toBe('500');
    expect(label(quiet as HTMLElement).color).not.toBe(label(normal as HTMLElement).color);
  },
};
