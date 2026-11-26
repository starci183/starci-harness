import type { Meta, StoryObj } from '@storybook/react-vite';
import * as G from '../common/index.js';

/**
 * FormGrid: rows of fields aligned on the control line. Each story draws the field anatomy order (label, control,
 * description) and neighbouring controls of one row sharing their top edge and height, whatever their neighbours carry.
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

const SettingsGrid = () => (
  <G.Grid kind="form">
    <G.Input id="grid-account" name="account" label="Account name" defaultValue="Main account" description="Shown on the payment page." />
    <G.Select label="Environment" options={planOptions} defaultValue="live" />
    <G.NumberField label="Retry attempts" defaultValue={3} />
    <G.CopyField label="Webhook URL" value="https://hooks.example.com/api/v2/payments/26465cdf9a0b" description="Paste it into the provider." {...labels} />
    <G.CopyField masked label="API key" lastFour="4387" onCopy={() => 'key_example_4387'} {...labels} />
    <G.Input id="grid-bank" name="bank" label="Bank account" defaultValue="12-34" errorMessage="Enter the full account number." />
  </G.Grid>
);

/** Two columns: a description, an error or a missing description in one field never moves its neighbour's control. */
export const ControlLine: Story = {
  name: 'Control line (2 columns)',
  render: () => (
    <div style={{ maxWidth: 720 }}>
      <SettingsGrid />
    </div>
  ),
};

/** Inside a narrow owner the grid is one column at every viewport (RESPONSIVE-1): the container decides, never the device. */
export const NarrowOwner: Story = {
  name: 'Narrow owner (1 column)',
  render: () => (
    <div style={{ maxWidth: 360 }}>
      <SettingsGrid />
    </div>
  ),
};

/** The two-column breakpoint is a 31rem container: a form inside a reading measure in a card (511px) holds two columns. */
export const CardReadingMeasure: Story = {
  name: 'Card reading measure, 511px (2 columns)',
  render: () => (
    <div style={{ maxWidth: 511 }}>
      <SettingsGrid />
    </div>
  ),
};

/** The form measure (30rem = 480px) stays one column. */
export const FormMeasure: Story = {
  name: 'Form measure, 480px (1 column)',
  render: () => (
    <div style={{ maxWidth: 480 }}>
      <SettingsGrid />
    </div>
  ),
};

/** The same row with every field loading: the skeletons keep the control line. */
export const Skeleton: Story = {
  render: () => (
    <div style={{ maxWidth: 720 }}>
      <G.Grid kind="form">
        <G.Input id="grid-skeleton-account" name="account" label="Account name" description="Shown on the payment page." isLoading />
        <G.CopyField label="Webhook URL" value="https://hooks.example.com/26465cdf" {...labels} isLoading />
      </G.Grid>
    </div>
  ),
};
