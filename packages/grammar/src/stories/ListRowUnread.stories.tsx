import type { Meta, StoryObj } from '@storybook/react-vite';
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

/** Two unread rows among read ones (pressable titles): strong weight and a dot on the title line, the read rows medium and no dot. */
export const Rows: Story = {
  render: () => <Page />,
};

/** A screen reader reads the label before an unread title; a read row has none. */
export const ReadAloud: Story = {
  render: () => <Page />,
};

/** The loading list draws the ready rows' geometry: no dot, the same title line. */
export const Loading: Story = {
  render: () => <Page isLoading />,
};
