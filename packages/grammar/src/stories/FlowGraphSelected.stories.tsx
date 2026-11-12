import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import { noop } from './fixtures.js';

/**
 * FLOW GRAPH SELECTED + 176 CARDS + BRANCH LANES (0.37.35, owner drawing graph-selected). A selected step has ONE border, 2px, in its status colour (done
 * success, failed danger, waiting warning, running accent, skipped and not reached muted) and a soft tint of that colour as its ground; never a second ring
 * (no outline, no box-shadow). Unselected = 1px. A map with no run status selects in the foreground colour. Keyboard focus shows only on `:focus-visible`: a
 * dashed outline in the card's own border colour, 3px off the card (DNA-COMMON-FLOW-SELECTED). A step card is 176 x 64, title 14 (at most two lines) and one
 * 12 line. A condition's branches each run their own lane, turn once into their target and never pass it (DNA-COMMON-FLOW-BRANCH-LANES). And the card
 * suggestions list keeps its chevron at the end of the row at 390 (DNA-COMMON-CARD-SUGGESTIONS).
 */
const meta: Meta = { title: 'Flow graph selected (0.37.35)', parameters: { layout: 'fullscreen' } };
export default meta;
type Story = StoryObj;

/** The receptionist graph as the workflow map draws it: the trigger, the intent with four ports, two hand-offs with chips, the answer, the complaint and its end. */
const handoffChips = (agent: string, workflow: string): ReadonlyArray<G.FlowGraphChip> => [
  { label: `Agent: ${agent}`, tone: 'accent' },
  { label: `Flow: ${workflow}` },
  { label: 'Version: latest' },
];
const receptionNodes: ReadonlyArray<G.FlowGraphNode> = [
  { id: 'new', kind: 'event', label: 'New event', description: 'Message, payment, timer', tag: 'Trigger' },
  {
    id: 'understand', kind: 'condition', label: 'Classify request', description: 'route the customer message',
    outputs: [{ id: 'buy', label: 'Wants to buy' }, { id: 'paid', label: 'Payment sent' }, { id: 'question', label: 'Asks a question' }, { id: 'complaint', label: 'Complaint' }],
  },
  { id: 'to-consult', kind: 'event', label: 'Hand off to flow', description: 'Sales', chips: handoffChips('sales', 'consult') },
  { id: 'to-reconcile', kind: 'event', label: 'Hand off to flow', description: 'Billing', chips: handoffChips('billing', 'reconcile') },
  { id: 'answer', kind: 'action', label: 'Answer the question', description: 'from the shop info' },
  { id: 'complaint', kind: 'action', label: 'Take complaint', description: 'apologise, summarise for owner' },
  { id: 'to-owner', kind: 'end', label: 'Hand to owner' },
];
const receptionEdges: ReadonlyArray<G.FlowGraphEdge> = [
  { id: 'e1', source: 'new', target: 'understand' },
  { id: 'e-buy', source: 'understand', target: 'to-consult', sourcePort: 'buy' },
  { id: 'e-paid', source: 'understand', target: 'to-reconcile', sourcePort: 'paid' },
  { id: 'e-question', source: 'understand', target: 'answer', sourcePort: 'question' },
  { id: 'e-complaint', source: 'understand', target: 'complaint', sourcePort: 'complaint' },
  { id: 'e-owner', source: 'complaint', target: 'to-owner' },
];
const branchIds = ['e-buy', 'e-paid', 'e-question', 'e-complaint'] as const;

/** The run of the drawing: the buy branch was taken; the rest was not reached. */
const runNodes = (status: G.FlowGraphRunStatus): ReadonlyArray<G.FlowGraphNode> => receptionNodes.map((node) =>
  node.id === 'new' || node.id === 'understand' ? { ...node, status: 'done' } : node.id === 'to-consult' ? { ...node, status } : { ...node, status: 'skipped' });
const runEdges: ReadonlyArray<G.FlowGraphEdge> = receptionEdges.map((edge) => ({ ...edge, isTaken: edge.id === 'e1' || edge.id === 'e-buy' }));

/** The workflow map well: 1160px wide at a 1440 page, the graph filling the rest of an 800px page. */
const Well = ({ children }: { readonly children: React.ReactNode }) => (
  <div data-story-well="true" style={{ boxSizing: 'border-box', width: 'min(1160px, 100%)', height: 800, overflowY: 'auto', background: 'var(--background)' }}>
    <G.Stack gap="row">
      <G.Heading level={2}>Diagram</G.Heading>
      {children}
    </G.Stack>
  </div>
);

const Graph = ({ nodes, edges, initial }: { readonly nodes: ReadonlyArray<G.FlowGraphNode>, readonly edges: ReadonlyArray<G.FlowGraphEdge>, readonly initial: string | null }) => {
  const [selected, setSelected] = useState<string | null>(initial);
  return <G.FlowGraph label="Flow diagram" layout="steps" height="fill" nodes={nodes} edges={edges} selectedId={selected} onSelect={setSelected} />;
};

