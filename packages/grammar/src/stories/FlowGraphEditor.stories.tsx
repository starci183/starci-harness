import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import { Matrix, State } from './fixtures.js';

/**
 * The FlowGraph editor additions of 0.37.5 (`steps`): a dot-grid ground (`background="dots"`, xyflow's own Background), blocks the user drags
 * (`isEditable`, `positions`, `onPositionsChange`, and a "Sắp xếp lại" reset in the zoom group), and an agent line (`FlowGraphNode.agent`) under the
 * title of a block that belongs to another agent.
 */
const meta: Meta = {
  title: 'Flow graph editor (0.37.5)',
  parameters: { grammar: { bleed: false } },
};
export default meta;

type Story = StoryObj;

const graphOf = (canvasElement: HTMLElement): HTMLElement => {
  const graph = canvasElement.querySelector<HTMLElement>('[data-component="FlowGraph"][data-grammar-flow-layout="steps"]');
  if (graph === null) throw new Error('The steps graph must render');
  return graph;
};

const nodes: ReadonlyArray<G.FlowGraphNode> = [
  { id: 'trigger', kind: 'event', label: 'Có đơn mới', tag: 'Kích hoạt' },
  { id: 'reply', kind: 'action', label: 'Soạn tin trả lời', description: 'Cho khách vừa đặt', agent: { name: 'Chatbot' } },
  { id: 'pack', kind: 'action', label: 'Đóng gói đơn', agent: { name: 'Kho vận' } },
  { id: 'done', kind: 'end', label: 'Xong' },
];
const edges: ReadonlyArray<G.FlowGraphEdge> = [
  { id: 'e1', source: 'trigger', target: 'reply' },
  { id: 'e2', source: 'trigger', target: 'pack' },
  { id: 'e3', source: 'reply', target: 'done' },
  { id: 'e4', source: 'pack', target: 'done' },
];

/** The canvas ground is a subtle dot grid (an SVG dot pattern at an 18px step), not the plain card. */
export const Dots: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="background=dots" direction="column">
        <G.FlowGraph label="Dots" layout="steps" background="dots" nodes={nodes} edges={edges} />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const graph = graphOf(canvasElement);
      expect(graph.getAttribute('data-grammar-flow-background')).toBe('dots');
      const pattern = graph.querySelector('.react-flow__background pattern');
      expect(pattern).not.toBeNull();
      expect(graph.querySelector('.react-flow__background pattern circle')).not.toBeNull();
    });
  },
};

const Editable = () => {
  const [positions, setPositions] = useState<G.FlowGraphPositions>({});
  return (
    <Matrix maxWidth={720}>
      <State label="isEditable: drag a card; the reset control clears the arrangement" direction="column">
        <G.FlowGraph label="Editable" layout="steps" background="dots" isEditable positions={positions} onPositionsChange={setPositions} nodes={nodes} edges={edges} />
        <pre data-testid="positions">{JSON.stringify(positions)}</pre>
      </State>
    </Matrix>
  );
};

/** A dragged card moves, `onPositionsChange` fires with the moved ids, and "Sắp xếp lại" returns to the auto layout (`{}`). */
export const DraggableAndPositions: Story = {
  render: () => <Editable />,
  play: async ({ canvasElement }) => {
    const graph = await waitFor(() => {
      const found = graphOf(canvasElement);
      expect(found.querySelector('[data-grammar-flow-node="pack"]')).not.toBeNull();
      return found;
    });
    const card = graph.querySelector<HTMLElement>('[data-grammar-flow-node="pack"]')!;
    const before = card.getBoundingClientRect();
    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: card, coords: { clientX: before.x + 20, clientY: before.y + 20 } },
      { coords: { clientX: before.x + 70, clientY: before.y + 60 } },
      { coords: { clientX: before.x + 120, clientY: before.y + 90 } },
      { keys: '[/MouseLeft]' },
    ]);
    const pre = canvasElement.querySelector<HTMLElement>('[data-testid="positions"]')!;
    await waitFor(() => {
      expect(Object.keys(JSON.parse(pre.textContent ?? '{}') as object)).toContain('pack');
      const after = graph.querySelector<HTMLElement>('[data-grammar-flow-node="pack"]')!.getBoundingClientRect();
      expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeGreaterThan(20);
    });
    const reset = graph.querySelector<HTMLElement>('.starci-core-flow-graph-reset');
    if (reset === null) throw new Error('The reset control renders while the graph is editable');
    expect(reset.getAttribute('aria-label')).toBe('Sắp xếp lại');
    await userEvent.click(reset);
    await waitFor(() => expect(pre.textContent).toBe('{}'));
  },
};

/** A block of another agent shows a 16px avatar and the agent's name under its title; a block of this agent shows none. */
export const AgentLine: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="agent: { name } under the title" direction="column">
        <G.FlowGraph label="Agent line" layout="steps" nodes={nodes} edges={edges} />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const graph = graphOf(canvasElement);
      const lines = [...graph.querySelectorAll<HTMLElement>('[data-grammar-flow-agent="true"]')];
      expect(lines.map((line) => line.textContent)).toEqual(['Chatbot', 'Kho vận']);
      const avatar = lines[0]!.querySelector<HTMLElement>('.starci-core-avatar, [data-slot="avatar"]');
      expect(avatar).not.toBeNull();
      expect(Math.round(avatar!.getBoundingClientRect().width)).toBe(16);
      expect(graph.querySelector('[data-grammar-flow-node="trigger"] [data-grammar-flow-agent]')).toBeNull();
    });
  },
};
