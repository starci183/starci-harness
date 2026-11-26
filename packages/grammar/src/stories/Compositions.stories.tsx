import type { Meta, StoryObj } from '@storybook/react-vite';
import { Fragment, useState } from 'react';
import * as G from '../common/index.js';
import { AppShellDemo } from './AppShellDemo.js';
import { BellGlyph, BookGlyph, ChartGlyph, HomeGlyph, MenuGlyph, SearchGlyph, SettingsGlyph, State, PlusGlyph, UserGlyph, noop, familyScope } from './fixtures.js';

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

/** TopBar `subnavigation` is a named region itself, so its slot takes bare links. */
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
            summary="3 documents changed"
            dismiss={<G.Button variant="border" onPress={noop}>Discard</G.Button>}
            commit={<G.Button variant="primary" onPress={noop}>Save changes</G.Button>}
          />
        </div>
      </State>
      <State label="Summary node with a commit only" direction="column">
        <div style={{ maxWidth: 390 }}>
          <G.PinnedActionBar label="Cart" visibility="always" summary={<G.Text>Total <strong>$48.00</strong></G.Text>} commit={<G.Button variant="primary" onPress={noop}>Check out</G.Button>} />
        </div>
      </State>
    </div>
  ),
};

const PageHeaderDemo = ({ withTabs }: { readonly withTabs: boolean }) => {
  const [tab, setTab] = useState('test');
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <G.Page
        header={{
          breadcrumbs: { label: 'Breadcrumb', items: [{ id: 'connections', label: 'Connections', href: '#connections' }, { id: 'main', label: 'Main account' }] },
          title: 'Main account',
          titleId: 'page-header-story-title',
          mark: <G.Avatar name="Acme" shape="rounded" isDecorative />,
          status: <><G.Badge isDot tone="success">Connected</G.Badge><G.Badge tone="warning">Test mode · not posted</G.Badge></>,
          meta: 'Wire transfer · ****6789',
          description: 'Payments arrive by webhook and are matched to invoices.',
          actions: <><G.Button variant="border" onPress={noop}>Switch to live</G.Button><G.Button variant="danger" onPress={noop}>Disconnect</G.Button></>,
          ...(withTabs ? { tabs: { label: 'Connection', selectedKey: tab, onSelect: setTab, items: [{ id: 'overview', label: 'Overview' }, { id: 'setup', label: 'Setup' }, { id: 'test', label: 'Test' }, { id: 'agents', label: 'Agents' }] } } : {}),
        }}
      >
        <Placeholder label="Webhook details" headingLevel={2} />
      </G.Page>
    </div>
  );
};

export const PageBand: Story = {
  name: 'Page header (separator, no tabs)',
  render: () => <PageHeaderDemo withTabs={false} />,
};

export const PageBandTabs: Story = {
  name: 'Page header (page tabs on the separator)',
  render: () => <PageHeaderDemo withTabs />,
};

/** Link tabs: each item carries its route, no state or `onSelect`, and the tab of the current path is selected. */
export const PageBandLinkTabs: Story = {
  name: 'Page header (link tabs follow the path)',
  render: () => (
    <G.Page
      header={{
        title: 'Main account',
        tabs: {
          label: 'Connection',
          items: [
            { id: 'overview', label: 'Overview', href: '/overview' },
            { id: 'current', label: 'Current', href: globalThis.location.pathname },
            { id: 'setup', label: 'Setup', href: '/setup' },
          ],
        },
      }}
    >
      <Placeholder label="Page body" headingLevel={2} />
    </G.Page>
  ),
};

export const PageBandPhone: Story = {
  name: 'Page header (360px: actions wrap under the heading)',
  parameters: {
    viewport: { options: { phone360: { name: 'Phone 360 x 740', styles: { width: '360px', height: '740px' }, type: 'mobile' } } },
  },
  globals: { viewport: { value: 'phone360', isRotated: false } },
  render: () => <PageHeaderDemo withTabs />,
};

