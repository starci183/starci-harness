import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { userEvent, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import { Matrix, SettingsGlyph, SignOutGlyph, State, TrashGlyph, UserGlyph, noop } from './fixtures.js';

/**
 * Overlays and feedback. Every overlay story opens by default so the surface is visible, and every
 * overlay portals into the nearest `.grammar-common-root` — the toolbar family root here — so the
 * family scope, tokens and theme still apply to it. `Toaster` must likewise be mounted inside the root.
 */
const meta: Meta = {
  title: 'Overlays',
};
export default meta;

type Story = StoryObj;

const openParameters = { grammar: { minHeight: '38rem' } };

export const Alert: Story = {
  render: () => (
    <Matrix maxWidth={560}>
      <State label="Tones" direction="column">
        <G.Alert title="Heads up" description="Informative is the default tone." />
        <G.Alert tone="affirmative" title="Saved" description="Your changes are live." />
        <G.Alert tone="cautionary" title="Almost full" description="You have used 90% of your storage." />
        <G.Alert tone="negative" title="Payment failed" description="Update the card on file to keep access." />
        <G.Alert tone="neutral" title="Neutral notice" />
      </State>
      <State label="Pending" direction="column">
        <G.Alert tone="pending" title="Syncing" description="This can take a minute." />
      </State>
      <State label="Soft appearance (tone soft tint at half strength, no shadow)" direction="column">
        <G.Alert appearance="soft" title="Heads up" description="Informative, soft." />
        <G.Alert appearance="soft" tone="affirmative" title="Saved" description="Your changes are live." />
        <G.Alert appearance="soft" tone="cautionary" title="Almost full" description="You have used 90% of your storage." action={{ label: 'Upgrade', onAction: noop }} />
        <G.Alert appearance="soft" tone="negative" title="Payment failed" description="Update the card on file to keep access." />
        <G.Alert appearance="soft" tone="neutral" title="Neutral notice" />
      </State>
      <State label="With action and dismiss" direction="column">
        <G.Alert tone="cautionary" title="New version available" action={{ label: 'Reload', onAction: noop }} dismissLabel="Dismiss" onDismiss={noop} />
      </State>
      <State label="Action variant by tone (accent primary, danger danger, else secondary)" direction="column">
        <G.Alert title="Update available" description="A new version is ready." action={{ label: 'Refresh', onAction: noop }} />
        <G.Alert tone="negative" title="Unable to connect" description="Check your connection." action={{ label: 'Retry', onAction: noop }} />
        <G.Alert tone="affirmative" title="Saved" action={{ label: 'View', onAction: noop }} />
      </State>
      <State label="Action with a start icon" direction="column">
        <G.Alert tone="cautionary" title="A capability is off" description="Turn it back on to answer order questions." action={{ label: 'Enable', onAction: noop, icon: SettingsGlyph }} />
      </State>
    </Matrix>
  ),
};

export const Dialog: Story = {
  parameters: openParameters,
  render: () => (
    <G.Dialog
      defaultOpen
      title="Rename project"
      description="The new name is visible to everyone on the team."
      closeLabel="Close"
      trigger={<G.Button variant="secondary">Rename project</G.Button>}
      footer={(close) => (
        <>
          <G.Button variant="ghost" onPress={close}>Cancel</G.Button>
          <G.Button variant="primary" onPress={close}>Save</G.Button>
        </>
      )}
    >
      <G.Input id="dialog-name" name="name" label="Project name" defaultValue="Quarterly plan" />
    </G.Dialog>
  ),
};

const ControlledDialogDemo = () => {
  const [open, setOpen] = useState(true);
  return (
    <>
      <G.Button variant="secondary" onPress={() => setOpen(true)}>Rename project</G.Button>
      <G.Dialog
        isOpen={open}
        onOpenChange={setOpen}
        title="Rename project"
        description="App state owns this dialog; it mounts no trigger child and no trigger root."
        closeLabel="Close"
        footer={(close) => <G.Button variant="primary" onPress={close}>Save</G.Button>}
      >
        <G.Input id="dialog-controlled-name" name="name" label="Project name" defaultValue="Quarterly plan" />
      </G.Dialog>
    </>
  );
};

export const DialogControlled: Story = {
  name: 'Dialog (controlled, no trigger)',
  parameters: openParameters,
  render: () => <ControlledDialogDemo />,
};

export const DialogSmallNotDismissable: Story = {
  name: 'Dialog (small, not dismissable)',
  parameters: openParameters,
  render: () => (
    <G.Dialog
      defaultOpen
      size="sm"
      isDismissable={false}
      isKeyboardDismissDisabled
      title="Session expired"
      description="Sign in again to continue."
      trigger={<G.Button>Show</G.Button>}
      footer={(close) => <G.Button variant="primary" width="fill" onPress={close}>Sign in</G.Button>}
    />
  ),
};

export const AlertDialog: Story = {
  parameters: openParameters,
  render: () => (
    <G.AlertDialog
      defaultOpen
      tone="negative"
      title="Delete this project?"
      description="Its lessons and history are removed for everyone. This cannot be undone."
      confirmLabel="Delete project"
      cancelLabel="Keep project"
      onConfirm={noop}
      trigger={<G.Button variant="outline">Delete project</G.Button>}
    />
  ),
};

const ControlledAlertDialogDemo = () => {
  const [open, setOpen] = useState(true);
  return (
    <>
      <G.Button variant="outline" onPress={() => setOpen(true)}>Delete project</G.Button>
      <G.AlertDialog
        isOpen={open}
        onOpenChange={setOpen}
        tone="negative"
        title="Delete this project?"
        description="App state owns this confirmation; it mounts no trigger child and no trigger root."
        confirmLabel="Delete project"
        cancelLabel="Keep project"
        onConfirm={noop}
      />
    </>
  );
};

export const AlertDialogControlled: Story = {
  name: 'AlertDialog (controlled, no trigger)',
  parameters: openParameters,
  render: () => <ControlledAlertDialogDemo />,
};

export const AlertDialogPending: Story = {
  name: 'AlertDialog (confirm pending)',
  parameters: openParameters,
  render: () => (
    <G.AlertDialog
      defaultOpen
      tone="cautionary"
      title="Leave the team?"
      description="You will lose access to shared projects."
      confirmLabel="Leave"
      cancelLabel="Stay"
      isConfirmPending
      onConfirm={noop}
      trigger={<G.Button variant="outline">Leave team</G.Button>}
    />
  ),
};

const FilterFields = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
    <G.CheckboxGroup
      label="Status"
      options={[{ value: 'active', label: 'Active' }, { value: 'draft', label: 'Draft' }, { value: 'archived', label: 'Archived' }]}
      defaultValue={['active']}
    />
    <G.Select label="Owner" options={[{ id: 'me', label: 'Me' }, { id: 'team', label: 'My team' }]} defaultValue="me" />
  </div>
);

