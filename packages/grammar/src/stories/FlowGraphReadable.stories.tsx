import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * FLOW GRAPH READABILITY (0.37.33, owner drawing graph-state; 176 wide since 0.37.35). A step card is 176 x 64 with its title at 14 and its line at 12 at zoom 1; cards stand 40 apart
 * (wider only where a labelled edge needs it). The round dot an edge starts with is centred ON the source card's edge, half on the card and half out, drawn above
 * it, and the edge leaves from it. On open the graph is fitted when it reads (zoom >= 0.95; a linear 5-step graph and its end pill fit the 1160px workflow map well), otherwise
 * it opens at zoom 1 at its entry and pans (0.8 on a phone); the least zoom stays 0.8. `height="fill"` gives the frame the rest of the page height (>= 360px).
 */
const meta: Meta = { title: 'Flow graph readability (0.37.33)', parameters: { layout: 'fullscreen' } };
export default meta;
type Story = StoryObj;

/** The sales workflow of the drawing: five steps in a line. */
const salesNodes: ReadonlyArray<G.FlowGraphNode> = [
  { id: 'new', kind: 'event', label: 'Có việc mới', description: 'Tin, tiền về, hẹn giờ', tag: 'Kích hoạt' },
  { id: 'consult', kind: 'action', label: 'Tư vấn khách', description: 'món, địa chỉ, giờ giao' },
  { id: 'order', kind: 'action', label: 'Tạo đơn', description: 'ghi đơn và xác nhận' },
  { id: 'qr', kind: 'action', label: 'Gửi QR thanh toán', description: 'gửi QR và mã đơn' },
  { id: 'notify', kind: 'ask', label: 'Báo đội đơn mới', description: 'nhắn đơn mới lên /chat' },
  { id: 'won', kind: 'end', label: 'Chốt đơn' },
];
const salesEdges: ReadonlyArray<G.FlowGraphEdge> = [
  { id: 's1', source: 'new', target: 'consult' },
  { id: 's2', source: 'consult', target: 'order' },
  { id: 's3', source: 'order', target: 'qr' },
  { id: 's4', source: 'qr', target: 'notify' },
  { id: 's5', source: 'notify', target: 'won' },
];

/** The receptionist (Lễ tân) graph: an intent that fans out to four branches. */
const receptionNodes: ReadonlyArray<G.FlowGraphNode> = [
  { id: 'new', kind: 'event', label: 'Có tin mới', description: 'Tin khách qua Zalo', tag: 'Kích hoạt' },
  {
    id: 'intent', kind: 'condition', label: 'Hiểu ý khách', description: 'chọn hướng cho tin khách',
    outputs: [{ id: 'buy', label: 'Muốn mua' }, { id: 'paid', label: 'Báo đã chuyển' }, { id: 'ask', label: 'Hỏi thông tin' }, { id: 'complain', label: 'Khiếu nại' }],
  },
  { id: 'sales', kind: 'action', label: 'Tư vấn', description: 'giao Sales' },
  { id: 'accounting', kind: 'action', label: 'Đối soát', description: 'giao Kế toán' },
  { id: 'answer', kind: 'action', label: 'Trả lời', description: 'từ thông tin của tiệm' },
  { id: 'receive', kind: 'action', label: 'Khiếu nại', description: 'xin lỗi khách, báo đội' },
  { id: 'handoff', kind: 'end', label: 'Chuyển chủ tiệm' },
];
const receptionEdges: ReadonlyArray<G.FlowGraphEdge> = [
  { id: 'r1', source: 'new', target: 'intent' },
  { id: 'r2', source: 'intent', target: 'sales', sourcePort: 'buy' },
  { id: 'r3', source: 'intent', target: 'accounting', sourcePort: 'paid' },
  { id: 'r4', source: 'intent', target: 'answer', sourcePort: 'ask' },
  { id: 'r5', source: 'intent', target: 'receive', sourcePort: 'complain' },
  { id: 'r6', source: 'receive', target: 'handoff' },
];

