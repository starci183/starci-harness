import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import * as G from '../common/index.js';
import { AppShellDemo } from './AppShellDemo.js';
import {
  BellGlyph,
  ChartGlyph,
  FilterGlyph,
  SettingsGlyph,
  UploadGlyph,
  UserGlyph,
  noop,
  familyScope,
  pageLabel,
} from './fixtures.js';

/**
 * Settings and data-list stories explore content composition in the flow renderer. Mobile app
 * recipes reuse the fixed app shell with its left drawer. Overlays stay inside the family
 * GrammarRoot supplied by the preview decorator.
 */
const meta: Meta = {
  title: 'Compositions/Pages',
  parameters: { grammar: { bleed: true } },
};
export default meta;

type Story = StoryObj;

/* ------------------------------------------------------------------ settings form page */

const settingsNav: ReadonlyArray<G.SidebarGroup> = [
  {
    id: 'settings',
    label: 'Settings',
    items: [
      { id: 'profile', label: 'Profile', source: UserGlyph },
      { id: 'notifications', label: 'Notifications', source: BellGlyph },
      { id: 'billing', label: 'Billing', source: ChartGlyph },
      { id: 'advanced', label: 'Advanced', source: SettingsGlyph },
    ],
  },
];

const SettingsFormPage = () => {
  const [selected, setSelected] = useState('profile');
  const [saved, setSaved] = useState(false);
  return (
    <G.WorkspaceShell
      header={
        <G.TopBar
          position="static"
          brand={<G.Link href="#home">Studio</G.Link>}
          actions={<G.Avatar name="Alex Morgan" size="sm" />}
        />
      }
      navigation={<G.Sidebar label="Settings sections" groups={settingsNav} selectedKey={selected} onAction={setSelected} />}
      navigationLabel="Settings"
      primaryLabel="Profile settings"
      primary={
        <G.Page
          measure="reading"
          header={{
            breadcrumbs: { label: 'Breadcrumb', items: [{ id: 'settings', label: 'Settings', href: '#settings' }, { id: 'profile', label: 'Profile' }] },
            title: 'Profile',
            description: 'How you appear to other people in this workspace.',
          }}
        >
            {saved ? <G.Alert tone="affirmative" title="Profile saved" dismissLabel="Dismiss" onDismiss={() => setSaved(false)} /> : null}
            <G.Form label="Profile settings" onSubmit={() => setSaved(true)}>
              <G.SurfaceCard label="Public profile" headingLevel={2}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <G.Input id="settings-name" name="name" label="Display name" defaultValue="Alex Morgan" isRequired />
                  <G.Input id="settings-email" name="email" label="Email" kind="email" defaultValue="alex@example.test" isError errorMessage="Verify this address before saving." />
                  <G.Textarea name="bio" label="Bio" description="A sentence or two." rows={3} defaultValue="Learning something new every week." />
                  <G.FileDropzone label="Photo" prompt="Drop an image or browse" accept="image/*" icon={<G.Icon source={UploadGlyph} usage="heading" />} />
                </div>
              </G.SurfaceCard>
              <G.SurfaceCard label="Preferences" headingLevel={2}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <G.Select name="language" label="Language" options={[{ id: 'en', label: 'English' }, { id: 'vi', label: 'Ti\u1ebfng Vi\u1ec7t' }, { id: 'fr', label: 'Français' }]} defaultValue="en" />
                  <G.SegmentedControl name="theme" label="Appearance" options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} defaultValue="system" />
                  <G.RadioGroup name="digest" label="Email digest" orientation="horizontal" options={[{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'never', label: 'Never' }]} defaultValue="weekly" />
                  <G.Switch name="reminders" label="Study reminders" defaultSelected />
                  <G.TimeField name="reminderTime" label="Reminder time" isDisabled />
                </div>
              </G.SurfaceCard>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <G.Button type="reset" variant="ghost">Cancel</G.Button>
                <G.Button type="submit" variant="primary">Save changes</G.Button>
              </div>
            </G.Form>
            <G.SurfaceCard label="Danger zone" headingLevel={2} state="negative">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <G.Text tone="muted">Delete the account and every lesson record.</G.Text>
                <G.AlertDialog
                  tone="negative"
                  title="Delete your account?"
                  description="This cannot be undone."
                  confirmLabel="Delete account"
                  cancelLabel="Keep account"
                  onConfirm={noop}
                  trigger={<G.Button variant="outline">Delete account</G.Button>}
                />
              </div>
            </G.SurfaceCard>
        </G.Page>
      }
    />
  );
};

/* ------------------------------------------------------------------ data list page */

type Member = { readonly id: string; readonly name: string; readonly role: string; readonly status: string; readonly joined: string };
const ROLES = ['Owner', 'Editor', 'Viewer'] as const;
const STATUSES = ['Active', 'Invited', 'Suspended'] as const;
const NAMES = ['Alex Morgan', 'Sam Lee', 'Robin Park', 'Jordan Kim', 'Taylor Fox', 'Casey Wu', 'Riley Chen', 'Morgan Diaz', 'Avery Brooks', 'Quinn Patel', 'Jamie Ortiz', 'Drew Nguyen'];
const MEMBERS: ReadonlyArray<Member> = Array.from({ length: 36 }, (_, index) => ({
  id: `m${index + 1}`,
  name: `${NAMES[index % NAMES.length] ?? 'Member'} ${Math.floor(index / NAMES.length) + 1}`,
  role: ROLES[index % ROLES.length] ?? 'Viewer',
  status: STATUSES[index % 5 === 0 ? 1 : index % 7 === 0 ? 2 : 0] ?? 'Active',
  joined: `2026-0${(index % 9) + 1}-1${index % 10}`,
}));

