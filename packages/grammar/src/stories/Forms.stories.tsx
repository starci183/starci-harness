import type { Meta, StoryObj } from '@storybook/react-vite';
import { parseDate, parseTime } from '@internationalized/date';
import { useState } from 'react';
import { userEvent, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import { Matrix, SearchGlyph, SettingsGlyph, StarGlyph, PaperclipGlyph, State, UploadGlyph, noop, showRowStates } from './fixtures.js';

/**
 * Forms: every input renderer shares the Field contract (label, description, error,
 * required/disabled/read-only/invalid), so each story walks the same state matrix.
 */
const meta: Meta = {
  title: 'Forms',
};
export default meta;

type Story = StoryObj;

const planOptions: ReadonlyArray<G.ListOption> = [
  { id: 'starter', label: 'Starter', description: 'For one person' },
  { id: 'team', label: 'Team', description: 'Up to ten people' },
  { id: 'org', label: 'Organisation' },
  { id: 'archived', label: 'Archived plan', isDisabled: true },
];

const choiceOptions: ReadonlyArray<G.ChoiceOption> = [
  { value: 'email', label: 'Email', description: 'A daily summary' },
  { value: 'push', label: 'Push notification' },
  { value: 'sms', label: 'Text message', isDisabled: true },
];

const formColumn = 420;

export const Input: Story = {
  render: () => (
    <Matrix maxWidth={formColumn}>
      <State label="Variants" direction="column">
        <G.Input id="input-primary" name="email" label="Email" kind="email" placeholder="you@example.com" />
        <G.Input id="input-secondary" name="name" label="Display name" description="Shown on your profile." />
        <G.Input id="input-password" name="password" label="Password" kind="password" defaultValue="hunter22" revealLabel="Show password" hideLabel="Hide password" />
      </State>
      <State label="Required" direction="column">
        <G.Input id="input-required" name="required" label="Full name" isRequired />
      </State>
      <State label="Invalid" direction="column">
        <G.Input id="input-invalid" name="invalid" label="Email" kind="email" isInvalid errorMessage="Enter a valid email address." defaultValue="not-an-email" />
      </State>
      <State label="Disabled" direction="column">
        <G.Input id="input-disabled" name="disabled" label="Workspace" isDisabled defaultValue="Locked value" />
      </State>
      <State label="Skeleton (pending)" direction="column">
        <G.Input id="input-skeleton" name="skeleton" label="Loading" isLoading />
      </State>
    </Matrix>
  ),
};

/** `isCopyable` adds a copy action after the control (it copies the current value); `isReadOnly` keeps a value selectable but fixed. */
/** 0.9.8: a row of inputs that label themselves by position (`isLabelHidden`), with `onBlur` / `onPaste` / `autoFocus` and a trailing action aligned to the control box. */
export const InputRowHiddenLabel: Story = {
  name: 'Input (hidden label row, error beside an action)',
  render: () => (
    <div style={{ display: 'grid', gap: '0.75rem', maxWidth: formColumn }}>
      {[1, 2, 3].map((n) => (
        <div key={n} style={{ display: 'flex', alignItems: 'start', gap: '0.5rem' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <G.Input id={`link-${n}`} name={`link-${n}`} label={`Link ${n}`} isLabelHidden {...(n === 2 ? { errorMessage: 'Enter a valid link.' } : {})} />
          </div>
          <G.Button intent="alternative">Delete</G.Button>
        </div>
      ))}
    </div>
  ),
};

export const InputCopyable: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: '1rem', maxWidth: '36rem' }}>
      <G.Input id="input-copy-url" name="webhookUrl" label="Webhook URL" description="Paste this into the provider." isReadOnly isCopyable copyLabel="Copy" copiedLabel="Copied" defaultValue="https://example.com/api/hooks/26465cdf" />
      <G.Input id="input-copy-name" name="webhookName" label="Webhook name" description="You can change it here." isCopyable copyLabel="Copy" copiedLabel="Copied" defaultValue="Acme · Main account" />
      <G.Input id="input-copy-key" name="apiKey" label="API Key" kind="password" isCopyable copyLabel="Copy" copiedLabel="Copied" revealLabel="Show" hideLabel="Hide" defaultValue="key_b564bbce026c88a12f034ecfbee4387" />
      <G.Input id="input-copy-disabled" name="disabled" label="Disabled" isDisabled isCopyable copyLabel="Copy" defaultValue="Locked value" />
    </div>
  ),
}

