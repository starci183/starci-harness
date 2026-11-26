import type { Meta, StoryObj } from "@storybook/react-vite"
import type { ReactNode } from "react"
import * as G from "../common/index.js"

/*
 * The standard state set of every control family, one story per family, each state in its own labelled cell
 * (`data-control-state`). The shots show each state drawn as that state: a filled value,
 * a disabled control, an invalid field with its message, a loading skeleton that is inert and busy.
 *
 * - Input family (Input, Textarea, NumberField, SearchField) and Select family (Select, ComboBox):
 *   Default, Filled, Disabled, Invalid, Loading.
 * - Choice family (Checkbox, CheckboxGroup, RadioGroup, Switch): Default, Checked/Selected, Disabled,
 *   Invalid, Loading (Switch has no invalid state of its own and is left out of that row).
 * - Field (a custom control): Default, WithHint, Required, Error, Disabled, Loading.
 */

const meta: Meta = { title: "Forms/Control states" }
export default meta
type Story = StoryObj

type Row = { readonly control: string; readonly states: Readonly<Record<string, ReactNode>> }

const StateTable = ({ rows, states }: { readonly rows: ReadonlyArray<Row>; readonly states: ReadonlyArray<string> }) => (
    <div style={{ display: "grid", gridTemplateColumns: `8rem repeat(${states.length}, minmax(12rem, 1fr))`, gap: "1.25rem 1.5rem", alignItems: "start" }}>
        <span />
        {states.map((state) => <span key={state} style={{ fontSize: "0.75rem", fontWeight: 600 }}>{state}</span>)}
        {rows.map((row) => [
            <span key={`${row.control}-name`} style={{ fontSize: "0.75rem", fontWeight: 600 }}>{row.control}</span>,
            ...states.map((state) => (
                <div key={`${row.control}-${state}`} data-control={row.control} data-control-state={state} style={{ minWidth: 0 }}>
                    {row.states[state] ?? null}
                </div>
            )),
        ])}
    </div>
)

const planOptions = [
    { id: "starter", label: "Starter" },
    { id: "team", label: "Team" },
]
const choiceOptions = [
    { value: "email", label: "Email" },
    { value: "push", label: "Push" },
]

const INPUT_STATES = ["Default", "Filled", "Disabled", "Invalid", "Loading"] as const

/** Input, Textarea, NumberField and SearchField: Default, Filled, Disabled, Invalid, Loading. */
export const InputFamily: Story = {
    render: () => (
        <StateTable
            states={INPUT_STATES}
            rows={[
                {
                    control: "Input",
                    states: {
                        Default: <G.Input id="state-input-default" name="name" label="Name" />,
                        Filled: <G.Input id="state-input-filled" name="name" label="Name" defaultValue="Alex Morgan" />,
                        Disabled: <G.Input id="state-input-disabled" name="name" label="Name" defaultValue="Alex Morgan" isDisabled />,
                        Invalid: <G.Input id="state-input-invalid" name="name" label="Name" errorMessage="Enter your name." />,
                        Loading: <G.Input id="state-input-loading" name="name" label="Name" isLoading />,
                    },
                },
                {
                    control: "Textarea",
                    states: {
                        Default: <G.Textarea label="Bio" rows={2} />,
                        Filled: <G.Textarea label="Bio" rows={2} defaultValue="Teaches grammar." />,
                        Disabled: <G.Textarea label="Bio" rows={2} defaultValue="Teaches grammar." isDisabled />,
                        Invalid: <G.Textarea label="Bio" rows={2} errorMessage="Write a sentence or two." />,
                        Loading: <G.Textarea label="Bio" rows={2} isLoading />,
                    },
                },
                {
                    control: "NumberField",
                    states: {
                        Default: <G.NumberField label="Seats" />,
                        Filled: <G.NumberField label="Seats" defaultValue={8} />,
                        Disabled: <G.NumberField label="Seats" defaultValue={8} isDisabled />,
                        Invalid: <G.NumberField label="Seats" defaultValue={0} errorMessage="At least one seat." />,
                        Loading: <G.NumberField label="Seats" isLoading />,
                    },
                },
                {
                    control: "SearchField",
                    states: {
                        Default: <G.SearchField label="Search" />,
                        Filled: <G.SearchField label="Search" defaultValue="documents" />,
                        Disabled: <G.SearchField label="Search" defaultValue="documents" isDisabled />,
                        Invalid: <G.SearchField label="Search" errorMessage="Type at least two letters." />,
                        Loading: <G.SearchField label="Search" isLoading />,
                    },
                },
            ]}
        />
    ),
}

