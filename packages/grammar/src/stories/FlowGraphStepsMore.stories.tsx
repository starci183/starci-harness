import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import { Matrix, State } from './fixtures.js';

/**
 * The FlowGraph `steps` additions of 0.37.4 (and `islands="wrap"` of 0.37.8), the workflow editor's cards: chips under a title, outputs on every kind (an error port in the danger tone),
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
  { id: 'trigger', kind: 'event', label: 'New order', chips: [{ label: '= order.id', tone: 'accent' }] },
  {
    id: 'send',
    kind: 'action',
    label: 'Send Email',
    description: 'For the new buyer',
    chips: [{ label: '= order.phone', tone: 'accent' }, { label: 'template: confirm', tone: 'neutral' }, { label: 'Email' }, { label: 'retry 3 times' }, { label: 'silent' }],
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
        <G.FlowGraph label="Chips" layout="steps" direction="TB" nodes={chipNodes} edges={chipEdges} />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const graph = graphOf(canvasElement);
      const send = graph.querySelector('[data-grammar-flow-node="send"]')!;
      const chips = [...send.querySelectorAll('[data-grammar-flow-chip]')];
      expect(chips.map((chip) => chip.textContent)).toEqual(['= order.phone', 'template: confirm', 'Email', '+2']);
      expect(chips.map((chip) => chip.getAttribute('data-tone'))).toEqual(['accent', 'neutral', 'neutral', 'neutral']);
      expect(getComputedStyle(chips[0] as HTMLElement).backgroundColor).not.toBe(getComputedStyle(chips[1] as HTMLElement).backgroundColor);
      expect(getComputedStyle(chips[0] as HTMLElement).fontSize).toBe('12px');
    });
  },
};

const portNodes: ReadonlyArray<G.FlowGraphNode> = [
  { id: 'start', kind: 'event', label: 'Customer message' },
  { id: 'call', kind: 'action', label: 'Call the orders API', outputs: [{ id: 'error', label: 'Error', tone: 'danger' }] },
  { id: 'ask', kind: 'ask', label: 'Ask the owner', outputs: [{ id: 'yes', label: 'Approve' }, { id: 'no', label: 'Decline' }, { id: 'fail', label: 'Error', tone: 'danger' }] },
  { id: 'wait', kind: 'wait', label: 'Wait 1 hour', outputs: [{ id: 'timeout', label: 'Timed out', tone: 'danger' }] },
  { id: 'reply', kind: 'action', label: 'Reply to customer' },
  { id: 'alert', kind: 'action', label: 'Alert the owner' },
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

/** `outputs` works on action, ask and wait cards; a port with `tone: "danger"` ("Error") sits on the card edge in danger and its edge is danger too; an edge with no port leaves from the bottom middle. */
export const OutputsOnAction: Story = {
  name: 'Outputs on action, ask and wait (a danger port)',
  render: () => (
    <Matrix maxWidth={1100}>
      <State label="An action with only an error port; an ask with three; a wait with a timeout port" direction="column">
        <G.FlowGraph label="Outputs" layout="steps" direction="TB" nodes={portNodes} edges={portEdges} />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const graph = graphOf(canvasElement);
      const ports = [...graph.querySelectorAll('[data-grammar-flow-port]')].map((port) => port.textContent);
      expect(ports).toEqual(['Error', 'Approve', 'Decline', 'Error', 'Timed out']);
      const danger = graph.querySelectorAll('[data-grammar-flow-port][data-tone="danger"]');
      expect(danger.length).toBe(3);
      expect(getComputedStyle(danger[0] as HTMLElement).color).not.toBe(getComputedStyle(graph.querySelector('[data-grammar-flow-port="yes"]')!).color);
      expect(graph.querySelectorAll('.starci-core-flow-graph-edge-danger').length).toBe(3);
      // The action keeps its plain edge: it leaves the bottom middle, so the "Call the orders API" card reaches "Ask the owner" and "Alert the owner" both.
      expect(graph.querySelectorAll('.react-flow__edge').length).toBe(portEdges.length);
    });
  },
};

