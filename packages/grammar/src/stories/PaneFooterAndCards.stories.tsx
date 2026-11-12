import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import { noop } from './fixtures.js';

/**
 * 0.37.5: a SurfaceCard on a white ground is bordered (never refused), the header zones of a table card keep their seams, a Pane has a `footer` slot that holds the
 * pane's bottom while the body scrolls, a nested grid with `rows` keeps the height chain, and `measure="narrow"` caps an order card at 30rem.
 */
const meta: Meta = { title: 'Surfaces/Pane footer and white-ground cards', parameters: { layout: 'fullscreen' } };
export default meta;
type Story = StoryObj;

const ROWS = [
  { id: 'a', title: 'Email', description: 'Receives customer messages' },
  { id: 'b', title: 'Chat', description: 'Receives customer messages' },
];
const card = (label: string) => <G.SurfaceCard kind="list" label={label} items={ROWS} empty={<G.EmptyNotice message="Empty" />} />;

/** A `SurfaceCard` in a white aside and in an open drawer: 1px border, no shadow; on the pink well: shadow, no border. Development no longer throws. */
export const CardOnWhiteGround: Story = {
  render: () => (
    <div style={{ height: 420 }}>
      <G.PaneGrid label="Grounds" areas={['well aside']} columns={['fill', 'standard']}>
        <G.Pane area="well" label="Well"><G.PaneSection>{card('On pink')}</G.PaneSection></G.Pane>
        <G.Pane area="aside" surface label="Aside"><G.PaneSection>{card('On white')}</G.PaneSection></G.Pane>
      </G.PaneGrid>
      <G.Drawer title="Drawer" closeLabel="Close" isOpen onOpenChange={noop}>{card('In the drawer')}</G.Drawer>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const cardIn = (scope: Element | null) => scope?.querySelector<HTMLElement>('.starci-core-surface[data-grammar-surface-kind="list"]') ?? null;
      const well = cardIn(canvasElement.querySelector('[data-grammar-pane-area="well"]'));
      const aside = cardIn(canvasElement.querySelector('[data-grammar-pane-area="aside"]'));
      const drawer = cardIn(document.querySelector('.starci-core-drawer'));
      if (well === null || aside === null || drawer === null) throw new Error('the three cards render');
      expect(getComputedStyle(well).boxShadow).not.toBe('none');
      expect(Number.parseFloat(getComputedStyle(well).borderTopWidth)).toBe(0);
      for (const white of [aside, drawer]) {
        expect(getComputedStyle(white).boxShadow).toBe('none');
        expect(Number.parseFloat(getComputedStyle(white).borderTopWidth)).toBe(1);
      }
    });
  },
};

const COLUMNS: readonly G.TableColumnData[] = [{ id: 'name', label: 'Order ID' }, { id: 'total', label: 'Total', numeric: true }];

/** A table card with a search zone and a tabs zone over the white table body (0.37.8): a visible 1px seam under each zone. */
export const TableHeaderSeams: Story = {
  render: () => (
    <div style={{ width: 'min(100%, 720px)', padding: 24 }}>
      <G.SurfaceCard
        kind="table"
        label="Orders"
        columns={COLUMNS}
        rows={[{ id: 'r1', cells: { name: 'OR-1001', total: '120,000' } }]}
        empty={<G.EmptyNotice message="Empty" />}
        headers={[
          { kind: 'search', label: 'Search orders', value: '', onChange: noop, placeholder: 'Search orders' },
          { kind: 'filter', label: 'Status', items: [{ id: 'all', label: 'All' }, { id: 'paid', label: 'Paid' }], selectedKey: 'all', onSelect: noop, overflowLabel: 'More', moreLabel: (count: number) => `${count} filters` },
        ]}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const zones = Array.from(canvasElement.querySelectorAll<HTMLElement>('[data-grammar-zone]'));
      expect(zones.length).toBeGreaterThanOrEqual(2);
      for (const zone of zones) {
        const style = getComputedStyle(zone);
        expect(Number.parseFloat(style.borderBottomWidth)).toBeGreaterThan(0);
        expect(style.borderBottomColor).not.toBe('rgba(0, 0, 0, 0)');
      }
    });
  },
};