const PageDemo = ({ withHeader, isLoading = false }: { readonly withHeader: boolean; readonly isLoading?: boolean }) => {
  const [tab, setTab] = useState('overview');
  return (
    <G.Page
      isLoading={isLoading}
      {...(withHeader ? {
        header: {
          breadcrumbs: { label: 'Breadcrumb', items: [{ id: 'connections', label: 'Connections', href: '#connections' }, { id: 'main', label: 'Main account' }] },
          title: 'Main account',
          description: 'Payments arrive by webhook and are matched to invoices.',
          actions: <G.Button variant="border" onPress={noop}>Switch to live</G.Button>,
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

export const Page: Story = {
  name: 'Page (header band, body in the gutter)',
  render: () => <PageDemo withHeader />,
};

export const PageWithoutHeader: Story = {
  name: 'Page (no header: the body starts one region step down)',
  render: () => <PageDemo withHeader={false} />,
};

export const PageSkeleton: Story = {
  name: 'Page (skeleton passes to the header)',
  render: () => <PageDemo withHeader isLoading />,
};

const bleedTrail = { label: 'Breadcrumb', items: [{ id: 'agents', label: 'Agents', href: '#agents' }, { id: 'chat', label: 'Support agent' }] };

/** An app surface: one card that fills the viewport height left below the trail or the band. */
const PageBleedDemo = ({ withBand }: { readonly withBand: boolean }) => (
  <G.Page
    chrome="bleed"
    header={withBand ? { breadcrumbs: bleedTrail, title: 'Support agent', tabs: { label: 'Agent', items: [{ id: 'setup', label: 'Setup', href: globalThis.location.pathname }, { id: 'settings', label: 'Settings', href: '/settings' }] } } : { breadcrumbs: bleedTrail }}
  >
    <G.SurfaceCard ariaLabel="Conversation" height="fill">
      <G.Text tone="muted">Thread</G.Text>
    </G.SurfaceCard>
  </G.Page>
);

export const PageBleedTrail: Story = {
  name: 'Page bleed (breadcrumbs only, an app surface fills the region)',
  render: () => <PageBleedDemo withBand={false} />,
};

export const PageBleedBand: Story = {
  name: 'Page bleed (with the band and its link tabs)',
  render: () => <PageBleedDemo withBand />,
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

/** 0.37.22: the directory links are plain (the foreground colour), never the accent red; the red budget leaves the accent to the one main CTA and links in prose. */
export const Footer: Story = {
  render: () => (
    <G.Footer
      label="Site"
      brand={<G.Text isStrong>Studio</G.Text>}
      externalHint="(opens in a new tab)"
      groups={[
        { id: 'product', label: 'Product', links: [{ id: 'features', label: 'Features', href: '#features', isCurrent: true }, { id: 'pricing', label: 'Pricing', href: '#pricing' }] },
        { id: 'support', label: 'Support', links: [{ id: 'help', label: 'Help centre', href: '#help' }, { id: 'status', label: 'Status', href: 'https://status.example.com', kind: 'external' }] },
      ]}
      legal={<G.Text role="caption">© 2026 Studio. All rights reserved.</G.Text>}
    />
  ),
};

export const TopBarSubnavigation: Story = {
  name: 'TopBar (a second layer: subnavigation)',
  render: () => (
    <G.TopBar
      position="static"
      brand={<strong>Studio</strong>}
      navigation={inlineLinks}
      actions={<G.Avatar name="Alex Morgan" size="md" />}
      menu={{ icon: <G.Icon source={MenuGlyph} />, openLabel: 'Open navigation', closeLabel: 'Close navigation', isOpen: false, onOpenChange: noop }}
      subnavigation={<G.Link href="#new">What is new</G.Link>}
      subnavigationLabel="Features"
    />
  ),
};

const sidebarGroups: ReadonlyArray<G.SidebarGroup> = [
  {
    id: 'main',
    label: 'Main',
    items: [
      { id: 'home', label: 'Home', source: HomeGlyph },
      { id: 'docs', label: 'Docs', source: BookGlyph, badge: 12, badgeLabel: '12 unread documents' },
      { id: 'progress', label: 'Progress', source: ChartGlyph },
      { id: 'agent', label: 'Review agent', source: UserGlyph, trailing: <G.StatusDot tone="success" echo aria-label="Running" /> },
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
  const [selected, setSelected] = useState('docs');
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
        header={<G.Text isStrong>Studio</G.Text>}
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
              <G.AvatarButton name="Alex Morgan" size="md" />
            </>
          }
        />
      }
      navigation={<G.Sidebar label="Workspace" groups={sidebarGroups} selectedKey="docs" />}
      navigationLabel="Workspace navigation"
      navigationTrack="fixed"
      navigationVisibility="wide"
      navigationDrawer={{
        title: 'Workspace',
        openLabel: 'Open navigation',
        closeLabel: 'Close navigation',
        source: MenuGlyph,
        defaultOpen,
        content: <G.Sidebar label="Workspace" presentation="drawer" groups={sidebarGroups} selectedKey="docs" />,
      }}
      primaryLabel="Docs"
      primary={
        <G.Page>
          <G.Section title="Docs" description="The navigation and this region scroll on their own.">
            <Placeholder label="Primary" height={900} headingLevel={3} />
          </G.Section>
        </G.Page>
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
      primaryLabel="Docs"
      primary={
        <G.Page>
          <G.Section title="Docs" description="Everything in this workspace.">
            <Placeholder label="Primary" height={240} headingLevel={3} />
          </G.Section>
        </G.Page>
      }
    />
  ),
};

const PaneGridRows = () => (
  <div data-story-pane-grid="rows" style={{ height: '20rem', display: 'flex' }}>
    <G.PaneGrid label="Four panes" areas={['a b c', 'd d d']} rows={['fill', 'auto']}>
      <G.Pane area="a" surface><G.PaneSection><G.Text>A</G.Text></G.PaneSection></G.Pane>
      <G.Pane area="b"><G.PaneSection><G.Text>B</G.Text></G.PaneSection></G.Pane>
      <G.Pane area="c" surface><G.PaneSection><G.Text>C</G.Text></G.PaneSection></G.Pane>
      <G.Pane area="d"><G.PaneSection><G.Text>D spans the row below A, B and C</G.Text></G.PaneSection></G.Pane>
    </G.PaneGrid>
  </div>
);

/** Panes laid out by named areas, flush, with one divider between neighbours: A B C side by side, D below. */
export const PaneGrid: Story = {
  render: () => <PaneGridRows />,
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
      <G.Pane area="head" surface><G.PaneSection><G.Text>Header</G.Text></G.PaneSection></G.Pane>
      <G.Pane area="a" surface><G.PaneSection><G.Text>A</G.Text></G.PaneSection></G.Pane>
      <G.Pane area="b"><G.PaneSection><G.Text>B (twice as wide)</G.Text></G.PaneSection></G.Pane>
      <G.Pane area="c" surface><G.PaneSection><G.Text>C</G.Text></G.PaneSection></G.Pane>
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
          <G.PaneSection gap="inline">
            {lines.map((line) => <G.Text key={line}>{line}</G.Text>)}
          </G.PaneSection>
        </G.Pane>
        <G.Pane area="head" surface>
          <G.PaneSection align="center"><G.Text isStrong>Header</G.Text></G.PaneSection>
        </G.Pane>
        <G.Pane area="main" scroll label="Main">
          <G.PaneSection gap="inline">
            {lines.map((line) => <G.Text key={line}>{line}</G.Text>)}
          </G.PaneSection>
        </G.Pane>
        <G.Pane area="foot" surface>
          <G.PaneSection align="center"><G.Text tone="muted">Footer</G.Text></G.PaneSection>
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
          <G.PaneSection><G.Text>Details</G.Text></G.PaneSection>
        </G.Pane>
      </G.PaneGrid>
    </div>
  );
};

/** A list, a header + main + footer column and an info pane: surface panes, one scroll owner, the same divider under the header as everywhere, and rail panes that become drawers when narrow. */
export const PaneGridApp: Story = {
  render: () => <PaneGridAppDemo />,
};

const chipLabels = ['Reply later', 'Assign to me', 'Mark as done', 'Add a note', 'Share', 'Archive'];

/** An Office-like grid: every band is a PaneSection, so every box starts on the pane's content edge. The info pane is a drawer below 48rem. */
const PaneInsetDemo = () => {
  const [tab, setTab] = useState('all');
  const [infoOpen, setInfoOpen] = useState(false);
  return (
    <div data-story-pane-grid="inset" style={{ height: '48rem', display: 'flex' }}>
      <G.PaneGrid
        label="Office"
        areas={{ base: ['list', 'thread', 'composer'], medium: ['list thread info', 'list composer info'] }}
        columns={{ base: ['fill'], medium: ['standard', 'fill', 'standard'] }}
        rows={{ base: ['fill', 'fill', 'auto'], medium: ['fill', 'auto'] }}
      >
        <G.Pane area="list" surface>
          <G.PaneSection align="center"><G.Text isStrong>Chats</G.Text></G.PaneSection>
          <G.PaneSection><G.SearchField label="Search" isLabelHidden placeholder="Search conversations" clearLabel="Clear search" /></G.PaneSection>
          <G.PaneSection>
            <G.Tabs
              label="Filter"
              panelId="office-filter-panel"
              selectedKey={tab}
              onSelect={setTab}
              items={[{ id: 'all', label: 'All' }, { id: 'unread', label: 'Unread' }, { id: 'mine', label: 'Mine' }]}
            />
          </G.PaneSection>
          <G.PaneSection scroll={{ label: 'Conversations' }}>
            <div role="tabpanel" id="office-filter-panel" aria-label="Filter">
            <G.ListBox
              label="Conversations"
              selectionIndicator="none"
              selectionMode="single"
              defaultSelectedIds={['study-group']}
              items={[
                { id: 'study-group', label: 'Study group', description: 'See you at 7' },
                { id: 'sam', label: 'Sam', description: 'Thanks!' },
                { id: 'maria', label: 'Maria', description: 'Sent the file' },
              ]}
            />
            </div>
          </G.PaneSection>
        </G.Pane>
        <G.Pane area="thread">
          <G.PaneSection scroll={{ label: 'Messages', tone: 'background' }}>
            <G.MessageBubble author="Sam" meta="09:12" body={"Can the order for table 4 move to 19:30?"} />
            <G.MessageBubble author="You" meta="09:14" side="outgoing" body={"Yes, I moved it."} />
          </G.PaneSection>
        </G.Pane>
        <G.Pane area="composer" surface>
          <G.PaneSection bleed="inline">
            <G.HorizontalScrollRegion aria-label="Quick replies" overflow="needed" carets={false}>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {chipLabels.map((chip) => <G.Button key={chip} size="sm" variant="border" onPress={noop}>{chip}</G.Button>)}
              </div>
            </G.HorizontalScrollRegion>
          </G.PaneSection>
          <G.PaneSection>
            <div style={{ display: 'flex', alignItems: 'end', gap: '0.5rem' }}>
              <G.IconButton source={PlusGlyph} label="Attach" onPress={noop} />
              <div style={{ flex: 1, minWidth: 0 }}><G.Textarea label="Message" isLabelHidden rows={1} /></div>
              <G.Button onPress={noop}>Send</G.Button>
            </div>
            <G.Text role="body" tone="muted">Enter sends, Shift+Enter breaks the line</G.Text>
          </G.PaneSection>
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
          <G.PaneSection align="center"><G.Text isStrong>Study group</G.Text></G.PaneSection>
          <G.PaneSection gap="section"><G.Text tone="muted">Four members. Created in March.</G.Text></G.PaneSection>
        </G.Pane>
      </G.PaneGrid>
    </div>
  );
};

const viewportOptions = {
  desktop1200: { name: 'Desktop 1200 x 800', styles: { width: '1200px', height: '800px' }, type: 'desktop' },
  phone375: { name: 'Phone 375 x 812', styles: { width: '375px', height: '812px' }, type: 'mobile' },
} as const;

/** The pane inset at 1200px: the head, search box, first tab pill, selected row, bubbles, chips, controls and hint all start 12px inside their pane. */
export const PaneInset: Story = {
  parameters: { viewport: { options: viewportOptions } },
  globals: { viewport: { value: 'desktop1200', isRotated: false } },
  render: () => <PaneInsetDemo />,
};

/** The same grid at 375px: one column, the inset does not step, the info pane is a drawer. */
export const PaneInsetPhone: Story = {
  parameters: { viewport: { options: viewportOptions } },
  globals: { viewport: { value: 'phone375', isRotated: false } },
  render: () => <PaneInsetDemo />,
};

/** A tabbed app page: the header tabs, then one PaneGrid attached flush to the tab line and running to the viewport bottom. */
const PagePanesDemo = () => (
  <G.Page
    chrome="panes"
    header={{
      title: 'Support agent',
      tabs: { label: 'Agent', items: [{ id: 'setup', label: 'Setup', href: globalThis.location.pathname }, { id: 'settings', label: 'Settings', href: '/settings' }] },
    }}
  >
    <G.PaneGrid label="Setup" areas={{ base: ['chat', 'side'], medium: ['chat side'] }} columns={{ base: ['fill'], medium: ['fill', 'standard'] }}>
      <G.Pane area="chat" content="chat">
        <G.ChatFrame label="Conversation" header={<G.PaneHeader title="Support agent" mark={<G.Avatar name="Support agent" size="md" />} />}>
          <G.MessageBubble author="Agent" meta="09:12" avatar={<G.Avatar name="Support agent" size="md" />} body={"How can I help?"} />
        </G.ChatFrame>
      </G.Pane>
      <G.Pane area="side" surface>
        <G.PaneSection gap="section"><G.Text isStrong>Settings</G.Text><G.Text tone="muted">Greeting and tools.</G.Text></G.PaneSection>
      </G.Pane>
    </G.PaneGrid>
  </G.Page>
);

/** Page chrome="panes" at 1200px. */
export const PagePanes: Story = {
  parameters: { viewport: { options: viewportOptions } },
  globals: { viewport: { value: 'desktop1200', isRotated: false } },
  render: () => <PagePanesDemo />,
};

/** Page chrome="panes" at 375px: the grid stacks, still attached to the tab line and the viewport bottom. */
export const PagePanesPhone: Story = {
  parameters: { viewport: { options: viewportOptions } },
  globals: { viewport: { value: 'phone375', isRotated: false } },
  render: () => <PagePanesDemo />,
};

/** One message: incoming on the recessed face, outgoing on the accent-soft pair; actions appear on hover or focus. */
export const MessageBubble: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: '0.75rem', maxWidth: '40rem' }}>
      <G.MessageBubble
        author="Sam"
        meta="09:12"
        avatar={<G.Avatar name="Sam" size="md" />}
        actions={
          <>
            <G.Tooltip content="Copy" trigger={<G.IconButton variant="border" source={BookGlyph} label="Copy" onPress={noop} />} />
            <G.Tooltip content="Reply" trigger={<G.IconButton variant="border" source={BellGlyph} label="Reply" onPress={noop} />} />
          </>
        } body={"Can the order for table 4 move to 19:30?"} />
      <G.MessageBubble
        side="outgoing"
        meta="09:13"
        actions={<G.Tooltip content="Copy" trigger={<G.IconButton variant="border" source={BookGlyph} label="Copy" onPress={noop} />} />} body={"Yes, moved. The kitchen has the new time."} />
      <G.MessageBubble
        author="Assistant"
        status={<G.Badge>AI</G.Badge>}
        meta="09:13"
        avatar={<G.IconTile source={BellGlyph} />}
        isHighlight
        footer={<G.Button variant="border" size="sm" onPress={noop}>Approve draft</G.Button>} body={'Draft reply ready.\nIt keeps the original price.'} />
      <G.MessageBubble isLoading side="outgoing" />
      <G.MessageBubble isLoading hasAvatar />
    </div>
  ),
};

/** Words from a source on a tinted ground at the nested inset: bare in a pane, inside a card, with a byline, and as its loading geometry. */
export const Quote: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: '0.75rem', maxWidth: '28rem' }}>
      <G.Quote source="Notes" byline="Chat, 09:41" text={"Table 4 moved to 19:30. The kitchen has the new time."} />
      <G.Quote source="Template" text={'Thank you for booking.\nWe hold the table for 15 minutes.'} />
      <G.SurfaceCard ariaLabel="Reply source">
        <G.Quote source="Chat" byline="Email, 09:12" text={"Can the order for table 4 move to 19:30?"} />
      </G.SurfaceCard>
      <G.Quote isLoading />
    </div>
  ),
};