/** OtpInput's `label` names the slot group and the input; `describedBy` wires the error text. */
const LabelledOtp = ({ id, ...props }: { readonly id: string; readonly label: string } & Omit<G.OtpInputProps, 'id' | 'name'>) => (
  <G.OtpInput id={id} name={id} {...props} />
);

export const OtpInput: Story = {
  render: () => (
    <Matrix>
      <State label="Default">
        <LabelledOtp id="otp-default" label="Verification code" />
      </State>
      <State label="Prefilled">
        <LabelledOtp id="otp-filled" label="Partly entered code" defaultValue="428" />
      </State>
      <State label="Invalid">
        <LabelledOtp id="otp-invalid" label="Rejected code" defaultValue="111111" isInvalid describedBy="otp-invalid-error" />
        <G.Text id="otp-invalid-error" live="polite">That code has expired.</G.Text>
      </State>
      <State label="Disabled">
        <LabelledOtp id="otp-disabled" label="Code (locked)" isDisabled />
      </State>
    </Matrix>
  ),
};

export const PressableField: Story = {
  render: () => (
    <Matrix maxWidth={formColumn}>
      <State label="Default" direction="column">
        <G.PressableField label="Search" placeholder="Search lessons" source={SearchGlyph} shortcut="Ctrl K" onPress={noop} />
      </State>
      <State label="Disabled" direction="column">
        <G.PressableField label="Search" placeholder="Search is unavailable" source={SearchGlyph} isDisabled />
      </State>
    </Matrix>
  ),
};

export const Field: Story = {
  render: () => (
    <Matrix maxWidth={formColumn}>
      <State label="Default with description" direction="column">
        <G.Field label="Nickname" description="Shown to other people." name="nickname" control={(control) => <input {...control} placeholder="nickname" />} />
      </State>
      <State label="Required and invalid" direction="column">
        <G.Field label="Nickname" isRequired isInvalid errorMessage="Choose a longer nickname." name="nick-invalid" control={(control) => <input {...control} defaultValue="a" />} />
      </State>
      <State label="Disabled and read-only" direction="column">
        <G.Field label="Plan" isDisabled control={(control) => <select {...control}><option>Starter</option></select>} />
        <G.Field label="Account id" isReadOnly control={(control) => <input {...control} defaultValue="acct-0042" />} />
      </State>
    </Matrix>
  ),
};

export const Textarea: Story = {
  render: () => (
    <Matrix maxWidth={formColumn}>
      <State label="Default" direction="column">
        <G.Textarea label="Bio" description="A sentence or two." placeholder="Tell people about yourself" rows={3} />
      </State>
      <State label="Loading (isLoading)" direction="column">
        <G.Textarea label="Bio" rows={3} isLoading />
      </State>
      <State label="Invalid" direction="column">
        <G.Textarea label="Bio" isInvalid errorMessage="Keep it under 20 characters." defaultValue="This bio is a little too long." maxLength={20} />
      </State>
      <State label="Disabled and read-only" direction="column">
        <G.Textarea label="Notes" isDisabled defaultValue="Disabled notes" />
        <G.Textarea label="Audit trail" isReadOnly defaultValue="Read-only history" />
      </State>
    </Matrix>
  ),
};

export const SearchField: Story = {
  render: () => (
    <Matrix maxWidth={formColumn}>
      <State label="Loading (isLoading)" direction="column">
        <G.SearchField label="Search" isLoading />
      </State>
      <State label="Default" direction="column">
        <G.SearchField label="Search" isLabelHidden placeholder="Search lessons" clearLabel="Clear search" />
      </State>
      <State label="With value" direction="column">
        <G.SearchField label="Search" defaultValue="grammar" clearLabel="Clear search" />
      </State>
      <State label="Pending" direction="column">
        <G.SearchField label="Search" defaultValue="loading" isPending clearLabel="Clear search" />
      </State>
      <State label="Invalid" direction="column">
        <G.SearchField label="Search" isInvalid errorMessage="Enter at least two characters." defaultValue="a" clearLabel="Clear search" />
      </State>
      <State label="Disabled" direction="column">
        <G.SearchField label="Search" isDisabled placeholder="Search is off" clearLabel="Clear search" />
      </State>
    </Matrix>
  ),
};

