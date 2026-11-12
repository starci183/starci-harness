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

const COLUMNS = [{ id: 'name', label: 'Mã đơn' }, { id: 'total', label: 'Tổng', isNumeric: true }] as const;
const zones = [
  { kind: 'search', label: 'Tìm đơn', value: '', onChange: noop, placeholder: 'Tìm đơn' },
  { kind: 'filter', label: 'Trạng thái', items: [{ id: 'all', label: 'Tất cả' }, { id: 'paid', label: 'Đã thanh toán' }], selectedKey: 'all', onSelect: noop, overflowLabel: 'Thêm', moreLabel: (count: number) => `${count} bộ lọc` },
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
      <G.SurfaceCard kind="table" label="Thẻ bảng" columns={COLUMNS} rows={[{ id: 'r1', cells: { name: 'DH-1001', total: '120.000' } }]} empty={<G.EmptyNotice message="Trống" />} headers={[...zones]} />
      <G.SurfaceCard kind="list" label="Trên thẻ trắng" items={[{ id: 'a', title: 'DH-1001' }]} empty={<G.EmptyNotice message="Trống" />} headers={[...zones]} />
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
  { id: 'a', title: 'Khách', value: 'Nguyễn Thị Hương' },
  { id: 'b', title: 'Địa chỉ giao', value: '125/7 Nguyễn Thị Minh Khai, Phường Bến Thành, Quận 1, Thành phố Hồ Chí Minh' },
  { id: 'c', title: 'Trạng thái', value: 'Đã thanh toán' },
];

export const KeyValueRows: Story = {
  render: () => (
    <div style={{ padding: 24, display: 'grid', gap: 24, gridTemplateColumns: '30rem 16rem', alignItems: 'start' }}>
      <G.SurfaceCard kind="list" layout="keyValue" label="Chi tiết đơn" items={FACTS} empty={<G.EmptyNotice message="Trống" />} />
      <G.SurfaceCard kind="list" layout="keyValue" label="Hẹp" items={FACTS} empty={<G.EmptyNotice message="Trống" />} />
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
        <G.Pane area="aside" surface scroll label="Chi tiết" head={{ title: 'Chi tiết khách hàng', description: 'Nguyễn Thị Hương', onClose: () => setClosed((n) => n + 1), closeLabel: 'Đóng' }}>
          <G.PaneSection>{Array.from({ length: 60 }, (_, index) => <G.Text key={index}>{`Dòng ${index + 1}`}</G.Text>)}</G.PaneSection>
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
    await userEvent.click(within(aside).getByRole('button', { name: 'Đóng' }));
    expect(canvasElement.textContent).toContain('closed 1');
  },
};