/** The primary content and one subordinate rail: reading order collapses by `collapsedOrder`. */
export const GridMainRail: Story = {
  render: () => (
    <G.Page>
      <State label="Standard rail, primary first" direction="column">
        <G.Grid kind="main-rail" primary={<Placeholder label="Primary" />} rail={<Placeholder label="Rail" />} />
      </State>
      <State label="Wide rail, stretched, rail first when collapsed" direction="column">
        <G.Grid kind="main-rail" railWidth="wide" align="stretch" collapsedOrder="rail-first" primary={<Placeholder label="Primary" />} rail={<Placeholder label="Rail" />} />
      </State>
    </G.Page>
  ),
};

/** `railPosition="leading"` draws the rail first (a module switcher, a filter list) without changing reading order. */
export const GridMainRailLeading: Story = {
  render: () => (
    <G.Page>
      <G.Grid kind="main-rail" railPosition="leading" railWidth="compact" primary={<Placeholder label="Primary" />} rail={<Placeholder label="Rail" />} />
    </G.Page>
  ),
};

const weekDays = ['Monday 9', 'Tuesday 10', 'Wednesday 11', 'Thursday 12', 'Friday 13', 'Saturday 14', 'Sunday 15'];

const agendaDays = () => weekDays.map((day, index) => (
  <G.Section key={day} kind="list" title={day}
    items={index % 2 === 0 ? [{ id: day, title: 'Delivery review with the operations team', description: '09:30–10:00', action: { label: 'Open', press: noop } }] : []}
    empty={<G.EmptyNotice message="No scheduled appointments" />} />
));

