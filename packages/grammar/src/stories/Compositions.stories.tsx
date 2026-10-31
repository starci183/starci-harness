import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import { AppShellDemo } from './AppShellDemo.js';
import {
  BellGlyph,
  BookGlyph,
  ChartGlyph,
  HomeGlyph,
  MenuGlyph,
  SearchGlyph,
  SettingsGlyph,
  State,
  UserGlyph,
  noop,
  rgbaOf,
  familyScope,
} from './fixtures.js';

/**
 * Composition renderers: page shells, layout and application chrome. Each story shows the
 * renderer with its current/selected destination; page-level recipes live in `Compositions/Pages`.
 */
const meta: Meta = {
  title: 'Compositions/Renderers',
  parameters: { grammar: { bleed: true } },
};
export default meta;

type Story = StoryObj;

const Placeholder = ({ label, height = 120, headingLevel }: { readonly label: string; readonly height?: number; readonly headingLevel?: G.SurfaceHeadingLevel }) => (
  <G.SurfaceCard label={label} {...(headingLevel === undefined ? {} : { headingLevel })}>
    <div style={{ minHeight: height }}><G.Text tone="muted">{label} content</G.Text></div>
  </G.SurfaceCard>
);

const links = (
  <>
    <G.Link href="#learn" isCurrent>Learn</G.Link>
    <G.Link href="#practice">Practice</G.Link>
    <G.Link href="#progress">Progress</G.Link>
  </>
);

/** TopBar's `navigation` slot takes the app's own `<nav>`. */
const inlineNav = <nav aria-label="Primary" style={{ display: 'flex', gap: '1rem' }}>{links}</nav>;

/** NavigationFeatureNav owns the `<nav>` landmark itself, so its slot takes bare links. */
const inlineLinks = <div style={{ display: 'flex', gap: '1rem' }}>{links}</div>;

export const PinnedActionBar: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', padding: '1.5rem 0' }}>
      <State label="visibility='always' (the narrow default hides at 48rem and wider)" direction="column">
        <div style={{ maxWidth: 390 }}>
          <Placeholder label="Page content" height={80} />
          <G.PinnedActionBar label="Install a module" visibility="always">
            <G.Button variant="primary" width="fill" onPress={noop}>Install module</G.Button>
          </G.PinnedActionBar>
        </div>
      </State>
    </div>
  ),
};

export const PinnedActionBarSummary: Story = {
  name: 'PinnedActionBar (summary with dismiss and commit)',
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', padding: '1.5rem 0' }}>
      <State label="Summary text, secondary dismiss and primary commit" direction="column">
        <div style={{ maxWidth: 480, maxHeight: 220, overflow: 'auto' }}>
          <Placeholder label="Scrolling page content" height={260} />
          <G.PinnedActionBar
            label="Unsaved changes"
            visibility="always"
            summary="3 lessons changed"
            dismiss={<G.Button intent="dismiss" onPress={noop}>Discard</G.Button>}
            commit={<G.Button intent="commit" onPress={noop}>Save changes</G.Button>}
          />
        </div>
      </State>
      <State label="Summary node with a commit only" direction="column">
        <div style={{ maxWidth: 390 }}>
          <G.PinnedActionBar label="Cart" visibility="always" summary={<G.Text>Total <strong>$48.00</strong></G.Text>} commit={<G.Button intent="commit" onPress={noop}>Check out</G.Button>} />
        </div>
      </State>
    </div>
  ),
};

export const PageContainer: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', padding: '1.5rem 0' }}>
      {(['reading', 'product', 'full'] as const).map((measure) => (
        <G.PageContainer key={measure} measure={measure}>
          <State label={`measure="${measure}"`} direction="column"><Placeholder label={`${measure} measure`} height={40} /></State>
        </G.PageContainer>
      ))}
    </div>
  ),
};

const PageHeaderDemo = ({ withTabs }: { readonly withTabs: boolean }) => {
  const [tab, setTab] = useState('test');
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <G.PageHeader
        breadcrumbs={{ label: 'Breadcrumb', items: [{ id: 'connections', label: 'Connections', href: '#connections' }, { id: 'main', label: 'Main account' }] }}
        title="Main account"
        titleId="page-header-story-title"
        mark={<G.Avatar name="Sepay" shape="rounded" isDecorative />}
        status={<><G.StatusDot tone="success">Connected</G.StatusDot><G.Badge tone="warning">Test mode · not posted</G.Badge></>}
        meta="Bank transfer · ****6789"
        description="Payments arrive by webhook and are matched to invoices."
        actions={<><G.Button intent="neutral" onPress={noop}>Switch to live</G.Button><G.Button intent="destructive" onPress={noop}>Disconnect</G.Button></>}
        {...(withTabs ? { tabs: { label: 'Connection', selectedKey: tab, onSelect: setTab, items: [{ id: 'overview', label: 'Overview' }, { id: 'setup', label: 'Setup' }, { id: 'test', label: 'Test' }, { id: 'agents', label: 'Agents' }] } } : {})}
      />
      <G.PageContainer data-story-page-content="true">
        <Placeholder label="Webhook details" headingLevel={2} />
      </G.PageContainer>
    </div>
  );
};

