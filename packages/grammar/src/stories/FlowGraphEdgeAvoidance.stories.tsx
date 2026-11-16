import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * FlowGraph `steps` 0.39.4: an edge goes ROUND the cards. A real graph has a join (a branch that rejoins the main road two layers on) and a loop back to an
 * earlier step; the edge between two far cards would otherwise run through the cards between them. Every edge's drawn path is sampled and none of its points
 * lies inside a card other than its own two ends. The overview map (`minimap`) is the other 0.39.4 prop.
 */
const meta: Meta = {
  title: 'Flow graph edge routing and minimap (0.39.4)',
  parameters: { grammar: { bleed: false } },
};
export default meta;

type Story = StoryObj;

/** A loop with a join: `start` runs `fetch` → `wait` → `check`; `check` forks to `ship` or `refund`, which both rejoin at `notify`; `fetch` also feeds `notify` directly (a join two layers on), and `check` loops back to `wait`. */
const nodes: ReadonlyArray<G.FlowGraphNode> = [
  { id: 'start', kind: 'event', label: 'Order placed', description: 'New order' },
  { id: 'fetch', kind: 'action', label: 'Fetch the order', description: 'Read the lines' },
  { id: 'wait', kind: 'wait', label: 'Wait for payment', description: 'Up to 6 rounds' },
  { id: 'check', kind: 'condition', label: 'Paid?', description: 'Compare to the total', outputs: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] },
  { id: 'ship', kind: 'action', label: 'Ship the order', description: 'Book the carrier' },
  { id: 'refund', kind: 'action', label: 'Refund', description: 'Return the money' },
  { id: 'notify', kind: 'event', label: 'Notify the team', description: 'Send by Email' },
  { id: 'done', kind: 'end', label: 'Done' },
];

const edges: ReadonlyArray<G.FlowGraphEdge> = [
  { id: 'e1', source: 'start', target: 'fetch' },
  { id: 'e2', source: 'fetch', target: 'wait' },
  { id: 'e3', source: 'wait', target: 'check' },
  { id: 'e4', source: 'check', target: 'ship', sourcePort: 'yes' },
  { id: 'e5', source: 'check', target: 'refund', sourcePort: 'no' },
  { id: 'e6', source: 'ship', target: 'notify' },
  { id: 'e7', source: 'refund', target: 'notify' },
  { id: 'e8', source: 'notify', target: 'done' },
  { id: 'join', source: 'fetch', target: 'notify' },
  { id: 'loop', source: 'check', target: 'wait', variant: 'back', label: 'not yet' },
];

/** Every sampled point of every edge path stays outside the cards that are not the edge's own ends. */
const assertNoEdgeCrossesACard = (graph: HTMLElement, directed: ReadonlyArray<G.FlowGraphEdge>) => {
  const cards = new Map([...graph.querySelectorAll<HTMLElement>('[data-grammar-flow-node]')].map((card) => [card.dataset['grammarFlowNode'] as string, card.getBoundingClientRect()]));
  expect(cards.size).toBe(nodes.length);
  for (const edge of directed) {
    const path = graph.querySelector<SVGPathElement>(`.react-flow__edge[data-id="${edge.id}"] path.react-flow__edge-path`);
    if (path === null) throw new Error(`The edge ${edge.id} must render`);
    const matrix = path.getScreenCTM();
    if (matrix === null) throw new Error('The edge must be on screen');
    const length = path.getTotalLength();
    expect(length, `the edge ${edge.id} has a path`).toBeGreaterThan(0);
    for (let at = 0; at <= length; at += 3) {
      const local = path.getPointAtLength(at);
      const point = new DOMPoint(local.x, local.y).matrixTransform(matrix);
      for (const [id, box] of cards) {
        if (id === edge.source || id === edge.target) continue;
        const crosses = point.x > box.left + 1 && point.x < box.right - 1 && point.y > box.top + 1 && point.y < box.bottom - 1;
        expect(crosses, `the edge ${edge.id} crosses the card ${id} at ${String(Math.round(at))}`).toBe(false);
      }
    }
  }
};

const Well = ({ direction, minimap }: { readonly direction: 'LR' | 'TB'; readonly minimap?: boolean }) => (
  <div data-story-well="true" style={{ boxSizing: 'border-box', width: 'min(1160px, 100%)', height: 720, background: 'var(--background)' }}>
    <G.FlowGraph label="Order loop" layout="steps" height="fill" direction={direction} nodes={nodes} edges={edges} {...(minimap === true ? { minimap: true } : {})} />
  </div>
);

export const JoinAndLoopAcross: Story = {
  render: () => <Well direction="LR" />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const graph = canvasElement.querySelector<HTMLElement>('[data-component="FlowGraph"]')!;
      expect(graph.querySelectorAll('.react-flow__edge').length).toBe(edges.length);
      assertNoEdgeCrossesACard(graph, edges);
    });
  },
};

export const JoinAndLoopDown: Story = {
  render: () => <Well direction="TB" />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const graph = canvasElement.querySelector<HTMLElement>('[data-component="FlowGraph"]')!;
      expect(graph.querySelectorAll('.react-flow__edge').length).toBe(edges.length);
      assertNoEdgeCrossesACard(graph, edges);
    });
  },
};

/** `minimap`: the overview map is drawn in the canvas's corner in the surface tokens, with one block per card; it is named for assistive technology. */
export const Minimap: Story = {
  render: () => <Well direction="LR" minimap />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const map = canvasElement.querySelector<HTMLElement>('[data-grammar-flow-minimap="true"]');
      expect(map).not.toBeNull();
      expect(map!.querySelectorAll('.starci-core-flow-graph-minimap-node').length).toBe(nodes.length);
      expect(parseFloat(getComputedStyle(map!).borderTopWidth)).toBeGreaterThan(0);
    });
  },
};