export const Drawer: Story = {
  parameters: openParameters,
  render: () => (
    <G.Drawer
      defaultOpen
      placement="right"
      title="Filters"
      description="Narrow the list."
      closeLabel="Close filters"
      trigger={<G.Button variant="secondary">Filters</G.Button>}
      footer={(close) => (
        <>
          <G.Button variant="ghost" onPress={close}>Clear</G.Button>
          <G.Button variant="primary" onPress={close}>Apply</G.Button>
        </>
      )}
    >
      <FilterFields />
    </G.Drawer>
  ),
};

const ControlledDrawerDemo = () => {
  const [open, setOpen] = useState(true);
  return (
    <>
      <G.Button variant="secondary" onPress={() => setOpen(true)}>Filters</G.Button>
      <G.Drawer
        isOpen={open}
        onOpenChange={setOpen}
        placement="right"
        title="Filters"
        description="App state owns this drawer; it mounts no trigger child and no trigger root."
        closeLabel="Close filters"
        footer={(close) => <G.Button variant="primary" onPress={close}>Apply</G.Button>}
      >
        <FilterFields />
      </G.Drawer>
    </>
  );
};

export const DrawerControlled: Story = {
  name: 'Drawer (controlled, no trigger)',
  parameters: openParameters,
  render: () => <ControlledDrawerDemo />,
};