/** The band, its separator and the page content: content edges align, the separator runs the band's full width. */
const assertPageHeaderBand = async (canvasElement: HTMLElement, withTabs: boolean) => {
  await waitFor(() => {
    const band = canvasElement.querySelector<HTMLElement>('[data-component="PageHeader"]');
    const body = band?.querySelector<HTMLElement>('.starci-core-page-header-body');
    const separator = band?.querySelector<HTMLElement>('[data-grammar-page-header-separator] [data-component="Divider"]');
    const content = canvasElement.querySelector<HTMLElement>('[data-story-page-content="true"]');
    if (!band || !body || !separator || !content) throw new Error('PageHeader band, body, separator and content must render');
    const bandBox = band.getBoundingClientRect();
    const separatorBox = separator.getBoundingClientRect();
    expect(Math.abs(separatorBox.left - bandBox.left)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(separatorBox.right - bandBox.right)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(separatorBox.bottom - bandBox.bottom)).toBeLessThanOrEqual(0.5);
    const bodyStyle = getComputedStyle(body);
    const contentStyle = getComputedStyle(content);
    expect(Math.abs(body.getBoundingClientRect().left + Number.parseFloat(bodyStyle.paddingLeft) - (content.getBoundingClientRect().left + Number.parseFloat(contentStyle.paddingLeft)))).toBeLessThanOrEqual(0.5);
    if (withTabs) {
      const indicator = band.querySelector<HTMLElement>('[role="tab"][aria-selected="true"] .tabs__indicator');
      if (!indicator) throw new Error('The selected tab must draw its indicator');
      expect(Math.abs(indicator.getBoundingClientRect().bottom - separatorBox.bottom)).toBeLessThanOrEqual(0.5);
    }
  }, { timeout: 4000 });
};

export const PageHeader: Story = {
  name: 'PageHeader (separator, no tabs)',
  render: () => <PageHeaderDemo withTabs={false} />,
  play: async ({ canvasElement }) => assertPageHeaderBand(canvasElement, false),
};

export const PageHeaderTabs: Story = {
  name: 'PageHeader (page tabs on the separator)',
  render: () => <PageHeaderDemo withTabs />,
  play: async ({ canvasElement }) => assertPageHeaderBand(canvasElement, true),
};

/** Link tabs: each item carries its route, no state or `onSelect`, and the tab of the current path is selected. */
export const PageHeaderLinkTabs: Story = {
  name: 'PageHeader (link tabs follow the path)',
  render: () => (
    <G.PageHeader
      title="Main account"
      tabs={{
        label: 'Connection',
        items: [
          { id: 'overview', label: 'Overview', href: '/overview' },
          { id: 'current', label: 'Current', href: globalThis.location.pathname },
          { id: 'setup', label: 'Setup', href: '/setup' },
        ],
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const selected = canvasElement.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      expect(selected?.textContent).toContain('Current');
      expect(selected?.tagName).toBe('A');
    }, { timeout: 4000 });
  },
};

export const PageHeaderPhone: Story = {
  name: 'PageHeader (360px: actions wrap under the heading)',
  parameters: {
    viewport: { options: { phone360: { name: 'Phone 360 x 740', styles: { width: '360px', height: '740px' }, type: 'mobile' } } },
  },
  globals: { viewport: { value: 'phone360', isRotated: false } },
  render: () => <PageHeaderDemo withTabs />,
  play: async ({ canvasElement }) => {
    await assertPageHeaderBand(canvasElement, true);
    const title = canvasElement.querySelector<HTMLElement>('.starci-core-page-header-title');
    const actions = canvasElement.querySelector<HTMLElement>('.starci-core-page-header-actions');
    await expect(actions!.getBoundingClientRect().top).toBeGreaterThanOrEqual(title!.getBoundingClientRect().bottom);
  },
};

const PageDemo = ({ withHeader, isSkeleton = false }: { readonly withHeader: boolean; readonly isSkeleton?: boolean }) => {
  const [tab, setTab] = useState('overview');
  return (
    <G.Page
      isSkeleton={isSkeleton}
      {...(withHeader ? {
        header: {
          breadcrumbs: { label: 'Breadcrumb', items: [{ id: 'connections', label: 'Connections', href: '#connections' }, { id: 'main', label: 'Main account' }] },
          title: 'Main account',
          description: 'Payments arrive by webhook and are matched to invoices.',
          actions: <G.Button intent="neutral" onPress={noop}>Switch to live</G.Button>,
          tabs: { label: 'Connection', selectedKey: tab, onSelect: setTab, items: [{ id: 'overview', label: 'Overview' }, { id: 'setup', label: 'Setup' }] },
        },
      } : {})}
    >
      <Placeholder label="Webhook details" headingLevel={2} />
      {/* A child that tries to bleed past the gutter: the body clips it at the gutter's outer edge. */}
      <div data-story-page-escape="true" style={{ marginInline: '-6rem', blockSize: '2rem', background: 'var(--accent-soft)' }} />
    </G.Page>
  );
};