/** Seven dated event tracks at wide container sizes, the same ordered days as an agenda when narrow. */
export const GridWeek: Story = {
  render: () => (
    <G.Page measure="full">
      <G.Section title="Appointments for 9–15 November">
        <G.Grid kind="week" label="Appointments by day">{agendaDays()}</G.Grid>
      </G.Section>
      <div style={{ maxWidth: 390 }}>
        <G.Grid kind="week" label="Narrow appointment agenda">{agendaDays()}</G.Grid>
      </div>
    </G.Page>
  ),
};

const summaryDays = () => weekDays.map((day, index) => (
  <G.SurfaceCard key={day} label={day}>
    <G.Meter label="Available capacity" value={index * 10} maxValue={100} valueLabel={`${index * 10}%`} />
  </G.SurfaceCard>
));

/** Daily summaries keep the seven-day order while wrapping through one, four and seven tracks. */
export const GridWeekSummary: Story = {
  render: () => (
    <G.Page measure="full">
      <G.Section title="Capacity for 9–15 November">
        <G.Grid kind="week-summary" label="Capacity by day">{summaryDays()}</G.Grid>
      </G.Section>
      <div style={{ maxWidth: 720 }}>
        <G.Grid kind="week-summary" label="Intermediate capacity summary">{summaryDays()}</G.Grid>
      </div>
      <div style={{ maxWidth: 390 }}>
        <G.Grid kind="week-summary" label="Narrow capacity summary">{summaryDays()}</G.Grid>
      </div>
    </G.Page>
  ),
};

