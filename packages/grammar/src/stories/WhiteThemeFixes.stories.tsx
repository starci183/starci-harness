import type { Meta, StoryObj } from '@storybook/react-vite';
import type { CSSProperties } from 'react';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * THE WHITE-THEME RESHOOT FIXES (0.42.0). One page with every part the NIVO reshoot named: a wide steps graph that opens fitted to its pane, with a
 * back edge to its entry node routed round that node's card; a pill Select in a Cluster sized to its value; a `Grid kind="sections"` whose columns
 * take the section divider hook; disabled buttons of every intent drawn neutral; a table whose action cell keeps its buttons on one line.
 * `Defaults` sets no hook; `White` sets `--starci-core-grid-section-divider` on the root, as an app's brand.css sets it on `:root`.
 */
const meta: Meta = {
  title: 'Surfaces/White theme fixes (0.42.0)',
  parameters: { grammar: { bleed: false } },
};
export default meta;
type Story = StoryObj;

const noop = () => undefined;

/** Five cards in a line, a condition and the end pill: wider than a 1160 well at zoom 1 (it fits at about 0.9), so before 0.42.0 it opened at zoom 1 with its end cut off. */
const nodes: ReadonlyArray<G.FlowGraphNode> = [
  { id: 'start', kind: 'event', label: 'Message received', description: 'Zalo OA' },
  { id: 'read', kind: 'action', label: 'Read the customer', description: 'Contact record' },
  { id: 'answer', kind: 'action', label: 'Draft an answer', description: 'From the brain' },
  { id: 'check', kind: 'condition', label: 'Confident?', description: 'Score over 0.8', outputs: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] },
  { id: 'send', kind: 'action', label: 'Send the answer', description: 'Reply in the thread' },
  { id: 'done', kind: 'end', label: 'Done' },
];

const edges: ReadonlyArray<G.FlowGraphEdge> = [
  { id: 'e1', source: 'start', target: 'read' },
  { id: 'e2', source: 'read', target: 'answer' },
  { id: 'e3', source: 'answer', target: 'check' },
  { id: 'e4', source: 'check', target: 'send', sourcePort: 'yes' },
  { id: 'e5', source: 'send', target: 'done' },
  { id: 'again', source: 'check', target: 'start', sourcePort: 'no', variant: 'back', label: 'ask again' },
];

const MEMBERS = [
  { id: 'a', name: 'Lan Nguyen', role: 'Owner' },
  { id: 'b', name: 'Minh Tran', role: 'Agent' },
  { id: 'c', name: 'Hoa Le', role: 'Agent' },
] as const;

type Member = G.DataTableRow & { readonly name: string; readonly role: string };

const columns: ReadonlyArray<G.DataTableColumn<Member>> = [
  { id: 'name', label: 'Member', isRowHeader: true, width: 'fill' },
  { id: 'role', label: 'Role', width: 'fit' },
  { id: 'actions', label: 'Actions', width: 'fit' },
];

const renderCell = (row: Member, columnId: string) => {
  if (columnId === 'name') return row.name;
  if (columnId === 'role') return row.role;
  return (
    <G.Cluster gap="inline" justify="end">
      <G.Button intent="neutral" size="sm" isDisabled={row.role === 'Owner'} disabledReason="The owner cannot be disabled." onPress={noop}>Disable access</G.Button>
      <G.Button intent="destructive" size="sm" onPress={noop}>Remove</G.Button>
    </G.Cluster>
  );
};

const Portion = ({ title, children }: { readonly title: string; readonly children: string }) => (
  <G.Section title={title}><G.Text>{children}</G.Text></G.Section>
);

const Body = () => (
  <G.Stack gap="section">
    <G.Section title="Workflow map">
      <div data-story-graph="true" style={{ boxSizing: 'border-box', width: 'min(1160px, 100%)', height: 420 }}>
        <G.FlowGraph label="Answer flow" layout="steps" height="fill" direction="LR" nodes={nodes} edges={edges} showControls />
      </div>
    </G.Section>
    <G.Section title="Pill select in a cluster">
      <G.Cluster gap="inline" align="center">
        <G.Select label="Channel" isLabelHidden appearance="pill" prefix="Channel:" options={[{ id: 'zalo', label: 'Zalo OA' }, { id: 'mail', label: 'Email' }]} defaultValue="zalo" />
        <G.Select label="Period" isLabelHidden appearance="pill" options={[{ id: '7', label: 'Last 7 days' }, { id: '30', label: 'Last 30 days' }]} defaultValue="7" />
        <G.Select label="Agent" isLabelHidden appearance="compact" options={[{ id: 'all', label: 'Every agent' }]} defaultValue="all" />
      </G.Cluster>
    </G.Section>
    <G.Grid kind="sections">
      <Portion title="People">The people who can act in this workspace.</Portion>
      <Portion title="Recent work">The latest decisions and their outcomes.</Portion>
      <Portion title="Connections">The services supplying current information.</Portion>
      <Portion title="Requests">Work waiting for an authorised person.</Portion>
    </G.Grid>
    <G.Section title="Disabled buttons">
      <G.Cluster gap="inline" align="center">
        <G.Button intent="commit" isDisabled disabledReason="Pick a plan first." onPress={noop}>Continue</G.Button>
        <G.Button intent="alternative" isDisabled onPress={noop}>Save draft</G.Button>
        <G.Button intent="neutral" isDisabled onPress={noop}>Export</G.Button>
        <G.Button intent="dismiss" isDisabled onPress={noop}>Cancel</G.Button>
        <G.Button intent="destructive" step="entry" isDisabled onPress={noop}>Delete</G.Button>
        <G.Button intent="destructive" step="confirm" isDisabled onPress={noop}>Delete permanently</G.Button>
        <G.Button intent="commit" isPending onPress={noop}>Saving</G.Button>
      </G.Cluster>
    </G.Section>
    <G.Section title="Members">
      <G.DataTable label="Members" columns={columns} rows={MEMBERS} renderCell={renderCell} emptyContent="No members yet." />
    </G.Section>
  </G.Stack>
);

