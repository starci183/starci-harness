import type { Meta, StoryObj } from '@storybook/react-vite';
import type { CSSProperties } from 'react';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * THE WHITE-THEME RESHOOT FIXES (0.42.0). One page with every part the NIVO reshoot named:
 * a pill Select in a Cluster sized to its value; a `Grid kind="sections"` whose columns
 * take the section divider hook; disabled buttons of every look drawn neutral; a table whose action cell keeps its buttons on one line.
 * `Defaults` sets no hook; `White` sets `--starci-core-grid-section-divider` on the root, as an app's brand.css sets it on `:root`.
 */
const meta: Meta = {
  title: 'Surfaces/White theme fixes (0.42.0)',
  parameters: { grammar: { bleed: false } },
};
export default meta;
type Story = StoryObj;

const noop = () => undefined;

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
      <G.Button variant="border" size="sm" isDisabled={row.role === 'Owner'} disabledReason="The owner cannot be disabled." onPress={noop}>Disable access</G.Button>
      <G.Button variant="danger" size="sm" onPress={noop}>Remove</G.Button>
    </G.Cluster>
  );
};

const Portion = ({ title, children }: { readonly title: string; readonly children: string }) => (
  <G.Section title={title}><G.Text>{children}</G.Text></G.Section>
);

const Body = () => (
  <G.Stack gap="section">
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
        <G.Button variant="primary" isDisabled disabledReason="Pick a plan first." onPress={noop}>Continue</G.Button>
        <G.Button variant="border" isDisabled onPress={noop}>Save draft</G.Button>
        <G.Button variant="border" isDisabled onPress={noop}>Export</G.Button>
        <G.Button variant="border" isDisabled onPress={noop}>Cancel</G.Button>
        <G.Button variant="danger" isDisabled onPress={noop}>Delete</G.Button>
        <G.Button variant="danger" isDisabled onPress={noop}>Delete permanently</G.Button>
        <G.Button variant="primary" isPending onPress={noop}>Saving</G.Button>
      </G.Cluster>
    </G.Section>
    <G.Section title="Members">
      <G.DataTable label="Members" columns={columns} rows={MEMBERS} renderCell={renderCell} emptyContent="No members yet." />
    </G.Section>
  </G.Stack>
);

const play: Story['play'] = async ({ canvasElement }) => {
  await waitFor(() => {
    const pill = canvasElement.querySelector<HTMLElement>('[data-component="Select"][data-grammar-select-appearance="pill"]');
    const cluster = pill?.parentElement;
    if (pill === null || pill === undefined || cluster === null || cluster === undefined) throw new Error('the pill renders');
    expect(pill.getBoundingClientRect().width).toBeLessThan(cluster.getBoundingClientRect().width / 2);
    const commit = canvasElement.querySelector<HTMLElement>('[data-component="Button"][data-grammar-variant="primary"][data-action-pending="false"]');
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
