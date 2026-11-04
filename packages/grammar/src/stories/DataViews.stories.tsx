import type { Meta, StoryObj } from "@storybook/react-vite"
import * as G from "../common/index.js"
import { Matrix, State, noop } from "./fixtures.js"

/*
 * Three generic data views, each in the four states of a region (contexts/ui/loading.md): ready, loading (the same
 * structure as geometry, labels kept real), empty (its own answer) and error (in place, with a retry).
 */

const meta: Meta = { title: "Navigation & Data/Data views" }
export default meta
type Story = StoryObj

const failure: G.ErrorData = { message: "Could not load this", description: "Check the connection and try again.", actionLabel: "Try again", onAction: noop }
const emptyLine = <G.EmptyNotice message="Nothing here yet" description="Items appear here as they arrive." />

const card = (id: string, title: string, description: string): G.ListRowData => ({ id, title, description, action: { label: "Open", press: noop } })

const columns: ReadonlyArray<G.BoardColumn> = [
    { id: "new", title: "New", count: 2, items: [card("a", "Hoa Sen Spa", "Zalo - 2 hours - Minh"), card("b", "Anh Tuan", "Website - 5 hours")], empty: emptyLine },
    { id: "qualified", title: "Qualified", count: 1, items: [card("c", "Tan Phat Company", "Next: send a quote by 06/11")], empty: emptyLine },
    { id: "proposal", title: "Proposal", count: 0, items: [], empty: <G.EmptyNotice message="No proposals" /> },
    { id: "won", title: "Won", count: 1, items: [card("d", "Chi Hanh", "Order 12,500,000")], empty: emptyLine },
]

export const BoardStates: Story = {
    render: () => (
        <Matrix>
            <State label="Ready" direction="column"><G.Board label="Sales pipeline" columns={columns} /></State>
            <State label="Loading (columns kept, rows as geometry)" direction="column"><G.Board label="Sales pipeline" columns={columns.map((column) => ({ ...column, items: [] }))} isLoading /></State>
            <State label="Error" direction="column"><G.Board label="Sales pipeline" columns={columns} error={failure} /></State>
        </Matrix>
    ),
}

const days: ReadonlyArray<G.ScheduleColumn> = [
    { id: "mon", label: "Mon", description: "2/11" },
    { id: "tue", label: "Tue", description: "3/11" },
    { id: "wed", label: "Wed", description: "4/11", isCurrent: true },
    { id: "thu", label: "Thu", description: "5/11" },
]
const hours: ReadonlyArray<G.ScheduleRow> = [{ id: "9", label: "09:00" }, { id: "11", label: "11:00" }, { id: "14", label: "14:00" }]
const entries: ReadonlyArray<G.ScheduleItem> = [
    { id: "1", row: "9", column: "mon", title: "Chi My", meta: "Hair wash - Lan", tone: "accent", onPress: noop },
    { id: "2", row: "9", column: "wed", title: "Anh Phong", meta: "Massage - Hung", tone: "success", onPress: noop },
    { id: "3", row: "11", column: "tue", title: "Chi Vy", meta: "Skin care - Room 2", tone: "warning", onPress: noop },
    { id: "4", row: "14", column: "thu", title: "Tan Phat Company", meta: "6 guests - Large room", tone: "danger", onPress: noop },
]

export const ScheduleGridStates: Story = {
    render: () => (
        <Matrix>
            <State label="Ready" direction="column"><G.ScheduleGrid label="Appointments, 2 to 5 November" columns={days} rows={hours} items={entries} empty={emptyLine} /></State>
            <State label="Loading (headings real, entries as geometry)" direction="column"><G.ScheduleGrid label="Appointments" columns={days} rows={hours} items={[]} empty={emptyLine} isLoading /></State>
            <State label="Empty (the grid stays, the answer under it)" direction="column"><G.ScheduleGrid label="Appointments" columns={days} rows={hours} items={[]} empty={<G.EmptyNotice message="No appointments this week" actionLabel="Add an appointment" onAction={noop} />} /></State>
            <State label="Error" direction="column"><G.ScheduleGrid label="Appointments" columns={days} rows={hours} items={entries} empty={emptyLine} error={failure} /></State>
        </Matrix>
    ),
}

const bars: ReadonlyArray<G.BarChartBar> = [
    { id: "mon", label: "Mon", value: 168 }, { id: "tue", label: "Tue", value: 120 }, { id: "wed", label: "Wed", value: 236 },
    { id: "thu", label: "Thu", value: 198 }, { id: "fri", label: "Fri", value: 214 }, { id: "sat", label: "Sat", value: 158 }, { id: "sun", label: "Sun", value: 142 },
]

export const BarChartStates: Story = {
    render: () => (
        <Matrix maxWidth={520}>
            <State label="Ready" direction="column"><G.BarChart label="Engagement per day" bars={bars} empty={emptyLine} /></State>
            <State label="Loading (labels kept)" direction="column"><G.BarChart label="Engagement per day" bars={bars.map((bar) => ({ ...bar, value: 0 }))} empty={emptyLine} isLoading /></State>
            <State label="Empty" direction="column"><G.BarChart label="Engagement per day" bars={[]} empty={emptyLine} /></State>
            <State label="Error" direction="column"><G.BarChart label="Engagement per day" bars={bars} empty={emptyLine} error={failure} /></State>
        </Matrix>
    ),
}
