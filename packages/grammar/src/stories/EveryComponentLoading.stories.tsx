import type { Meta, StoryObj } from "@storybook/react-vite"
import { parseDate, parseTime } from "@internationalized/date"
import * as G from "../common/index.js"
import { Matrix, State, noop } from "./fixtures.js"

/*
 * Every component, loading. The same page is drawn ready and in a loading region (a SurfaceCard that carries
 * the flag): nothing here takes `isLoading` of its own. Static chrome keeps its real words and only goes inert ("Cancel", the tab
 * labels, the field labels); data (values, counts, rows, chips, avatars, a button that carries a count) becomes the geometry of the
 * ready box; the region carries the one aria-busy. The two renders have the same boxes, in both families, light and dark.
 */

const meta: Meta = { title: "States/Every component, loading" }
export default meta
type Story = StoryObj

const options = [{ id: "a", label: "Starter" }, { id: "b", label: "Team" }, { id: "c", label: "Business" }]
const choice = [{ value: "email", label: "Email" }, { value: "sms", label: "SMS" }]
const people: ReadonlyArray<G.AvatarGroupItem> = [{ id: "1", name: "Alex Morgan" }, { id: "2", name: "Sam Rivera" }, { id: "3", name: "Jo Kim" }]
const tags: ReadonlyArray<G.TagGroupItem> = [{ id: "t1", label: "Spa" }, { id: "t2", label: "Retail" }]
const steps: ReadonlyArray<G.StepperStep> = [{ id: "a", label: "Profile" }, { id: "b", label: "Channels" }, { id: "c", label: "Done" }]
const rows: ReadonlyArray<G.ListRowData> = [
    { id: "r1", title: "Hoa Sen Spa", description: "Zalo, 2 hours", leading: { avatar: { name: "Hoa Sen" } }, badges: [{ label: "New", tone: "accent" }], meta: { text: "Due today" }, action: { label: "Open", press: noop } },
    { id: "r2", title: "Anh Tuan", description: "Website, 5 hours", leading: { avatar: { name: "Anh Tuan" } }, badges: [{ label: "Open", tone: "warning" }], action: { label: "Open", press: noop } },
]

const Page = ({ isLoading }: { readonly isLoading?: boolean }) => (
    <G.SurfaceCard label="Customer" {...(isLoading === undefined ? {} : { isLoading })}>
        <G.Cluster gap="inline">
            <G.Button intent="alternative" onPress={noop}>Cancel</G.Button>
            <G.Button intent="commit" onPress={noop} {...(isLoading === undefined ? {} : { isLoading })}>Approve 3 orders</G.Button>
            <G.IconButton label="Refresh" intent="neutral" source={BellIcon} onPress={noop} />
            <G.TextAction onPress={noop}>View history</G.TextAction>
            <G.Link href="#details">Details</G.Link>
        </G.Cluster>
        <G.Tabs label="Sections" items={[{ id: "a", label: "Overview" }, { id: "b", label: "Orders", count: 3 }]} selectedKey="a" onSelect={noop} panelId="every-panel" />
        <div id="every-panel" role="tabpanel"><G.Text tone="muted">The overview.</G.Text></div>
        <G.Grid kind="form" columns={1}>
            <G.Input id="name" name="name" label="Name" defaultValue="Hoa Sen Spa" />
            <G.Select label="Plan" options={options} defaultValue="b" />
            <G.ComboBox label="Owner" options={options} defaultValue="a" />
            <G.NumberField label="Seats" defaultValue={4} />
            <G.DateField label="Start" defaultValue={parseDate("2026-11-05")} />
            <G.TimeField label="At" defaultValue={parseTime("09:30")} />
            <G.DatePicker label="Due" defaultValue={parseDate("2026-11-10")} />
            <G.DateRangePicker label="Trip" defaultValue={{ start: parseDate("2026-11-10"), end: parseDate("2026-11-14") }} />
            <G.SearchField label="Search" placeholder="Search" />
            <G.Textarea label="Note" defaultValue="Prefers mornings." />
        </G.Grid>
        <G.Cluster gap="row">
            <G.Checkbox label="Send a copy" />
            <G.Switch label="Reminders" />
            <G.Slider label="Volume" defaultValue={40} />
            <G.Rating label="Rating" defaultValue={3} valueLabel={(value, max) => `${value} of ${max}`} />
        </G.Cluster>
        <G.RadioGroup label="Delivery" options={choice} defaultValue="email" />
        <G.CheckboxGroup label="Channels" options={choice} />
        <G.ChoiceChips label="Time" options={[{ value: "9", label: "09:00" }, { value: "10", label: "10:00" }]} defaultValue="9" empty={null} />
        <G.Cluster gap="inline">
            <G.Badge tone="success">Paid</G.Badge>
            <G.Avatar name="Alex Morgan" size="sm" />
            <G.AvatarGroup label="Members" items={people} max={3} overflowLabel={(count) => `${count} more`} />
            <G.StatusDot tone="success" aria-label="Live" />
            <G.RelativeTime dateTime="2026-11-05T08:00:00Z" locale="en" />
            <G.TagGroup label="Topics" items={tags} />
        </G.Cluster>
        <G.Meter label="Storage" value={32} />
        <G.Progress label="Setup" value={40} />
        <G.Alert tone="cautionary" title="Almost full" description="You have used 90%." action={{ label: "Upgrade", onAction: noop }} />
        <G.DescriptionList density="compact" items={[{ id: "from", term: "From", description: "Chi Lan" }, { id: "via", term: "Channel", description: "Zalo" }]} />
        <G.Stepper label="Progress" steps={steps} currentStepId="b" />
        <G.Pagination label="Pages" page={2} pageCount={5} onPageChange={noop} previousLabel="Previous" nextLabel="Next" pageLabel={(page) => `Page ${page}`} />
        <G.Section kind="list" title="Open work" items={rows} empty={null} />
    </G.SurfaceCard>
)

export const EveryComponentLoading: Story = {
    render: () => (
        <Matrix maxWidth={720}>
            <State label="Ready" direction="column"><Page /></State>
            <State label="Loading: the region carries the flag; chrome keeps its words and goes inert, data is geometry" direction="column"><Page isLoading /></State>
        </Matrix>
    ),
}

function BellIcon(props: React.SVGProps<SVGSVGElement>) {
    return <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth={2} {...props}><path d="M6 9a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8" /></svg>
}
