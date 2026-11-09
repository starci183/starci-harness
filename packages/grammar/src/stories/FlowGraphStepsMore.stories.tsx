import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import { Matrix, State } from './fixtures.js';

/**
 * The FlowGraph `steps` additions of 0.37.4, the workflow editor's cards: chips under a title, outputs on every kind (an error port in the danger tone),
 * a loop card that holds its children, and a graph that is not one connected piece (islands stacked, fan-out, two entry nodes feeding one step).
 */
const meta: Meta = {
  title: 'Flow graph steps (0.37.4)',
  parameters: { grammar: { bleed: false } },
};
export default meta;

type Story = StoryObj;

const graphOf = (canvasElement: HTMLElement, index = 0): HTMLElement => {
  const graph = canvasElement.querySelectorAll<HTMLElement>('[data-component="FlowGraph"][data-grammar-flow-layout="steps"]')[index];
  if (graph === undefined) throw new Error('The steps graph must render');
  return graph;
};
const nodeBox = (graph: HTMLElement, id: string): DOMRect => {
  const node = graph.querySelector<HTMLElement>(`[data-grammar-flow-node="${id}"]`);
  if (node === null) throw new Error(`The node ${id} must render`);
  return node.getBoundingClientRect();
};

const chipNodes: ReadonlyArray<G.FlowGraphNode> = [
  { id: 'trigger', kind: 'event', label: 'Có đơn mới', chips: [{ label: '= order.id', tone: 'accent' }] },
  {
    id: 'send',
    kind: 'action',
    label: 'Gửi tin Zalo',
    description: 'Cho khách vừa đặt',
    chips: [{ label: '= order.phone', tone: 'accent' }, { label: 'mẫu: xác nhận', tone: 'neutral' }, { label: 'Zalo OA' }, { label: 'thử lại 3 lần' }, { label: 'im lặng' }],
  },
  { id: 'done', kind: 'end', label: 'Xong' },
];
const chipEdges: ReadonlyArray<G.FlowGraphEdge> = [
  { id: 'e1', source: 'trigger', target: 'send' },
  { id: 'e2', source: 'send', target: 'done' },
];

/** Up to three chips render under the title; the rest fold into "+N". Accent is the pink soft pair, neutral the grey pair. */
export const Chips: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="Accent (dynamic) and neutral (fixed) chips; five chips draw three and +2" direction="column">
        <G.FlowGraph label="Chips" layout="steps" nodes={chipNodes} edges={chipEdges} />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const graph = graphOf(canvasElement);
      const send = graph.querySelector('[data-grammar-flow-node="send"]')!;
      const chips = [...send.querySelectorAll('[data-grammar-flow-chip]')];
      expect(chips.map((chip) => chip.textContent)).toEqual(['= order.phone', 'mẫu: xác nhận', 'Zalo OA', '+2']);
      expect(chips.map((chip) => chip.getAttribute('data-tone'))).toEqual(['accent', 'neutral', 'neutral', 'neutral']);
      expect(getComputedStyle(chips[0] as HTMLElement).backgroundColor).not.toBe(getComputedStyle(chips[1] as HTMLElement).backgroundColor);
      expect(getComputedStyle(chips[0] as HTMLElement).fontSize).toBe('12px');
    });
  },
};

const portNodes: ReadonlyArray<G.FlowGraphNode> = [
  { id: 'start', kind: 'event', label: 'Khách nhắn tin' },
  { id: 'call', kind: 'action', label: 'Gọi API đơn hàng', outputs: [{ id: 'error', label: 'Lỗi', tone: 'danger' }] },
  { id: 'ask', kind: 'ask', label: 'Hỏi chủ', outputs: [{ id: 'yes', label: 'Đồng ý' }, { id: 'no', label: 'Từ chối' }, { id: 'fail', label: 'Lỗi', tone: 'danger' }] },
  { id: 'wait', kind: 'wait', label: 'Chờ 1 giờ', outputs: [{ id: 'timeout', label: 'Quá hạn', tone: 'danger' }] },
  { id: 'reply', kind: 'action', label: 'Trả lời khách' },
  { id: 'alert', kind: 'action', label: 'Báo chủ lỗi' },
  { id: 'ok', kind: 'end', label: 'Xong' },
];
const portEdges: ReadonlyArray<G.FlowGraphEdge> = [
  { id: 'p1', source: 'start', target: 'call' },
  { id: 'p2', source: 'call', target: 'ask' },
  { id: 'p3', source: 'call', target: 'alert', sourcePort: 'error' },
  { id: 'p4', source: 'ask', target: 'wait', sourcePort: 'yes' },
  { id: 'p5', source: 'ask', target: 'reply', sourcePort: 'no' },
  { id: 'p6', source: 'ask', target: 'alert', sourcePort: 'fail' },
  { id: 'p7', source: 'wait', target: 'reply' },
  { id: 'p8', source: 'wait', target: 'alert', sourcePort: 'timeout' },
  { id: 'p9', source: 'reply', target: 'ok' },
];