/** Select and ComboBox: Default, Filled (a value chosen), Disabled, Invalid, Loading. */
export const SelectFamily: Story = {
    render: () => (
        <StateTable
            states={INPUT_STATES}
            rows={[
                {
                    control: "Select",
                    states: {
                        Default: <G.Select label="Plan" options={planOptions} />,
                        Filled: <G.Select label="Plan" options={planOptions} defaultValue="team" />,
                        Disabled: <G.Select label="Plan" options={planOptions} defaultValue="team" isDisabled />,
                        Invalid: <G.Select label="Plan" options={planOptions} errorMessage="Choose a plan." />,
                        Loading: <G.Select label="Plan" options={planOptions} isLoading />,
                    },
                },
                {
                    control: "ComboBox",
                    states: {
                        Default: <G.ComboBox label="Plan" options={planOptions} />,
                        Filled: <G.ComboBox label="Plan" options={planOptions} defaultValue="team" />,
                        Disabled: <G.ComboBox label="Plan" options={planOptions} defaultValue="team" isDisabled />,
                        Invalid: <G.ComboBox label="Plan" options={planOptions} errorMessage="Choose a plan." />,
                        Loading: <G.ComboBox label="Plan" options={planOptions} isLoading />,
                    },
                },
            ]}
        />
    ),
}

const CHOICE_STATES = ["Default", "Checked", "Disabled", "Invalid", "Loading"] as const

/** Checkbox, CheckboxGroup, RadioGroup and Switch: Default, Checked/Selected, Disabled, Invalid, Loading. */
export const ChoiceFamily: Story = {
    render: () => (
        <StateTable
            states={CHOICE_STATES}
            rows={[
                {
                    control: "Checkbox",
                    states: {
                        Default: <G.Checkbox label="Accept the terms" />,
                        Checked: <G.Checkbox label="Accept the terms" defaultSelected />,
                        Disabled: <G.Checkbox label="Accept the terms" isDisabled />,
                        Invalid: <G.Checkbox label="Accept the terms" isRequired errorMessage="Required to continue." />,
                        Loading: <G.Checkbox label="Accept the terms" isLoading />,
                    },
                },
                {
                    control: "CheckboxGroup",
                    states: {
                        Default: <G.CheckboxGroup label="Notifications" options={choiceOptions} />,
                        Checked: <G.CheckboxGroup label="Notifications" options={choiceOptions} defaultValue={["email"]} />,
                        Disabled: <G.CheckboxGroup label="Notifications" options={choiceOptions} isDisabled />,
                        Invalid: <G.CheckboxGroup label="Notifications" options={choiceOptions} errorMessage="Pick at least one." />,
                        Loading: <G.CheckboxGroup label="Notifications" options={choiceOptions} isLoading />,
                    },
                },
                {
                    control: "RadioGroup",
                    states: {
                        Default: <G.RadioGroup label="Digest" options={choiceOptions} />,
                        Checked: <G.RadioGroup label="Digest" options={choiceOptions} defaultValue="email" />,
                        Disabled: <G.RadioGroup label="Digest" options={choiceOptions} isDisabled />,
                        Invalid: <G.RadioGroup label="Digest" options={choiceOptions} errorMessage="Pick a channel." />,
                        Loading: <G.RadioGroup label="Digest" options={choiceOptions} isLoading />,
                    },
                },
                {
                    control: "Switch",
                    states: {
                        Default: <G.Switch description="Short description." label="Dark mode" />,
                        Checked: <G.Switch description="Short description." label="Dark mode" defaultSelected />,
                        Disabled: <G.Switch description="Short description." label="Dark mode" isDisabled />,
                        Loading: <G.Switch description="Short description." label="Dark mode" isLoading />,
                    },
                },
            ]}
        />
    ),
}

const FIELD_STATES = ["Default", "WithHint", "Required", "Error", "Disabled", "Loading"] as const
const nativeInput = (control: G.FieldControlAttributes) => <input {...control} style={{ boxSizing: "border-box", width: "100%", height: "2.5rem" }} />

/** Field around a custom control: Default, WithHint (description), Required, Error, Disabled, Loading. */
export const FieldStates: Story = {
    render: () => (
        <StateTable
            states={FIELD_STATES}
            rows={[
                {
                    control: "Field",
                    states: {
                        Default: <G.Field label="Account id" control={nativeInput} />,
                        WithHint: <G.Field label="Account id" description="Shown on invoices." control={nativeInput} />,
                        Required: <G.Field label="Account id" isRequired control={nativeInput} />,
                        Error: <G.Field label="Account id" errorMessage="Use 8 digits." control={nativeInput} />,
                        Disabled: <G.Field label="Account id" isDisabled control={nativeInput} />,
                        Loading: <G.Field label="Account id" description="Shown on invoices." isLoading control={nativeInput} />,
                    },
                },
            ]}
        />
    ),
}
