import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import { Matrix, State } from './fixtures.js';
import { body13, body4, decisionGraph, decisionLegend, payLoop } from './FlowGraphDecisionLoop.data.js';

/**
 * FlowGraph `steps` 0.39.1: a decision drawn as a DIAMOND (`shape: "diamond"`), a LOOP FRAME (`container.kind: "loop"`: dashed, its description, its note, its
 * exits on its edge), a dashed FALLBACK road (`isFallback`) and the legend's `loop` and diamond entries. Laws DNA-COMMON-FLOW-DIAMOND and DNA-COMMON-FLOW-LOOP-FRAME.
 */
const meta: Meta = {
  title: 'Flow graph decision and loop (0.39.1)',
  parameters: { grammar: { bleed: false } },
};
export default meta;

type Story = StoryObj;

const graphOf = (canvasElement: HTMLElement, index = 0): HTMLElement => {
  const graph = canvasElement.querySelectorAll<HTMLElement>('[data-component="FlowGraph"][data-grammar-flow-layout="steps"]')[index];
  if (graph === undefined) throw new Error('The steps graph must render');
  return graph;
};
const boxOf = (graph: HTMLElement, id: string): DOMRect => {
  const node = graph.querySelector<HTMLElement>(`[data-grammar-flow-node="${id}"]`);
  if (node === null) throw new Error(`The node ${id} must render`);
  return node.getBoundingClientRect();
};
const overlaps = (a: DOMRect, b: DOMRect): boolean => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
/** The viewport zoom React Flow applied. */
const zoomOf = (graph: HTMLElement): number => new DOMMatrixReadOnly(getComputedStyle(graph.querySelector<HTMLElement>('.react-flow__viewport')!).transform).a;

/** No two step cards (diamonds included) overlap, and no port word of a diamond lies on a card. */
const assertNoOverlap = (graph: HTMLElement) => {
  const cards = [...graph.querySelectorAll<HTMLElement>('.starci-core-flow-graph-step')].map((card) => ({ id: card.dataset['grammarFlowNode'], box: card.getBoundingClientRect() }));
  for (const [index, card] of cards.entries()) {
    for (const other of cards.slice(index + 1)) expect(overlaps(card.box, other.box), `${String(card.id)} overlaps ${String(other.id)}`).toBe(false);
  }
  for (const word of graph.querySelectorAll<HTMLElement>('.starci-core-flow-graph-diamond-port')) {
    const box = word.getBoundingClientRect();
    for (const card of cards) {
      if (card.id === word.closest<HTMLElement>('[data-grammar-flow-node]')?.dataset['grammarFlowNode']) continue;
      expect(overlaps(box, card.box), `the port word ${String(word.textContent)} lies on ${String(card.id)}`).toBe(false);
    }
  }
};