/** The body sits in the measure and gutter one region step below the band, and nothing in it paints past the gutter. */
const assertPage = async (canvasElement: HTMLElement, withHeader: boolean) => {
  await waitFor(() => {
    const page = canvasElement.querySelector<HTMLElement>('[data-component="Page"]');
    const body = page?.querySelector<HTMLElement>('[data-grammar-page-body]');
    const escape = page?.querySelector<HTMLElement>('[data-story-page-escape]');
    if (!page || !body || !escape) throw new Error('Page, its body and the escaping child must render');
    const bodyBox = body.getBoundingClientRect();
    expect(body.parentElement).toBe(page);
    expect(getComputedStyle(body).overflowX).toBe('clip');
    expect(getComputedStyle(body).getPropertyValue('overflow-clip-margin')).toContain('content-box');
    // The escaping child is wider than the body; the body clips it one gutter step past its content box.
    expect(escape.getBoundingClientRect().width).toBeGreaterThan(bodyBox.width);
    const gap = Number.parseFloat(getComputedStyle(page).rowGap);
    expect(gap).toBeGreaterThan(0);
    if (withHeader) {
      const header = page.querySelector<HTMLElement>(':scope > [data-component="PageHeader"]');
      if (!header) throw new Error('The header band must be the page\'s first child');
      expect(Math.abs(bodyBox.top - header.getBoundingClientRect().bottom - gap)).toBeLessThanOrEqual(0.5);
      const headerBody = header.querySelector<HTMLElement>('.starci-core-page-header-body')!;
      expect(Math.abs(headerBody.getBoundingClientRect().left - bodyBox.left)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(headerBody.getBoundingClientRect().width - bodyBox.width)).toBeLessThanOrEqual(0.5);
    } else {
      expect(Math.abs(bodyBox.top - page.getBoundingClientRect().top - gap)).toBeLessThanOrEqual(0.5);
    }
  }, { timeout: 4000 });
};

export const Page: Story = {
  name: 'Page (header band, body in the gutter)',
  render: () => <PageDemo withHeader />,
  play: async ({ canvasElement }) => assertPage(canvasElement, true),
};

export const PageWithoutHeader: Story = {
  name: 'Page (no header: the body starts one region step down)',
  render: () => <PageDemo withHeader={false} />,
  play: async ({ canvasElement }) => assertPage(canvasElement, false),
};

export const PageSkeleton: Story = {
  name: 'Page (skeleton passes to the header)',
  render: () => <PageDemo withHeader isSkeleton />,
  play: async ({ canvasElement }) => {
    await assertPage(canvasElement, true);
    await expect(canvasElement.querySelector('[data-component="PageHeader"]')?.getAttribute('aria-busy')).toBe('true');
  },
};

const bleedTrail = { label: 'Breadcrumb', items: [{ id: 'agents', label: 'Agents', href: '#agents' }, { id: 'chat', label: 'Support agent' }] };

/** An app surface: one joined card that fills the viewport height left below the trail or the band. */
const PageBleedDemo = ({ withBand }: { readonly withBand: boolean }) => (
  <G.Page
    chrome="bleed"
    header={withBand ? { breadcrumbs: bleedTrail, title: 'Support agent', tabs: { label: 'Agent', items: [{ id: 'setup', label: 'Setup', href: globalThis.location.pathname }, { id: 'settings', label: 'Settings', href: '/settings' }] } } : { breadcrumbs: bleedTrail }}
  >
    <G.FillViewport minHeight="sm" bottomInset="page">
      <G.SurfaceCard ariaLabel="Conversation" composition="joined" height="fill">
        <div style={{ display: 'flex', blockSize: '100%', minBlockSize: 0 }}>
          <div style={{ inlineSize: '16rem', padding: '1rem' }}><G.Text tone="muted">Conversations</G.Text></div>
          <G.Divider orientation="vertical" semantics="presentation" />
          <div style={{ flex: '1 1 auto', padding: '1rem' }}><G.Text tone="muted">Thread</G.Text></div>
        </div>
      </G.SurfaceCard>
    </G.FillViewport>
  </G.Page>
);

/** A bleed body has no gutter, no block padding and no clip, and fills the page; the FillViewport keeps the one bottom inset. */
const assertPageBleed = async (canvasElement: HTMLElement, withBand: boolean) => {
  await waitFor(() => {
    const page = canvasElement.querySelector<HTMLElement>('[data-component="Page"][data-grammar-page-chrome="bleed"]');
    const body = page?.querySelector<HTMLElement>(':scope > [data-grammar-page-body]');
    if (!page || !body) throw new Error('The bleed Page and its body must render');
    const pageStyle = getComputedStyle(page);
    const bodyStyle = getComputedStyle(body);
    expect(Number.parseFloat(pageStyle.paddingTop)).toBe(0);
    expect(Number.parseFloat(pageStyle.paddingBottom)).toBe(0);
    expect(Number.parseFloat(bodyStyle.paddingLeft)).toBe(0);
    expect(Number.parseFloat(bodyStyle.paddingRight)).toBe(0);
    expect(bodyStyle.overflowX).toBe('visible');
    expect(Math.abs(body.getBoundingClientRect().width - page.getBoundingClientRect().width)).toBeLessThanOrEqual(0.5);
    expect(page.querySelectorAll('h1')).toHaveLength(withBand ? 1 : 0);
    expect(page.querySelector(':scope > [data-component="PageHeader"]') !== null).toBe(withBand);
    expect(page.querySelector(':scope > .starci-core-page-trail [data-component="Breadcrumbs"]') !== null).toBe(!withBand);
  }, { timeout: 4000 });
};

export const PageBleedTrail: Story = {
  name: 'Page bleed (breadcrumbs only, an app surface fills the region)',
  render: () => <PageBleedDemo withBand={false} />,
  play: async ({ canvasElement }) => assertPageBleed(canvasElement, false),
};

export const PageBleedBand: Story = {
  name: 'Page bleed (with the band and its link tabs)',
  render: () => <PageBleedDemo withBand />,
  play: async ({ canvasElement }) => assertPageBleed(canvasElement, true),
};