/** `outputs` works on action, ask and wait cards; a port with `tone: "danger"` ("Lỗi") sits on the card edge in danger and its edge is danger too; an edge with no port leaves from the bottom middle. */
export const OutputsOnAction: Story = {
  name: 'Outputs on action, ask and wait (a danger port)',
  render: () => (
    <Matrix maxWidth={1100}>
      <State label="An action with only an error port; an ask with three; a wait with a timeout port" direction="column">
        <G.FlowGraph label="Outputs" layout="steps" nodes={portNodes} edges={portEdges} />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const graph = graphOf(canvasElement);
      const ports = [...graph.querySelectorAll('[data-grammar-flow-port]')].map((port) => port.textContent);
      expect(ports).toEqual(['Lỗi', 'Đồng ý', 'Từ chối', 'Lỗi', 'Quá hạn']);
      const danger = graph.querySelectorAll('[data-grammar-flow-port][data-tone="danger"]');
      expect(danger.length).toBe(3);
      expect(getComputedStyle(danger[0] as HTMLElement).color).not.toBe(getComputedStyle(graph.querySelector('[data-grammar-flow-port="yes"]')!).color);
      expect(graph.querySelectorAll('.starci-core-flow-graph-edge-danger').length).toBe(3);
      // The action keeps its plain edge: it leaves the bottom middle, so the "Gọi API" card reaches "Hỏi chủ" and "Báo chủ lỗi" both.
      expect(graph.querySelectorAll('.react-flow__edge').length).toBe(portEdges.length);
    });
  },
};

const loopNodes: ReadonlyArray<G.FlowGraphNode> = [
  { id: 'trigger', kind: 'event', label: 'Có đơn mới' },
  {
    id: 'loop',
    kind: 'action',
    label: 'Mỗi sản phẩm',
    container: { label: 'Lặp theo từng sản phẩm', chips: [{ label: '= order.items', tone: 'accent' }, { label: 'tối đa 20' }], childIds: ['stock', 'reserve'] },
  },
  { id: 'stock', kind: 'action', label: 'Kiểm tồn kho', chips: [{ label: '= item.sku', tone: 'accent' }] },
  { id: 'reserve', kind: 'action', label: 'Giữ hàng' },
  { id: 'confirm', kind: 'action', label: 'Xác nhận đơn' },
  { id: 'done', kind: 'end', label: 'Xong' },
];
const loopEdges: ReadonlyArray<G.FlowGraphEdge> = [
  { id: 'l1', source: 'trigger', target: 'loop' },
  { id: 'l2', source: 'stock', target: 'reserve' },
  { id: 'l3', source: 'loop', target: 'confirm' },
  { id: 'l4', source: 'confirm', target: 'done' },
];

/** A loop card: a 1.5px primary outline, a header line with its label and chips, and its children laid out inside; edges to and from the container meet its edges. */
export const Container: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="Top down" direction="column">
        <G.FlowGraph label="Loop" layout="steps" nodes={loopNodes} edges={loopEdges} />
      </State>
      <State label="Left to right" direction="column">
        <G.FlowGraph label="Loop (ngang)" layout="steps" direction="LR" nodes={loopNodes} edges={loopEdges} />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      for (const index of [0, 1]) {
        const graph = graphOf(canvasElement, index);
        const container = graph.querySelector<HTMLElement>('[data-grammar-flow-container]');
        if (container === null) throw new Error('The loop card must render');
        expect(container.textContent).toContain('Lặp theo từng sản phẩm');
        expect(container.querySelectorAll('[data-grammar-flow-chip]').length).toBe(2);
        expect(Number.parseFloat(getComputedStyle(container).borderTopWidth)).toBeCloseTo(1.5, 1);
        const box = container.getBoundingClientRect();
        for (const id of ['stock', 'reserve']) {
          const child = nodeBox(graph, id);
          expect(child.left).toBeGreaterThanOrEqual(box.left - 1);
          expect(child.right).toBeLessThanOrEqual(box.right + 1);
          expect(child.top).toBeGreaterThanOrEqual(box.top - 1);
          expect(child.bottom).toBeLessThanOrEqual(box.bottom + 1);
        }
        // The header line stands above the children.
        expect(nodeBox(graph, 'stock').top).toBeGreaterThan(box.top + 30);
      }
    });
  },
};

