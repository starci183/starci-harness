import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import { BellGlyph, noop } from './fixtures.js';

/**
 * THE ROW EDGE TONE (0.45.1). A `ListRow` (a `Section kind="list"` item, a `Board` item) and a `DataTable` row take `edgeTone` (`accent`, `success`, `warning`, `danger`): the
 * 2px bar a selected table row draws, on the row's start edge, in the theme token of the tone. It marks a row that waits for the reader or leads the list; the words stay in
 * the badge and the meta. A selected table row draws the accent bar over it.
 */
const meta: Meta = { title: 'Surfaces/Row edge tone (0.45.1)', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

const ROWS: readonly G.SectionRow[] = [
  { id: 'a', title: 'Send a quote of 8,640,000 VND to Thu Trang', description: 'Sales assistant, waits for you', leading: { icon: BellGlyph }, badges: [{ label: 'To approve', tone: 'warning' }], meta: { text: '2 h 58 min left' }, edgeTone: 'warning', onPress: noop },
  { id: 'b', title: 'Hoa Moc Spa', description: 'Opened most recently', leading: { icon: BellGlyph }, meta: { text: '5 min ago' }, edgeTone: 'accent', onPress: noop },
  { id: 'c', title: 'Zalo OA lost its connection', description: 'Five retries failed', leading: { icon: BellGlyph }, edgeTone: 'danger', onPress: noop },
  { id: 'd', title: 'Booking synced', description: 'Calendar, 09:12', leading: { icon: BellGlyph }, edgeTone: 'success', onPress: noop },
  { id: 'e', title: 'Rate limiting', description: 'No edge' },
];

type Job = G.DataTableRow & { readonly title: string; readonly owner: string; readonly due: string };

const JOBS: readonly Job[] = [
  { id: 'j1', title: 'Send a quote to Thu Trang', owner: 'Sales assistant', due: '2 h 58 min', edgeTone: 'warning' },
  { id: 'j2', title: 'Refund a deposit to Quoc Bao', owner: 'Chatbot', due: '5 h', edgeTone: 'warning' },
  { id: 'j3', title: 'Read the November statement', owner: 'Accounting assistant', due: 'Stopped 08:30', edgeTone: 'danger' },
  { id: 'j4', title: 'Remind six customers', owner: 'Sales assistant', due: '7 h' },
];

const COLUMNS: readonly G.DataTableColumn<Job>[] = [
  { id: 'title', label: 'Job', isRowHeader: true, truncate: true },
  { id: 'owner', label: 'Owner', width: 'fit' },
  { id: 'due', label: 'Due', width: 'fit', align: 'end' },
];

const Page = () => (
  <G.Stack gap="region">
    <G.Section kind="list" title="Rows" count={ROWS.length} items={ROWS} empty={<G.EmptyNotice message="Nothing here." />} />
    <G.Section title="Jobs" count={JOBS.length}>
      <G.DataTable<Job>
        label="Jobs"
        columns={COLUMNS}
        rows={JOBS}
        renderCell={(row, columnId) => (columnId === 'title' ? row.title : columnId === 'owner' ? row.owner : row.due)}
        emptyContent={<G.EmptyNotice message="No jobs." />}
      />
    </G.Section>
  </G.Stack>
);

/** The bar sits on the row (a list row, a phone list row) or on its first cell (a table row). */
const edgeOf = (element: Element): string => {
  const own = getComputedStyle(element).boxShadow;
  if (own !== 'none') return own;
  const first = element.firstElementChild;
  return first === null ? 'none' : getComputedStyle(first).boxShadow;
};

/** Four tones on list rows and two on table rows (at 390 the table is a list and its rows draw the same bar). */
export const Rows: Story = {
  render: () => <Page />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const toned = [...canvasElement.querySelectorAll<HTMLElement>('[data-edge-tone]')];
      expect(toned.length).toBe(7);
      for (const row of toned) {
        const shadow = edgeOf(row);
        expect(shadow).toContain('inset');
        expect(shadow).toMatch(/2px 0px 0px 0px/);
      }
      expect(new Set(toned.map((row) => edgeOf(row))).size).toBeGreaterThanOrEqual(3);
      const plain = canvasElement.querySelector<HTMLElement>('[data-grammar-row-id="e"]');
      expect(plain === null ? 'none' : getComputedStyle(plain).boxShadow).toBe('none');
    }, { timeout: 4000 });
  },
};