/** The workflow map well of the drawing: 1160px wide (at a 1440 page), a heading above the graph, the graph filling the rest of an 800px page. */
const Well = ({ nodes, edges }: { readonly nodes: ReadonlyArray<G.FlowGraphNode>, readonly edges: ReadonlyArray<G.FlowGraphEdge> }) => (
  <div data-story-well="true" style={{ boxSizing: 'border-box', width: 'min(1160px, 100%)', height: 800, overflowY: 'auto', background: 'var(--background)' }}>
    <G.Stack gap="row">
      <G.Heading level={2}>Sơ đồ</G.Heading>
      <G.FlowGraph label="Sơ đồ quy trình" layout="steps" height="fill" nodes={nodes} edges={edges} isEditable />
    </G.Stack>
  </div>
);

/** The viewport zoom React Flow applied. */
const zoomOf = (graph: HTMLElement): number => new DOMMatrixReadOnly(getComputedStyle(graph.querySelector<HTMLElement>('.react-flow__viewport')!).transform).a;

/** Every edge starts with its dot centred on the source card's edge (x for LR), and the dot is drawn above the card. */
const assertDotsOnEdges = (graph: HTMLElement, edges: ReadonlyArray<G.FlowGraphEdge>) => {
  for (const edge of edges) {
    const group = graph.querySelector<SVGGElement>(`.react-flow__edge[data-id="${edge.id}"]`) ?? graph.querySelector<SVGGElement>(`[data-testid="rf__edge-${edge.id}"]`)!;
    const dot = group.querySelector<SVGCircleElement>('[data-grammar-flow-edge-dot]')!.getBoundingClientRect();
    const card = graph.querySelector<HTMLElement>(`.starci-core-flow-graph-step[data-grammar-flow-node="${edge.source}"]`)!.getBoundingClientRect();
    const centreX = dot.left + dot.width / 2;
    const centreY = dot.top + dot.height / 2;
    expect(Math.abs(centreX - card.right)).toBeLessThanOrEqual(1);
    expect(centreY).toBeGreaterThan(card.top);
    expect(centreY).toBeLessThan(card.bottom);
    // above the card: the edge layer that holds the dot stands over the node layer (edges are not hit targets, so the order is read from the stacking)
    const layer = group.closest('svg')!;
    const node = graph.querySelector<HTMLElement>(`.react-flow__node[data-id="${edge.source}"]`)!;
    expect(Number(getComputedStyle(layer).zIndex)).toBeGreaterThan(Number(getComputedStyle(node).zIndex));
  }
};

/** A plain card is 176 x 64 at zoom 1 (0.37.35) with a 14px title and a 12px line. */
const assertCards = (graph: HTMLElement, ids: ReadonlyArray<string>) => {
  for (const id of ids) {
    const card = graph.querySelector<HTMLElement>(`.starci-core-flow-graph-step[data-grammar-flow-node="${id}"]`)!;
    expect(card.offsetWidth).toBe(176);
    // 64 tall; a title that wraps (at most two lines, 0.37.35) grows the card by its second line only.
    const title = card.querySelector<HTMLElement>('.starci-core-flow-graph-step-title')!;
    const titleLines = Math.round(title.offsetHeight / Number.parseFloat(getComputedStyle(title).lineHeight));
    expect(titleLines).toBeLessThanOrEqual(2);
    if (card.querySelector('[data-grammar-flow-outputs]') === null) {
      if (titleLines === 1) expect(card.offsetHeight).toBe(64);
      else expect(card.offsetHeight).toBeLessThanOrEqual(64 + 18);
    }
    expect(getComputedStyle(card.querySelector('.starci-core-flow-graph-step-title')!).fontSize).toBe('14px');
    const line = card.querySelector('.starci-core-flow-graph-step-line');
    if (line !== null) expect(getComputedStyle(line).fontSize).toBe('12px');
  }
};

/** The frame takes the rest of the 800px page under the heading, and at least 360px. */
const assertFills = (graph: HTMLElement) => {
  const well = graph.closest<HTMLElement>('[data-story-well]')!.getBoundingClientRect();
  const canvas = graph.querySelector<HTMLElement>('.starci-core-flow-graph-canvas')!.getBoundingClientRect();
  expect(canvas.height).toBeGreaterThanOrEqual(360);
  expect(Math.abs(graph.getBoundingClientRect().bottom - well.bottom)).toBeLessThanOrEqual(2);
};