const longBody = Array.from({ length: 50 }, (_, index) => <G.Text key={index}>{`Line ${index + 1}`}</G.Text>);

/** `Pane footer`: the body scrolls, the footer holds the pane's bottom edge. */
export const PaneFooter: Story = {
  render: () => (
    <div style={{ height: 420 }}>
      <G.PaneGrid label="Footer" areas={['main']}>
        <G.Pane area="main" surface label="Main" footer={<G.PaneSection as="footer"><G.Input id="composer" name="composer" label="Message" kind="text" /></G.PaneSection>}>
          <G.PaneSection gap="section">{longBody}</G.PaneSection>
        </G.Pane>
      </G.PaneGrid>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const pane = canvasElement.querySelector<HTMLElement>('[data-grammar-pane-area="main"]');
      const body = canvasElement.querySelector<HTMLElement>('[data-grammar-pane-body="true"]');
      const footer = canvasElement.querySelector<HTMLElement>('[data-grammar-pane-footer-slot="true"]');
      if (pane === null || body === null || footer === null) throw new Error('pane, body and footer render');
      expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
      const before = footer.getBoundingClientRect();
      body.scrollTop = 300;
      const after = footer.getBoundingClientRect();
      expect(after.top).toBe(before.top);
      expect(Math.abs(after.bottom - pane.getBoundingClientRect().bottom)).toBeLessThanOrEqual(1);
      expect(pane.scrollHeight).toBeLessThanOrEqual(pane.clientHeight + 1);
    });
  },
};

const thread = Array.from({ length: 60 }, (_, index) => <G.MessageBubble key={index} side={index % 3 === 0 ? 'outgoing' : 'incoming'} body={`Message ${index + 1}`} />);

/** The height chain through nested grids with `rows`, `inset="flush"` and `content` variants: only the thread scrolls, the outer pane does not. */
export const NestedRowsHeightChain: Story = {
  render: () => (
    <div style={{ height: 480 }}>
      <G.Page chrome="panes" layout="workspace" header={{ title: 'Chat' }}>
        <G.PaneGrid label="Tab" areas={['tab']} rows={{ base: ['fill'] }}>
          <G.Pane area="tab" inset="flush" content="cards">
            <G.PaneGrid label="Chat" areas={['room']} rows={{ base: ['fill'] }}>
              <G.Pane area="room" surface content="full" inset="flush" label="Room">
                <G.PaneSection align="center"><G.PaneHeader title="Chatbot" /></G.PaneSection>
                <G.PaneSection scroll={{ label: 'Thread', role: 'log', align: 'end', tone: 'background' }}>{thread}</G.PaneSection>
                <G.PaneSection as="footer" rule="start"><G.Input id="c2" name="c2" label="Message" kind="text" /></G.PaneSection>
              </G.Pane>
            </G.PaneGrid>
          </G.Pane>
        </G.PaneGrid>
      </G.Page>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const outer = canvasElement.querySelector<HTMLElement>('[data-grammar-pane-area="tab"]');
      const log = canvasElement.querySelector<HTMLElement>('[role="log"]');
      if (outer === null || log === null) throw new Error('the panes render');
      expect(outer.scrollHeight).toBeLessThanOrEqual(outer.clientHeight + 1);
      expect(log.scrollHeight).toBeGreaterThan(log.clientHeight);
    });
  },
};

/** `measure="narrow"`: an order card in a chat bubble is capped at 30rem and stays at the start edge. */
export const NarrowMeasure: Story = {
  render: () => (
    <div style={{ width: 900, padding: 24 }}>
      <G.SurfaceCard kind="details" label="Order OR-1001" measure="narrow" items={[{ id: 't', term: 'Total', description: '120,000' }]} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const root = canvasElement.querySelector<HTMLElement>('.starci-core-surface-card');
      if (root === null) throw new Error('the card renders');
      const box = root.getBoundingClientRect();
      expect(box.width).toBeLessThanOrEqual(480.5);
      expect(box.left - root.parentElement!.getBoundingClientRect().left).toBeLessThanOrEqual(25);
    });
  },
};