export const NumberField: Story = {
  render: () => (
    <Matrix maxWidth={formColumn}>
      <State label="Loading (isLoading)" direction="column">
        <G.NumberField label="Seats" isLoading />
      </State>
      <State label="Default" direction="column">
        <G.NumberField label="Seats" defaultValue={3} minValue={1} maxValue={50} />
      </State>
      <State label="Currency format, no steppers" direction="column">
        <G.NumberField label="Budget" defaultValue={1200} formatOptions={{ style: 'currency', currency: 'USD' }} hideSteppers />
      </State>
      <State label="Invalid" direction="column">
        <G.NumberField label="Seats" defaultValue={0} isInvalid errorMessage="At least one seat is required." />
      </State>
      <State label="Disabled" direction="column">
        <G.NumberField label="Seats" defaultValue={5} isDisabled />
      </State>
    </Matrix>
  ),
};

export const Checkbox: Story = {
  render: () => (
    <Matrix>
      <State label="Default">
        <G.Checkbox label="Remember me" />
      </State>
      <State label="Selected">
        <G.Checkbox label="Subscribe" defaultSelected />
      </State>
      <State label="Indeterminate">
        <G.Checkbox label="Select all" isIndeterminate />
      </State>
      <State label="Invalid">
        <G.Checkbox label="Accept the terms" isRequired isInvalid errorMessage="Required to continue." />
      </State>
      <State label="Disabled">
        <G.Checkbox label="Disabled" isDisabled />
        <G.Checkbox label="Disabled selected" isDisabled defaultSelected />
      </State>
    </Matrix>
  ),
};

export const CheckboxGroup: Story = {
  render: () => (
    <Matrix maxWidth={formColumn}>
      <State label="Loading (isLoading)" direction="column">
        <G.CheckboxGroup label="Notifications" options={choiceOptions} isLoading />
      </State>
      <State label="Default" direction="column">
        <G.CheckboxGroup label="Notifications" description="Choose any." options={choiceOptions} defaultValue={['email']} />
      </State>
      <State label="Horizontal" direction="column">
        <G.CheckboxGroup label="Days" orientation="horizontal" options={[{ value: 'mon', label: 'Mon' }, { value: 'tue', label: 'Tue' }, { value: 'wed', label: 'Wed' }]} />
      </State>
      <State label="Invalid" direction="column">
        <G.CheckboxGroup label="Topics" isRequired isInvalid errorMessage="Pick at least one topic." options={choiceOptions} />
      </State>
      <State label="Disabled" direction="column">
        <G.CheckboxGroup label="Locked" isDisabled options={choiceOptions} defaultValue={['push']} />
      </State>
    </Matrix>
  ),
};

export const RadioGroup: Story = {
  render: () => (
    <Matrix maxWidth={formColumn}>
      <State label="Default (selected)" direction="column">
        <G.RadioGroup label="Delivery" options={choiceOptions} defaultValue="email" />
      </State>
      <State label="Horizontal" direction="column">
        <G.RadioGroup label="Size" orientation="horizontal" options={[{ value: 's', label: 'Small' }, { value: 'm', label: 'Medium' }, { value: 'l', label: 'Large' }]} defaultValue="m" />
      </State>
      <State label="Invalid" direction="column">
        <G.RadioGroup label="Delivery" isRequired isInvalid errorMessage="Choose a delivery method." options={choiceOptions} />
      </State>
      <State label="Disabled" direction="column">
        <G.RadioGroup label="Delivery" isDisabled options={choiceOptions} defaultValue="push" />
      </State>
    </Matrix>
  ),
};

