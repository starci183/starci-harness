import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
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

/* The empty notice's action weight: the region's one primary by default, or outlined in a secondary place (a rail, a side card). */
export const EmptyNoticeActionIntent: Story = {
    render: () => (
        <Matrix>
            <State label="commit (default): the region's one primary" direction="column"><G.EmptyNotice message="No documents yet" description="Add a document so the agent can read it." actionLabel="Add document" onAction={noop} /></State>
            <State label="neutral: a rail on a page whose primary is in its header" direction="column"><G.EmptyNotice message="No documents from Google Drive yet" description="Turn on Drive and pick a folder for NIVO to read." actionLabel="Turn on Drive" actionIntent="neutral" onAction={noop} /></State>
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

const slots: ReadonlyArray<G.ChoiceChip> = ["09:00", "09:30", "10:30", "14:00", "15:30", "16:00", "17:30", "18:00", "18:30", "19:00", "19:30"].map((time) => ({ value: time, label: time, isDisabled: time === "10:30" }))

export const ChoiceChipsStates: Story = {
    render: () => (
        <Matrix maxWidth={420}>
            <State label="Ready (a taken option keeps its place)" direction="column"><G.ChoiceChips label="Time" options={slots} defaultValue="14:00" empty={emptyLine} /></State>
            <State label="Loading (the options given as geometry)" direction="column"><G.ChoiceChips label="Time" options={slots} empty={emptyLine} isLoading /></State>
            <State label="Empty" direction="column"><G.ChoiceChips label="Time" options={[]} empty={<G.EmptyNotice message="No free time that day" description="Pick another day." />} /></State>
            <State label="Error" direction="column"><G.ChoiceChips label="Time" options={slots} empty={emptyLine} error={failure} /></State>
        </Matrix>
    ),
}

/* ------------------------------------------------------------------ move, press and place */

const stageOf = (stage: string): ReadonlyArray<string> => (stage === "new" ? ["a", "b"] : stage === "qualified" ? ["c"] : [])
const names: Readonly<Record<string, string>> = { a: "Hoa Sen Spa", b: "Anh Tuan", c: "Tan Phat Company" }

const MovableBoard = () => {
    const [stages, setStages] = useState<Readonly<Record<string, ReadonlyArray<string>>>>({ new: stageOf("new"), qualified: stageOf("qualified"), proposal: [] })
    const [opened, setOpened] = useState("nothing opened")
    const titles: Readonly<Record<string, string>> = { new: "New", qualified: "Qualified", proposal: "Proposal" }
    const board: ReadonlyArray<G.BoardColumn> = Object.keys(titles).map((id) => ({
        id,
        title: titles[id] ?? id,
        count: (stages[id] ?? []).length,
        items: (stages[id] ?? []).map((item) => ({ id: item, title: names[item] ?? item, description: "Next: send a quote", onPress: () => setOpened(names[item] ?? item) })),
        empty: <G.EmptyNotice message="Nothing here" description="Drag a card here." />,
    }))
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--grammar-row-gap, 0.75rem)" }}>
            <G.Board
                label="Sales pipeline"
                columns={board}
                onMove={({ itemId, fromColumnId, toColumnId }) => setStages((current) => ({ ...current, [fromColumnId]: (current[fromColumnId] ?? []).filter((id) => id !== itemId), [toColumnId]: [...(current[toColumnId] ?? []), itemId] }))}
                moveLabels={{ instructions: "Alt and the left or right arrow move this card to the previous or next stage.", announce: (item, column) => `Moved ${item} to ${column}` }}
            />
            <G.Text tone="muted" data-story-opened>{`Opened: ${opened}`}</G.Text>
        </div>
    )
}

export const BoardMoveAndPress: Story = {
    render: () => <Matrix><State label="Drag a card to a column, or Alt + arrow on a focused card; press a card to open it" direction="column"><MovableBoard /></State></Matrix>,
}

