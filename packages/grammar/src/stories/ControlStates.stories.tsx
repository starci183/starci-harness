import type { Meta, StoryObj } from "@storybook/react-vite"
import type { ReactNode } from "react"
import { expect, waitFor } from "storybook/test"
import * as G from "../common/index.js"

/*
 * The standard state set of every control family, one story per family, each state in its own labelled cell
 * (`data-control-state`). The play function checks that each state is really drawn as that state: a filled value,
 * a disabled control, an invalid field with its message, a loading skeleton that is inert and busy.
 *
 * - Input family (Input, Textarea, NumberField, SearchField) and Select family (Select, ComboBox):
 *   Default, Filled, Disabled, Invalid, Loading.
 * - Choice family (Checkbox, CheckboxGroup, RadioGroup, Switch, SegmentedControl): Default, Checked/Selected, Disabled,
 *   Invalid, Loading (SegmentedControl and Switch have no invalid state of their own and are left out of that row).
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

const cells = (canvas: Element, state: string) => [...canvas.querySelectorAll<HTMLElement>(`[data-control-state="${state}"]`)].filter((cell) => cell.childElementCount > 0)
const named = (cell: HTMLElement) => cell.getAttribute("data-control") ?? "?"

/** The checks every family shares; `extra` adds the family's own (filled value, checked mark). */
const checkStates = (canvas: Element) => {
    const problems: string[] = []
    for (const cell of cells(canvas, "Disabled")) {
        if (cell.querySelector('[data-grammar-disabled="true"], [data-disabled="true"], :disabled') === null) problems.push(`${named(cell)} Disabled: no disabled control`)
    }
    for (const state of ["Invalid", "Error"]) {
        for (const cell of cells(canvas, state)) {
            if (cell.querySelector('[data-grammar-invalid="true"], [data-invalid="true"], [aria-invalid="true"]') === null) problems.push(`${named(cell)} ${state}: not invalid`)
            if ((cell.querySelector('[data-grammar-field-error], .field-error, .error-message, [slot="errorMessage"]')?.textContent?.trim() ?? "") === "") problems.push(`${named(cell)} ${state}: no error message`)
        }
    }
    for (const cell of cells(canvas, "Loading")) {
        const scope = cell.querySelector('[aria-busy="true"]')
        if (scope === null) problems.push(`${named(cell)} Loading: no aria-busy owner`)
        if (cell.querySelector('[data-grammar-field-skeleton="true"][inert], [data-grammar-skeleton="true"]') === null) problems.push(`${named(cell)} Loading: not a skeleton`)
        if (cell.querySelector('[data-grammar-field-skeleton="true"]:not([inert])') !== null) problems.push(`${named(cell)} Loading: skeleton is not inert`)
    }
    for (const cell of cells(canvas, "Default")) {
        if (cell.querySelector('[data-grammar-invalid="true"], [data-grammar-disabled="true"], [aria-busy="true"]') !== null) problems.push(`${named(cell)} Default: not at rest`)
    }
    return problems
}

const playStates = (extra: (canvas: Element) => string[]): NonNullable<Story["play"]> => async ({ canvasElement }) => {
    await waitFor(() => {
        const problems = [...checkStates(canvasElement), ...extra(canvasElement)]
        expect(problems, problems.join("; ")).toEqual([])
    })
}

const planOptions = [
    { id: "starter", label: "Starter" },
    { id: "team", label: "Team" },
]
const choiceOptions = [
    { value: "email", label: "Email" },
    { value: "push", label: "Push" },
]
const segmentOptions = [
    { value: "day", label: "Day" },
    { value: "week", label: "Week" },
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
                        Loading: <G.Input id="state-input-loading" name="name" label="Name" isSkeleton />,
                    },
                },
                {
                    control: "Textarea",
                    states: {
                        Default: <G.Textarea label="Bio" rows={2} />,
                        Filled: <G.Textarea label="Bio" rows={2} defaultValue="Teaches grammar." />,
                        Disabled: <G.Textarea label="Bio" rows={2} defaultValue="Teaches grammar." isDisabled />,
                        Invalid: <G.Textarea label="Bio" rows={2} errorMessage="Write a sentence or two." />,
                        Loading: <G.Textarea label="Bio" rows={2} isSkeleton />,
                    },
                },
                {
                    control: "NumberField",
                    states: {
                        Default: <G.NumberField label="Seats" />,
                        Filled: <G.NumberField label="Seats" defaultValue={8} />,
                        Disabled: <G.NumberField label="Seats" defaultValue={8} isDisabled />,
                        Invalid: <G.NumberField label="Seats" defaultValue={0} errorMessage="At least one seat." />,
                        Loading: <G.NumberField label="Seats" isSkeleton />,
                    },
                },
                {
                    control: "SearchField",
                    states: {
                        Default: <G.SearchField label="Search" />,
                        Filled: <G.SearchField label="Search" defaultValue="lessons" />,
                        Disabled: <G.SearchField label="Search" defaultValue="lessons" isDisabled />,
                        Invalid: <G.SearchField label="Search" errorMessage="Type at least two letters." />,
                        Loading: <G.SearchField label="Search" isSkeleton />,
                    },
                },
            ]}
        />
    ),
    play: playStates((canvas) => cells(canvas, "Filled").flatMap((cell) => {
        const control = cell.querySelector<HTMLInputElement | HTMLTextAreaElement>("input:not([type=hidden]), textarea")
        return control === null || control.value === "" ? [`${named(cell)} Filled: no value`] : []
    })),
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
                        Loading: <G.Select label="Plan" options={planOptions} isSkeleton />,
                    },
                },
                {
                    control: "ComboBox",
                    states: {
                        Default: <G.ComboBox label="Plan" options={planOptions} />,
                        Filled: <G.ComboBox label="Plan" options={planOptions} defaultValue="team" />,
                        Disabled: <G.ComboBox label="Plan" options={planOptions} defaultValue="team" isDisabled />,
                        Invalid: <G.ComboBox label="Plan" options={planOptions} errorMessage="Choose a plan." />,
                        Loading: <G.ComboBox label="Plan" options={planOptions} isSkeleton />,
                    },
                },
            ]}
        />
    ),
    play: playStates((canvas) => cells(canvas, "Filled").flatMap((cell) => {
        const shown = cell.querySelector("[data-grammar-field-control]")?.textContent?.trim() ?? ""
        const input = cell.querySelector<HTMLInputElement>("input:not([type=hidden])")?.value ?? ""
        return shown.includes("Team") || input === "Team" ? [] : [`${named(cell)} Filled: "Team" is not shown`]
    })),
}

