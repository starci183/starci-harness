import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import * as G from '../common/index.js';
import { noop } from './fixtures.js';

/**
 * A list is flat (0.43.0): its rows carry p-3 (`--grammar-row-gap`, 12) on every block side and no inline inset, so the row content starts on the section
 * title's edge. Controls included: a row grows around a tall control (the Tabs pill), it never touches a separator. A control centres on the copy of its row.
 */
const meta: Meta = { title: 'Surfaces/Row edge padding (0.37.25)', parameters: { grammar: { bleed: false } } };
export default meta;
type Story = StoryObj;

const OPTIONS: readonly G.ListOption[] = [{ id: 'a', label: 'All' }, { id: 'b', label: 'Running' }];
const MODES = [{ id: 'auto', label: 'Auto' }, { id: 'ask', label: 'Ask' }] as const;

const Everything = () => {
  const [mode, setMode] = useState('auto');
  const [on, setOn] = useState(true);
  const [pick, setPick] = useState<string | null>('a');
  return (
    <div data-row-clearance style={{ display: 'flex', flexDirection: 'column', gap: 24, width: 'min(100%, 720px)' }}>
      <G.Section
        kind="list"
        title="List rows"
        items={[
          { id: 'l1', title: 'Platform', control: <G.Tabs appearance="primary" label="Mode" selectedKey={mode} onSelect={setMode} items={MODES} /> },
          { id: 'l2', title: 'On', control: <G.Switch label="On" size="md" isLabelHidden isSelected={on} onSelectedChange={setOn} /> },
          { id: 'l3', title: 'Filter', control: <G.Select label="Filter" isLabelHidden size="sm" options={OPTIONS} value={pick} onValueChange={setPick} /> },
          { id: 'l4', title: 'Settings', action: { label: 'Open', press: noop } },
        ]}
        empty={<G.EmptyNotice message="Empty" />}
      />
    </div>
  );
};

export const RowEdgePadding: Story = {
  name: 'A flat list: p-3 on every block side, a tall control grows its row',
  render: () => <Everything />,
};

const FIRST_SINGLE = [{ id: 's', title: 'A single row' }];
export const SingleRow: Story = {
  name: 'A single flat list row is p-4 above and below',
  render: () => (
    <div data-row-single style={{ display: 'flex', flexDirection: 'column', gap: 24, width: 'min(100%, 720px)' }}>
      <G.Section kind="list" title="One row" items={FIRST_SINGLE} empty={<G.EmptyNotice message="Empty" />} />
    </div>
  ),
};

const PERMISSION_MODES = [{ id: 'auto', label: 'Auto' }, { id: 'ask', label: 'Ask' }] as const;

const CentredRows = () => {
  const [send, setSend] = useState('auto');
  const [on, setOn] = useState(true);
  return (
    <div data-row-centre style={{ display: 'flex', flexDirection: 'column', gap: 24, width: 'min(100%, 720px)' }}>
      <G.Section
        kind="list"
        title="List rows"
        items={[
          { id: 'l1', title: 'Message customers over Chat', description: 'Chat', control: <G.Tabs appearance="primary" label="Mode" selectedKey={send} onSelect={setSend} items={PERMISSION_MODES} /> },
          { id: 'l2', title: 'Notify team', control: <G.Switch label="Notify team" size="md" isLabelHidden isSelected={on} onSelectedChange={setOn} /> },
        ]}
        empty={<G.EmptyNotice message="Empty" />}
      />
    </div>
  );
};

/** A list row's copy and its control are centred on each other within 1px. */
export const RowControlCentre: Story = {
  name: 'A row control and its copy are centred on each other',
  render: () => <CentredRows />,
};