export const Switch: Story = {
  render: () => (
    <Matrix>
      <State label="Loading (isLoading)">
        <G.Switch label="Dark mode" isLoading />
      </State>
      <State label="Default">
        <G.Switch label="Dark mode" />
      </State>
      <State label="Selected">
        <G.Switch label="Notifications" defaultSelected />
      </State>
      <State label="Large (StarCi look), with thumb glyphs">
        <G.Switch label="Appearance" size="lg" thumbIcon={SettingsGlyph} selectedThumbIcon={StarGlyph} />
        <G.Switch label="Appearance" size="lg" defaultSelected thumbIcon={SettingsGlyph} selectedThumbIcon={StarGlyph} />
        <G.Switch label="Appearance" size="lg" isLoading />
      </State>
      <State label="Control height (2.5rem, 40px), label hidden but accessible">
        <G.Switch label="Dark mode" isLabelHidden size="control" thumbIcon={SettingsGlyph} selectedThumbIcon={StarGlyph} />
        <G.AvatarButton name="Alex Morgan" size="control" />
        <G.IconButton source={SettingsGlyph} label="Settings" />
      </State>
      <State label="Invalid">
        <G.Switch label="Required toggle" isInvalid errorMessage="Turn this on to continue." />
      </State>
      <State label="Disabled">
        <G.Switch label="Disabled" isDisabled />
        <G.Switch label="Disabled on" isDisabled defaultSelected />
      </State>
    </Matrix>
  ),
};

export const Slider: Story = {
  render: () => (
    <Matrix maxWidth={formColumn}>
      <State label="Single value" direction="column">
        <G.Slider label="Volume" defaultValue={40} />
      </State>
      <State label="Range" direction="column">
        <G.Slider label="Price" defaultValue={[20, 80]} thumbLabels={['Minimum', 'Maximum']} formatOptions={{ style: 'currency', currency: 'USD' }} />
      </State>
    </Matrix>
  ),
};

// Disabled on its own: WCAG 1.4.3 exempts inactive controls, so the a11y allowlist waives
// color-contrast for this story id only and the enabled Slider story stays fully gated.
export const SliderDisabled: Story = {
  render: () => (
    <Matrix maxWidth={formColumn}>
      <State label="Disabled" direction="column">
        <G.Slider label="Locked" defaultValue={60} isDisabled />
      </State>
    </Matrix>
  ),
};

export const DateField: Story = {
  render: () => (
    <Matrix maxWidth={formColumn}>
      <State label="Default" direction="column">
        <G.DateField label="Start date" defaultValue={parseDate('2026-09-23')} />
      </State>
      <State label="Invalid" direction="column">
        <G.DateField label="Birth date" isInvalid errorMessage="Enter a date in the past." defaultValue={parseDate('2030-01-01')} />
      </State>
      <State label="Disabled and read-only" direction="column">
        <G.DateField label="Created" isDisabled defaultValue={parseDate('2026-01-15')} />
        <G.DateField label="Renews" isReadOnly defaultValue={parseDate('2027-01-15')} />
      </State>
    </Matrix>
  ),
};

export const TimeField: Story = {
  render: () => (
    <Matrix maxWidth={formColumn}>
      <State label="Default" direction="column">
        <G.TimeField label="Reminder" defaultValue={parseTime('09:30')} />
      </State>
      <State label="24-hour" direction="column">
        <G.TimeField label="Start" defaultValue={parseTime('18:45')} hourCycle={24} />
      </State>
      <State label="Invalid" direction="column">
        <G.TimeField label="Quiet hours" isInvalid errorMessage="Pick a time after 20:00." defaultValue={parseTime('12:00')} />
      </State>
      <State label="Disabled" direction="column">
        <G.TimeField label="Locked" isDisabled defaultValue={parseTime('07:00')} />
      </State>
    </Matrix>
  ),
};

export const DatePicker: Story = {
  render: () => (
    <Matrix maxWidth={formColumn}>
      <State label="Default" direction="column">
        <G.DatePicker label="Due date" defaultValue={parseDate('2026-10-01')} />
      </State>
      <State label="Invalid" direction="column">
        <G.DatePicker label="Due date" isInvalid errorMessage="Pick a date after today." defaultValue={parseDate('2020-01-01')} />
      </State>
      <State label="Disabled" direction="column">
        <G.DatePicker label="Due date" isDisabled />
      </State>
    </Matrix>
  ),
};

export const DateRangePicker: Story = {
  render: () => (
    <Matrix maxWidth={formColumn}>
      <State label="Default" direction="column">
        <G.DateRangePicker label="Trip" defaultValue={{ start: parseDate('2026-10-01'), end: parseDate('2026-10-08') }} />
      </State>
      <State label="Invalid" direction="column">
        <G.DateRangePicker label="Trip" isInvalid errorMessage="The range must be at most two weeks." />
      </State>
      <State label="Disabled" direction="column">
        <G.DateRangePicker label="Trip" isDisabled />
      </State>
    </Matrix>
  ),
};