const CHOICE_STATES = ["Default", "Checked", "Disabled", "Invalid", "Loading"] as const

/** Checkbox, CheckboxGroup, RadioGroup, Switch and SegmentedControl: Default, Checked/Selected, Disabled, Invalid, Loading. */
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
                        Loading: <G.Checkbox label="Accept the terms" isSkeleton />,
                    },
                },
                {
                    control: "CheckboxGroup",
                    states: {
                        Default: <G.CheckboxGroup label="Notifications" options={choiceOptions} />,
                        Checked: <G.CheckboxGroup label="Notifications" options={choiceOptions} defaultValue={["email"]} />,
                        Disabled: <G.CheckboxGroup label="Notifications" options={choiceOptions} isDisabled />,
                        Invalid: <G.CheckboxGroup label="Notifications" options={choiceOptions} errorMessage="Pick at least one." />,
                        Loading: <G.CheckboxGroup label="Notifications" options={choiceOptions} isSkeleton />,
                    },
                },
                {
                    control: "RadioGroup",
                    states: {
                        Default: <G.RadioGroup label="Digest" options={choiceOptions} />,
                        Checked: <G.RadioGroup label="Digest" options={choiceOptions} defaultValue="email" />,
                        Disabled: <G.RadioGroup label="Digest" options={choiceOptions} isDisabled />,
                        Invalid: <G.RadioGroup label="Digest" options={choiceOptions} errorMessage="Pick a channel." />,
                        Loading: <G.RadioGroup label="Digest" options={choiceOptions} isSkeleton />,
                    },
                },
                {
                    control: "Switch",
                    states: {
                        Default: <G.Switch label="Dark mode" />,
                        Checked: <G.Switch label="Dark mode" defaultSelected />,
                        Disabled: <G.Switch label="Dark mode" isDisabled />,
                        Loading: <G.Switch label="Dark mode" isSkeleton />,
                    },
                },
                {
                    control: "SegmentedControl",
                    states: {
                        Default: <G.SegmentedControl label="Range" options={segmentOptions} />,
                        Checked: <G.SegmentedControl label="Range" options={segmentOptions} defaultValue="week" />,
                        Disabled: <G.SegmentedControl label="Range" options={segmentOptions} isDisabled />,
                        Loading: <G.SegmentedControl label="Range" options={segmentOptions} isSkeleton />,
                    },
                },
            ]}
        />
    ),
    play: playStates((canvas) => cells(canvas, "Checked").flatMap((cell) =>
        cell.querySelector('[data-selected="true"], :checked, [aria-pressed="true"], [aria-checked="true"]') === null ? [`${named(cell)} Checked: nothing selected`] : [])),
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
                        Default: <G.Field label="Account id">{nativeInput}</G.Field>,
                        WithHint: <G.Field label="Account id" description="Shown on invoices.">{nativeInput}</G.Field>,
                        Required: <G.Field label="Account id" isRequired>{nativeInput}</G.Field>,
                        Error: <G.Field label="Account id" errorMessage="Use 8 digits.">{nativeInput}</G.Field>,
                        Disabled: <G.Field label="Account id" isDisabled>{nativeInput}</G.Field>,
                        Loading: <G.Field label="Account id" description="Shown on invoices." isSkeleton>{nativeInput}</G.Field>,
                    },
                },
            ]}
        />
    ),
    play: playStates((canvas) => {
        const problems: string[] = []
        const hint = cells(canvas, "WithHint")[0]
        const hintText = hint?.querySelector("[data-grammar-field-description]")
        const hintInput = hint?.querySelector("input")
        if (hintText == null || hintInput == null || !(hintInput.getAttribute("aria-describedby") ?? "").includes(hintText.id)) problems.push("Field WithHint: the description is not the control's description")
        const required = cells(canvas, "Required")[0]
        if (required?.querySelector("input[required][aria-required=true]") == null || required.querySelector(".starci-core-field-required") === null) problems.push("Field Required: no required control and mark")
        return problems
    }),
}
