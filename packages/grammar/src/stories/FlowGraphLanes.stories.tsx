import type { Meta, StoryObj } from '@storybook/react-vite';
import * as G from '../common/index.js';
import { Matrix, State } from './fixtures.js';
import { chatbotEdges, chatbotHeaders, chatbotNodes, salesEdges, salesHeaders, salesNodes } from './FlowGraphLanes.data.js';

/**
 * The branch-lane map of a workflow: a column per stage, one row per branch of a condition, orthogonal edges with rounded corners
 * and arrowheads, branch labels on their own edge, one tone per node kind. A Chatbot-sized graph (9 nodes) and a Sales-sized one (24).
 */
const meta: Meta = {
  title: 'Flow graph lanes',
  parameters: { grammar: { bleed: false } },
};
export default meta;

type Story = StoryObj;

export const Chatbot: Story = {
  render: () => (
    <Matrix maxWidth={1200}>
      <State label="Chatbot, 9 nodes" direction="column">
        <G.FlowGraph label="Chatbot" layout="lanes" nodes={chatbotNodes} edges={chatbotEdges} headers={chatbotHeaders} />
      </State>
    </Matrix>
  ),
};

export const Sales: Story = {
  render: () => (
    <Matrix maxWidth={1200}>
      <State label="Sales, 24 nodes" direction="column">
        <G.FlowGraph label="Sales" layout="lanes" nodes={salesNodes} edges={salesEdges} headers={salesHeaders} />
      </State>
    </Matrix>
  ),
};
