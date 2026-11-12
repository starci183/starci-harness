import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import { Matrix, State } from './fixtures.js';

/**
 * 0.37.27 (owner drawing C, "C trò yêu"): a steps graph reads LEFT → RIGHT by default and a branching step fans its children out down the page. Edges are
 * ORTHOGONAL ONLY (straight along x or y, a 10px rounded corner at every turn, siblings leaving one shared trunk); every edge STARTS with a round dot (a white
 * disc ringed in the edge's colour) and ends with a small solid triangle in its colour. Cards are white with a 1px border on the dotted ground, on the page
 * and in a Drawer. A run's path is green (taken edges and the cards it reached); the cards it did not reach are faded. The readable floor holds (zoom >= 0.8 since 0.37.29, pan).
 */
const meta: Meta = { title: 'Flow graph style C (0.37.27)', parameters: { grammar: { bleed: false, minHeight: '40rem' } } };
export default meta;
type Story = StoryObj;

const nodes: ReadonlyArray<G.FlowGraphNode> = [
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
const edges: ReadonlyArray<G.FlowGraphEdge> = [
  { id: 'e1', source: 'new', target: 'intent' },
  { id: 'e2', source: 'intent', target: 'sales', sourcePort: 'buy' },
  { id: 'e3', source: 'intent', target: 'accounting', sourcePort: 'paid' },
  { id: 'e4', source: 'intent', target: 'answer', sourcePort: 'ask' },
  { id: 'e5', source: 'intent', target: 'receive', sourcePort: 'complain' },
  { id: 'e6', source: 'receive', target: 'handoff' },
];

/** The run that took "Muốn mua": the trigger, the intent and Tư vấn reached, the rest not. */
const runNodes: ReadonlyArray<G.FlowGraphNode> = nodes.map((node) => (node.id === 'new' || node.id === 'intent' || node.id === 'sales' ? { ...node, status: 'done' as const } : node));
const runEdges: ReadonlyArray<G.FlowGraphEdge> = edges.map((edge) => ({ ...edge, isTaken: edge.id === 'e1' || edge.id === 'e2' }));

const graphsOf = (root: HTMLElement): HTMLElement[] => Array.from(root.ownerDocument.querySelectorAll<HTMLElement>('[data-component="FlowGraph"][data-grammar-flow-layout="steps"]'));

/** Every straight run of a path is along x or along y (the corners are the Q curves between them). */
const assertOrthogonal = (d: string) => {
  const numbers = (text: string) => text.trim().split(/[\s,]+/).map(Number);
  let at: [number, number] | null = null;
  for (const [, command, args] of d.matchAll(/([MLQ])([^MLQ]*)/g)) {
    const values = numbers(args!);
    if (command === 'M') at = [values[0]!, values[1]!];
    else if (command === 'L') {
      const next: [number, number] = [values[0]!, values[1]!];
      expect(Math.min(Math.abs(next[0] - at![0]), Math.abs(next[1] - at![1]))).toBeLessThan(0.5);
      at = next;
    } else at = [values[2]!, values[3]!];
  }
};

/** Drawing C: LR, dotted ground, orthogonal edges each starting with a white ringed dot and ending with an arrowhead. */
const assertStyleC = (graph: HTMLElement) => {
  expect(graph.getAttribute('data-grammar-flow-direction')).toBe('LR');
  expect(graph.getAttribute('data-grammar-flow-background')).toBe('dots');
  const edgeGroups = Array.from(graph.querySelectorAll<SVGGElement>('.react-flow__edge'));
  expect(edgeGroups.length).toBe(edges.length);
  for (const group of edgeGroups) {
    const path = group.querySelector<SVGPathElement>('.react-flow__edge-path')!;
    assertOrthogonal(path.getAttribute('d')!);
    expect(path.getAttribute('marker-end')).toMatch(/^url\(/);
    const dot = group.querySelector<SVGCircleElement>('[data-grammar-flow-edge-dot]')!;
    expect(Number(dot.getAttribute('r'))).toBe(4);
    const start = path.getAttribute('d')!.match(/^M\s*([-\d.]+)[\s,]+([-\d.]+)/)!;
    expect(Math.abs(Number(dot.getAttribute('cx')) - Number(start[1]))).toBeLessThan(0.5);
    expect(Math.abs(Number(dot.getAttribute('cy')) - Number(start[2]))).toBeLessThan(0.5);
    expect(getComputedStyle(dot).fill).not.toBe(getComputedStyle(dot).stroke);
  }
  // A branching step fans down: the four children of the intent stand at one x, one below the other.
  const children = ['sales', 'accounting', 'answer', 'receive'].map((id) => graph.querySelector<HTMLElement>(`[data-grammar-flow-node="${id}"]`)!.getBoundingClientRect());
  for (const box of children) expect(Math.abs(box.left - children[0]!.left)).toBeLessThan(1);
  for (let index = 1; index < children.length; index += 1) expect(children[index]!.top).toBeGreaterThan(children[index - 1]!.bottom);
};

export const LeTanBranching: Story = {
  name: 'Lễ tân: left → right, a four-way fan, orthogonal edges with a start dot',
  render: () => (
    <Matrix maxWidth={1160}>
      <State label="Default steps graph (LR)" direction="column">
        <G.FlowGraph label="Lễ tân" layout="steps" showControls nodes={nodes} edges={edges} />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const [graph] = graphsOf(canvasElement);
      assertStyleC(graph!);
      const zoom = new DOMMatrixReadOnly(getComputedStyle(graph!.querySelector<HTMLElement>('.react-flow__viewport')!).transform).a;
      expect(zoom).toBeGreaterThanOrEqual(0.8 - 0.001);
    });
  },
};

