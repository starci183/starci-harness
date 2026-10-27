import type { Meta, StoryObj } from "@storybook/react-vite"
import { parseDate, parseTime } from "@internationalized/date"
import * as G from "../common/index.js"

const meta: Meta = { title: "Forms/Surface defaults" }
export default meta

type Story = StoryObj

const options = [
    { id: "personal", label: "Personal" },
    { id: "team", label: "Team" },
]
const choices = [
    { value: "email", label: "Email" },
    { value: "push", label: "Push" },
]

/** Omitted variants follow painted surfaces; unpainted containers inherit their parent layer. */
const Fields = ({ prefix }: { readonly prefix: string }) => (
    <div style={{ display: "grid", gap: "1rem" }}>
        <G.Input id={`${prefix}-name`} name={`${prefix}-name`} label="Display name" />
        <G.SearchField label="Search conversations" clearLabel="Clear search" />
        <G.Select label="Workspace" options={options} />
        <G.Checkbox label="Remember this workspace" />
        <G.PressableField label="Find a workspace" placeholder="Choose a workspace" />
        <G.OtpInput id={`${prefix}-code`} name={`${prefix}-code`} label="Verification code" />
    </div>
)

export const LayerDefaults: Story = {
    render: () => (
        <div style={{ display: "grid", gap: "2rem", maxWidth: "64rem", gridTemplateColumns: "repeat(auto-fit, minmax(16rem, 1fr))" }}>
            <section>
                <G.Heading level={2}>Page defaults: primary</G.Heading>
                <Fields prefix="page" />
            </section>
            <G.SurfaceCard label="Bounded surface: secondary">
                <Fields prefix="bounded" />
            </G.SurfaceCard>
            <G.Rail label="Page rail: primary">
                <Fields prefix="rail" />
            </G.Rail>
            <G.SurfaceCard label="Outer surface: secondary">
                <G.SurfaceCard label="Nested surface: border, secondary">
                    <Fields prefix="nested" />
                </G.SurfaceCard>
            </G.SurfaceCard>
        </div>
    ),
}

export const EveryNestedField: Story = {
    render: () => (
        <div style={{ maxWidth: "28rem" }}>
            <G.SurfaceCard label="All fields inherit secondary">
                <div style={{ display: "grid", gap: "1rem" }}>
                    <Fields prefix="all" />
                    <G.Textarea label="About the group" rows={3} />
                    <G.NumberField label="Member limit" defaultValue={8} />
                    <G.DateField label="Start date" defaultValue={parseDate("2026-10-25")} />
                    <G.TimeField label="Meeting time" defaultValue={parseTime("09:30")} />
                    <G.DatePicker label="Reminder date" />
                    <G.DateRangePicker label="Availability" />
                    <G.ComboBox label="Conversation" options={options} />
                    <G.CheckboxGroup label="Notifications" options={choices} />
                    <G.RadioGroup label="Digest channel" options={choices} />
                    <G.SearchField label="Loading search" isSkeleton />
                    <G.NumberField label="Loading member limit" isSkeleton />
                    <G.Textarea label="Loading description" isSkeleton />
                </div>
            </G.SurfaceCard>
        </div>
    ),
}

export const PanelsAndOverlays: Story = {
    render: () => (
        <div style={{ display: "grid", gap: "2rem", maxWidth: "42rem" }}>
            <G.Rail label="Conversation panel" inset="content">
                <G.SearchField label="Search panel" />
            </G.Rail>
            <G.Sidebar label="Workspace navigation" groups={[]} header={<G.SearchField label="Search sidebar" />} />
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                <G.Dialog title="Edit conversation" closeLabel="Close dialog" trigger={<G.Button variant="secondary">Open dialog</G.Button>}>
                    <Fields prefix="dialog" />
                </G.Dialog>
                <G.Drawer title="Conversation details" closeLabel="Close drawer" trigger={<G.Button variant="secondary">Open drawer</G.Button>}>
                    <Fields prefix="drawer" />
                </G.Drawer>
                <G.Popover title="Find conversations" trigger={<G.Button variant="secondary">Open popover</G.Button>}>
                    <Fields prefix="popover" />
                </G.Popover>
            </div>
        </div>
    ),
}
