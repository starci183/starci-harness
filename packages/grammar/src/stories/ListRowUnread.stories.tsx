import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import { BellGlyph, noop } from './fixtures.js';

/**
 * THE UNREAD ROW (0.46.0). A `ListRow` (a `Section kind="list"` item, a `Board` item) takes `emphasis: "unread"`: its title takes the strong weight and an accent dot follows it on the title
 * line, so the box of the row does not change; it is the fact of a `ListBox` item's `emphasis: "unread"` and has one look. The dot is decorative; `unreadLabel` is the word a screen reader
 * reads before the title. Evidence: NIVO console shell canvas, `GRAMMAR-GAPS.md` G3 (notifications panel and list).
 */
const meta: Meta = { title: 'Surfaces/Unread row (0.46.0)', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

const ROWS: readonly G.SectionRow[] = [
  { id: 'a', title: 'Send a quote of 8,640,000 VND to Thu Trang', description: 'Sales assistant, waits for you', leading: { icon: BellGlyph }, meta: { text: '2 min ago' }, emphasis: 'unread', unreadLabel: 'Unread', onPress: noop },
  { id: 'b', title: 'Booking synced', description: 'Calendar, 09:12', leading: { icon: BellGlyph }, meta: { text: '1 h ago' }, onPress: noop },
  { id: 'c', title: 'Zalo OA lost its connection, five retries failed and the customer messages are waiting', description: 'Connections', leading: { icon: BellGlyph }, badges: [{ label: 'Needs you', tone: 'warning' }], emphasis: 'unread', unreadLabel: 'Unread', onPress: noop },
  { id: 'd', title: 'Weekly report is ready', description: 'Reports', leading: { icon: BellGlyph }, meta: { text: 'Yesterday' }, onPress: noop },
];

const Page = ({ isLoading = false }: { readonly isLoading?: boolean }) => (
  <G.Section kind="list" title="Notifications" count={ROWS.length} items={ROWS} isLoading={isLoading} empty={<G.EmptyNotice message="Nothing here." />} />
);

const weight = (element: Element): number => Number(getComputedStyle(element).fontWeight);

/** Two unread rows among read ones (pressable titles): strong weight and a dot on the title line, the read rows medium and no dot. */
export const Rows: Story = {
  render: () => <Page />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const rows = [...canvasElement.querySelectorAll<HTMLElement>('[data-component="ListRow"]')];
      expect(rows).toHaveLength(4);
      const unread = rows.filter((row) => row.dataset['grammarEmphasis'] === 'unread');
      expect(unread.map((row) => row.dataset['grammarRowId'])).toEqual(['a', 'c']);
      for (const row of rows) {
        const name = row.querySelector<HTMLElement>('.starci-core-list-row-name');
        const control = name?.querySelector<HTMLElement>('button, a') ?? name;
        const dot = row.querySelector<HTMLElement>('[data-grammar-unread-dot]');
        expect(name).not.toBeNull();
        if (unread.includes(row)) {
          expect(weight(name as HTMLElement)).toBe(500);
          expect(weight(control as HTMLElement)).toBe(500);
          expect(dot).not.toBeNull();
          expect(dot?.getAttribute('aria-hidden')).toBe('true');
          expect(row.querySelector('.starci-core-list-row-title')?.contains(dot as HTMLElement)).toBe(true);
          expect(getComputedStyle(dot as HTMLElement).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
        } else {
          expect(weight(name as HTMLElement)).toBe(400);
          expect(dot).toBeNull();
        }
      }
    });
  },
};

/** A screen reader reads the label before an unread title; a read row has none. */
export const ReadAloud: Story = {
  render: () => <Page />,
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('[data-grammar-row-id="a"]')).not.toBeNull());
    expect(canvasElement.querySelector('[data-grammar-row-id="a"] [data-grammar-unread-label]')?.textContent).toBe('Unread: ');
    expect(canvasElement.querySelector('[data-grammar-row-id="c"] [data-grammar-unread-label]')?.textContent).toBe('Unread: ');
    expect(canvasElement.querySelector('[data-grammar-row-id="b"] [data-grammar-unread-label]')).toBeNull();
  },
};

/** The loading list draws the ready rows' geometry: no dot, the same title line. */
export const Loading: Story = {
  render: () => <Page isLoading />,
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelectorAll('[data-component="ListRow"][data-grammar-skeleton="true"]').length).toBe(4));
    expect(canvasElement.querySelector('[data-grammar-unread-dot]')).toBeNull();
  },
};