export const PrimaryRailLayout: Story = {
  render: () => (
    <G.PageContainer>
      <div style={{ padding: '1.5rem 0', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <State label="Standard rail, primary first" direction="column">
          <G.PrimaryRailLayout primary={<Placeholder label="Primary" />} rail={<Placeholder label="Rail" />} />
        </State>
        <State label="Wide rail, stretched, rail first when collapsed" direction="column">
          <G.PrimaryRailLayout railWidth="wide" align="stretch" collapsedOrder="rail-first" primary={<Placeholder label="Primary" />} rail={<Placeholder label="Rail" />} />
        </State>
      </div>
    </G.PageContainer>
  ),
};

const TopBarDemo = ({ initialOpen }: { readonly initialOpen: boolean }) => {
  const [open, setOpen] = useState(initialOpen);
  return (
    <G.TopBar
      position="static"
      brand={<G.Link href="#home">Studio</G.Link>}
      navigation={inlineNav}
      actions={<G.IconButton source={BellGlyph} label="Notifications" onPress={noop} />}
      menu={{ icon: <G.Icon source={MenuGlyph} />, openLabel: 'Open menu', closeLabel: 'Close menu', isOpen: open, onOpenChange: setOpen, visibility: 'always' }}
    />
  );
};

export const TopBar: Story = {
  name: 'TopBar (current destination, menu closed)',
  render: () => <TopBarDemo initialOpen={false} />,
};

export const TopBarMenuOpen: Story = {
  name: 'TopBar (menu open)',
  render: () => <TopBarDemo initialOpen />,
};

const bottomItems: ReadonlyArray<G.BottomNavItem> = [
  { id: 'home', label: 'Home', icon: <G.Icon source={HomeGlyph} />, href: '#home' },
  { id: 'learn', label: 'Learn', icon: <G.Icon source={BookGlyph} />, href: '#learn' },
  { id: 'alerts', label: 'Alerts', icon: <G.Icon source={BellGlyph} />, badge: '3', badgeLabel: '3 unread' },
  { id: 'profile', label: 'Profile', icon: <G.Icon source={UserGlyph} />, isDisabled: true },
];

const BottomNavDemo = ({ label }: { readonly label: string }) => {
  const [current, setCurrent] = useState('home');
  return <G.BottomNav label={label} items={bottomItems} currentId={current} onSelect={setCurrent} position="static" visibility="always" />;
};

export const BottomNav: Story = {
  render: () => (
    <div style={{ maxWidth: 420, padding: '1.5rem' }}>
      <State label="Current item, badge and a disabled item" direction="column"><BottomNavDemo label="Primary" /></State>
    </div>
  ),
};

const fixedNavQueue = G.createToastQueue();

/** Fixed BottomNav publishes clearance for the page content and bottom-placed toasts. */
const FixedBottomNavDemo = () => {
  const [current, setCurrent] = useState('home');
  const [queue] = useState(() => {
    fixedNavQueue.clear();
    fixedNavQueue.add({ title: 'Lesson saved for offline', tone: 'affirmative', timeout: 0 });
    return fixedNavQueue;
  });
  return (
    <>
      <G.WorkspaceShell
        primaryLabel="Lessons"
        primary={
          <G.PageContainer measure="reading">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <G.SectionHeader level={1} title="Lessons" description="Everything scrolls clear of the bar." />
              {['Articles', 'Plurals', 'Pronouns', 'Present simple', 'Past simple'].map((title) => (
                <G.SurfaceCard key={title} label={title} headingLevel={2}>
                  <G.Text tone="muted">Five short exercises.</G.Text>
                </G.SurfaceCard>
              ))}
              <div data-story-last-content="true"><G.Text>End of the list.</G.Text></div>
            </div>
          </G.PageContainer>
        }
      />
      <G.BottomNav label="Primary" position="fixed" visibility="compact" currentId={current} onSelect={setCurrent} items={bottomItems} />
      <G.Toaster label="Notifications" dismissLabel="Dismiss notification" queue={queue} placement="bottom" />
    </>
  );
};

/** Follows the toolbar family, so the sweep checks the offset in every family at 360px. */
export const FixedBottomNavLayout: Story = {
  name: 'Fixed BottomNav clearance (360px)',
  parameters: {
    viewport: { options: { phone360: { name: 'Phone 360 x 740', styles: { width: '360px', height: '740px' }, type: 'mobile' } } },
  },
  globals: { viewport: { value: 'phone360', isRotated: false } },
  render: () => <FixedBottomNavDemo />,
  play: async ({ canvasElement }) => {
    const nav = canvasElement.querySelector<HTMLElement>('[data-component="BottomNav"]');
    const last = canvasElement.querySelector<HTMLElement>('[data-story-last-content="true"]');
    await expect(nav).not.toBeNull();
    await expect(last).not.toBeNull();
    await waitFor(() => {
      const offset = getComputedStyle(canvasElement.querySelector('.grammar-common-root') ?? canvasElement).getPropertyValue('--starci-core-bottom-nav-offset').trim();
      expect(offset).not.toBe('');
      expect(canvasElement.querySelector('[data-component="Toaster"] ol')).not.toBeNull();
    });
    window.scrollTo(0, document.documentElement.scrollHeight);
    await waitFor(() => {
      const barTop = nav!.getBoundingClientRect().top;
      const toasts = canvasElement.querySelector<HTMLElement>('[data-component="Toaster"] ol');
      expect(Math.round(last!.getBoundingClientRect().bottom)).toBeLessThanOrEqual(Math.round(barTop));
      expect(Math.round(toasts!.getBoundingClientRect().bottom)).toBeLessThanOrEqual(Math.round(barTop));
    });
    window.scrollTo(0, 0);
  },
};

export const Footer: Story = {
  render: () => (
    <G.Footer
      label="Site"
      brand={<G.Text weight="semibold">Studio</G.Text>}
      externalHint="(opens in a new tab)"
      groups={[
        { id: 'product', label: 'Product', links: [{ id: 'features', label: 'Features', href: '#features', isCurrent: true }, { id: 'pricing', label: 'Pricing', href: '#pricing' }] },
        { id: 'support', label: 'Support', links: [{ id: 'help', label: 'Help centre', href: '#help' }, { id: 'status', label: 'Status', href: 'https://status.example.com', kind: 'external' }] },
      ]}
      legal={<G.Text size="xs" tone="muted">© 2026 Studio. All rights reserved.</G.Text>}
    />
  ),
};

export const NavigationFeatureNav: Story = {
  render: () => (
    <G.NavigationFeatureNav
      identity={<strong>Studio</strong>}
      navigation={inlineLinks}
      navigationLabel="Primary"
      compactNavigationTrigger={<G.IconButton source={MenuGlyph} label="Open navigation" />}
      compactNavigationTriggerLabel="Open navigation"
      actions={<G.Avatar name="Alex Morgan" size="sm" />}
      actionsLabel="Account"
      featureNavigation={<G.TextAction href="#new" appearance="route">What is new</G.TextAction>}
      featureNavigationLabel="Features"
      position="static"
    />
  ),
};

const sidebarGroups: ReadonlyArray<G.SidebarGroup> = [
  {
    id: 'main',
    label: 'Main',
    items: [
      { id: 'home', label: 'Home', source: HomeGlyph },
      { id: 'lessons', label: 'Lessons', source: BookGlyph, badge: 12, badgeLabel: '12 unread lessons' },
      { id: 'progress', label: 'Progress', source: ChartGlyph },
      { id: 'agent', label: 'Grading agent', source: UserGlyph, trailing: <G.StatusDot tone="success" echo aria-label="Running" /> },
    ],
  },
  {
    id: 'account',
    label: 'Account',
    placement: 'end',
    items: [
      { id: 'settings', label: 'Settings', source: SettingsGlyph },
      { id: 'billing', label: 'Billing', source: UserGlyph, isDisabled: true },
    ],
  },
];

const SidebarDemo = ({ initialCollapsed }: { readonly initialCollapsed: boolean }) => {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [selected, setSelected] = useState('lessons');
  return (
    <div style={{ height: 480, display: 'flex' }}>
      <G.Sidebar
        label={initialCollapsed ? 'Workspace (collapsed)' : 'Workspace'}
        groups={sidebarGroups}
        selectedKey={selected}
        onAction={setSelected}
        isCollapsed={collapsed}
        onCollapsedChange={setCollapsed}
        collapseLabel="Collapse sidebar"
        expandLabel="Expand sidebar"
        toggleSource={MenuGlyph}
        header={<G.Text weight="semibold">Studio</G.Text>}
        footer={<G.Avatar name="Alex Morgan" size="sm" />}
      />
    </div>
  );
};

export const Sidebar: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '2rem', padding: '1.5rem' }}>
      <State label="Expanded, selected item, disabled item" direction="column"><SidebarDemo initialCollapsed={false} /></State>
      <State label="Collapsed" direction="column"><SidebarDemo initialCollapsed /></State>
    </div>
  ),
  play: async ({ canvasElement }) => {
    // The item's name is its label (aria-label), so a trailing StatusDot must reach it as the description.
    await waitFor(() => {
      const item = canvasElement.querySelector<HTMLElement>('[data-key="agent"], [id$="agent"][role="option"], [aria-label="Grading agent"]');
      if (item === null) throw new Error('The agent item must render');
      const described = (item.getAttribute('aria-describedby') ?? '').split(' ').map((id) => canvasElement.ownerDocument.getElementById(id)).filter((node) => node !== null);
      if (!described.some((node) => node.querySelector('[aria-label="Running"]') !== null)) throw new Error('The trailing status must be the item\'s description');
    });
  },
};

