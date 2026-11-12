import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import { noop } from './fixtures.js';

/**
 * MESSAGE-CARD-FILL and BUTTON-WRAP (0.37.30, the /chat stop card). A MessageCard's content column fills the card: a nested bordered
 * list (surface in surface: `SurfaceCard kind="list"`) and a composer in its body span the card's inner width, while the head, the
 * actions row and the meta line still start at the reading edge. A suggestion pill (`Button size="sm"`) with `width="wrap"` hugs a
 * short label like `content` and wraps a label longer than its container inside the pill (same radius and inline padding, text at
 * the reading edge), growing from the 32px step; it never spills out of its row.
 */
const meta: Meta = { title: 'Navigation & Data/Message card fill (0.37.30)', parameters: { grammar: { bleed: false } } };
export default meta;
type Story = StoryObj;

const facts: readonly G.ListRowData[] = [
  { id: 'workflow', title: 'Quy trình', value: 'Chốt đơn qua Zalo' },
  { id: 'step', title: 'Bước', value: 'Gửi QR thanh toán' },
  { id: 'reason', title: 'Lý do dừng', value: 'Khách hỏi giao hàng ngoài khu vực' },
];

const suggestions = [
  'Đồng ý',
  'Hỏi lại địa chỉ',
  'Báo khách phí giao ngoài khu vực là 30.000đ và hỏi khách có muốn tiếp tục đặt đơn này không, nếu có thì gửi lại QR thanh toán',
] as const;

const Suggestions = () => (
  <G.Cluster gap="inline" label="Gợi ý trả lời">
    {suggestions.map((text) => (
      <G.Button key={text} intent="neutral" size="sm" width="wrap" onPress={noop}>
        {text}
      </G.Button>
    ))}
  </G.Cluster>
);

const Composer = () => (
  <G.Cluster gap="inline" align="end" wrap={false}>
    <div style={{ flex: 1, minWidth: 0 }}>
      <G.Textarea label="Trả lời" isLabelHidden placeholder="Trả lời cho NIVO..." />
    </div>
    <G.Button intent="commit" startGlyph="send" onPress={noop}>
      Gửi
    </G.Button>
  </G.Cluster>
);

const stopBody = (
  <G.Stack gap="row">
    <G.SurfaceCard kind="list" layout="keyValue" ariaLabel="Chi tiết" empty={null} items={facts} />
    <Suggestions />
    <Composer />
  </G.Stack>
);

/** The stop card: the bordered list, the suggestions and the composer fill the card's inner width; the head, actions and meta start at the reading edge. */
export const NestedListAndComposer: Story = {
  render: () => (
    <div style={{ maxWidth: '64rem' }}>
      <G.MessageCard
        measure="wide"
        author="NIVO"
        avatar={<G.Avatar name="NIVO" size="sm" />}
        title="Quy trình đang dừng"
        chip={<G.Badge tone="warning">Cần bạn quyết</G.Badge>}
        body={stopBody}
        actions={[
          { id: 'retry', label: 'Thử lại', onPress: noop },
          { id: 'take', label: 'Tiếp quản', onPress: noop },
          { id: 'skip', label: 'Bỏ qua', onPress: noop },
        ]}
        meta="Chốt đơn qua Zalo · Gửi QR · 09:12 · lần 2"
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('[data-component="MessageCard"]')).not.toBeNull());
    const card = canvasElement.querySelector<HTMLElement>('[data-component="MessageCard"]')!;
    const list = card.querySelector<HTMLElement>('[data-component="SurfaceCard"]')!;
    const textarea = card.querySelector<HTMLElement>('textarea')!;
    const send = [...card.querySelectorAll<HTMLElement>('[data-component="Button"]')].find((b) => b.textContent?.includes('Gửi'))!;
    const box = card.getBoundingClientRect();
    expect(Math.abs(list.getBoundingClientRect().width - box.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(send.getBoundingClientRect().right - box.right)).toBeLessThanOrEqual(1);
    expect(textarea.getBoundingClientRect().left - box.left).toBeLessThanOrEqual(1);
  },
};

/** Long suggestion pills in a narrow container: the short ones hug their label at 32px; the long one wraps inside its pill and stays within the column. */
export const LongSuggestionsNarrow: Story = {
  render: () => (
    <div style={{ inlineSize: '18rem' }} data-testid="narrow">
      <Suggestions />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const column = canvasElement.querySelector<HTMLElement>('[data-testid="narrow"]')!;
    await waitFor(() => expect(column.querySelectorAll('[data-component="Button"]').length).toBe(3));
    const right = column.getBoundingClientRect().right;
    const pills = [...column.querySelectorAll<HTMLElement>('[data-component="Button"]')];
    for (const pill of pills) expect(pill.getBoundingClientRect().right).toBeLessThanOrEqual(right + 0.5);
    expect(Math.round(pills[0]!.getBoundingClientRect().height)).toBe(32);
    expect(pills[2]!.getBoundingClientRect().height).toBeGreaterThan(32);
  },
};