/** HeroUI's Select docs examples: options with a description under the label, and the secondary variant on a surface. */
export const SelectDescriptionsAndVariants: Story = {
  name: 'Select (option descriptions, secondary variant)',
  parameters: { grammar: { minHeight: '22rem' } },
  render: () => (
    <Matrix maxWidth={420}>
      <State label="Option descriptions" direction="column">
        <G.Select
          label="Plan"
          placeholder="Choose a plan"
          options={[
            { id: 'starter', label: 'Starter', description: 'One workspace, 3 members' },
            { id: 'team', label: 'Team', description: 'Unlimited members and SSO' },
          ]}
          defaultValue="team"
        />
      </State>
      <State label="Secondary (on a surface)" direction="column">
        <G.Select label="Plan" options={planOptions} defaultValue="starter" />
      </State>
    </Matrix>
  ),
};

export const Select: Story = {
  render: () => (
    <Matrix maxWidth={formColumn}>
      <State label="Default" direction="column">
        <G.Select label="Plan" placeholder="Choose a plan" options={planOptions} />
      </State>
      <State label="Selected" direction="column">
        <G.Select label="Plan" options={planOptions} defaultValue="team" />
      </State>
      <State label="Loading (isLoading)" direction="column">
        <G.Select label="Plan" options={planOptions} isLoading />
      </State>
      <State label="Pending" direction="column">
        <G.Select label="Plan" options={planOptions} isPending placeholder="Loading plans" />
      </State>
      <State label="Invalid" direction="column">
        <G.Select label="Plan" options={planOptions} isRequired isInvalid errorMessage="Choose a plan." />
      </State>
      <State label="Disabled" direction="column">
        <G.Select label="Plan" options={planOptions} isDisabled defaultValue="starter" />
      </State>
    </Matrix>
  ),
};

/** Select and Input share the same control height. */
export const SelectBesideInput: Story = {
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'start', gap: '1rem', maxWidth: 720 }}>
      <G.Input id="select-parity-name" name="workspaceName" label="Workspace name" defaultValue="Acme" />
      <G.Select label="Workspace plan" options={planOptions} defaultValue="team" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const input = canvasElement.querySelector<HTMLElement>('.starci-core-input-field');
      const select = canvasElement.querySelector<HTMLElement>('.starci-core-select-trigger');
      if (input === null || select === null) throw new Error('field controls are missing');
      const height = input.getBoundingClientRect().height;
      if (Math.abs(height - select.getBoundingClientRect().height) > 0.1) throw new Error('Select and Input must have equal field height');
    });
  },
};

/** Open the listbox of a Select/ComboBox and show a selected, a hovered and a keyboard-focused option. */
const openWithRowStates = async (canvasElement: HTMLElement, trigger: string) => {
  const control = canvasElement.querySelector<HTMLElement>(trigger);
  if (control !== null) await userEvent.click(control);
  const root = canvasElement.ownerDocument;
  const options = await waitFor(() => {
    const found = root.querySelectorAll<HTMLElement>('[role="listbox"] [role="option"]');
    if (found.length < 3) throw new Error('options not open yet');
    return found;
  });
  await showRowStates(options[2], undefined);
  await userEvent.keyboard('{ArrowDown}');
};

export const SelectOpenRowStates: Story = {
  name: 'Select (open: selected, hover, focus rows)',
  parameters: { grammar: { minHeight: '28rem' } },
  render: () => (
    <div style={{ maxWidth: formColumn }}>
      <G.Select label="Plan" options={planOptions} defaultValue="starter" />
    </div>
  ),
  play: async ({ canvasElement }) => openWithRowStates(canvasElement, 'button'),
};

export const ComboBoxOpenRowStates: Story = {
  name: 'ComboBox (open: selected, hover, focus rows)',
  parameters: { grammar: { minHeight: '28rem' } },
  render: () => (
    <div style={{ maxWidth: formColumn }}>
      <G.ComboBox label="Plan" options={planOptions} defaultValue="starter" menuTrigger="focus" />
    </div>
  ),
  play: async ({ canvasElement }) => openWithRowStates(canvasElement, 'input'),
};