export const DrawerBottomSheet: Story = {
  name: 'Drawer (bottom sheet with handle)',
  parameters: openParameters,
  render: () => (
    <G.Drawer
      defaultOpen
      placement="bottom"
      showHandle
      title="Share"
      closeLabel="Close"
      trigger={<G.Button variant="secondary">Share</G.Button>}
    >
      <G.Text>Anyone with the link can view.</G.Text>
    </G.Drawer>
  ),
};

const MenuDemo = () => {
  const [sort, setSort] = useState<readonly string[]>(['recent']);
  const [language, setLanguage] = useState<readonly string[]>(['de']);
  const [view, setView] = useState<readonly string[]>(['list', 'preview']);
  return (
    <G.DropdownMenu
      defaultOpen
      trigger={<G.Button variant="secondary">Options</G.Button>}
      entries={[
        { id: 'profile', label: 'Profile', iconSource: UserGlyph, shortcut: ['command', 'P'] },
        { id: 'settings', label: 'Settings', iconSource: SettingsGlyph, description: 'Account and privacy' },
        { id: 'locked', label: 'Billing', isDisabled: true },
        {
          kind: 'section',
          id: 'sort',
          label: 'Sort by',
          selection: { mode: 'single', selectedIds: sort, onChange: setSort },
          items: [{ id: 'recent', label: 'Most recent' }, { id: 'name', label: 'Name' }],
        },
        {
          kind: 'section',
          id: 'view',
          label: 'Show (multiple selection)',
          selection: { mode: 'multiple', selectedIds: view, onChange: setView },
          items: [{ id: 'list', label: 'List' }, { id: 'preview', label: 'Preview' }, { id: 'hidden', label: 'Hidden files', isDisabled: true }],
        },
        {
          kind: 'section',
          id: 'language',
          label: 'Language',
          selection: { mode: 'single', selectedIds: language, onChange: setLanguage },
          items: [{ id: 'de', label: 'Deutsch' }, { id: 'en', label: 'English' }],
        },
        { kind: 'section', id: 'danger', items: [{ id: 'delete', label: 'Delete', tone: 'danger', iconSource: TrashGlyph }] },
      ]}
      onAction={noop}
    />
  );
};

/** HeroUI's Dropdown docs examples in one menu: icons, descriptions, shortcuts, sections, single and multiple selection, a danger item. */
export const DropdownMenu: Story = {
  parameters: openParameters,
  render: () => <MenuDemo />,
};

const workspaceMark = (
  <svg viewBox="0 0 32 32" fill="currentColor">
    <path d="M4 4h10v10H4zm14 0h10v10H18zM4 18h10v10H4zm14 0h10v10H18z" />
  </svg>
);

const wideMark = (
  <svg viewBox="0 0 48 24" fill="currentColor">
    <path d="M0 0h20v24H0zm28 0h20v24H28z" />
  </svg>
);

export const DropdownMenuMarks: Story = {
  name: 'DropdownMenu (marks share the icon slot)',
  parameters: openParameters,
  render: () => (
    <G.DropdownMenu
      defaultOpen
      trigger={<G.Button variant="secondary">Workspace</G.Button>}
      entries={[
        { id: 'studio', label: 'Studio', mark: workspaceMark },
        { id: 'design', label: 'Design team', description: 'Wide artwork stays contained', mark: wideMark },
        { id: 'archived', label: 'Archived workspace', mark: workspaceMark, isDisabled: true },
        { id: 'settings', label: 'Settings', description: 'A glyph uses the same size and alignment', iconSource: SettingsGlyph },
      ]}
      onAction={noop}
    />
  ),
};