/** The back edge's path, sampled away from its two ends, never enters its own source or target card. */
const assertBackEdgeClearsItsCards = (graph: HTMLElement) => {
  const box = (id: string) => graph.querySelector<HTMLElement>(`[data-grammar-flow-node="${id}"]`)?.getBoundingClientRect();
  const path = graph.querySelector<SVGPathElement>('.react-flow__edge[data-id="again"] path.react-flow__edge-path');
  const start = box('start');
  const check = box('check');
  if (path === null || start === undefined || check === undefined) throw new Error('the back edge and its cards render');
  const matrix = path.getScreenCTM();
  if (matrix === null) throw new Error('the back edge is on screen');
  const length = path.getTotalLength();
  for (let at = 16; at <= length - 16; at += 3) {
    const local = path.getPointAtLength(at);
    const point = new DOMPoint(local.x, local.y).matrixTransform(matrix);
    for (const [id, card] of [['start', start], ['check', check]] as const) {
      const inside = point.x > card.left + 1 && point.x < card.right - 1 && point.y > card.top + 1 && point.y < card.bottom - 1;
      expect(inside, `the back edge runs through ${id} at ${String(Math.round(at))}`).toBe(false);
    }
  }
};

const play: Story['play'] = async ({ canvasElement }) => {
  await waitFor(() => {
    const graph = canvasElement.querySelector<HTMLElement>('[data-component="FlowGraph"]');
    const well = canvasElement.querySelector<HTMLElement>('[data-story-graph]');
    if (graph === null || well === null) throw new Error('the graph renders');
    const done = graph.querySelector<HTMLElement>('[data-grammar-flow-node="done"]')?.getBoundingClientRect();
    if (done === undefined) throw new Error('the end pill renders');
    // A pane of 1160 holds the whole graph once fitted (at most zoom 1, at least the 0.8 floor): the end pill is inside the pane, not cut off at its end edge.
    if (well.getBoundingClientRect().width >= 1000) expect(done.right).toBeLessThanOrEqual(well.getBoundingClientRect().right);
    assertBackEdgeClearsItsCards(graph);
    const pill = canvasElement.querySelector<HTMLElement>('[data-component="Select"][data-grammar-select-appearance="pill"]');
    const cluster = pill?.parentElement;
    if (pill === null || pill === undefined || cluster === null || cluster === undefined) throw new Error('the pill renders');
    expect(pill.getBoundingClientRect().width).toBeLessThan(cluster.getBoundingClientRect().width / 2);
    const commit = canvasElement.querySelector<HTMLElement>('[data-component="Button"][data-grammar-intent="commit"][data-action-pending="false"]');
    if (commit === null) throw new Error('the disabled commit renders');
    expect(getComputedStyle(commit).opacity).toBe('1');
    const actions = canvasElement.querySelector<HTMLElement>('[data-component="DataTable"] .starci-core-cluster');
    if (actions === null) throw new Error('the action cell renders');
    const buttons = [...actions.querySelectorAll<HTMLElement>('[data-component="Button"]')].map((button) => button.getBoundingClientRect().top);
    expect(new Set(buttons.map(Math.round)).size).toBe(1);
  });
};

/** No hook set: the default look, the section columns without a divider. */
export const Defaults: Story = { render: () => <Body />, play };

const WHITE_HOOKS = {
  '--starci-core-grid-section-divider': '1px solid var(--border)',
} as CSSProperties;

/** The section divider hook on the root: a hairline between the two section columns at 80rem and up, none at 390. */
export const White: Story = {
  parameters: { grammar: { bleed: false, rootStyle: WHITE_HOOKS } },
  render: () => <Body />,
  play,
};
