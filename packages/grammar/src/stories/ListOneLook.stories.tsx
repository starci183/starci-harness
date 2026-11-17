import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import { noop } from './fixtures.js';

/**
 * ONE LOOK FOR A LIST (0.43.0, law DNA-COMMON-LIST-ONE-LOOK). A list is `Section kind="list"` of `ListRow`s: plain rows on whatever it stands
 * on, divided by hairlines, the row content on the section title's edge, with no frame, fill, radius or shadow, and no theme hook. The same
 * list on the page canvas and in a card body draws the same rows. A Board item is a real object, so it stays a card.
 */
const meta: Meta = { title: 'Surfaces/One look for a list (0.43.0)', parameters: { grammar: { bleed: true } } };
export default meta;
type Story = StoryObj;

const ROWS: readonly G.SectionRow[] = [
  { id: 'a', title: 'Request lifecycle', description: 'System Design, module 1', meta: { text: '12 min' }, onPress: noop },
  { id: 'b', title: 'Caching layers', description: 'System Design, module 2', badges: [{ label: 'New', tone: 'accent' }], onPress: noop },
  { id: 'c', title: 'Message queues', description: 'System Design, module 3', meta: { text: 'Overdue 1 day', tone: 'danger' }, onPress: noop },
  { id: 'd', title: 'Rate limiting', description: 'System Design, module 4' },
];

const FACTS: readonly G.SectionRow[] = [
  { id: 'owner', title: 'Owner', value: 'Maria Garcia' },
  { id: 'plan', title: 'Plan', value: 'Team, billed monthly' },
  { id: 'seats', title: 'Seats', value: '8 of 10' },
];

const COLUMNS: readonly G.BoardColumn[] = [
  { id: 'new', title: 'New', count: 2, empty: 'No customers', items: [{ id: 'g', title: 'Globex', description: 'Asked for a quote', onPress: noop }, { id: 'h', title: 'Acme', description: 'Wants two pots', onPress: noop }] },
  { id: 'proposal', title: 'Proposal', count: 1, empty: 'No customers', items: [{ id: 's', title: 'Sam Lee', description: '26,000.00', onPress: noop }] },
  { id: 'won', title: 'Won', count: 0, empty: 'No customers', items: [] },
];

const Page = () => (
  <G.Page header={{ title: 'Lists', description: 'One look for every list.' }}>
    <G.Stack gap="region">
      <G.Section
        kind="list"
        title="Backend foundations"
        count={4}
        action={<G.Link variant="head" href="#all">View all</G.Link>}
        caption="Updated at 10:00."
        items={ROWS}
        empty={<G.EmptyNotice message="Nothing yet." />}
      />
      <G.SurfaceCard label="Workspace" headers={[{ kind: 'figures', items: [{ id: 'm', term: 'Members', value: 8 }, { id: 'o', term: 'Open', value: 3 }, { id: 'd', term: 'Done', value: 12 }] }]}>
        <G.Section kind="list" layout="keyValue" ariaLabel="Workspace facts" items={FACTS} empty={null} />
      </G.SurfaceCard>
      <G.Section title="Sales pipeline">
        <G.Board label="Sales pipeline" columns={COLUMNS} />
      </G.Section>
    </G.Stack>
  </G.Page>
);

/** A titled list on the canvas, a key-value list in a card body and a Board: flat rows, hairlines, rows on the title's edge; Board items stay cards. */
export const ListAndBoard: Story = {
  render: () => <Page />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const lists = Array.from(canvasElement.querySelectorAll<HTMLElement>('.starci-core-section-list'));
      expect(lists.length).toBe(2);
      for (const list of lists) {
        const style = getComputedStyle(list);
        expect(style.boxShadow).toBe('none');
        expect(Number.parseFloat(style.borderTopWidth)).toBe(0);
        expect(Number.parseFloat(style.borderTopLeftRadius)).toBe(0);
        expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)');
        const rows = Array.from(list.querySelectorAll<HTMLElement>(':scope > .starci-core-list-row'));
        expect(Number.parseFloat(getComputedStyle(rows[1]!).borderTopWidth)).toBe(1);
      }
      const canvasList = lists[0]!;
      const heading = canvasList.closest('[data-component="Section"]')!.querySelector<HTMLElement>('.starci-core-section-title')!;
      const title = canvasList.querySelector<HTMLElement>('.starci-core-list-row-name')!;
      expect(Math.abs(title.getBoundingClientRect().left - heading.getBoundingClientRect().left)).toBeLessThanOrEqual(1);
      const item = canvasElement.querySelector<HTMLElement>('.starci-core-board-cards > .starci-core-list-row')!;
      expect(getComputedStyle(item).boxShadow).not.toBe('none');
      expect(Number.parseFloat(getComputedStyle(item).borderTopLeftRadius)).toBeGreaterThan(0);
    }, { timeout: 5000 });
  },
};
