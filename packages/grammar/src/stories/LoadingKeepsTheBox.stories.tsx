import type { Meta, StoryObj } from "@storybook/react-vite"
import { parseDate, parseTime } from "@internationalized/date"
import type { ReactNode } from "react"
import * as G from "../common/index.js"
import { LoadingScope } from "../core/regionScope.js"
import { Matrix, State } from "./fixtures.js"

/*
 * Loading keeps the box (ruling region-loading, law DNA-COMMON-LOADING-SAME-BOX). Every component here is drawn twice with the same
 * props: ready, and inside a loading region. The pair is a twin, and the law measures that both have one width and one height.
 */

const meta: Meta = { title: "States/Loading keeps the box" }
export default meta
type Story = StoryObj

const options = [{ id: "a", label: "Starter" }, { id: "b", label: "Team" }]
const choice = [{ value: "email", label: "Email" }, { value: "sms", label: "SMS" }]
const people: ReadonlyArray<G.AvatarGroupItem> = [{ id: "1", name: "Alex Morgan" }, { id: "2", name: "Sam Rivera" }, { id: "3", name: "Jo Kim" }]

const Twin = ({ name, children, width }: { readonly name: string; readonly children: ReactNode; readonly width?: string }) => (
    <State label={name} direction="row">
        <div data-grammar-twin={name} style={{ display: "flex", gap: "1.5rem", alignItems: "flex-start", flexWrap: "wrap" }}>
            <div data-grammar-twin-item="ready" style={{ display: "inline-flex", flexDirection: "column", ...(width === undefined ? {} : { width }) }}>{children}</div>
            <LoadingScope isLoading><div data-grammar-twin-item="loading" style={{ display: "inline-flex", flexDirection: "column", ...(width === undefined ? {} : { width }) }}>{children}</div></LoadingScope>
        </div>
    </State>
)

export const LoadingKeepsTheBox: Story = {
    render: () => (
        <Matrix>
            <Twin name="Input"><G.Input id="in" name="in" label="Name" defaultValue="Hoa Sen Spa" /></Twin>
            <Twin name="Select"><G.Select label="Plan" options={options} defaultValue="b" /></Twin>
            <Twin name="ComboBox"><G.ComboBox label="Owner" options={options} defaultValue="a" /></Twin>
            <Twin name="NumberField"><G.NumberField label="Seats" defaultValue={4} /></Twin>
            <Twin name="SearchField"><G.SearchField label="Search" placeholder="Search" /></Twin>
            <Twin name="Textarea" width="20rem"><G.Textarea label="Note" defaultValue="Prefers mornings." /></Twin>
            <Twin name="DateField"><G.DateField label="Start" defaultValue={parseDate("2026-11-05")} /></Twin>
            <Twin name="TimeField"><G.TimeField label="At" defaultValue={parseTime("09:30")} /></Twin>
            <Twin name="DatePicker"><G.DatePicker label="Due" defaultValue={parseDate("2026-11-10")} /></Twin>
            <Twin name="Checkbox"><G.Checkbox label="Send a copy" /></Twin>
            <Twin name="Switch"><G.Switch label="Reminders" /></Twin>
            <Twin name="Slider"><G.Slider label="Volume" defaultValue={40} /></Twin>
            <Twin name="Rating"><G.Rating label="Rating" defaultValue={3} valueLabel={(value, max) => `${value} of ${max}`} /></Twin>
            <Twin name="RadioGroup"><G.RadioGroup label="Delivery" options={choice} defaultValue="email" /></Twin>
            <Twin name="CheckboxGroup"><G.CheckboxGroup label="Channels" options={choice} /></Twin>
            <Twin name="RadioGroupRows"><G.RadioGroup label="Service" appearance="rows" options={[{ value: "wash", label: "Herbal wash", description: "60 minutes, 250,000" }, { value: "dye", label: "Colour", description: "90 minutes, 450,000" }]} defaultValue="wash" /></Twin>
            <Twin name="CheckboxGroupDescribed"><G.CheckboxGroup label="Extras" options={[{ value: "a", label: "Scalp massage", description: "15 minutes" }, { value: "b", label: "Towel service" }]} /></Twin>
            <Twin name="ChoiceChipsMultiple"><G.ChoiceChips label="Days" selectionMode="multiple" options={["Mon", "Tue", "Wed", "Thu"].map((day) => ({ value: day, label: day }))} defaultValues={["Mon", "Wed"]} empty={null} /></Twin>
            <Twin name="CalendarFill" width="30rem"><G.Calendar label="Date" previousLabel="Previous" nextLabel="Next" width="fill" defaultValue={parseDate("2026-11-05")} /></Twin>
            <Twin name="ChoiceChips"><G.ChoiceChips label="Time" options={[{ value: "9", label: "09:00" }, { value: "10", label: "10:00" }]} defaultValue="9" empty={null} /></Twin>
            <Twin name="Badge"><G.Badge tone="success">Paid</G.Badge></Twin>
            <Twin name="Avatar"><G.Avatar name="Alex Morgan" size="sm" /></Twin>
            <Twin name="AvatarGroup"><G.AvatarGroup label="Members" items={people} max={3} overflowLabel={(count) => `${count} more`} /></Twin>
            <Twin name="StatusDot"><G.StatusDot tone="success" aria-label="Live" /></Twin>
            <Twin name="RelativeTime"><G.RelativeTime dateTime="2026-11-05T08:00:00Z" locale="en" /></Twin>
            <Twin name="Meter" width="16rem"><G.Meter label="Storage" value={32} /></Twin>
            <Twin name="Progress" width="16rem"><G.Progress label="Setup" value={40} /></Twin>
            <Twin name="Alert"><G.Alert tone="cautionary" title="Almost full" description="You have used 90%." /></Twin>
            <Twin name="DescriptionList"><G.DescriptionList density="compact" items={[{ id: "from", term: "From", description: "Chi Lan" }, { id: "via", term: "Channel", description: "Zalo" }]} /></Twin>
            <Twin name="IdentityLockup"><G.IdentityLockup title="Hakuen" subtitle="Owner" /></Twin>
        </Matrix>
    ),
}