export const ComboBox: Story = {
  render: () => (
    <Matrix maxWidth={formColumn}>
      <State label="Default" direction="column">
        <G.ComboBox label="Plan" placeholder="Type to filter" options={planOptions} />
      </State>
      <State label="Selected" direction="column">
        <G.ComboBox label="Plan" options={planOptions} defaultValue="org" />
      </State>
      <State label="Pending" direction="column">
        <G.ComboBox label="Plan" options={planOptions} isPending placeholder="Searching" />
      </State>
      <State label="Invalid" direction="column">
        <G.ComboBox label="Plan" options={planOptions} isInvalid errorMessage="Pick a plan from the list." defaultInputValue="Unknown" />
      </State>
      <State label="Disabled" direction="column">
        <G.ComboBox label="Plan" options={planOptions} isDisabled />
      </State>
    </Matrix>
  ),
};

const longPlanOptions: ReadonlyArray<G.ListOption> = [
  { id: 'long', label: 'Enterprise annual plan with dedicated onboarding, priority support and a custom data retention agreement' },
  ...planOptions,
];

/**
 * 0.9.8: the single-line fields are one family. On the secondary layer Input, Select, ComboBox, SearchField,
 * NumberField, DateField and TimeField share one radius, one height and one trigger placement, and a long selected
 * value of Select / ComboBox stays on one line with an ellipsis (the full text is the title; options may still wrap).
 */
export const FieldFamilySecondary: Story = {
  name: 'Single-line fields: one family (secondary, long value)',
  render: () => (
    <Matrix maxWidth={formColumn}>
      <State label="Input" direction="column"><G.Input id="fam-input" name="fam-input" label="Name" defaultValue="Ada Lovelace" /></State>
      <State label="Select" direction="column"><G.Select label="Plan" options={planOptions} defaultValue="team" /></State>
      <State label="Select (long value)" direction="column"><G.Select label="Plan" options={longPlanOptions} defaultValue="long" /></State>
      <State label="ComboBox" direction="column"><G.ComboBox label="Plan" options={planOptions} defaultValue="team" /></State>
      <State label="ComboBox (long value)" direction="column"><G.ComboBox label="Plan" options={longPlanOptions} defaultValue="long" /></State>
      <State label="SearchField" direction="column"><G.SearchField label="Search" /></State>
      <State label="NumberField" direction="column"><G.NumberField label="Seats" defaultValue={4} /></State>
      <State label="DateField" direction="column"><G.DateField label="Due" /></State>
      <State label="TimeField" direction="column"><G.TimeField label="At" /></State>
    </Matrix>
  ),
};

export const ButtonGroup: Story = {
  render: () => (
    <Matrix>
      <State label="Horizontal">
        <G.ButtonGroup label="Text alignment" actions={[
          { id: 'left', label: 'Left', intent: 'alternative' },
          { id: 'centre', label: 'Centre', intent: 'alternative' },
          { id: 'right', label: 'Right', intent: 'alternative' },
        ]} />
      </State>
      <State label="Vertical">
        <G.ButtonGroup label="Actions" orientation="vertical" actions={[
          { id: 'duplicate', label: 'Duplicate', intent: 'neutral' },
          { id: 'archive', label: 'Archive', intent: 'neutral' },
        ]} />
      </State>
      <State label="Disabled">
        <G.ButtonGroup label="History" isDisabled actions={[
          { id: 'undo', label: 'Undo', intent: 'alternative' },
          { id: 'redo', label: 'Redo', intent: 'alternative' },
        ]} />
      </State>
    </Matrix>
  ),
};

export const FileDropzone: Story = {
  render: () => (
    <Matrix maxWidth={formColumn}>
      <State label="Default" direction="column">
        <G.FileDropzone label="Attachments" description="PNG or PDF, up to 5 MB." prompt="Drop files here or browse" icon={<G.Icon source={UploadGlyph} usage="heading" />} accept="image/png,application/pdf" multiple />
      </State>
      <State label="Invalid" direction="column">
        <G.FileDropzone label="Avatar" prompt="Drop an image" isRequired isInvalid errorMessage="An image is required." />
      </State>
    </Matrix>
  ),
};

