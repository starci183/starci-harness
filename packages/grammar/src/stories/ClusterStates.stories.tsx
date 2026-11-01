import type { Meta, StoryObj } from '@storybook/react-vite';
import * as G from '../common/index.js';
import { Matrix, State } from './fixtures.js';

const meta: Meta = { title: 'Frames/Cluster' };
export default meta;
type Story = StoryObj;

export const CenteredWrapped: Story = {
  render: () => (
    <Matrix maxWidth={480}>
      <State label="A centred set keeps every wrapped line centred" direction="column">
        <G.Cluster gap="inline" justify="center">
          <G.Button intent="alternative">Plan the next week</G.Button>
          <G.Button intent="alternative">Find the latest decision</G.Button>
          <G.Button intent="alternative">Prepare a short update</G.Button>
        </G.Cluster>
      </State>
    </Matrix>
  ),
};