/** The loop frame holds its body, is dashed with no fill, shows its header, note and exits on its end edge, and the cards its exits lead to stand outside it. */
const assertLoopFrame = (graph: HTMLElement, bodyIds: ReadonlyArray<string>, direction: 'LR' | 'TB') => {
  const frame = graph.querySelector<HTMLElement>('[data-grammar-flow-container][data-kind="loop"]');
  if (frame === null) throw new Error('The loop frame must render');
  expect(getComputedStyle(frame).borderTopStyle).toBe('dashed');
  expect(getComputedStyle(frame).backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(frame.querySelector('.starci-core-flow-graph-container-label')?.textContent).toBe('Wait for payment');
  const description = frame.querySelector<HTMLElement>('.starci-core-flow-graph-container-description');
  expect(description?.textContent).toBe('up to 6 rounds');
  expect(getComputedStyle(description!).fontSize).toBe('12px');
  const note = frame.querySelector<HTMLElement>('[data-grammar-flow-note]');
  expect(note?.textContent).toBe('Not out yet: back to the first step');
  expect(getComputedStyle(note!).fontSize).toBe('12px');
  const box = frame.getBoundingClientRect();
  for (const id of bodyIds) {
    const child = boxOf(graph, id);
    expect(child.left).toBeGreaterThanOrEqual(box.left - 1);
    expect(child.right).toBeLessThanOrEqual(box.right + 1);
    expect(child.top).toBeGreaterThanOrEqual(box.top - 1);
    expect(child.bottom).toBeLessThanOrEqual(box.bottom + 1);
  }
  const exits = [...frame.querySelectorAll<HTMLElement>('[data-grammar-flow-exit]')];
  expect(exits.map((exit) => exit.textContent)).toEqual(['Leave when the order is paid', '6 rounds without payment']);
  for (const exit of exits) {
    const pill = exit.getBoundingClientRect();
    expect(getComputedStyle(exit).fontSize).toBe('12px');
    // ON the end edge: the pill crosses the frame's right (LR) or bottom (TB) edge.
    if (direction === 'LR') {
      expect(pill.left).toBeLessThan(box.right);
      expect(pill.right).toBeGreaterThan(box.right);
    } else {
      expect(pill.top).toBeLessThan(box.bottom);
      expect(pill.bottom).toBeGreaterThan(box.bottom);
    }
  }
  // Each exit leads to a card outside the frame, its edge leaving the pill.
  for (const id of ['thanks', 'drop']) expect(overlaps(boxOf(graph, id), box)).toBe(false);
  expect(graph.querySelector('.react-flow__edge[data-id="x-paid"]')).not.toBeNull();
  expect(graph.querySelector('.react-flow__edge[data-id="x-exhausted"]')).not.toBeNull();
};

/** One decision diamond with its question and two branches, across and down; the wait's timed-out road is the dashed fallback. */
export const Diamond: Story = {
  render: () => (
    <Matrix maxWidth={1160}>
      <State label="Across (LR)" direction="column">
        <G.FlowGraph label="Decision across" layout="steps" nodes={decisionGraph.nodes} edges={decisionGraph.edges} legend={decisionLegend} />
      </State>
      <State label="Down (TB)" direction="column">
        <G.FlowGraph label="Decision down" layout="steps" direction="TB" nodes={decisionGraph.nodes} edges={decisionGraph.edges} legend={decisionLegend} />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      for (const index of [0, 1]) {
        const graph = graphOf(canvasElement, index);
        const diamond = graph.querySelector<HTMLElement>('[data-grammar-flow-diamond][data-grammar-flow-node="enough"]');
        if (diamond === null) throw new Error('The decision must draw as a diamond');
        expect(diamond.offsetWidth).toBe(176);
        expect(diamond.offsetHeight).toBe(88);
        expect(diamond.querySelector('polygon')).not.toBeNull();
        const question = diamond.querySelector<HTMLElement>('.starci-core-flow-graph-diamond-label')!;
        expect(question.textContent).toBe('Enough paid?');
        expect(getComputedStyle(question).fontSize).toBe('14px');
        const words = [...diamond.querySelectorAll<HTMLElement>('.starci-core-flow-graph-diamond-port')];
        expect(words.map((word) => word.textContent)).toEqual(['Yes', 'No']);
        expect(words.map((word) => word.dataset['side'])).toEqual(['start', 'end']);
        expect(getComputedStyle(words[0]!).fontSize).toBe('12px');
        // Each branch leaves its side vertex: the Yes target stands before the diamond across the flow, the No target after it.
        const own = diamond.getBoundingClientRect();
        const yes = boxOf(graph, 'record');
        const no = boxOf(graph, 'hold');
        if (index === 0) {
          expect(yes.top + yes.height / 2).toBeLessThan(own.top);
          expect(no.top + no.height / 2).toBeGreaterThan(own.bottom);
        } else {
          expect(yes.left + yes.width / 2).toBeLessThan(own.left);
          expect(no.left + no.width / 2).toBeGreaterThan(own.right);
        }
        // The timed-out road is dashed; the other forward edges are solid.
        const fallback = graph.querySelector<SVGPathElement>('.starci-core-flow-graph-edge-fallback .react-flow__edge-path');
        if (fallback === null) throw new Error('The fallback road must render');
        expect(getComputedStyle(fallback).strokeDasharray).not.toBe('none');
        expect(getComputedStyle(graph.querySelector<SVGPathElement>('.react-flow__edge[data-id="d-record"] .react-flow__edge-path')!).strokeDasharray).toBe('none');
        // The legend: the condition swatch turned on its corner, the loop swatch dashed.
        const legend = graph.querySelector<HTMLElement>('[data-grammar-flow-legend]')!;
        expect(getComputedStyle(legend.querySelector<HTMLElement>('[data-kind="condition"] .starci-core-flow-graph-legend-swatch')!).transform).not.toBe('none');
        expect(getComputedStyle(legend.querySelector<HTMLElement>('[data-kind="loop"] .starci-core-flow-graph-legend-swatch')!).borderTopStyle).toBe('dashed');
        assertNoOverlap(graph);
      }
    });
  },
};

