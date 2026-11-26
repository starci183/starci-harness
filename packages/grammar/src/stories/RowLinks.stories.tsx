import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn, userEvent, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * ROW LINKS (0.39.4): a row (or a `ListBox` item) with an `href` is a real link in every layout. A `DataTable` row is the vendor row (one keyboard stop, Enter navigates through
 * `GrammarRoot`'s router) with the row-header content as a real `<a>` stretched over it; at phone width (the list layout) the title is the anchor, stretched over the row;
 * a `ListBox` link item is `<a role="option">`. Each is an anchor (middle-click, copy-link, the modifier click open a new tab), a plain click or Enter navigates once through the router,
 * and the focus ring shows on keyboard focus. An item is either selectable or a link: link items belong to a `selectionMode="none"` list.
 */
const meta: Meta = {
  title: 'Surfaces/Row links (0.39.4)',
  parameters: { grammar: { bleed: false } },
};
export default meta;
type Story = StoryObj;

type Invoice = G.DataTableRow & { readonly name: string; readonly due: string; readonly amount: string };
const invoices: ReadonlyArray<Invoice> = [
  { id: 'a', href: '/invoices/a', name: 'INV-0140 Acme', due: '12/11', amount: '1,200.00' },
  { id: 'b', href: '/invoices/b', name: 'INV-0141 Globex', due: '14/11', amount: '4,200.00' },
];

const isPhone = (): boolean => window.matchMedia('(max-width: 767.98px)').matches;

const navigate = fn();

const Table = () => (
  <G.GrammarRoot navigate={navigate}>
    <div style={{ width: 'min(640px, 100%)' }}>
      <G.DataTable<Invoice>
        label="Invoices"
        columns={[{ id: 'name', label: 'Invoice', isRowHeader: true }, { id: 'due', label: 'Due' }, { id: 'amount', label: 'Amount', align: 'end' }]}
        rows={invoices}
        renderCell={(row, column) => column === 'name' ? row.name : column === 'due' ? row.due : row.amount}
        emptyContent="No invoices"
      />
    </div>
  </G.GrammarRoot>
);

/** The table layout (from 768 px) and the list layout (under it) both render each row's `href` as an anchor; a click and Enter navigate once through the router. */
export const DataTableRowIsALink: Story = {
  render: () => <Table />,
  play: async ({ canvasElement }) => {
    navigate.mockClear();
    const anchors = await waitFor(() => {
      const found = [...canvasElement.querySelectorAll<HTMLAnchorElement>('a[data-grammar-table-row-anchor="true"]')];
      return found;
    });
    // Pointer: one navigation through the router, never a document load.
    await userEvent.click(anchors[0]!);
    navigate.mockClear();
    // Keyboard: the row (table) or the anchor (list) takes focus and Enter navigates.
    const stop = isPhone() ? anchors[1]! : canvasElement.querySelector<HTMLElement>('tr[data-grammar-table-row-link="true"][data-key="b"], tr[data-grammar-table-row-link="true"]:nth-of-type(2)')!;
    stop.focus();
    await userEvent.keyboard('{Enter}');
  },
};

const Mail = ({ selectionMode }: { readonly selectionMode: 'none' | 'single' }) => (
  <G.GrammarRoot navigate={navigate}>
    <div style={{ width: 320 }}>
      {selectionMode === 'none' ? (
        <G.ListBox
          label="Mail"
          selectionMode="none"
          items={[
            { id: 'inbox', label: 'Inbox', href: '/mail/inbox', meta: '12' },
            { id: 'sent', label: 'Sent', href: '/mail/sent' },
            { id: 'draft', label: 'Drafts', isDisabled: true, href: '/mail/drafts' },
          ]}
        />
      ) : (
        <G.ListBox label="Pick" items={[{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }]} />
      )}
    </div>
  </G.GrammarRoot>
);

/** A `ListBox` link item is a real anchor with the `option` role: the destination in `href`, a click and Enter navigate through the router, and no selection indicator is drawn. */
export const ListBoxItemIsALink: Story = {
  render: () => <Mail selectionMode="none" />,
  play: async ({ canvasElement }) => {
    navigate.mockClear();
    const options = await waitFor(() => {
      const found = [...canvasElement.querySelectorAll<HTMLAnchorElement>('a[role="option"][data-grammar-list-link="true"]')];
      return found;
    });
    await userEvent.click(options[0]!);
    navigate.mockClear();
    options[1]!.focus();
    await userEvent.keyboard('{Enter}');
    // A disabled link is not followed.
    navigate.mockClear();
  },
};

/** A selecting list has no links: its options are `div`s that take the selection. */
export const ListBoxSelectionStaysSeparate: Story = {
  render: () => <Mail selectionMode="single" />,
};
