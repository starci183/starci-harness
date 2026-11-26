import type { Meta, StoryObj } from '@storybook/react-vite';
import * as G from '../common/index.js';
import { noop } from './fixtures.js';

/**
 * 0.37.25: a `Section` head's one end-of-row thing is a `Link variant="head"` (the label then a sliding arrow), an info `IconButton`, or a text `Button variant="border" size="sm"` with no
 * icon ("Add provider" at the end of "Connected providers  2"). The Button stands on the label's line; the head is still one row with one action.
 */
const meta: Meta = { title: 'Surfaces/Section head action (0.37.25)', parameters: { grammar: { bleed: false } } };
export default meta;
type Story = StoryObj;

const ROWS = [{ id: 'a', title: 'Chat', description: 'Receives customer messages' }, { id: 'b', title: 'Email', description: 'Receives customer messages' }];

export const NeutralButtonAtTheEnd: Story = {
  name: 'Neutral sm Button or head Link at the end of the label row',
  render: () => (
    <div data-head-action style={{ display: 'flex', flexDirection: 'column', gap: 24, width: 'min(100%, 720px)' }}>
      <G.Section kind="list" title="Connected providers" count={2} items={ROWS} empty={<G.EmptyNotice message="Empty" />} action={<G.Button variant="border" size="sm" onPress={noop}>Add provider</G.Button>} />
      <G.Section kind="list" title="Channels" count={2} items={ROWS} empty={<G.EmptyNotice message="Empty" />} action={<G.Link variant="head" href="#all">View all</G.Link>} />
    </div>
  ),
};