const loopNodes: ReadonlyArray<G.FlowGraphNode> = [
  { id: 'trigger', kind: 'event', label: 'New order' },
  {
    id: 'loop',
    kind: 'action',
    label: 'Each product',
    container: { label: 'Loop over each product', chips: [{ label: '= order.items', tone: 'accent' }, { label: 'max 20' }], childIds: ['stock', 'reserve'] },
  },
  { id: 'stock', kind: 'action', label: 'Check stock', chips: [{ label: '= item.sku', tone: 'accent' }] },
  { id: 'reserve', kind: 'action', label: 'Hold the goods' },
  { id: 'confirm', kind: 'action', label: 'Confirm the order' },
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
        <G.FlowGraph label="Loop" layout="steps" direction="TB" nodes={loopNodes} edges={loopEdges} />
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
        expect(container.textContent).toContain('Loop over each product');
        expect(container.querySelectorAll('[data-grammar-flow-chip]').length).toBe(2);
        // The outline is declared 1.5px; Chromium snaps a border to whole device pixels, so a 1x screen draws 1px and a 2x screen 1.5px (0.37.29: the check follows the screen).
        expect(Number.parseFloat(getComputedStyle(container).borderTopWidth)).toBeCloseTo(Math.max(1, Math.floor(1.5 * window.devicePixelRatio) / window.devicePixelRatio), 2);
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
  { id: 'a1', kind: 'event', label: 'New order' },
  { id: 'a2', kind: 'action', label: 'Send confirmation' },
  { id: 'b1', kind: 'event', label: 'Every day at 8:00' },
  { id: 'b2', kind: 'action', label: 'Summarise revenue' },
  { id: 'c1', kind: 'event', label: 'Customer replies' },
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
        <G.FlowGraph label="Islands" layout="steps" direction="TB" islands="stack" nodes={islandNodes} edges={islandEdges} />
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

/** 0.37.11: the zoom controls (bottom-left) cover a strip the fit leaves empty, so a node at the bottom-left corner (the last island, left-aligned) is never drawn under them. */
export const ControlsReserveCorner: Story = {
  render: () => (
    <Matrix maxWidth={300}>
      <State label="A lone node at the bottom-left, controls shown" direction="column">
        <G.FlowGraph label="Controls corner" layout="steps" direction="TB" islands="stack" showControls nodes={islandNodes} edges={islandEdges} />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const graph = graphOf(canvasElement);
      const controls = graph.querySelector<HTMLElement>('.starci-core-flow-graph-controls');
      if (controls === null) throw new Error('the zoom controls render');
      const c = controls.getBoundingClientRect();
      for (const id of ['a1', 'a2', 'b1', 'b2', 'c1']) {
        const n = nodeBox(graph, id)!;
        const overlaps = n.left < c.right && n.right > c.left && n.top < c.bottom && n.bottom > c.top;
        expect(overlaps).toBe(false);
      }
    });
  },
};

const fanNodes: ReadonlyArray<G.FlowGraphNode> = [
  { id: 'order', kind: 'event', label: 'New order', tag: 'Trigger' },
  { id: 'hook', kind: 'event', label: 'Webhook', tag: 'Trigger' },
  { id: 'normalize', kind: 'action', label: 'Normalise the order' },
  { id: 'chat', kind: 'action', label: 'Email the customer' },
  { id: 'sheet', kind: 'action', label: 'Write to the order log' },
  { id: 'stock', kind: 'action', label: 'Deduct stock' },
  { id: 'done', kind: 'end', label: 'Xong' },
];
const fanEdges: ReadonlyArray<G.FlowGraphEdge> = [
  { id: 'f1', source: 'order', target: 'normalize' },
  { id: 'f2', source: 'hook', target: 'normalize' },
  { id: 'f3', source: 'normalize', target: 'chat' },
  { id: 'f4', source: 'normalize', target: 'sheet' },
  { id: 'f5', source: 'normalize', target: 'stock' },
  { id: 'f6', source: 'chat', target: 'done' },
  { id: 'f7', source: 'sheet', target: 'done' },
  { id: 'f8', source: 'stock', target: 'done' },
];

/** Two entry nodes feed one step (they stand side by side, centred over it) and that step fans out to three targets that join at the end. */
export const FanOutAndTwoTriggers: Story = {
  render: () => (
    <Matrix maxWidth={1000}>
      <State label="Two triggers, one workflow, a fan-out of three" direction="column">
        <G.FlowGraph label="Fan-out" layout="steps" direction="TB" nodes={fanNodes} edges={fanEdges} />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const graph = graphOf(canvasElement);
      const [order, hook, normalize, chat, sheet, stock] = ['order', 'hook', 'normalize', 'chat', 'sheet', 'stock'].map((id) => nodeBox(graph, id));
      const centre = (box: DOMRect) => (box.left + box.right) / 2;
      expect(Math.abs(order!.top - hook!.top)).toBeLessThanOrEqual(1);
      expect(hook!.left).toBeGreaterThan(order!.right);
      expect(Math.abs((centre(order!) + centre(hook!)) / 2 - centre(normalize!))).toBeLessThanOrEqual(2);
      expect(Math.abs(chat!.top - sheet!.top)).toBeLessThanOrEqual(1);
      expect(Math.abs(sheet!.top - stock!.top)).toBeLessThanOrEqual(1);
      expect(chat!.left).toBeLessThan(sheet!.left);
      expect(sheet!.left).toBeLessThan(stock!.left);
      expect(graph.querySelectorAll('.react-flow__edge').length).toBe(fanEdges.length);
    });
  },
};

const markNodes: ReadonlyArray<G.FlowGraphNode> = [
  { id: 'start', kind: 'event', label: 'New order', tag: 'Trigger' },
  { id: 'check', kind: 'condition', label: 'Paid?', outputs: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] },
  { id: 'ship', kind: 'action', label: 'Ship the goods' },
  { id: 'remind', kind: 'action', label: 'Payment reminder' },
];
const markEdges: ReadonlyArray<G.FlowGraphEdge> = [
  { id: 'm1', source: 'start', target: 'check' },
  { id: 'm2', source: 'check', target: 'ship', sourcePort: 'yes' },
  { id: 'm3', source: 'check', target: 'remind', sourcePort: 'no' },
];