const copyReply = (
  <>
    <G.Tooltip content="Copy" trigger={<G.IconButton variant="border" source={BookGlyph} label="Copy" onPress={noop} />} />
    <G.Tooltip content="Reply" trigger={<G.IconButton variant="border" source={BellGlyph} label="Reply" onPress={noop} />} />
  </>
);

/** `actionsPlacement="inline"`: the actions are a bare toolbar in the message row, on the reading end of the bubble; hover or tab into a message to show them. */
export const MessageBubbleInlineActions: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: '0.75rem', maxWidth: '40rem' }}>
      <G.MessageBubble author="Sam" meta="09:12" avatar={<G.Avatar name="Sam" size="md" />} actionsPlacement="inline" actions={copyReply} body={'Can the order for table 4 move to 19:30?'} />
      <G.MessageBubble side="outgoing" meta="09:13" actionsPlacement="inline" actions={copyReply} body={'Yes, moved. The kitchen has the new time.'} />
      <G.MessageBubble author="Sam" meta="09:14" actionsPlacement="floating" actions={copyReply} body={'The floating default, for comparison.'} />
    </div>
  ),
};

/** `measure="wide"`: a bubble reaches 70% of its row (the default `standard` stops at 40rem or 85%). A long body shows the reach. */
export const MessageBubbleMeasure: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: '0.75rem', maxWidth: '64rem' }}>
      {(['standard', 'wide'] as const).map((measure) => (
        <Fragment key={measure}>
          <G.MessageBubble measure={measure} author="Sam" meta={measure} avatar={<G.Avatar name="Sam" size="md" />} actionsPlacement="inline" actions={copyReply} body={'The booking for table 4 moves to 19:30 and the kitchen needs the new time before the first order goes in, so please confirm with the floor lead and tell the guests the table is ready from 19:25.'} />
          <G.MessageBubble measure={measure} side="outgoing" meta={measure} body={'Confirmed with the floor lead, the guests are told. The kitchen has the 19:30 time and the first order goes in at 19:35 once everyone is seated at the table.'} />
        </Fragment>
      ))}
    </div>
  ),
};
