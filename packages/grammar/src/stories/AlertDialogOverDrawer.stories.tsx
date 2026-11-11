import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * An alert dialog opened from a control inside a drawer stacks above that drawer: the confirmation is the view while it is open,
 * at every width. Every modal-level overlay of the Grammar (Dialog, AlertDialog, Drawer, a PaneGrid pane's drawer) sits on HeroUI's
 * `--z-index-overlay`, so the one opened last paints on top; the toaster sits on `--z-index-toast`, above them. At 390 a side drawer is
 * full width, so a dialog under its sheet could be neither seen nor answered.
 */
const meta: Meta = { title: 'Alert dialog over a drawer (0.37.38)', parameters: { grammar: { bleed: false } } };
export default meta;
type Story = StoryObj;

const noop = () => undefined;
const PHONE = { viewport: { value: 'phone375', isRotated: false } };

/**
 * The confirmation paints above its opener drawer: its backdrop's stacking level is at least the drawer's, and it comes later in the
 * Grammar root, so it paints on top. (`elementFromPoint` cannot judge it: the vendor's drawer content is `pointer-events: none`.)
 */
const dialogIsOnTop = () => {
  const alert = document.querySelector<HTMLElement>('.alert-dialog__backdrop');
  const drawer = document.querySelector<HTMLElement>('.drawer__backdrop');
  expect(alert).not.toBeNull();
  expect(drawer).not.toBeNull();
  expect(Number(getComputedStyle(alert!).zIndex)).toBeGreaterThanOrEqual(Number(getComputedStyle(drawer!).zIndex));
  expect(drawer!.compareDocumentPosition(alert!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
};

const confirm = (
  <G.AlertDialog
    tone="negative"
    title="Cancel order DH-0006?"
    description="The order and its reminders stop."
    confirmLabel="Cancel order"
    cancelLabel="Keep order"
    onConfirm={noop}
    trigger={<G.Button intent="destructive" step="entry" size="sm">Cancel order</G.Button>}
  />
);

const openAndCheck = async () => {
  const body = within(document.body);
  await userEvent.click(await body.findByRole('button', { name: 'Cancel order' }));
  await waitFor(dialogIsOnTop);
};

/** A plain `Drawer` holding the confirmation's trigger. */
const InDrawer = () => (
  <G.Drawer
    defaultOpen
    placement="right"
    title="Customer"
    description="Order DH-0006"
    closeLabel="Close customer"
    trigger={<G.Button intent="alternative">Customer</G.Button>}
  >
    {confirm}
  </G.Drawer>
);

/** A `PaneGrid` aside that collapses to a drawer below the wide width, opened, holding the confirmation's trigger. */
const InPaneDrawer = () => {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ height: '40rem', display: 'flex' }}>
      <G.PaneGrid label="Inbox" areas={['main aside']} columns={['fill', 'standard']}>
        <G.Pane area="main" scroll label="Conversation">
          <G.PaneSection><G.Text>Conversation</G.Text></G.PaneSection>
        </G.Pane>
        <G.Pane
          area="aside"
          surface
          scroll
          label="Customer"
          collapse="drawer"
          trigger="none"
          collapseLabel="Customer"
          closeLabel="Close customer"
          isOpen={open}
          onOpenChange={setOpen}
        >
          <G.PaneSection>{confirm}</G.PaneSection>
        </G.Pane>
      </G.PaneGrid>
    </div>
  );
};

export const DrawerAt390: Story = {
  name: 'Drawer: alert dialog opened inside it on a phone',
  globals: PHONE,
  render: () => <InDrawer />,
  play: openAndCheck,
};

export const PaneDrawerAt390: Story = {
  name: 'PaneGrid aside drawer: alert dialog opened inside it on a phone',
  globals: PHONE,
  render: () => <InPaneDrawer />,
  play: openAndCheck,
};