const FixedShellDemo = ({ defaultOpen = false }: { readonly defaultOpen?: boolean }) => {
  return (
    <G.WorkspaceShell
      viewport="fixed"
      header={
        <G.TopBar
          position="static"
          brand={<G.IdentityLockup title="Studio" subtitle="Owner" />}
          actions={
            <>
              <G.Switch label="Dark mode" isLabelHidden size="control" thumbIcon={SettingsGlyph} selectedThumbIcon={UserGlyph} />
              <G.IconButton source={BellGlyph} label="Notifications" onPress={noop} />
              <G.AvatarButton name="Alex Morgan" size="control" />
            </>
          }
        />
      }
      navigation={<G.Sidebar label="Workspace" groups={sidebarGroups} selectedKey="lessons" />}
      navigationLabel="Workspace navigation"
      navigationTrack="fixed"
      navigationVisibility="wide"
      navigationDrawer={{
        title: 'Workspace',
        openLabel: 'Open navigation',
        closeLabel: 'Close navigation',
        source: MenuGlyph,
        defaultOpen,
        content: <G.Sidebar label="Workspace" presentation="drawer" groups={sidebarGroups} selectedKey="lessons" />,
      }}
      primaryLabel="Lessons"
      primary={
        <G.PageContainer>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1.5rem 0' }}>
            <G.SectionHeader title="Lessons" description="The navigation and this region scroll on their own." level={1} />
            <Placeholder label="Primary" height={900} headingLevel={2} />
          </div>
        </G.PageContainer>
      }
    />
  );
};