const memberColumns: ReadonlyArray<G.DataTableColumn> = [
  { id: 'name', label: 'Name', isRowHeader: true, allowsSorting: true },
  { id: 'role', label: 'Role', allowsSorting: true },
  { id: 'status', label: 'Status' },
  { id: 'joined', label: 'Joined', align: 'end', allowsSorting: true },
];

const statusTone = (status: string): G.BadgeTone => (status === 'Active' ? 'success' : status === 'Invited' ? 'accent' : 'danger');

const PAGE_SIZE = 8;

const DataListPage = () => {
  const [query, setQuery] = useState('');
  const [roles, setRoles] = useState<ReadonlyArray<string>>([]);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<G.DataTableSort>({ columnId: 'name', direction: 'ascending' });
  const [drawerOpen, setDrawerOpen] = useState(false);

  const filtered = MEMBERS.filter(
    (member) => member.name.toLowerCase().includes(query.toLowerCase()) && (roles.length === 0 || roles.includes(member.role)),
  ).sort((a, b) => {
    const key = sort.columnId as keyof Member;
    const order = a[key].localeCompare(b[key]);
    return sort.direction === 'ascending' ? order : -order;
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return (
    <G.WorkspaceShell
      header={<G.TopBar position="static" brand={<G.Link href="#home">Studio</G.Link>} actions={<G.Avatar name="Alex Morgan" size="sm" />} />}
      primaryLabel="Members"
      primary={
        <G.Page header={{ title: 'Members', description: `${filtered.length} people in this workspace.`, actions: <G.Button variant="primary">Invite</G.Button> }}>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 16rem' }}>
                <G.SearchField label="Search members" isLabelHidden placeholder="Search by name" value={query} onValueChange={(value) => { setQuery(value); setPage(1); }} clearLabel="Clear search" />
              </div>
              <G.Drawer
                isOpen={drawerOpen}
                onOpenChange={setDrawerOpen}
                placement="right"
                title="Filter members"
                closeLabel="Close filters"
                trigger={<G.Button variant="secondary" startContent={<G.Icon source={FilterGlyph} usage="leading" />}>Filters{roles.length === 0 ? '' : ` (${roles.length})`}</G.Button>}
                footer={(close) => (
                  <>
                    <G.Button variant="ghost" onPress={() => { setRoles([]); setPage(1); }}>Clear</G.Button>
                    <G.Button variant="primary" onPress={close}>Show results</G.Button>
                  </>
                )}
              >
                <G.CheckboxGroup
                  label="Role"
                  options={ROLES.map((role) => ({ value: role, label: role }))}
                  value={roles}
                  onValueChange={(value) => { setRoles(value); setPage(1); }}
                />
              </G.Drawer>
            </div>
            {roles.length === 0 ? null : (
              <G.TagGroup
                label="Active filters"
                items={roles.map((role) => ({ id: role, label: role }))}
                onRemove={(ids) => setRoles((currentRoles) => currentRoles.filter((role) => !ids.includes(role)))}
                removeLabel={(label) => `Remove ${label} filter`}
              />
            )}
            <G.DataTable
              label="Members"
              columns={memberColumns}
              rows={rows}
              sort={sort}
              onSortChange={setSort}
              renderCell={(row, columnId) =>
                columnId === 'status' ? <G.Badge tone={statusTone(row.status)}>{row.status}</G.Badge> : row[columnId as keyof Member]
              }
              emptyContent={<G.EmptyNotice message="No members match." description="Try a different search or clear the filters." />}
            />
            <G.Pagination
              label="Member pages"
              page={current}
              pageCount={pageCount}
              onPageChange={setPage}
              previousLabel="Previous"
              nextLabel="Next"
              pageLabel={pageLabel}
              summary={`Showing ${rows.length} of ${filtered.length}`}
            />
        </G.Page>
      }
    />
  );
};

/* ------------------------------------------------------------------ mobile app shell */

const renderAppShell: NonNullable<Story['render']> = (_, { globals }) => <AppShellDemo initialCollapsed={false} navigationMode="slot" initialDark={globals['grammarTheme'] === 'dark'} scope={familyScope(globals)} />;

export const FixedAppShell360: Story = {
  name: 'Fixed app shell (360px)',
  parameters: {
    viewport: { options: { phone360: { name: 'Phone 360 x 740', styles: { width: '360px', height: '740px' }, type: 'mobile' } } },
  },
  globals: { viewport: { value: 'phone360', isRotated: false } },
  render: renderAppShell,
};

/* ------------------------------------------------------------------ stories per family */

const mobile = { viewport: { value: 'mobile2', isRotated: false } };

export const CoreSettings: Story = { name: 'Core · Settings form', globals: { grammarFamily: 'core' }, render: () => <SettingsFormPage /> };
export const CoreDataList: Story = { name: 'Core · Data list with filter drawer', globals: { grammarFamily: 'core' }, render: () => <DataListPage /> };
export const CoreMobileHome: Story = { name: 'Core · Mobile app shell', globals: { grammarFamily: 'core', ...mobile }, render: renderAppShell };

export const OffsetPopSettings: Story = { name: 'Offset Pop · Settings form', globals: { grammarFamily: 'offset-pop' }, render: () => <SettingsFormPage /> };
export const OffsetPopDataList: Story = { name: 'Offset Pop · Data list with filter drawer', globals: { grammarFamily: 'offset-pop' }, render: () => <DataListPage /> };
export const OffsetPopMobileHome: Story = { name: 'Offset Pop · Mobile app shell', globals: { grammarFamily: 'offset-pop', ...mobile }, render: renderAppShell };
