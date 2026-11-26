import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import * as G from '../common/index.js';

/**
 * THE TABLE'S THREE ADDITIONS (0.46.2). `totals` is a row after the last row, its figures in the cells of their own columns and sticky at the foot of the scroll region over the
 * footer; a row `groundTone` paints the whole row with its tone's soft pair beside the 2px `edgeTone` bar; and on a phone list a long press on a row starts selecting.
 */
const meta: Meta = { title: 'Surfaces/Table totals, row ground and phone selection (0.46.2)', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

type Invoice = G.DataTableRow & { readonly customer: string; readonly status: string; readonly due: string; readonly amount: number; readonly paid: number };

const INVOICES: ReadonlyArray<Invoice> = [
  { id: 'i1', customer: 'Hoa Moc Spa', status: 'Paid', due: '02/11', amount: 4_900_000, paid: 4_900_000 },
  { id: 'i2', customer: 'Thu Trang Studio', status: 'Overdue', due: '03/11', amount: 8_640_000, paid: 0, groundTone: 'danger', edgeTone: 'danger' },
  { id: 'i3', customer: 'Minh Tran', status: 'Part paid', due: '04/11', amount: 3_200_000, paid: 1_000_000, groundTone: 'warning' },
  { id: 'i4', customer: 'Quoc Bao', status: 'Paid', due: '05/11', amount: 2_100_000, paid: 2_100_000, groundTone: 'success' },
  { id: 'i5', customer: 'Mai Phuong', status: 'Draft', due: '06/11', amount: 7_800_000, paid: 0, groundTone: 'accent' },
  { id: 'i6', customer: 'Lan Anh', status: 'Paid', due: '07/11', amount: 3_400_000, paid: 3_400_000 },
  { id: 'i7', customer: 'Hung Pham', status: 'Paid', due: '08/11', amount: 2_100_000, paid: 2_100_000 },
  { id: 'i8', customer: 'Chi Hanh', status: 'Paid', due: '09/11', amount: 1_500_000, paid: 1_500_000 },
];

const money = (value: number): string => `${value.toLocaleString('en-US')} VND`;

const COLUMNS: ReadonlyArray<G.DataTableColumn<Invoice>> = [
  { id: 'customer', label: 'Customer', isRowHeader: true },
  { id: 'status', label: 'Status' },
  { id: 'due', label: 'Due' },
  { id: 'amount', label: 'Amount', isNumeric: true },
  { id: 'paid', label: 'Paid', isNumeric: true },
];

const cell = (row: Invoice, columnId: string): string => {
  switch (columnId) {
    case 'customer': return row.customer;
    case 'status': return row.status;
    case 'due': return row.due;
    case 'amount': return money(row.amount);
    default: return money(row.paid);
  }
};

const TOTALS: G.DataTableTotals = {
  label: 'Total',
  values: { amount: money(INVOICES.reduce((sum, row) => sum + row.amount, 0)), paid: money(INVOICES.reduce((sum, row) => sum + row.paid, 0)) },
};

const Footer = () => (
  <G.Pagination label="Invoice pages" page={1} pageCount={3} onPageChange={() => undefined} previousLabel="Previous" nextLabel="Next" pageLabel={(n) => `Page ${n}`} summary="1-8 of 21 invoices" />
);

/**
 * A bounded table: the rows scroll in a 15rem body, the totals row stays at the foot of that body over the pager, and each figure stands under its own column (the right edges
 * match the rows'). At 390 the table is the phone list and the totals are its last item, each figure named by its column.
 */
export const Totals: Story = {
  render: () => (
    <div style={{ maxInlineSize: '64rem' }}>
      <G.Section title="Invoices" count={21}>
        <G.DataTable<Invoice> label="Invoices" columns={COLUMNS} rows={INVOICES} renderCell={cell} totals={TOTALS} maxBlockSize="15rem" stickyHeader footer={<Footer />} emptyContent="No invoices." />
      </G.Section>
    </div>
  ),
};

/** Totals in a table as tall as its rows, and the states that draw none: loading, an error and an empty table keep the totals out. */
export const TotalsStates: Story = {
  render: () => (
    <div style={{ maxInlineSize: '64rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <G.DataTable<Invoice> label="Ready" columns={COLUMNS} rows={INVOICES.slice(0, 3)} renderCell={cell} totals={TOTALS} emptyContent="No invoices." />
      <G.DataTable<Invoice> label="Loading" columns={COLUMNS} rows={INVOICES.slice(0, 3)} renderCell={cell} totals={TOTALS} isLoading emptyContent="No invoices." />
      <G.DataTable<Invoice> label="Empty" columns={COLUMNS} rows={[]} renderCell={cell} totals={TOTALS} emptyContent="No invoices." />
    </div>
  ),
};

/**
 * A row `groundTone` is the whole row in its tone's soft pair, beside the `edgeTone` bar (the overdue row draws both). The status stays a word in its cell. A plain row stays
 * unpainted. At 390 the phone list rows draw the same ground.
 */
export const RowGround: Story = {
  render: () => (
    <div style={{ maxInlineSize: '64rem' }}>
      <G.DataTable<Invoice> label="Invoices by status" columns={COLUMNS} rows={INVOICES.slice(0, 6)} renderCell={cell} emptyContent="No invoices." />
    </div>
  ),
};

const SelectableList = () => {
  const [selected, setSelected] = useState<ReadonlyArray<string> | 'all'>([]);
  return (
    <div style={{ maxInlineSize: '64rem' }}>
      <G.DataTable<Invoice>
        label="Invoices to send"
        columns={COLUMNS}
        rows={INVOICES.slice(0, 5)}
        renderCell={cell}
        selectionMode="multiple"
        selectedIds={selected}
        onSelectionChange={setSelected}
        selectAllLabel="Select all invoices"
        selectRowLabel={(row) => `Select ${row.customer}`}
        selectedCountLabel={(count) => `${count} selected`}
        phone="list"
        emptyContent="No invoices."
      />
    </div>
  );
};

const wait = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

const press = (target: Element, type: string, init: PointerEventInit = {}) => {
  const rect = target.getBoundingClientRect();
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerType: 'touch', clientX: rect.left + 20, clientY: rect.top + 10, ...init }));
};