export const WorkspaceShellFixed: Story = {
  name: 'WorkspaceShell fixed (app shell)',
  parameters: { layout: 'fullscreen' },
  render: (_, { globals }) => <AppShellDemo initialCollapsed={false} initialDark={globals['grammarTheme'] === 'dark'} scope={familyScope(globals)} />,
};

export const WorkspaceShellDrawerOpen: Story = {
  name: 'WorkspaceShell navigation drawer (default open)',
  parameters: { layout: 'fullscreen' },
  render: () => <FixedShellDemo defaultOpen />,
};

export const WorkspaceShell: Story = {
  name: 'WorkspaceShell (document/site flow)',
  parameters: { docs: { description: { story: 'The flow renderer supports document and site layouts. App chrome follows the fixed App shell stories.' } } },
  render: () => (
    <G.WorkspaceShell
      header={
        <G.TopBar
          position="static"
          brand={<G.Link href="#home">Studio</G.Link>}
          actions={<G.IconButton source={SearchGlyph} label="Search" onPress={noop} />}
        />
      }
      navigation={<SidebarDemo initialCollapsed={false} />}
      navigationLabel="Workspace navigation"
      rail={<Placeholder label="Details" />}
      railLabel="Details"
      primaryLabel="Lessons"
      primary={
        <G.PageContainer>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1.5rem 0' }}>
            <G.SectionHeader title="Lessons" description="Everything in this workspace." level={1} />
            {/* The page title is an h1, so the first card under it names itself at rank 2. */}
            <Placeholder label="Primary" height={240} headingLevel={2} />
          </div>
        </G.PageContainer>
      }
    />
  ),
};

const PaneGridRows = () => (
  <div data-story-pane-grid="rows" style={{ height: '20rem', display: 'flex' }}>
    <G.PaneGrid label="Four panes" areas={['a b c', 'd d d']} rows={['fill', 'auto']}>
      <G.Pane area="a" surface><G.Text>A</G.Text></G.Pane>
      <G.Pane area="b"><G.Text>B</G.Text></G.Pane>
      <G.Pane area="c" surface><G.Text>C</G.Text></G.Pane>
      <G.Pane area="d"><G.Text>D spans the row below A, B and C</G.Text></G.Pane>
    </G.PaneGrid>
  </div>
);

/** Panes laid out by named areas, flush, with one divider between neighbours: A B C side by side, D below. */
export const PaneGrid: Story = {
  render: () => <PaneGridRows />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const pane = (area: string) => {
        const node = canvasElement.querySelector(`[data-story-pane-grid="rows"] [data-grammar-pane-area="${area}"]`);
        if (!(node instanceof HTMLElement)) throw new Error(`pane ${area} renders`);
        return node;
      };
      const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(pane);
      if (a === undefined || b === undefined || c === undefined || d === undefined) throw new Error('four panes render');
      // n-1 vertical lines between A B C, one horizontal line above D, none doubled.
      expect(getComputedStyle(a).borderInlineStartWidth).toBe('0px');
      expect(getComputedStyle(b).borderInlineStartWidth).toBe('1px');
      expect(getComputedStyle(c).borderInlineStartWidth).toBe('1px');
      for (const top of [a, b, c]) expect(getComputedStyle(top).borderBlockStartWidth).toBe('0px');
      expect(getComputedStyle(d).borderBlockStartWidth).toBe('1px');
      expect(getComputedStyle(d).borderInlineStartWidth).toBe('0px');
      // Flush: no gap between neighbours, D as wide as the three above.
      expect(Math.abs(a.getBoundingClientRect().right - b.getBoundingClientRect().left)).toBeLessThanOrEqual(1);
      expect(Math.abs(d.getBoundingClientRect().width - (c.getBoundingClientRect().right - a.getBoundingClientRect().left))).toBeLessThanOrEqual(1);
      // A surface pane stands on the surface ground; a plain pane is transparent.
      expect(rgbaOf(getComputedStyle(a).backgroundColor)[3]).toBeGreaterThan(0);
      expect(rgbaOf(getComputedStyle(b).backgroundColor)[3]).toBe(0);
    });
  },
};

const ResponsiveHost = ({ id, width }: { readonly id: string; readonly width: string }) => (
  <div data-story-pane-grid={id} style={{ height: '16rem', inlineSize: width }}>
    <G.PaneGrid
      label={`Responsive ${id}`}
      areas={{
        base: ['head', 'a', 'b', 'c'],
        medium: ['head head head', 'a b c'],
      }}
      columns={{ base: ['fill'], medium: ['fill', 'fill-2', 'fill'] }}
      rows={{ base: ['auto', 'fill', 'fill', 'fill'], medium: ['auto', 'fill'] }}
    >
      <G.Pane area="head" surface><G.Text>Header</G.Text></G.Pane>
      <G.Pane area="a" surface><G.Text>A</G.Text></G.Pane>
      <G.Pane area="b"><G.Text>B (twice as wide)</G.Text></G.Pane>
      <G.Pane area="c" surface><G.Text>C</G.Text></G.Pane>
    </G.PaneGrid>
  </div>
);