/** The file picker as one action among others: the size of an IconButton, beside a message field in a composer. */
export const FileButton: Story = {
  render: () => (
    <Matrix maxWidth={formColumn}>
      <State label="Default" direction="row">
        <G.FileButton label="Attach a file" source={PaperclipGlyph} accept="image/png,application/pdf" onFilesChange={noop} />
      </State>
      <State label="In a composer" direction="row">
        <div style={{ display: 'flex', alignItems: 'end', gap: '0.5rem', width: '100%' }}>
          <G.FileButton label="Attach a file" source={PaperclipGlyph} multiple onFilesChange={noop} />
          <div style={{ flex: 1, minWidth: 0 }}><G.Textarea label="Message" isLabelHidden rows={1} /></div>
          <G.Button onPress={noop}>Send</G.Button>
        </div>
      </State>
    </Matrix>
  ),
};

export const FileButtonDisabled: Story = {
  render: () => (
    <Matrix maxWidth={formColumn}>
      <State label="Disabled" direction="row">
        <G.FileButton label="Attach a file" source={PaperclipGlyph} isDisabled onFilesChange={noop} />
      </State>
    </Matrix>
  ),
};

// Disabled on its own: WCAG 1.4.3 exempts inactive controls, so the a11y allowlist waives
// color-contrast for this story id only and the enabled FileDropzone story stays fully gated.
export const FileDropzoneDisabled: Story = {
  render: () => (
    <Matrix maxWidth={formColumn}>
      <State label="Disabled" direction="column">
        <G.FileDropzone label="Attachments" prompt="Uploads are paused" isDisabled />
      </State>
    </Matrix>
  ),
};

export const Rating: Story = {
  render: () => (
    <Matrix>
      <State label="Interactive">
        <G.Rating label="Rate this lesson" defaultValue={3} valueLabel={(value, max) => `${value} of ${max} stars`} />
      </State>
      <State label="Custom icon, ten steps">
        <G.Rating label="Difficulty" max={10} defaultValue={7} icon={<G.Icon source={StarGlyph} />} valueLabel={(value, max) => `${value} of ${max}`} />
      </State>
      <State label="Read-only">
        <G.Rating label="Average rating" value={4} isReadOnly valueLabel={(value, max) => `${value} of ${max} stars`} />
      </State>
      <State label="Disabled">
        <G.Rating label="Rating closed" value={2} isDisabled valueLabel={(value, max) => `${value} of ${max} stars`} />
      </State>
    </Matrix>
  ),
};

export const Fieldset: Story = {
  render: () => (
    <Matrix maxWidth={formColumn}>
      <State label="Default" direction="column">
        <G.Fieldset legend="Profile" description="Visible to your team.">
          <G.Input id="fs-name" name="name" label="Name" />
          <G.Input id="fs-role" name="role" label="Role" />
        </G.Fieldset>
      </State>
      <State label="Invalid with actions" direction="column">
        <G.Fieldset legend="Address" errorMessage="Complete the address before saving." actions={<G.Button size="sm" intent="alternative">Reset</G.Button>}>
          <G.Input id="fs-street" name="street" label="Street" isInvalid errorMessage="Required." />
        </G.Fieldset>
      </State>
      <State label="Disabled" direction="column">
        <G.Fieldset legend="Billing" isDisabled>
          <G.Switch label="Invoices by email" />
        </G.Fieldset>
      </State>
    </Matrix>
  ),
};

const FormDemo = ({ label, isPending, withErrors }: { readonly label: string; readonly isPending?: boolean; readonly withErrors?: boolean }) => {
  const [submitted, setSubmitted] = useState<string | null>(null);
  return (
    <G.Form
      label={label}
      isPending={isPending === true}
      {...(withErrors === true ? { validationErrors: { message: 'Add a short note so they know who invited them.' } } : {})}
      onSubmit={(data) => setSubmitted(data.get('role')?.toString() ?? '')}
    >
      <G.Textarea label="Message" name="message" rows={2} placeholder="Optional note" />
      <G.Select label="Role" name="role" options={planOptions} defaultValue="team" />
      <G.Checkbox label="Send a copy to me" name="copy" />
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <G.Button type="submit" intent="commit" isPending={isPending === true}>Send invite</G.Button>
        <G.Button type="reset" intent="neutral">Reset</G.Button>
      </div>
      {submitted === null ? null : <G.Text live="polite">Submitted with role {submitted}.</G.Text>}
    </G.Form>
  );
};