/** A linear 5-step graph and its end pill fit the 1160px well whole, at zoom >= 0.95 (0.37.35: 176 cards); the gap between two cards is 40 at zoom 1. */
export const LinearFiveFits: Story = {
  render: () => <Well nodes={salesNodes} edges={salesEdges} />,
  play: async ({ canvasElement }) => {
    const graph = canvasElement.querySelector<HTMLElement>('[data-component="FlowGraph"]')!;
    await waitFor(() => expect(graph.querySelectorAll('.starci-core-flow-graph-step').length).toBe(6));
    await waitFor(() => assertFills(graph));
    assertCards(graph, salesNodes.filter((node) => node.kind !== 'end').map((node) => node.id));
    const canvas = graph.querySelector<HTMLElement>('.starci-core-flow-graph-canvas')!.getBoundingClientRect();
    await waitFor(() => {
      const zoom = zoomOf(graph);
      const first = graph.querySelector<HTMLElement>('[data-grammar-flow-node="new"]')!.getBoundingClientRect();
      const second = graph.querySelector<HTMLElement>('[data-grammar-flow-node="consult"]')!.getBoundingClientRect();
      expect(Math.abs((second.left - first.right) / zoom - 40)).toBeLessThanOrEqual(1);
      if (canvas.width >= 1150) {
        expect(zoom).toBeGreaterThanOrEqual(0.95);
        expect(zoom).toBeLessThanOrEqual(1);
        const last = graph.querySelector<HTMLElement>('[data-grammar-flow-node="won"]')!.getBoundingClientRect();
        expect(first.left).toBeGreaterThanOrEqual(canvas.left);
        expect(last.right).toBeLessThanOrEqual(canvas.right);
      } else {
        // a phone opens at 0.8 at the entry and pans
        expect(zoom).toBeCloseTo(0.8, 2);
        expect(first.left).toBeGreaterThanOrEqual(canvas.left);
      }
    });
    assertDotsOnEdges(graph, salesEdges);
    graph.setAttribute('data-story-zoom', String(zoomOf(graph)));
  },
};

/** The branched receptionist graph does not fit the well at zoom >= 0.95: it opens at zoom 1 (0.8 on a phone) at its entry, and the reader pans. */
export const BranchedOpensAtOne: Story = {
  render: () => <Well nodes={receptionNodes} edges={receptionEdges} />,
  play: async ({ canvasElement }) => {
    const graph = canvasElement.querySelector<HTMLElement>('[data-component="FlowGraph"]')!;
    await waitFor(() => expect(graph.querySelectorAll('.starci-core-flow-graph-step').length).toBe(7));
    await waitFor(() => assertFills(graph));
    assertCards(graph, ['new', 'sales', 'accounting', 'answer', 'receive']);
    const canvas = graph.querySelector<HTMLElement>('.starci-core-flow-graph-canvas')!.getBoundingClientRect();
    await waitFor(() => {
      const zoom = zoomOf(graph);
      const fits = graph.getAttribute('data-grammar-flow-floored') !== 'true';
      if (fits) expect(zoom).toBeGreaterThanOrEqual(canvas.width <= 480 ? 0.8 : 0.95);
      else expect(zoom).toBeCloseTo(canvas.width <= 480 ? 0.8 : 1, 2);
      const entry = graph.querySelector<HTMLElement>('[data-grammar-flow-node="new"]')!.getBoundingClientRect();
      expect(entry.left).toBeGreaterThanOrEqual(canvas.left);
      expect(entry.right).toBeLessThanOrEqual(canvas.right);
    });
    assertDotsOnEdges(graph, receptionEdges.filter((edge) => edge.source !== 'intent'));
    // a port's edge starts on the card's end edge too
    const port = graph.querySelector<SVGGElement>('[data-testid="rf__edge-r2"]') ?? graph.querySelector<SVGGElement>('.react-flow__edge[data-id="r2"]')!;
    const dot = port.querySelector<SVGCircleElement>('[data-grammar-flow-edge-dot]')!.getBoundingClientRect();
    const intent = graph.querySelector<HTMLElement>('.starci-core-flow-graph-step[data-grammar-flow-node="intent"]')!.getBoundingClientRect();
    expect(Math.abs(dot.left + dot.width / 2 - intent.right)).toBeLessThanOrEqual(1);
  },
};