const islandNodes: ReadonlyArray<G.FlowGraphNode> = [
  { id: 'a1', kind: 'event', label: 'Có đơn mới' },
  { id: 'a2', kind: 'action', label: 'Gửi xác nhận' },
  { id: 'b1', kind: 'event', label: 'Mỗi sáng 8:00' },
  { id: 'b2', kind: 'action', label: 'Tóm tắt doanh thu' },
  { id: 'c1', kind: 'event', label: 'Khách phản hồi' },
];
const islandEdges: ReadonlyArray<G.FlowGraphEdge> = [
  { id: 'i1', source: 'a1', target: 'a2' },
  { id: 'i2', source: 'b1', target: 'b2' },
];

/** A graph that is not one connected piece: each island is laid out on its own and the islands stack down the page, left edges aligned (a lone node is an island too). */
export const Islands: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="Three islands: two pairs and a lone node" direction="column">
        <G.FlowGraph label="Islands" layout="steps" nodes={islandNodes} edges={islandEdges} />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const graph = graphOf(canvasElement);
      const [a1, a2, b1, b2, c1] = ['a1', 'a2', 'b1', 'b2', 'c1'].map((id) => nodeBox(graph, id));
      // Stacked: each island starts below the previous one, and they share the left edge.
      expect(b1!.top).toBeGreaterThan(a2!.bottom);
      expect(c1!.top).toBeGreaterThan(b2!.bottom);
      expect(Math.abs(a1!.left - b1!.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(a1!.left - c1!.left)).toBeLessThanOrEqual(1);
      expect(a2!.top).toBeGreaterThan(a1!.top);
    });
  },
};

const fanNodes: ReadonlyArray<G.FlowGraphNode> = [
  { id: 'order', kind: 'event', label: 'Có đơn mới', tag: 'Kích hoạt' },
  { id: 'hook', kind: 'event', label: 'Webhook Shopee', tag: 'Kích hoạt' },
  { id: 'normalize', kind: 'action', label: 'Chuẩn hoá đơn' },
  { id: 'zalo', kind: 'action', label: 'Nhắn Zalo cho khách' },
  { id: 'sheet', kind: 'action', label: 'Ghi vào sổ đơn' },
  { id: 'stock', kind: 'action', label: 'Trừ tồn kho' },
  { id: 'done', kind: 'end', label: 'Xong' },
];
const fanEdges: ReadonlyArray<G.FlowGraphEdge> = [
  { id: 'f1', source: 'order', target: 'normalize' },
  { id: 'f2', source: 'hook', target: 'normalize' },
  { id: 'f3', source: 'normalize', target: 'zalo' },
  { id: 'f4', source: 'normalize', target: 'sheet' },
  { id: 'f5', source: 'normalize', target: 'stock' },
  { id: 'f6', source: 'zalo', target: 'done' },
  { id: 'f7', source: 'sheet', target: 'done' },
  { id: 'f8', source: 'stock', target: 'done' },
];

/** Two entry nodes feed one step (they stand side by side, centred over it) and that step fans out to three targets that join at the end. */
export const FanOutAndTwoTriggers: Story = {
  render: () => (
    <Matrix maxWidth={1000}>
      <State label="Two triggers, one workflow, a fan-out of three" direction="column">
        <G.FlowGraph label="Fan-out" layout="steps" nodes={fanNodes} edges={fanEdges} />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const graph = graphOf(canvasElement);
      const [order, hook, normalize, zalo, sheet, stock] = ['order', 'hook', 'normalize', 'zalo', 'sheet', 'stock'].map((id) => nodeBox(graph, id));
      const centre = (box: DOMRect) => (box.left + box.right) / 2;
      expect(Math.abs(order!.top - hook!.top)).toBeLessThanOrEqual(1);
      expect(hook!.left).toBeGreaterThan(order!.right);
      expect(Math.abs((centre(order!) + centre(hook!)) / 2 - centre(normalize!))).toBeLessThanOrEqual(2);
      expect(Math.abs(zalo!.top - sheet!.top)).toBeLessThanOrEqual(1);
      expect(Math.abs(sheet!.top - stock!.top)).toBeLessThanOrEqual(1);
      expect(zalo!.left).toBeLessThan(sheet!.left);
      expect(sheet!.left).toBeLessThan(stock!.left);
      expect(graph.querySelectorAll('.react-flow__edge').length).toBe(fanEdges.length);
    });
  },
};