const AvatarMenuDemo = () => {
  const [workspace, setWorkspace] = useState<readonly string[]>(['hakuen']);
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <G.DropdownMenu
        defaultOpen
        placement="bottom end"
        trigger={<G.AvatarButton name="Alex Morgan" />}
        entries={[
          {
            kind: 'section',
            id: 'workspace',
            label: 'Workspace',
            selection: { mode: 'single', selectedIds: workspace, onChange: setWorkspace },
            items: [
              { id: 'hakuen', label: 'Hakuen', description: 'Owner', mark: <G.Avatar name="Hakuen" size="sm" shape="rounded" isDecorative /> },
              { id: 'tedo', label: 'Tedo Studio', description: 'Member', mark: <G.Avatar name="Tedo Studio" size="sm" shape="rounded" isDecorative /> },
            ],
          },
          {
            kind: 'section',
            id: 'account',
            items: [
              { id: 'profile', label: 'Profile', description: 'Name, photo and language', iconSource: UserGlyph },
              { id: 'settings', label: 'Settings', description: 'Account and privacy', iconSource: SettingsGlyph },
            ],
          },
          { kind: 'section', id: 'session', items: [{ id: 'sign-out', label: 'Sign out', tone: 'danger', iconSource: SignOutGlyph }] },
        ]}
        onAction={noop}
      />
    </div>
  );
};

/**
 * The entry model on an avatar menu: a workspace section (single selection, an identity in the `mark` slot), an account section
 * (a Heroicons glyph and a description) and sign out (`tone: 'danger'` with a glyph). Grammar puts HeroUI's own `Separator` between the
 * sections, draws the glyph in the leading position at 20px (size-5) and the selection check where HeroUI puts it; the app passes no
 * separator, no className and no size.
 */
export const DropdownMenuAvatar: Story = {
  name: 'DropdownMenu (avatar menu: workspace, account, sign out)',
  parameters: openParameters,
  render: () => <AvatarMenuDemo />,
};

export const Popover: Story = {
  parameters: openParameters,
  render: () => (
    <div style={{ paddingTop: '1rem' }}>
      <G.Popover
        defaultOpen
        showArrow
        title="Keyboard shortcuts"
        trigger={<G.Button variant="secondary">Shortcuts</G.Button>}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <G.Text size="sm">Search <G.Kbd keys={['command', 'K']} /></G.Text>
          <G.Text size="sm">New lesson <G.Kbd keys={['command', 'N']} /></G.Text>
        </div>
      </G.Popover>
    </div>
  ),
};

export const DisabledButtonReason: Story = {
  name: 'Tooltip (disabled Button with a reason)',
  render: () => (
    <Matrix>
      <State label="disabledReason: hover or focus the wrapper for the words; they are also its accessible description">
        <div style={{ paddingTop: '2.5rem' }}>
          <G.Button intent="commit" isDisabled disabledReason="Add a title before publishing." onPress={noop}>Publish</G.Button>
        </div>
      </State>
      <State label="Full width">
        <div style={{ paddingTop: '2.5rem', width: '16rem' }}>
          <G.Button intent="commit" width="fill" isDisabled disabledReason="Pick a plan first." onPress={noop}>Continue</G.Button>
        </div>
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    const root = canvasElement.closest('.grammar-common-root') ?? document.body;
    const tooltipText = () => [...root.ownerDocument.querySelectorAll('[role="tooltip"]')].map((tip) => tip.textContent).join('|');
    const wrappers = [...canvasElement.querySelectorAll<HTMLElement>('[data-grammar-tooltip-disabled-trigger="true"]')];
    if (wrappers.length !== 2) throw new Error('Both disabled Buttons must sit in a tooltip trigger');
    for (const wrapper of wrappers) {
      const button = wrapper.querySelector<HTMLElement>('[data-component="Button"]');
      if (button === null) throw new Error('The wrapper must hold the Button');
      // The focus ring is drawn on the wrapper, so it must take the Button's shape.
      if (getComputedStyle(wrapper).borderTopLeftRadius !== getComputedStyle(button).borderTopLeftRadius) throw new Error(`Wrapper radius ${getComputedStyle(wrapper).borderTopLeftRadius} differs from the Button's ${getComputedStyle(button).borderTopLeftRadius}`);
    }
    const [first, second] = wrappers;
    if (first === undefined || second === undefined) throw new Error('Both wrappers must render');
    // React Aria opens a tooltip on hover only once the pointer has moved (pointer modality), as a real mouse does.
    await userEvent.hover(canvasElement);
    await userEvent.hover(first);
    await waitFor(() => { if (!tooltipText().includes('Add a title before publishing.')) throw new Error('Hover must show the reason'); });
    await userEvent.unhover(first);
    await waitFor(() => { if (tooltipText().includes('Add a title before publishing.')) throw new Error('Leaving must hide the reason'); });
    // Tab to the second wrapper: the platform skips the disabled Buttons, the wrappers take the keyboard stops.
    first.focus();
    await userEvent.tab();
    if (canvasElement.ownerDocument.activeElement !== second) throw new Error('Tab must move from one disabled Button wrapper to the next');
    await waitFor(() => { if (!tooltipText().includes('Pick a plan first.')) throw new Error('Keyboard focus must show the reason'); });
    second.blur();
  },
};

