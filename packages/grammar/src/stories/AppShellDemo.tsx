import { useEffect, useState } from 'react';
import * as G from '../common/index.js';
import type { familyScope } from './fixtures.js';
import { BellGlyph, BookGlyph, EllipsisGlyph, HomeGlyph, LanguageGlyph, MenuGlyph, MoonGlyph, SearchGlyph, SettingsGlyph, SunGlyph, UserGlyph } from './fixtures.js';
import './AppShell.stories.css';

const groups: ReadonlyArray<G.SidebarGroup> = [
  { id: 'main', label: 'Main', items: [{ id: 'home', label: 'Home', source: HomeGlyph }, { id: 'conversations', label: 'Conversations', source: BookGlyph, badge: 12, badgeLabel: '12 unread conversations' }] },
  { id: 'operations', label: 'Operations', items: [{ id: 'team', label: 'Team', source: UserGlyph, badge: 105, badgeLabel: '105 pending invitations' }] },
  { id: 'settings', label: 'Settings', placement: 'end', items: [{ id: 'preferences', label: 'Preferences', source: SettingsGlyph }] },
];

export const AppShellDemo = ({ initialCollapsed, initialDrawerOpen = false, initialDark = false, navigationMode = 'spec', scope }: { readonly initialCollapsed: boolean; readonly initialDrawerOpen?: boolean; readonly initialDark?: boolean; readonly navigationMode?: 'spec' | 'slot'; readonly scope: ReturnType<typeof familyScope> }) => {
  const userId = `grammar-app-shell-${initialCollapsed ? 'rail' : 'expanded'}-${initialDrawerOpen ? 'drawer' : 'desktop'}-${initialDark ? 'dark' : 'light'}-${navigationMode}`;
  const storageKey = `grammar:sidebar:${userId}`;
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [selected, setSelected] = useState('conversations');
  const [drawerOpen, setDrawerOpen] = useState(initialDrawerOpen);
  const [searchOpen, setSearchOpen] = useState(false);
  const [language, setLanguage] = useState('vi');
  const [dark, setDark] = useState(initialDark);
  const [workspace, setWorkspace] = useState('studio');

  useEffect(() => setDark(initialDark), [initialDark]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const changeCollapsed = (next: boolean) => {
    setCollapsed(next);
    window.localStorage.setItem(storageKey, String(next));
  };
  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey);
    setCollapsed(stored === null ? initialCollapsed : stored === 'true');
  }, [initialCollapsed, storageKey]);

  const workspaceItems: ReadonlyArray<G.DropdownMenuItem> = [
    { id: 'studio', label: 'Studio', mark: <G.Avatar name="Studio" isDecorative shape="square" size="sm" /> },
    { id: 'academy', label: 'Academy', mark: <G.Avatar name="Academy" isDecorative shape="square" size="sm" /> },
  ];
  const workspaceSection: G.DropdownMenuSection = { kind: 'section', id: 'workspaces', label: 'Workspaces', selection: { mode: 'single', selectedIds: [workspace], onChange: (ids) => { const id = ids[0]; if (id !== undefined) setWorkspace(id); } }, items: workspaceItems };
  const languageControl = <G.DropdownMenu trigger={<G.IconButton source={LanguageGlyph} label="Language" size="control" variant="tertiary" />} entries={[{ kind: 'section', id: 'language', selection: { mode: 'single', selectedIds: [language], onChange: (ids) => { const id = ids[0]; if (id !== undefined) setLanguage(id); } }, items: [{ id: 'vi', label: new Intl.DisplayNames(['vi'], { type: 'language' }).of('vi') ?? 'Vietnamese' }, { id: 'en', label: new Intl.DisplayNames(['en'], { type: 'language' }).of('en') ?? 'English' }] }]} />;
  const themeControl = <G.Switch label="Dark mode" isLabelHidden size="control" thumbIcon={SunGlyph} selectedThumbIcon={MoonGlyph} isSelected={dark} onSelectedChange={setDark} />;
  const drawerContent = <G.Sidebar presentation="drawer" label="Workspace" groups={groups} selectedKey={selected} onAction={(id) => { setSelected(id); setDrawerOpen(false); }} footer={<div className="app-shell-story-drawer-controls">{languageControl}{themeControl}</div>} />;
  const mobileNavigation: Pick<G.WorkspaceShellProps, 'compactHeader' | 'navigationDrawer'> = navigationMode === 'slot' ? {
    compactHeader: <G.Drawer title="Navigation" closeLabel="Close navigation" placement="left" isOpen={drawerOpen} onOpenChange={setDrawerOpen} trigger={<G.IconButton label="Open navigation" source={EllipsisGlyph} size="control" variant="tertiary" aria-expanded={drawerOpen} />}>{drawerContent}</G.Drawer>,
  } : {
    navigationDrawer: { title: 'Navigation', openLabel: 'Open navigation', closeLabel: 'Close navigation', source: EllipsisGlyph, isOpen: drawerOpen, onOpenChange: setDrawerOpen, content: drawerContent },
  };

  return <G.GrammarRoot {...scope} theme={dark ? 'dark' : 'light'} data-contract="FE-APP-SHELL-1 FE-APP-SHELL-2 FE-APP-SHELL-3 FE-APP-SHELL-4 FE-APP-SHELL-5 FE-APP-SHELL-6">
    <G.WorkspaceShell
      viewport="fixed"
      header={<div className="app-shell-story-navbar">
        <div className="app-shell-story-identity"><G.DropdownMenu trigger={<G.IdentityLockup title={workspace === 'studio' ? 'Studio' : 'Academy'} subtitle="Owner" size="control" />} entries={[workspaceSection]} /></div>
        <div className="app-shell-story-search">
          <div className="app-shell-story-desktop-search"><G.Button size="control" variant="tertiary" startContent={<G.Icon source={SearchGlyph} usage="leading" />} endContent={<G.Kbd keys={['Ctrl', 'K']} />} onPress={() => setSearchOpen(true)}>Search</G.Button></div>
          <div className="app-shell-story-mobile-search"><G.IconButton size="control" label="Search (Ctrl K)" source={SearchGlyph} onPress={() => setSearchOpen(true)} /></div>
        </div>
        <div className="app-shell-story-actions">
          <div className="app-shell-story-desktop-controls">{languageControl}{themeControl}</div>
          <G.Popover title="Notifications" trigger={<G.IconButton source={BellGlyph} label="Notifications" size="control" badge={3} badgeLabel="3 unread notifications" />}><G.Text>Three conversations need your attention.</G.Text></G.Popover>
          <G.DropdownMenu placement="bottom end" trigger={<G.AvatarButton name="Alex Morgan" seed={userId} size="control" />} entries={[workspaceSection, { kind: 'section', id: 'account', label: 'Account', items: [{ id: 'profile', label: 'Alex Morgan', description: 'alex@example.com · Owner', iconSource: UserGlyph }] }, { id: 'sign-out', label: 'Sign out', iconSource: UserGlyph, tone: 'danger' }]} />
        </div>
      </div>}
      navigation={<G.Sidebar label="Workspace" groups={groups} selectedKey={selected} isCollapsed={collapsed} onCollapsedChange={changeCollapsed} collapseLabel="Collapse sidebar" expandLabel="Expand sidebar" toggleSource={MenuGlyph} onAction={setSelected} />}
      navigationLabel="Workspace navigation"
      navigationTrack="intrinsic"
      navigationVisibility="wide"
      {...mobileNavigation}
      primaryLabel="Workspace content"
      primary={<G.Page header={{ title: 'Conversations', description: 'The sidebar and the page scroll independently. Collapse the sidebar, hover or focus an icon, and inspect its unread count.', actions: <G.Button variant="primary">Create conversation</G.Button> }}><div className="app-shell-story-content"><G.SurfaceCard label="Latest activity"><G.Text>Page actions stay with the page heading.</G.Text></G.SurfaceCard></div></G.Page>}
    />
    <G.Dialog title="Search workspace" closeLabel="Close search" isOpen={searchOpen} onOpenChange={setSearchOpen}><G.SearchField label="Search" isLabelHidden placeholder="Search conversations" size="control" autoFocus /></G.Dialog>
  </G.GrammarRoot>;
};