export const Form: Story = {
  render: () => (
    <Matrix maxWidth={formColumn}>
      <State label="Default" direction="column"><FormDemo label="Invite a teammate" /></State>
      <State label="Server validation errors (invalid)" direction="column"><FormDemo label="Invite with server errors" withErrors /></State>
      <State label="Pending" direction="column"><FormDemo label="Invite being sent" isPending /></State>
    </Matrix>
  ),
};

const rhythmChips: ReadonlyArray<{ readonly value: string; readonly label: string }> = [
  { value: 'friend', label: 'Friend' },
  { value: 'expert', label: 'Expert' },
  { value: 'critic', label: 'Critic' },
];

/**
 * THE FIELD RULE (owner, 2026-11-09), every control kind in one Form so the rhythm reads top to bottom: label -> control 8,
 * control -> help, error or counter 4, field -> field 24 (set by the Form, never by a field). A Fieldset: legend -> fields 8,
 * fields 24 apart, the actions 24 below the last field.
 */
export const FieldRhythm: Story = {
  render: () => (
    <Matrix maxWidth={formColumn}>
      <State label="Every control in one Form" direction="column">
        <G.Form label="Field rhythm">
          <G.Input id="rhythm-name" label="Name" name="rhythm-name" description="Shown to your team." />
          <G.Select label="Agent" name="rhythm-agent" options={planOptions} defaultValue="team" />
          <G.NumberField label="Goal" defaultValue={3} description="Leave empty when there is no goal yet." />
          <G.Textarea label="Question" rows={3} maxLength={200} description="Ask in your own words." />
          <G.ComboBox label="Plan" options={planOptions} placeholder="Type to filter" />
          <G.SearchField label="Search" />
          <G.DatePicker label="Due date" defaultValue={parseDate('2026-10-01')} />
          <G.DateField label="Start date" defaultValue={parseDate('2026-09-23')} />
          <G.TimeField label="Start time" defaultValue={parseTime('09:30')} />
          <G.CopyField label="Webhook URL" value="https://example.com/hooks/26465cdf" copyLabel="Copy" copiedLabel="Copied" copyErrorLabel="Copy failed" description="Paste it into the sender." />
          <G.ChoiceChips label="Ask as" options={rhythmChips} defaultValue="friend" empty={null} />
          <G.CheckboxGroup label="Notify by" options={choiceOptions} description="Pick at least one." />
          <G.RadioGroup label="Delivery" options={choiceOptions} defaultValue="email" description="You can change it later." />
          <G.Switch label="Dark mode" />
          <G.Slider label="Volume" defaultValue={40} />
          <G.Input id="rhythm-code" name="rhythm-code" label="Code" isInvalid errorMessage="Enter the six-digit code." />
          <G.Fieldset legend="Address" description="Where we send the invoice." actions={<G.Button size="sm" intent="alternative">Reset</G.Button>}>
            <G.Input id="rhythm-street" label="Street" name="rhythm-street" />
            <G.Input id="rhythm-city" label="City" name="rhythm-city" />
          </G.Fieldset>
        </G.Form>
      </State>
    </Matrix>
  ),
};

const MENTION_PEOPLE = [
  { id: 'linh', label: 'Linh', description: 'Owner' },
  { id: 'minh', label: 'Minh', description: 'Sales' },
  { id: 'sales-ai', label: 'Sales AI', description: 'Agent' },
] as const;

const MentionComposer = () => {
  const [value, setValue] = useState('Hi @');
  const [sent, setSent] = useState<string[]>([]);
  return (
    <div style={{ display: 'grid', gap: '0.75rem', maxWidth: '32rem' }}>
      <G.Textarea
        label="Message"
        value={value}
        onValueChange={setValue}
        send={{ label: 'Send message', onPress: () => { setSent((s) => [...s, value]); setValue(''); } }}
        description="Type @ to mention someone. Enter sends, Shift+Enter breaks the line."
        mentions={{ options: MENTION_PEOPLE, label: 'People to mention' }}
        onSubmitShortcut={() => { setSent((s) => [...s, value]); setValue(''); }}
      />
      {sent.map((m, i) => <G.Text key={i} size="sm">{m}</G.Text>)}
    </div>
  );
};

/** Mention suggestions and the Enter-to-send shortcut of a chat composer. */
export const TextareaMentions: Story = { render: () => <MentionComposer /> };