/**
 * On a phone list a long press starts selecting: the row is selected, its checkbox shows, and from then on a press toggles a row instead of running its action. At 1440 the table
 * keeps its own selection checkboxes (the long press is the phone list's gesture).
 */
export const LongPressSelects: Story = {
  render: () => <SelectableList />,
  play: async ({ canvasElement }) => {
    // The list is drawn once the viewport is read (after mount): below 768px wait for it.
    const phone = window.innerWidth < 768;
    if (!phone) return;
    const rows = [...canvasElement.querySelectorAll<HTMLElement>('.starci-core-data-table-list-row')];
    // A short press selects nothing.
    press(rows[0] as HTMLElement, 'pointerdown');
    await wait(120);
    press(rows[0] as HTMLElement, 'pointerup');
    rows[0]?.click();
    // A long press selects the row and starts selecting.
    press(rows[1] as HTMLElement, 'pointerdown');
    await wait(650);
    press(rows[1] as HTMLElement, 'pointerup');
    rows[1]?.click();
    // While selecting, a press on another row toggles it.
    rows[3]?.click();
    // A drift cancels the press.
    press(rows[4] as HTMLElement, 'pointerdown');
    press(rows[4] as HTMLElement, 'pointermove', { clientX: rows[4]!.getBoundingClientRect().left + 120, clientY: rows[4]!.getBoundingClientRect().top + 60 });
    await wait(650);
    press(rows[4] as HTMLElement, 'pointerup');
  },
};