/** Three columns under a header that stack into one column below 48rem, chosen by CSS on the grid's own width; dividers stay one per touching edge. */
export const PaneGridResponsive: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <ResponsiveHost id="narrow" width="24rem" />
      <ResponsiveHost id="medium" width="60rem" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const pane = (id: string, area: string) => {
        const node = canvasElement.querySelector(`[data-story-pane-grid="${id}"] [data-grammar-pane-area="${area}"]`);
        if (!(node instanceof HTMLElement)) throw new Error(`pane ${area} renders in ${id}`);
        return node;
      };
      const rect = (id: string, area: string) => pane(id, area).getBoundingClientRect();
      const width = (id: string, area: string, side: 'Inline' | 'Block') => getComputedStyle(pane(id, area))[`border${side}StartWidth`];

      // Narrow: one column, A above B above C below the header; a horizontal line above each, none vertical, none on the header.
      expect(Math.abs(rect('narrow', 'a').left - rect('narrow', 'b').left)).toBeLessThanOrEqual(1);
      expect(rect('narrow', 'b').top).toBeGreaterThanOrEqual(rect('narrow', 'a').bottom - 1);
      expect(rect('narrow', 'c').top).toBeGreaterThanOrEqual(rect('narrow', 'b').bottom - 1);
      for (const area of ['a', 'b', 'c']) {
        expect(width('narrow', area, 'Block')).toBe('1px');
        expect(width('narrow', area, 'Inline')).toBe('0px');
      }
      expect(width('narrow', 'head', 'Block')).toBe('0px');

      // Wide: three columns A | B | C in 1:2:1 under the header; two vertical lines, one horizontal line under the bar, none doubled.
      expect(Math.abs(rect('medium', 'a').top - rect('medium', 'c').top)).toBeLessThanOrEqual(1);
      expect(rect('medium', 'b').left).toBeGreaterThanOrEqual(rect('medium', 'a').right - 1);
      expect(Math.abs(rect('medium', 'b').width / rect('medium', 'a').width - 2)).toBeLessThan(0.1);
      expect(width('medium', 'a', 'Inline')).toBe('0px');
      expect(width('medium', 'b', 'Inline')).toBe('1px');
      expect(width('medium', 'c', 'Inline')).toBe('1px');
      for (const area of ['a', 'b', 'c']) expect(width('medium', area, 'Block')).toBe('1px');
      expect(width('medium', 'head', 'Block')).toBe('0px');
      expect(width('medium', 'head', 'Inline')).toBe('0px');
    });
  },
};

const PaneGridAppDemo = () => {
  const [listOpen, setListOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const lines = Array.from({ length: 24 }, (_, index) => `Row ${index + 1}`);
  return (
    <div data-story-pane-grid="app" style={{ height: '30rem', display: 'flex' }}>
      <G.PaneGrid
        label="Three column workspace"
        areas={['list head info', 'list main info', 'list foot info']}
        columns={['standard', 'fill', 'standard']}
        rows={['auto', 'fill', 'auto']}
      >
        <G.Pane
          area="list"
          surface
          scroll
          label="Items"
          collapse="drawer"
          collapseLabel="Items"
          openLabel="Show items"
          closeLabel="Hide items"
          isOpen={listOpen}
          onOpenChange={setListOpen}
        >
          <div style={{ display: 'grid', gap: '0.5rem', padding: '1rem' }}>
            {lines.map((line) => <G.Text key={line}>{line}</G.Text>)}
          </div>
        </G.Pane>
        <G.Pane area="head" surface>
          <div style={{ padding: '0.75rem 1rem' }}><G.Text weight="semibold">Header</G.Text></div>
        </G.Pane>
        <G.Pane area="main" scroll label="Main">
          <div style={{ display: 'grid', gap: '0.5rem', padding: '1rem' }}>
            {lines.map((line) => <G.Text key={line}>{line}</G.Text>)}
          </div>
        </G.Pane>
        <G.Pane area="foot" surface>
          <div style={{ padding: '0.75rem 1rem' }}><G.Text tone="muted">Footer</G.Text></div>
        </G.Pane>
        <G.Pane
          area="info"
          surface
          label="Details"
          collapse="drawer"
          collapseLabel="Details"
          openLabel="Show details"
          closeLabel="Hide details"
          isOpen={infoOpen}
          onOpenChange={setInfoOpen}
        >
          <div style={{ padding: '1rem' }}><G.Text>Details</G.Text></div>
        </G.Pane>
      </G.PaneGrid>
    </div>
  );
};

/** A list, a header + main + footer column and an info pane: surface panes, one scroll owner, the same divider under the header as everywhere, and rail panes that become drawers when narrow. */
export const PaneGridApp: Story = {
  render: () => <PaneGridAppDemo />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const pane = (area: string) => {
        const node = canvasElement.querySelector(`[data-story-pane-grid="app"] [data-grammar-pane-area="${area}"]`);
        if (!(node instanceof HTMLElement)) throw new Error(`pane ${area} renders`);
        return node;
      };
      const head = pane('head');
      const main = pane('main');
      const foot = pane('foot');
      const info = pane('info');
      // One ordinary line under the header (drawn by the pane below it) and one above the footer; none on the outer edges.
      expect(getComputedStyle(main).borderBlockStartWidth).toBe('1px');
      expect(getComputedStyle(foot).borderBlockStartWidth).toBe('1px');
      expect(getComputedStyle(head).borderBlockStartWidth).toBe('0px');
      expect(getComputedStyle(pane('list')).borderInlineStartWidth).toBe('0px');
      // The header itself draws no bottom edge: the boundary is drawn once.
      expect(getComputedStyle(head).borderBlockEndWidth).toBe('0px');
      // The rail panes stand on the surface ground and keep their vertical divider.
      expect(rgbaOf(getComputedStyle(info).backgroundColor)[3]).toBeGreaterThan(0);
      expect(getComputedStyle(info).borderInlineStartWidth).toBe('1px');
      expect(rgbaOf(getComputedStyle(main).backgroundColor)[3]).toBe(0);
      // The main pane is its own scroll owner and the header and footer never scroll with it.
      const scroller = main.querySelector('[data-grammar-scroll-region="vertical"]');
      if (!(scroller instanceof HTMLElement)) throw new Error('main owns a scroll region');
      expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
      expect(getComputedStyle(head).overflowY).toBe('hidden');
    });
  },
};

