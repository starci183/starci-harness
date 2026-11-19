import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
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

const GAP = 12;
/** 0.48.0: a row side that touches the list edge is p-4 (16), a side that touches a divider is p-3 (12), and the row has px-4. */
const EDGE = 16;
const pad = (element: Element, side: 'Top' | 'Bottom'): number => Number.parseFloat(getComputedStyle(element)[`padding${side}`]);

const OPTIONS: readonly G.ListOption[] = [{ id: 'a', label: 'All' }, { id: 'b', label: 'Running' }];
const MODES = [{ id: 'auto', label: 'Auto' }, { id: 'ask', label: 'Ask' }] as const;

/** The padding a row's own box carries on its first and last row, and between rows. */
const assertRows = (rows: readonly Element[], first: number, last: number, between: number) => {
  expect(rows.length).toBeGreaterThanOrEqual(2);
  expect(pad(rows[0]!, 'Top')).toBe(first);
  expect(pad(rows[rows.length - 1]!, 'Bottom')).toBe(last);
  for (const row of rows.slice(0, -1)) expect(pad(row, 'Bottom')).toBe(between);
  for (const row of rows.slice(1)) expect(pad(row, 'Top')).toBe(between);
};

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
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const root = canvasElement.querySelector<HTMLElement>('[data-row-clearance]')!;
      const list = root.querySelector<HTMLElement>('[data-component="Section"]')!;
      assertRows(Array.from(list.querySelectorAll('.starci-core-list-row')), EDGE, EDGE, GAP);
      // A tall control (the Tabs pill) never touches the separators: the row grew around it.
      const first = list.querySelector<HTMLElement>('.starci-core-list-row')!;
      const pill = first.querySelector('.starci-core-tabs-frame')!.getBoundingClientRect();
      expect(first.getBoundingClientRect().height).toBeGreaterThanOrEqual(pill.height + GAP * 2 - 0.5);
      // A flat row has px-4.
      const side = (element: Element, edge: 'Left' | 'Right'): number => Number.parseFloat(getComputedStyle(element)[`padding${edge}`]);
      expect([side(first, 'Left'), side(first, 'Right')]).toEqual([EDGE, EDGE]);
    });
  },
};

const FIRST_SINGLE = [{ id: 's', title: 'A single row' }];
export const SingleRow: Story = {
  name: 'A single flat list row is p-4 above and below',
  render: () => (
    <div data-row-single style={{ display: 'flex', flexDirection: 'column', gap: 24, width: 'min(100%, 720px)' }}>
      <G.Section kind="list" title="One row" items={FIRST_SINGLE} empty={<G.EmptyNotice message="Empty" />} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const only = canvasElement.querySelector('[data-component="Section"] .starci-core-list-row')!;
      expect(pad(only, 'Top')).toBe(EDGE);
      expect(pad(only, 'Bottom')).toBe(EDGE);
    });
  },
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

const middle = (element: Element): number => { const box = element.getBoundingClientRect(); return (box.top + box.bottom) / 2; };

/** A list row's copy and its control are centred on each other within 1px. */
export const RowControlCentre: Story = {
  name: 'A row control and its copy are centred on each other',
  render: () => <CentredRows />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const root = canvasElement.querySelector<HTMLElement>('[data-row-centre]')!;
      const list = root.querySelector<HTMLElement>('[data-component="Section"]')!;
      // A list row centres its copy and its control (on a narrow list a tall control may wrap under the copy, the list row's own text-first rule; then there is no line to share).
      for (const row of Array.from(list.querySelectorAll<HTMLElement>('.starci-core-list-row'))) {
        const copy = row.querySelector('.starci-core-list-row-copy')!;
        const control = row.querySelector('.starci-core-list-row-control > *')!;
        if (control.getBoundingClientRect().top >= copy.getBoundingClientRect().bottom) continue;
        expect(Math.abs(middle(copy) - middle(control))).toBeLessThanOrEqual(1);
      }
    });
  },
};
