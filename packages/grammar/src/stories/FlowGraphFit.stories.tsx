import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import { Matrix, State } from './fixtures.js';

/**
 * 0.37.20: the initial fit contains every node (the controls' corner reserved) for a wide branching steps graph, and a graph inside a Drawer
 * measures its real container. The graph is the NIVO workflow map: a trigger, an intent step that branches four ways, one branch ending.
 */
const meta: Meta = {
  title: 'Flow graph fit (0.37.20)',
  parameters: { grammar: { bleed: false, minHeight: '40rem' } },
};
export default meta;

type Story = StoryObj;

const nodes: ReadonlyArray<G.FlowGraphNode> = [
  { id: 'new', kind: 'event', label: 'Có việc mới', description: 'Tin, tiền về, hẹn giờ', tag: 'Kích hoạt' },
  {
    id: 'intent', kind: 'condition', label: 'Hiểu ý khách', description: 'chọn hướng cho tin khách',
    outputs: [{ id: 'buy', label: 'Muốn mua' }, { id: 'paid', label: 'Báo đã chuyển' }, { id: 'ask', label: 'Hỏi thông tin' }, { id: 'complain', label: 'Khiếu nại' }],
  },
  { id: 'sales', kind: 'action', label: 'Chuyển sang quy trình', description: 'Bán hàng', chips: [{ label: 'Agent nhận việc: sales' }, { label: 'Quy trình: consult' }, { label: 'Phiên bản: latest' }] },
  { id: 'accounting', kind: 'action', label: 'Chuyển sang quy trình', description: 'Kế toán', chips: [{ label: 'Agent nhận việc: accounting' }, { label: 'Quy trình: reconcile' }, { label: 'Phiên bản: latest' }] },
  { id: 'answer', kind: 'action', label: 'Trả lời câu hỏi', description: 'từ thông tin của tiệm' },
  { id: 'receive', kind: 'action', label: 'Tiếp nhận khiếu nại', description: 'xin lỗi khách, báo đội' },
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

/** Every node box inside the canvas box and clear of the zoom controls. */
const assertContained = (graph: HTMLElement) => {
  const canvas = graph.querySelector<HTMLElement>('.react-flow')!.getBoundingClientRect();
  const controls = graph.querySelector<HTMLElement>('.starci-core-flow-graph-controls')?.getBoundingClientRect() ?? null;
  const boxes = Array.from(graph.querySelectorAll<HTMLElement>('[data-grammar-flow-node]'));
  expect(boxes.length).toBe(nodes.length);
  for (const element of boxes) {
    const box = element.getBoundingClientRect();
    expect(box.left).toBeGreaterThanOrEqual(canvas.left - 1);
    expect(box.right).toBeLessThanOrEqual(canvas.right + 1);
    expect(box.top).toBeGreaterThanOrEqual(canvas.top - 1);
    expect(box.bottom).toBeLessThanOrEqual(canvas.bottom + 1);
    if (controls !== null) expect(box.left < controls.right && box.right > controls.left && box.top < controls.bottom && box.bottom > controls.top).toBe(false);
  }
};
const graphOf = (root: HTMLElement): HTMLElement => {
  const graph = root.ownerDocument.querySelector<HTMLElement>('[data-component="FlowGraph"][data-grammar-flow-layout="steps"]');
  if (graph === null) throw new Error('The steps graph must render');
  return graph;
};

export const WideBranchingInPane: Story = {
  name: 'Wide branching graph in a page pane',
  render: () => (
    <Matrix maxWidth={1160}>
      <State label="Controls shown, default fit" direction="column">
        <G.FlowGraph label="Workflow map" layout="steps" showControls nodes={nodes} edges={edges} />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => assertContained(graphOf(canvasElement)));
  },
};

export const WideBranchingNarrow: Story = {
  name: 'Wide branching graph at 390',
  render: () => (
    <Matrix maxWidth={358}>
      <State label="Controls shown, default fit" direction="column">
        <G.FlowGraph label="Workflow map" layout="steps" showControls nodes={nodes} edges={edges} />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => assertContained(graphOf(canvasElement)));
  },
};

export const InDrawer: Story = {
  name: 'Same graph in a Drawer (fit contain)',
  parameters: { grammar: { minHeight: '48rem' } },
  render: () => (
    <G.Drawer defaultOpen placement="right" title="Bản 1" closeLabel="Close" trigger={<G.Button intent="alternative">Open</G.Button>}>
      <G.Section title="Sơ đồ" headingLevel={2}>
        <G.FlowGraph label="Workflow map" layout="steps" isInteractive={false} fit="contain" height="lg" nodes={nodes} edges={edges} />
      </G.Section>
    </G.Drawer>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const graph = graphOf(canvasElement);
      const canvas = graph.querySelector<HTMLElement>('.react-flow')!.getBoundingClientRect();
      expect(canvas.height).toBeGreaterThan(300);
      assertContained(graph);
      // Not a speck: the widest node renders at a readable fraction of the canvas.
      const widest = Math.max(...Array.from(graph.querySelectorAll<HTMLElement>('[data-grammar-flow-node]')).map((node) => node.getBoundingClientRect().width));
      expect(widest).toBeGreaterThan(canvas.width * 0.12);
    });
  },
};