export const LeTanRun: Story = {
  name: 'Lễ tân run: the path taken is green, the rest faded',
  render: () => (
    <Matrix maxWidth={1160}>
      <State label="A run that took “Muốn mua”" direction="column">
        <G.FlowGraph label="Lễ tân, lần chạy" layout="steps" nodes={runNodes} edges={runEdges} />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const [graph] = graphsOf(canvasElement);
      assertStyleC(graph!);
      const probe = document.createElement('span');
      probe.style.color = 'var(--success)';
      graph!.append(probe);
      const success = getComputedStyle(probe).color;
      probe.remove();
      const taken = Array.from(graph!.querySelectorAll<SVGGElement>('.starci-core-flow-graph-edge-taken'));
      expect(taken.length).toBe(2);
      for (const group of taken) {
        expect(getComputedStyle(group.querySelector('.react-flow__edge-path')!).stroke).toBe(success);
        expect(getComputedStyle(group.querySelector('[data-grammar-flow-edge-dot]')!).stroke).toBe(success);
      }
      expect(getComputedStyle(graph!.querySelector<HTMLElement>('[data-grammar-flow-node="sales"]')!).borderTopColor).toBe(success);
      expect(Number.parseFloat(getComputedStyle(graph!.querySelector<HTMLElement>('[data-grammar-flow-node="answer"]')!).opacity)).toBeLessThan(1);
    });
  },
};

export const LeTanInDrawer: Story = {
  name: 'The same in a Drawer (versions diff): dotted ground, held at zoom 0.8, pans',
  parameters: { grammar: { minHeight: '48rem' } },
  render: () => (
    <G.Drawer defaultOpen placement="right" title="Bản 1, bản đầu tiên" closeLabel="Đóng" trigger={<G.Button intent="alternative">Mở</G.Button>}>
      <G.Section title="Sơ đồ" headingLevel={2}>
        <G.FlowGraph label="Lễ tân, bản 1" layout="steps" isInteractive={false} fit="contain" height="lg" nodes={runNodes} edges={runEdges} />
      </G.Section>
    </G.Drawer>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const [graph] = graphsOf(canvasElement);
      assertStyleC(graph!);
      expect(graph!.getAttribute('data-grammar-flow-framed')).toBe('false');
      expect(graph!.querySelector('.react-flow__background pattern circle, .starci-core-flow-graph-background circle')).not.toBeNull();
      const zoom = new DOMMatrixReadOnly(getComputedStyle(graph!.querySelector<HTMLElement>('.react-flow__viewport')!).transform).a;
      expect(zoom).toBeGreaterThanOrEqual(0.8 - 0.001);
    });
  },
};