/** 0.37.27 (drawing C): every edge STARTS with a round dot (r 4, a white disc ringed in the edge's colour) on its port or anchor, the arrowhead is a small solid triangle; the tag chip is 18px high. */
export const PortsArrowheadsAndTag: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="A ringed start dot on every edge, small solid arrowheads, an 18px tag chip" direction="column">
        <G.FlowGraph label="Marks" layout="steps" direction="TB" nodes={markNodes} edges={markEdges} />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const graph = graphOf(canvasElement);
      // One start dot per edge (graph units, so the fit's zoom does not change it): r 4, the surface fill, a ring in the edge's colour.
      const dots = Array.from(graph.querySelectorAll<SVGCircleElement>('[data-grammar-flow-edge-dot]'));
      expect(dots.length).toBe(markEdges.length);
      for (const dot of dots) {
        expect(Number(dot.getAttribute('r'))).toBe(4);
        expect(getComputedStyle(dot).fill).not.toBe(getComputedStyle(dot).stroke);
      }
      // The handles draw no dot of their own any more.
      expect(getComputedStyle(graph.querySelector<HTMLElement>('.starci-core-flow-graph-step-port-dot')!).backgroundColor).toBe('rgba(0, 0, 0, 0)');
      const tag = graph.querySelector<HTMLElement>('[data-grammar-flow-tag]')!;
      expect(tag.offsetHeight).toBe(18);
      expect(getComputedStyle(tag).fontSize).toBe('12px');
      const head = graph.querySelector('marker polyline.arrowclosed');
      expect(head).not.toBeNull();
    });
  },
};

/** Six unconnected workflows of 2-3 steps and one connected chain of five (the Sales agent): `islands="wrap"` (the default) fills rows by the canvas width instead of one tall column. */
const wrapNodes: ReadonlyArray<G.FlowGraphNode> = [
  ...[1, 2, 3, 4, 5, 6].flatMap((n): ReadonlyArray<G.FlowGraphNode> => [
    { id: `w${n}a`, kind: 'event', label: `Flow ${n}`, tag: 'Trigger' },
    { id: `w${n}b`, kind: 'action', label: `Task ${n}` },
    ...(n % 2 === 0 ? [{ id: `w${n}c`, kind: 'end' as const, label: 'Xong' }] : []),
  ]),
  { id: 'c1', kind: 'event', label: 'Main chain', tag: 'Trigger' },
  { id: 'c2', kind: 'action', label: 'Step 2' },
  { id: 'c3', kind: 'action', label: 'Step 3' },
  { id: 'c4', kind: 'action', label: 'Step 4' },
  { id: 'c5', kind: 'end', label: 'Xong' },
];
const wrapEdges: ReadonlyArray<G.FlowGraphEdge> = [
  ...[1, 2, 3, 4, 5, 6].flatMap((n): ReadonlyArray<G.FlowGraphEdge> => [
    { id: `we${n}a`, source: `w${n}a`, target: `w${n}b` },
    ...(n % 2 === 0 ? [{ id: `we${n}b`, source: `w${n}b`, target: `w${n}c` }] : []),
  ]),
  { id: 'ce1', source: 'c1', target: 'c2' },
  { id: 'ce2', source: 'c2', target: 'c3' },
  { id: 'ce3', source: 'c3', target: 'c4' },
  { id: 'ce4', source: 'c4', target: 'c5' },
];

export const IslandsWrap: Story = {
  render: () => (
    <div style={{ width: 1100 }}>
      <G.FlowGraph label="Islands wrap" layout="steps" direction="TB" nodes={wrapNodes} edges={wrapEdges} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const graph = graphOf(canvasElement);
      const roots = ['w1a', 'w2a', 'w3a', 'w4a', 'w5a', 'w6a', 'c1'].map((id) => nodeBox(graph, id));
      // Not one column: the island roots stand at several distinct x origins and several rows.
      expect(new Set(roots.map((box) => Math.round(box.left))).size).toBeGreaterThanOrEqual(2);
      expect(new Set(roots.map((box) => Math.round(box.top))).size).toBeLessThan(roots.length);
      // The connected chain stays one island: its steps stand in one column, top to bottom.
      const chain = ['c1', 'c2', 'c3', 'c4', 'c5'].map((id) => nodeBox(graph, id));
      for (let i = 1; i < chain.length; i += 1) expect(chain[i]!.top).toBeGreaterThan(chain[i - 1]!.bottom);
    });
  },
};

/** `islands="stack"` keeps the 0.37.4 arrangement: one column, left edges aligned. */
export const IslandsStackKept: Story = {
  render: () => (
    <div style={{ width: 1100 }}>
      <G.FlowGraph label="Islands stack" layout="steps" direction="TB" islands="stack" nodes={wrapNodes} edges={wrapEdges} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const graph = graphOf(canvasElement);
      const roots = ['w1a', 'w2a', 'w3a', 'w4a', 'w5a', 'w6a', 'c1'].map((id) => nodeBox(graph, id));
      expect(new Set(roots.map((box) => Math.round(box.left))).size).toBe(1);
    });
  },
};
