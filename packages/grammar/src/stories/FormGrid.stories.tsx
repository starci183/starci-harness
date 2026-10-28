import type { Meta, StoryObj } from '@storybook/react-vite';
import { waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * FormGrid: rows of fields aligned on the control line. The plays measure the field anatomy order (label, control,
 * description) and that neighbouring controls of one row share their top edge and height, whatever their neighbours carry.
 */
const meta: Meta = {
  title: 'Forms/Form grid',
};
export default meta;

type Story = StoryObj;

const labels = { copyLabel: 'Copy', copiedLabel: 'Copied', copyErrorLabel: 'Could not copy' } as const;
const planOptions: ReadonlyArray<G.ListOption> = [
  { id: 'sandbox', label: 'Sandbox' },
  { id: 'live', label: 'Live' },
];

const controlsOf = (row: Element) => [...row.querySelectorAll<HTMLElement>(':scope > * [data-grammar-field-control="true"], :scope > * [data-grammar-input-control="true"]')]
  .filter((control) => control.parentElement?.closest('[data-grammar-field-control="true"], [data-grammar-input-control="true"]') === null);

/** Every row: its controls share one top edge and one height, and each field draws its description under its control. */
const assertControlLine = (canvasElement: HTMLElement, columns: number) => {
  const rows = [...canvasElement.querySelectorAll<HTMLElement>('[data-grammar-form-grid-row]')];
  if (rows.length === 0) throw new Error('the grid has no rows');
  for (const [index, row] of rows.entries()) {
    const controls = controlsOf(row);
    if (controls.length < 2) throw new Error(`row ${index + 1} has ${controls.length} controls`);
    const [first, ...rest] = controls.map((control) => control.getBoundingClientRect());
    if (first === undefined) continue;
    for (const other of rest) {
      if (Math.abs(other.height - first.height) > 0.5) throw new Error(`row ${index + 1}: control heights differ (${first.height} vs ${other.height})`);
      if (columns === 2 && Math.abs(other.top - first.top) > 0.5) throw new Error(`row ${index + 1}: control tops differ (${first.top} vs ${other.top})`);
      if (columns === 1 && other.top <= first.bottom) throw new Error(`row ${index + 1}: a one-column row stacks its fields`);
    }
  }
  for (const description of canvasElement.querySelectorAll<HTMLElement>('[data-grammar-field-description]')) {
    const field = description.parentElement;
    const control = field?.querySelector(':scope > [data-grammar-field-control="true"], :scope > [data-grammar-input-control="true"]');
    if (control === null || control === undefined) throw new Error('a description belongs to a field with a control');
    if (description.getBoundingClientRect().top < control.getBoundingClientRect().bottom - 0.5) throw new Error('the description sits under the control');
  }
};

const SettingsGrid = () => (
  <G.FormGrid>
    <G.Input id="grid-account" name="account" label="Account name" defaultValue="Main account" description="Shown on the payment page." />
    <G.Select label="Environment" options={planOptions} defaultValue="live" />
    <G.NumberField label="Retry attempts" defaultValue={3} />
    <G.CopyField label="Webhook URL" value="https://hooks.example.com/api/v2/payments/26465cdf9a0b" description="Paste it into the provider." {...labels} />
    <G.CopyField masked label="API key" lastFour="4387" onCopy={() => 'key_example_4387'} {...labels} />
    <G.Input id="grid-bank" name="bank" label="Bank account" defaultValue="12-34" errorMessage="Enter the full account number." />
  </G.FormGrid>
);

/** Two columns: a description, an error or a missing description in one field never moves its neighbour's control. */
export const ControlLine: Story = {
  name: 'Control line (2 columns)',
  render: () => (
    <div style={{ maxWidth: 720 }}>
      <SettingsGrid />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      if (canvasElement.querySelector('[data-grammar-form-grid-columns="2"] [data-grammar-form-grid-row]') === null) throw new Error('the grid is missing');
      const row = canvasElement.querySelector('[data-grammar-form-grid-row]');
      if (row === null || getComputedStyle(row).gridTemplateColumns.split(' ').length !== 2) throw new Error('a wide grid has two columns');
      assertControlLine(canvasElement, 2);
    });
  },
};

/** Inside a narrow owner the grid is one column at every viewport (RESPONSIVE-1): the container decides, never the device. */
export const NarrowOwner: Story = {
  name: 'Narrow owner (1 column)',
  render: () => (
    <div style={{ maxWidth: 360 }}>
      <SettingsGrid />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const row = canvasElement.querySelector('[data-grammar-form-grid-row]');
      if (row === null || getComputedStyle(row).gridTemplateColumns.split(' ').length !== 1) throw new Error('a narrow grid has one column');
      assertControlLine(canvasElement, 1);
    });
  },
};

/** The same row with every field loading: the skeletons keep the control line. */
export const Skeleton: Story = {
  render: () => (
    <div style={{ maxWidth: 720 }}>
      <G.FormGrid>
        <G.Input id="grid-skeleton-account" name="account" label="Account name" description="Shown on the payment page." isSkeleton />
        <G.CopyField label="Webhook URL" value="https://hooks.example.com/26465cdf" {...labels} isSkeleton />
      </G.FormGrid>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => assertControlLine(canvasElement, 2));
  },
};
