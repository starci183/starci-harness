import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import * as G from '../common/index.js';
import { noop } from './fixtures.js';

/**
 * 0.37.5: the seam between header zones reads on the white card, including a table card (0.37.8: no grey frame); `SurfaceCard kind="list" layout="keyValue"` draws muted keys and normal values
 * (values wrap under the key on a narrow card); `Pane head` is a sticky one-row head with a close button.
 */
const meta: Meta = { title: 'Surfaces/Zone seam, key-value rows and pane head', parameters: { layout: 'fullscreen' } };
export default meta;
type Story = StoryObj;

const COLUMNS = [{ id: 'name', label: 'Order ID' }, { id: 'total', label: 'Total', isNumeric: true }] as const;
const zones = [
  { kind: 'search', label: 'Search orders', value: '', onChange: noop, placeholder: 'Search orders' },
  { kind: 'filter', label: 'Status', items: [{ id: 'all', label: 'All' }, { id: 'paid', label: 'Paid' }], selectedKey: 'all', onSelect: noop, overflowLabel: 'More', moreLabel: (count: number) => `${count} filters` },
] as const;

/** The channel distance between a colour composited over a ground and the ground, measured on a canvas (the seam is a translucent mix). */
const delta = (seam: string, ground: string) => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d')!;
  context.fillStyle = ground;
  context.fillRect(0, 0, 1, 1);
  const base = context.getImageData(0, 0, 1, 1).data;
  context.fillStyle = seam;
  context.fillRect(0, 0, 1, 1);
  const over = context.getImageData(0, 0, 1, 1).data;
  return Math.max(Math.abs(over[0]! - base[0]!), Math.abs(over[1]! - base[1]!), Math.abs(over[2]! - base[2]!));
};

export const ZoneSeamContrast: Story = {
  render: () => (
    <div style={{ width: 'min(100%, 720px)', padding: 24, display: 'grid', gap: 24 }}>
      <G.SurfaceCard kind="table" label="Table card" columns={COLUMNS} rows={[{ id: 'r1', cells: { name: 'OR-1001', total: '120,000' } }]} empty={<G.EmptyNotice message="Empty" />} headers={[...zones]} />
      <G.SurfaceCard kind="list" label="On a white card" items={[{ id: 'a', title: 'OR-1001' }]} empty={<G.EmptyNotice message="Empty" />} headers={[...zones]} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      for (const kind of ['table', 'list']) {
        const card = canvasElement.querySelector<HTMLElement>(`.starci-core-surface[data-grammar-surface-kind="${kind}"]`);
        const zone = card?.querySelector<HTMLElement>('[data-grammar-zone]');
        if (card == null || zone == null) throw new Error('the card and its zone render');
        const ground = getComputedStyle(card).backgroundColor;
        expect(Number.parseFloat(getComputedStyle(zone).borderBottomWidth)).toBe(1);
        expect(delta(getComputedStyle(zone).borderBottomColor, ground)).toBeGreaterThanOrEqual(20);
      }
    });
  },
};

const FACTS = [
  { id: 'a', title: 'Customer', value: 'Maria Garcia' },
  { id: 'b', title: 'Delivery address', value: '125/7 Lakeside Boulevard, Northgate District, Springfield Heights, Greater Metropolitan Area' },
  { id: 'c', title: 'Status', value: 'Paid' },
];

export const KeyValueRows: Story = {
  render: () => (
    <div style={{ padding: 24, display: 'grid', gap: 24, gridTemplateColumns: '30rem 16rem', alignItems: 'start' }}>
      <G.SurfaceCard kind="list" layout="keyValue" label="Order details" items={FACTS} empty={<G.EmptyNotice message="Empty" />} />
      <G.SurfaceCard kind="list" layout="keyValue" label="Narrow" items={FACTS} empty={<G.EmptyNotice message="Empty" />} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const [wide, narrow] = Array.from(canvasElement.querySelectorAll<HTMLElement>('[data-grammar-list-layout="keyValue"]'));
      if (wide === undefined || narrow === undefined) throw new Error('both lists render');
      const key = wide.querySelector<HTMLElement>('.starci-core-list-row-name')!;
      const value = wide.querySelector<HTMLElement>('.starci-core-list-row-value')!;
      expect(getComputedStyle(key).color).not.toBe(getComputedStyle(value).color);
      expect(value.getBoundingClientRect().left).toBeGreaterThan(key.getBoundingClientRect().right);
      const nkey = narrow.querySelector<HTMLElement>('.starci-core-list-row-name')!.getBoundingClientRect();
      const nvalue = narrow.querySelector<HTMLElement>('.starci-core-list-row-value')!.getBoundingClientRect();
      expect(nvalue.top).toBeGreaterThanOrEqual(nkey.bottom - 1);
    });
  },
};

const Head = () => {
  const [closed, setClosed] = useState(0);
  return (
    <div style={{ height: 360 }}>
      <G.PaneGrid label="Detail" areas={['main aside']} columns={['fill', 'standard']}>
        <G.Pane area="main" label="Main"><G.PaneSection><G.Text>{`closed ${closed}`}</G.Text></G.PaneSection></G.Pane>
        <G.Pane area="aside" surface scroll label="Details" head={{ title: 'Customer details', description: 'Maria Garcia', onClose: () => setClosed((n) => n + 1), closeLabel: 'Close' }}>
          <G.PaneSection>{Array.from({ length: 60 }, (_, index) => <G.Text key={index}>{`Line ${index + 1}`}</G.Text>)}</G.PaneSection>
        </G.Pane>
      </G.PaneGrid>
    </div>
  );
};

export const PaneHeadSlot: Story = {
  render: () => <Head />,
  play: async ({ canvasElement }) => {
    const aside = await waitFor(() => {
      const element = canvasElement.querySelector<HTMLElement>('[data-grammar-pane-area="aside"]');
      if (element === null) throw new Error('the aside renders');
      return element;
    });
    const head = aside.querySelector<HTMLElement>('.starci-core-pane-stack > .starci-core-pane-section:first-child')!;
    const before = head.getBoundingClientRect().top;
    const scroller = aside.querySelector<HTMLElement>('.starci-core-pane-scroll') ?? aside;
    scroller.scrollTop = 300;
    await waitFor(() => expect(Math.abs(head.getBoundingClientRect().top - before)).toBeLessThanOrEqual(1));
    await userEvent.click(within(aside).getByRole('button', { name: 'Close' }));
    expect(canvasElement.textContent).toContain('closed 1');
  },
};