/** The workflow map well: 1160px wide at a 1440 page, the graph filling the rest of an 800px page. */
const Well = ({ nodes, edges, direction }: { readonly nodes: ReadonlyArray<G.FlowGraphNode>; readonly edges: ReadonlyArray<G.FlowGraphEdge>; readonly direction?: 'LR' | 'TB' }) => (
  <div data-story-well="true" style={{ boxSizing: 'border-box', width: 'min(1160px, 100%)', height: 800, overflowY: 'auto', background: 'var(--background)' }}>
    <G.FlowGraph label="Payment loop" layout="steps" height="fill" nodes={nodes} edges={edges} legend={decisionLegend} {...(direction === undefined ? {} : { direction })} />
  </div>
);

const loop4 = payLoop(body4);
const loop13 = payLoop(body13);

/** A loop frame round a body of 4 cards: dashed, its description, its note, two exits on its right edge leading out of it. */
export const LoopFrame4: Story = {
  name: 'Loop frame, body of 4 (1440)',
  render: () => <Well nodes={loop4.nodes} edges={loop4.edges} />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const graph = graphOf(canvasElement);
      assertLoopFrame(graph, body4.nodes.map((node) => node.id), 'LR');
      assertNoOverlap(graph);
      expect(zoomOf(graph)).toBeGreaterThanOrEqual(0.8);
    });
  },
};

/** The size of a real payment loop: 13 body cards, 6 of them diamonds, readable (zoom 0.8 or more, panning) with nothing overlapping. */
export const LoopFrame13: Story = {
  name: 'Loop frame, body of 13 (1440)',
  render: () => <Well nodes={loop13.nodes} edges={loop13.edges} />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const graph = graphOf(canvasElement);
      assertLoopFrame(graph, body13.nodes.map((node) => node.id), 'LR');
      expect(graph.querySelectorAll('[data-grammar-flow-diamond]').length).toBe(6);
      assertNoOverlap(graph);
      expect(zoomOf(graph)).toBeGreaterThanOrEqual(0.8);
    });
  },
};

/** The same loop down the page: the exits side by side on the frame's bottom edge. */
export const LoopFrameDown: Story = {
  name: 'Loop frame down (TB)',
  render: () => <Well nodes={loop4.nodes} edges={loop4.edges} direction="TB" />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const graph = graphOf(canvasElement);
      assertLoopFrame(graph, body4.nodes.map((node) => node.id), 'TB');
      assertNoOverlap(graph);
    });
  },
};

/** Dark mode: the diamond's ground is the card's surface, the frame stays a dashed outline with no fill. */
export const LoopFrameDark: Story = {
  name: 'Loop frame, body of 13 (dark)',
  globals: { grammarTheme: 'dark' },
  render: () => <Well nodes={loop13.nodes} edges={loop13.edges} />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const graph = graphOf(canvasElement);
      assertLoopFrame(graph, body13.nodes.map((node) => node.id), 'LR');
      const polygon = graph.querySelector<SVGPolygonElement>('[data-grammar-flow-diamond] polygon')!;
      const card = graph.querySelector<HTMLElement>('.starci-core-flow-graph-step:not([data-grammar-flow-diamond]):not([data-kind="end"])')!;
      expect(getComputedStyle(polygon).fill).toBe(getComputedStyle(card).backgroundColor);
      assertNoOverlap(graph);
    });
  },
};