const PlaceableSchedule = () => {
    const [placed, setPlaced] = useState<Readonly<Record<string, { readonly row: string; readonly column: string }>>>({ lan: { row: "9", column: "mon" }, hung: { row: "11", column: "tue" } })
    const [picked, setPicked] = useState<string | null>(null)
    const place = (id: string, row: string, column: string) => { setPlaced((current) => ({ ...current, [id]: { row, column } })); setPicked(null) }
    const people: ReadonlyArray<G.ScheduleItem> = [
        { id: "lan", title: "Lan", meta: "Morning", tone: "accent", isDraggable: true, isSelected: picked === "lan", onPress: () => setPicked(picked === "lan" ? null : "lan"), ...placed.lan! },
        { id: "hung", title: "Hung", meta: "Afternoon", tone: "success", isDraggable: true, isSelected: picked === "hung", onPress: () => setPicked(picked === "hung" ? null : "hung"), ...placed.hung! },
        { id: "open", title: "Open shift", meta: "Needs one more", isDashed: true, row: "14", column: "thu" },
        { id: "clash", title: "Mai", meta: "Morning", tone: "warning", isInvalid: true, why: "Already on leave", row: "9", column: "wed" },
    ]
    return (
        <G.ScheduleGrid
            label="Shifts, 2 to 5 November"
            columns={days}
            rows={hours}
            items={people}
            empty={emptyLine}
            onDrop={place}
            {...(picked === null ? {} : { onCellPress: (row: string, column: string) => place(picked, row, column) })}
            cellPressLabel={(row, column) => `${column.label} ${column.description ?? ""}, ${row.label}`}
        />
    )
}

export const ScheduleDropAndCellPress: Story = {
    render: () => <Matrix><State label="Drag an entry to a cell, or press it (picked) then press a cell; an invalid and an open entry" direction="column"><PlaceableSchedule /></State></Matrix>,
}

const metaRows: ReadonlyArray<G.ListRowData> = [
    { id: "m1", title: "Follow up with Hoa Sen Spa", description: "Chi Lan", meta: { text: "Overdue 1 day", tone: "danger" }, badges: [{ label: "Open", tone: "warning" }], onPress: noop },
    { id: "m2", title: "Send the quote", description: "Anh Tuan", meta: { text: "Due today" }, badges: [{ label: "Open", tone: "warning" }], onPress: noop },
    { id: "m3", title: "Customer replied", description: "Chi Hanh", meta: { text: "8 min" }, onPress: noop },
]

export const RowEndMeta: Story = {
    render: () => (
        <Matrix maxWidth={560}>
            <State label="Ready (the whole row presses; a short fact at the end, danger when overdue)" direction="column"><G.SurfaceCard kind="list" label="Open work" items={metaRows} empty={emptyLine} /></State>
            <State label="Loading (same rows as geometry)" direction="column"><G.SurfaceCard kind="list" label="Open work" items={metaRows} empty={emptyLine} isLoading /></State>
        </Matrix>
    ),
}

const personTile = (isLoading?: boolean) => (
    <G.SurfaceCard
        kind="tile"
        name="Chatbot"
        mark={{ avatar: { name: "Chatbot" } }}
        badges={[{ label: "Running", tone: "success" }]}
        description="Customer care on Zalo OA and Telegram."
        action={{ label: "Open", press: noop }}
        menu={{ label: "More actions", entries: [{ kind: "section", id: "s", items: [{ id: "x", label: "Duplicate" }] }] }}
        {...(isLoading === undefined ? {} : { isLoading })}
    />
)

export const TileWithMarkBesideName: Story = {
    render: () => (
        <Matrix maxWidth={360}>
            <State label="Ready: the mark beside the name, status chips under it, the description, the action at the foot start" direction="column"><div data-grammar-twin="Tile"><div data-grammar-twin-item="ready">{personTile()}</div><div data-grammar-twin-item="loading">{personTile(true)}</div></div></State>
        </Matrix>
    ),
}