/** One message: incoming on the recessed face, outgoing on the accent-soft pair; actions appear on hover or focus. */
export const ChatBubble: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: '0.75rem', maxWidth: '40rem' }}>
      <G.ChatBubble
        author="Linh"
        meta="09:12"
        avatar={<G.Avatar name="Linh" size="sm" />}
        actions={
          <>
            <G.Tooltip content="Copy"><G.IconButton intent="neutral" source={BookGlyph} label="Copy" onPress={noop} /></G.Tooltip>
            <G.Tooltip content="Reply"><G.IconButton intent="neutral" source={BellGlyph} label="Reply" onPress={noop} /></G.Tooltip>
          </>
        }
      >
        Can the order for table 4 move to 19:30?
      </G.ChatBubble>
      <G.ChatBubble
        side="outgoing"
        meta="09:13"
        actions={<G.Tooltip content="Copy"><G.IconButton intent="neutral" source={BookGlyph} label="Copy" onPress={noop} /></G.Tooltip>}
      >
        Yes, moved. The kitchen has the new time.
      </G.ChatBubble>
      <G.ChatBubble
        author="Assistant"
        status={<G.Badge>AI</G.Badge>}
        meta="09:13"
        avatar={<G.IconTile source={BellGlyph} size="sm" />}
        isHighlight
        footer={<G.Button variant="secondary" size="sm" onPress={noop}>Approve draft</G.Button>}
      >
        {'Draft reply ready.\nIt keeps the original price.'}
      </G.ChatBubble>
      <G.ChatBubble isSkeleton side="outgoing" />
      <G.ChatBubbleSkeletons />
    </div>
  ),
};

/** A messenger frame: ONE joined surface, columns touching and divided by vertical hairlines; the thread scrolls on the background tone. */
export const MessengerFrame: Story = {
  render: () => (
    <div style={{ height: '28rem' }}>
      <G.SurfaceCard ariaLabel="Messenger" composition="joined" height="fill">
        <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
          <div style={{ width: '16rem', flex: 'none', padding: '1rem' }}>
            <G.ListBox
              label="Conversations"
              selectionIndicator="none"
              selectionMode="single"
              defaultSelectedIds={['study-group']}
              items={[
                { id: 'study-group', label: 'Study group', description: 'See you at 7' },
                { id: 'linh', label: 'Linh', description: 'Thanks!' },
              ]}
            />
          </div>
          <G.Divider orientation="vertical" semantics="presentation" />
          <div style={{ display: 'flex', minWidth: 0, flex: 1, flexDirection: 'column' }}>
            <div style={{ padding: '1rem' }}><G.Text weight="semibold">Study group</G.Text></div>
            <G.Divider semantics="presentation" />
            <G.VerticalScrollRegion isScrollable tone="background" aria-label="Messages" style={{ flex: 1, minHeight: 0, padding: '1rem' }}>
              <G.ChatBubble author="Linh" meta="09:12" actions={<G.Tooltip content="Copy"><G.IconButton intent="neutral" source={BookGlyph} label="Copy" onPress={noop} /></G.Tooltip>}>
                Can the order for table 4 move to 19:30?
              </G.ChatBubble>
            </G.VerticalScrollRegion>
          </div>
          <G.Divider orientation="vertical" semantics="presentation" />
          <div style={{ width: '14rem', flex: 'none', padding: '1rem' }}><G.Text tone="muted">Info</G.Text></div>
        </div>
      </G.SurfaceCard>
    </div>
  ),
};

/** Fills the viewport height left under whatever sits above it; the child takes `h-full`. */
export const FillViewport: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <Placeholder label="Chrome above (top bar, page header)" height={80} />
      <G.FillViewport minHeight="sm" label="Conversation">
        <G.SurfaceCard height="fill" label="Conversation">
          <G.Text tone="muted">This card reaches the bottom of the window.</G.Text>
        </G.SurfaceCard>
      </G.FillViewport>
    </div>
  ),
};

/** `railPosition="leading"` draws the rail first (a module switcher, a filter list) without changing reading order. */
export const PrimaryRailLayoutLeading: Story = {
  render: () => (
    <G.PageContainer>
      <div style={{ padding: '1.5rem 0' }}>
        <G.PrimaryRailLayout railPosition="leading" railWidth="compact" primary={<Placeholder label="Primary" />} rail={<Placeholder label="Rail" />} />
      </div>
    </G.PageContainer>
  ),
};
