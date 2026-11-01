import type { Meta, StoryObj } from '@storybook/react-vite';
import * as G from '../common/index.js';
import { Matrix, State } from './fixtures.js';

const meta: Meta = { title: 'Frames/Grid relations' };
export default meta;
type Story = StoryObj;

const Portion = ({ title, children }: { readonly title: string; readonly children: string }) => (
  <G.Section title={title}><G.Text>{children}</G.Text></G.Section>
);

export const WorkingSections: Story = {
  render: () => (
    <Matrix maxWidth={1280}>
      <State label="Independent named working regions" direction="column">
        <G.Grid kind="sections">
          <Portion title="People">The people who can act in this workspace.</Portion>
          <Portion title="Recent work">The latest decisions and their outcomes.</Portion>
          <Portion title="Connections">The services supplying current information.</Portion>
          <Portion title="Requests">Work waiting for an authorised person.</Portion>
        </G.Grid>
      </State>
    </Matrix>
  ),
};

export const ReadingPair: Story = {
  render: () => (
    <Matrix maxWidth={960}>
      <State label="Two equal portions of one reading unit" direction="column">
        <G.Grid kind="pair"
          leading={<Portion title="Before you begin">Choose the workspace whose information and permissions should be used.</Portion>}
          trailing={<Portion title="What happens next">The request stays visible so its owner can follow the result.</Portion>} />
      </State>
    </Matrix>
  ),
};

export const CentralFocus: Story = {
  render: () => (
    <Matrix maxWidth={1280}>
      <State label="One central focus with symmetric support" direction="column">
        <G.Grid kind="featured"
          leading={<Portion title="Included">A shared place for work, history and accountable decisions.</Portion>}
          featured={<G.SurfaceCard kind="figures" label="Monthly membership" items={[{ id: 'price', term: 'Per workspace', value: 24, unit: 'credits', meta: 'One clear recurring amount' }]} />}
          trailing={<Portion title="Your control">Review access and pause future renewals from the same workspace.</Portion>} />
      </State>
    </Matrix>
  ),
};

export const LongPortions: Story = {
  render: () => (
    <Matrix maxWidth={640}>
      <State label="Long translated headings keep equal reading measures" direction="column">
        <G.Grid kind="pair"
          leading={<Portion title="Who can review a request before it continues to the next stage?">The current owner and the people granted approval for this scope.</Portion>}
          trailing={<Portion title="Where does the result remain visible after the request has finished?">Its original conversation and the workspace history keep the outcome together.</Portion>} />
      </State>
    </Matrix>
  ),
};