export const Tooltip: Story = {
  render: () => (
    <Matrix>
      <State label="Top (revealed on focus)">
        <div style={{ paddingTop: '2.5rem' }}>
          <G.Tooltip content="Search everything" placement="top">
            <G.Button variant="secondary">Search</G.Button>
          </G.Tooltip>
        </div>
      </State>
      <State label="Bottom">
        <G.Tooltip content="Open settings" placement="bottom">
          <G.IconButton source={SettingsGlyph} label="Settings" />
        </G.Tooltip>
      </State>
    </Matrix>
  ),
  play: ({ canvasElement }) => {
    const trigger = canvasElement.querySelector<HTMLElement>('[data-grammar-tooltip-trigger] button');
    trigger?.focus();
  },
};

const record = (id: string, options: G.ToastOptions): G.ToastRecord => ({ ...options, id, version: 1 });

export const Toast: Story = {
  render: () => (
    <Matrix maxWidth={420}>
      <State label="Tones" direction="column">
        <G.Toast toast={record('t1', { title: 'Saved', tone: 'affirmative', timeout: 0 })} dismissLabel="Dismiss" onDismiss={noop} />
        <G.Toast toast={record('t2', { title: 'Link copied', description: 'Paste it anywhere.', tone: 'informative', timeout: 0 })} dismissLabel="Dismiss" onDismiss={noop} />
        <G.Toast toast={record('t3', { title: 'Storage almost full', tone: 'cautionary', timeout: 0 })} dismissLabel="Dismiss" onDismiss={noop} />
        <G.Toast toast={record('t4', { title: 'Upload failed', description: 'Check your connection.', tone: 'negative', timeout: 0 })} dismissLabel="Dismiss" onDismiss={noop} />
      </State>
      <State label="Pending and with action" direction="column">
        <G.Toast toast={record('t5', { title: 'Uploading 3 files', tone: 'pending', timeout: 0 })} dismissLabel="Dismiss" onDismiss={noop} />
        <G.Toast toast={record('t6', { title: 'Lesson archived', tone: 'neutral', timeout: 0, action: { label: 'Undo', onAction: noop } })} dismissLabel="Dismiss" onDismiss={noop} />
      </State>
    </Matrix>
  ),
};

const seededQueue = () => {
  const queue = G.createToastQueue();
  queue.add({ title: 'Draft saved', tone: 'affirmative', timeout: 0 });
  queue.add({ title: 'Connection lost', description: 'Retrying in 5 seconds.', tone: 'negative', timeout: 0, action: { label: 'Retry', onAction: noop } });
  return queue;
};

const ToasterDemo = () => {
  const [queue] = useState(seededQueue);
  return (
    <div style={{ display: 'flex', gap: '0.75rem' }}>
      <G.Button variant="secondary" onPress={() => queue.add({ title: 'Reminder set', tone: 'informative' })}>Add toast</G.Button>
      <G.Button variant="ghost" onPress={() => queue.clear()}>Clear</G.Button>
      <G.Toaster label="Notifications" dismissLabel="Dismiss notification" queue={queue} placement="bottom-end" />
    </div>
  );
};

export const Toaster: Story = {
  parameters: openParameters,
  render: () => <ToasterDemo />,
};