/** A token's colour as the browser computes it. */
const tokenColour = (host: Element, token: string): string => {
  const probe = document.createElement('div');
  probe.style.color = `var(${token})`;
  host.appendChild(probe);
  const colour = getComputedStyle(probe).color;
  probe.remove();
  return colour;
};
const cardOf = (graph: HTMLElement, id: string) => graph.querySelector<HTMLElement>(`.starci-core-flow-graph-step[data-grammar-flow-node="${id}"]`)!;

/** ONE border: every side the given width and colour, no outline, no box-shadow ring; a selected card's ground is a tint, not the plain surface. */
const assertOneBorder = (card: HTMLElement, width: number, colour: string, isSelected: boolean) => {
  const style = getComputedStyle(card);
  for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
    expect(Number.parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`))).toBe(width);
    expect(style.getPropertyValue(`border-${side.toLowerCase()}-color`)).toBe(colour);
  }
  expect(style.boxShadow).toBe('none');
  if (isSelected) {
    expect(style.outlineStyle).toBe('none');
    expect(style.backgroundColor).not.toBe(tokenColour(card, '--surface'));
  }
};

const runStory = (status: G.FlowGraphRunStatus, token: string): Story => ({
  render: () => <Well><Graph nodes={runNodes(status)} edges={runEdges} initial="to-consult" /></Well>,
  play: async ({ canvasElement }) => {
    const graph = canvasElement.querySelector<HTMLElement>('[data-component="FlowGraph"]')!;
    await waitFor(() => expect(cardOf(graph, 'to-consult').getAttribute('data-grammar-selected')).toBe('true'));
    const selected = cardOf(graph, 'to-consult');
    assertOneBorder(selected, 2, tokenColour(selected, token), true);
    expect(selected.offsetWidth).toBe(176);
    // an unselected card of the run keeps one 1px border in its own status colour
    const done = cardOf(graph, 'new');
    assertOneBorder(done, 1, tokenColour(done, '--success'), false);
    // selecting another card moves the one border: the first returns to 1px
    await userEvent.click(cardOf(graph, 'understand'));
    await waitFor(() => expect(cardOf(graph, 'understand').getAttribute('data-grammar-selected')).toBe('true'));
    // the test's click focuses the node by script, which the browser may treat as keyboard focus; a real mouse click shows no focus outline
    (document.activeElement as HTMLElement | null)?.blur();
    assertOneBorder(cardOf(graph, 'understand'), 2, tokenColour(selected, '--success'), true);
    assertOneBorder(cardOf(graph, 'to-consult'), 1, tokenColour(selected, token), false);
  },
});

/** A run, the done hand-off selected: one 2px green border and a soft green ground (the drawing's right panel); no red ring. */
export const RunSelectedDone: Story = runStory('done', '--success');
/** A failed step selected: one 2px danger border. */
export const RunSelectedFailed: Story = runStory('failed', '--danger');
/** A waiting step selected: one 2px warning (amber) border. */
export const RunSelectedWaiting: Story = runStory('waiting', '--warning');

/** The workflow map (no run status): the selected card is one 2px border in the foreground colour; the others 1px in the card border token. */
export const MapSelectedForeground: Story = {
  render: () => <Well><Graph nodes={receptionNodes} edges={receptionEdges} initial="answer" /></Well>,
  play: async ({ canvasElement }) => {
    const graph = canvasElement.querySelector<HTMLElement>('[data-component="FlowGraph"]')!;
    await waitFor(() => expect(cardOf(graph, 'answer').getAttribute('data-grammar-selected')).toBe('true'));
    const card = cardOf(graph, 'answer');
    assertOneBorder(card, 2, tokenColour(card, '--foreground'), true);
    expect(card.offsetWidth).toBe(176);
    expect(card.offsetHeight).toBe(64);
    const other = cardOf(graph, 'new');
    const border = document.createElement('div');
    border.style.color = 'var(--border)';
    other.appendChild(border);
    assertOneBorder(other, 1, getComputedStyle(border).color, false);
    border.remove();
  },
};

/** Keyboard focus (focus-visible only): a dashed outline in the card's own border colour, offset from it; a mouse selection shows no outline. */
export const KeyboardFocusSameColour: Story = {
  render: () => <Well><Graph nodes={runNodes('done')} edges={runEdges} initial="to-consult" /></Well>,
  play: async ({ canvasElement }) => {
    const graph = canvasElement.querySelector<HTMLElement>('[data-component="FlowGraph"]')!;
    await waitFor(() => expect(cardOf(graph, 'to-consult').getAttribute('data-grammar-selected')).toBe('true'));
    expect(getComputedStyle(cardOf(graph, 'to-consult')).outlineStyle).toBe('none');
    const wrapper = graph.querySelector<HTMLElement>('.react-flow__node[data-id="to-consult"]')!;
    // Tab into the graph until the selected card's node holds keyboard focus.
    for (let step = 0; step < 12 && document.activeElement !== wrapper; step += 1) await userEvent.tab();
    expect(document.activeElement).toBe(wrapper);
    const card = cardOf(graph, 'to-consult');
    await waitFor(() => expect(getComputedStyle(card).outlineStyle).toBe('dashed'));
    const style = getComputedStyle(card);
    expect(style.outlineColor).toBe(style.borderTopColor);
    expect(Number.parseFloat(style.outlineOffset)).toBeGreaterThan(0);
    expect(style.boxShadow).toBe('none');
  },
};

/** The parsed points of an edge path (M / L / Q coordinates), in flow units. */
const pathPoints = (path: SVGPathElement): ReadonlyArray<{ readonly x: number, readonly y: number }> => {
  const numbers = (path.getAttribute('d') ?? '').match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  const points: Array<{ x: number, y: number }> = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) points.push({ x: numbers[index]!, y: numbers[index + 1]! });
  return points;
};

/**
 * The receptionist map: each branch leaves its port, turns once into its own lane and once into its target; no segment runs above the higher or below the lower of its
 * port and its target, no two branches share a lane, and the graph fits the 1160 well whole.
 */
export const BranchLanesNoOvershoot: Story = {
  render: () => <Well><Graph nodes={receptionNodes} edges={receptionEdges} initial={null} /></Well>,
  play: async ({ canvasElement }) => {
    const graph = canvasElement.querySelector<HTMLElement>('[data-component="FlowGraph"]')!;
    await waitFor(() => expect(graph.querySelectorAll('.starci-core-flow-graph-step').length).toBe(receptionNodes.length));
    await waitFor(() => expect(graph.querySelector(`[data-testid="rf__edge-e-complaint"] path`)).not.toBeNull());
    const lanes: number[] = [];
    for (const id of branchIds) {
      const points = pathPoints(graph.querySelector<SVGPathElement>(`[data-testid="rf__edge-${id}"] .react-flow__edge-path`)!);
      const first = points[0]!;
      const last = points[points.length - 1]!;
      const low = Math.min(first.y, last.y) - 0.5;
      const high = Math.max(first.y, last.y) + 0.5;
      for (const point of points) {
        expect(point.y).toBeGreaterThanOrEqual(low);
        expect(point.y).toBeLessThanOrEqual(high);
        expect(point.x).toBeGreaterThanOrEqual(first.x - 0.5);
        expect(point.x).toBeLessThanOrEqual(last.x + 0.5);
      }
      // a branch that turns has one vertical run: its lane, the x of every point between its two horizontal runs
      if (Math.abs(first.y - last.y) > 0.5) {
        const vertical = points.filter((point) => point.y > low + 1 && point.y < high - 1).map((point) => Math.round(point.x));
        expect(new Set(vertical).size).toBe(1);
        lanes.push(vertical[0]!);
      }
    }
    expect(lanes.length).toBeGreaterThan(0);
    expect(new Set(lanes).size).toBe(lanes.length);
    // the whole graph shows in the well at 1440 (fitted, or zoom 1 with everything inside)
    const canvas = graph.querySelector<HTMLElement>('.starci-core-flow-graph-canvas')!.getBoundingClientRect();
    if (canvas.width >= 1150) {
      for (const card of graph.querySelectorAll<HTMLElement>('.starci-core-flow-graph-step')) {
        const box = card.getBoundingClientRect();
        expect(box.top).toBeGreaterThanOrEqual(canvas.top);
        expect(box.bottom).toBeLessThanOrEqual(canvas.bottom);
        expect(box.right).toBeLessThanOrEqual(canvas.right);
      }
    }
  },
};

/** The card suggestions at 390: every row keeps its chevron at the end, on the text's line block, vertically centred; the text wraps beside it. */
export const SuggestionsChevron390: Story = {
  render: () => (
    <div style={{ width: 390, boxSizing: 'border-box', padding: 16, background: 'var(--background)' }}>
      <G.SurfaceCard
        kind="list"
        layout="suggestions"
        ariaLabel="Reply suggestions"
        empty={null}
        items={[
          { id: 'paid', title: 'Order OR-0004 was paid in full at $1,000, the extra $2 stays as a tip or is refunded later', onPress: noop },
          { id: 'short', title: 'Resend the link', onPress: noop },
          { id: 'fix', title: 'Fix the messaging tool error, then let me rerun the reply step', onPress: noop },
        ]}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const rows = [...canvasElement.querySelectorAll<HTMLElement>('[data-grammar-list-layout="suggestions"] > .starci-core-list-row')];
    expect(rows.length).toBe(3);
    for (const row of rows) {
      const text = row.querySelector<HTMLElement>('.starci-core-list-row-name')!.getBoundingClientRect();
      const chevron = row.querySelector<HTMLElement>('[data-grammar-row-chevron="true"]')!.getBoundingClientRect();
      // at the end of the same line block, beside the text, never under it
      expect(chevron.left).toBeGreaterThanOrEqual(text.right - 0.5);
      expect(chevron.top).toBeGreaterThanOrEqual(text.top - 0.5);
      expect(chevron.bottom).toBeLessThanOrEqual(text.bottom + 0.5);
      expect(Math.abs((chevron.top + chevron.bottom) / 2 - (text.top + text.bottom) / 2)).toBeLessThanOrEqual(1.5);
    }
  },
};
