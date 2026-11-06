import type { Meta, StoryObj } from "@storybook/react-vite"
import * as G from "../common/index.js"
import { BellGlyph, Matrix, State, noop } from "./fixtures.js"

/*
 * The four states of a region (contexts/ui/loading.md): loading (a first read with no data: the ready structure as geometry),
 * content, error (a failed read has its own place and never reads as empty) and empty (the read finished with nothing). One story per
 * component draws them together, in both families, light and dark, at both widths (the render proof). A component with no
 * empty answer of its own (a figures strip, a tile, a body) shows three.
 *
 * Loading is drawn from the rows the component was given (the block's same-shape placeholder), so each loading list below
 * is given rows that have the leading mark, supporting line and command its ready rows have.
 */

const meta: Meta = { title: "States/Loading states" }
export default meta
type Story = StoryObj

const failure: G.ErrorData = { message: "Could not load this. Check the connection.", actionLabel: "Try again", onAction: noop }

const rowOf = (id: string, title: string, description: string): G.ListRowData => ({
    id,
    title,
    description,
    leading: { avatar: { name: title } },
    badges: [{ label: "Active", tone: "success" }],
    action: { label: "Open", press: noop },
})
const rows: ReadonlyArray<G.ListRowData> = [
    rowOf("a", "Alex Morgan", "Owner, joined in March"),
    rowOf("b", "Sam Rivera", "Editor, joined in May"),
    rowOf("c", "Jo Kim", "Viewer, joined in June"),
]
const placeholderRows: ReadonlyArray<G.ListRowData> = rows.map((row) => ({ ...row, title: " ", description: " " }))
const emptyLine = <G.EmptyNotice message="Nobody here yet." />

/* ------------------------------------------------------------------ Section */

export const SectionStates: Story = {
    render: () => (
        <Matrix>
            <State label="Loading" direction="column">
                <G.Section kind="list" title="Members" count={3} description="Everyone on the team." meta="Updated now" action={<G.Button size="sm" onPress={noop}>Invite</G.Button>} items={placeholderRows} empty={emptyLine} isLoading />
            </State>
            <State label="Content" direction="column">
                <G.Section kind="list" title="Members" count={3} description="Everyone on the team." meta="Updated now" action={<G.Button size="sm" onPress={noop}>Invite</G.Button>} items={rows} empty={emptyLine} />
            </State>
            <State label="Error" direction="column">
                <G.Section kind="list" title="Members" count={3} description="Everyone on the team." action={<G.Button size="sm" onPress={noop}>Invite</G.Button>} items={[]} empty={emptyLine} error={failure} />
            </State>
            <State label="Empty" direction="column">
                <G.Section kind="list" title="Members" count={0} description="Everyone on the team." action={<G.Button size="sm" onPress={noop}>Invite</G.Button>} items={[]} empty={emptyLine} />
            </State>
            <State label="Region: loading, then error" direction="column">
                <G.Section title="Billing" description="Plan and invoices." isLoading><G.Text>Everything about billing.</G.Text></G.Section>
                <G.Section title="Billing" description="Plan and invoices." error={failure}><G.Text>Everything about billing.</G.Text></G.Section>
            </State>
        </Matrix>
    ),
}

/* ------------------------------------------------------------------ SurfaceCard, every kind */

const listCard = (items: ReadonlyArray<G.ListRowData>, status: { readonly isLoading?: boolean; readonly error?: G.ErrorData } = {}) => (
    <G.SurfaceCard kind="list" label="Members" items={items} empty={emptyLine} {...status} />
)

export const SurfaceCardListStates: Story = {
    render: () => (
        <Matrix maxWidth={560}>
            <State label="Loading" direction="column">{listCard(placeholderRows, { isLoading: true })}</State>
            <State label="Content" direction="column">{listCard(rows)}</State>
            <State label="Error" direction="column">{listCard([], { error: failure })}</State>
            <State label="Empty" direction="column">{listCard([])}</State>
        </Matrix>
    ),
}

const figures: ReadonlyArray<G.Figure> = [
    { id: "a", term: "Revenue", value: "1,200", meta: "Today" },
    { id: "b", term: "Users", value: "40", meta: "Today" },
    { id: "c", term: "Refunds", value: "2", meta: "Today" },
]

export const SurfaceCardFiguresStates: Story = {
    render: () => (
        <Matrix maxWidth={720}>
            <State label="Loading" direction="column"><G.SurfaceCard kind="figures" label="Today" items={figures} isLoading /></State>
            <State label="Content" direction="column"><G.SurfaceCard kind="figures" label="Today" items={figures} /></State>
            <State label="Error" direction="column"><G.SurfaceCard kind="figures" label="Today" items={figures} error={failure} /></State>
        </Matrix>
    ),
}

const disclosures: ReadonlyArray<G.AccordionRowData> = [
    { id: "a", title: "How billing works", meta: "2 min", body: "You are billed monthly.", isOpen: false },
    { id: "b", title: "Cancelling", meta: "1 min", body: "Cancel any time.", isOpen: false },
]

export const SurfaceCardAccordionStates: Story = {
    render: () => (
        <Matrix maxWidth={560}>
            <State label="Loading" direction="column"><G.SurfaceCard kind="accordion" label="Help" items={disclosures} onItemOpenChange={noop} isLoading /></State>
            <State label="Content" direction="column"><G.SurfaceCard kind="accordion" label="Help" items={disclosures} onItemOpenChange={noop} /></State>
            <State label="Error" direction="column"><G.SurfaceCard kind="accordion" label="Help" items={disclosures} onItemOpenChange={noop} error={failure} /></State>
        </Matrix>
    ),
}

export const SurfaceCardZonesStates: Story = {
    render: () => {
        const bands = (list: ReadonlyArray<G.ListRowData>): G.SurfaceCardProps => ({
            kind: "list",
            label: "Team",
            headers: [{ kind: "figures", items: figures }],
            items: list,
            empty: emptyLine,
        })
        return (
            <Matrix maxWidth={720}>
                <State label="Loading" direction="column"><G.SurfaceCard {...bands(placeholderRows)} isLoading /></State>
                <State label="Content" direction="column"><G.SurfaceCard {...bands(rows)} /></State>
                <State label="Error" direction="column"><G.SurfaceCard {...bands([])} error={failure} /></State>
            </Matrix>
        )
    },
}

export const SurfaceCardTileStates: Story = {
    render: () => {
        const tile = { kind: "tile", name: "Google Drive", mark: { icon: BellGlyph }, description: "Reads the files you share.", badge: { label: "Connected", tone: "success" }, action: { label: "Open", press: noop } } as const
        return (
            <Matrix maxWidth={360}>
                <State label="Loading" direction="column"><G.SurfaceCard {...tile} isLoading /></State>
                <State label="Content" direction="column"><G.SurfaceCard {...tile} /></State>
                <State label="Error" direction="column"><G.SurfaceCard {...tile} error={failure} /></State>
            </Matrix>
        )
    },
}

export const SurfaceCardBodyStates: Story = {
    render: () => (
        <Matrix maxWidth={560}>
            <State label="Loading" direction="column">
                <G.SurfaceCard label="Notes" isLoading><G.ListBox label="Notes" items={[{ id: "n", label: " ", description: " " }]} /></G.SurfaceCard>
            </State>
            <State label="Content" direction="column">
                <G.SurfaceCard label="Notes"><G.ListBox label="Notes" items={[{ id: "n", label: "Kickoff", description: "Agenda and owners" }]} /></G.SurfaceCard>
            </State>
            <State label="Error" direction="column">
                <G.SurfaceCard label="Notes" error={failure}><G.Text>Notes</G.Text></G.SurfaceCard>
            </State>
        </Matrix>
    ),
}

/* ------------------------------------------------------------------ ListBox, Timeline, DataTable */

const conversations: ReadonlyArray<G.ListBoxItem> = [
    { id: "a", label: "Alex Morgan", description: "Can we move the call to Friday?", leading: <G.Avatar name="Alex Morgan" size="sm" isDecorative />, trailing: <G.Text size="xs" tone="muted">09:12</G.Text> },
    { id: "b", label: "Sam Rivera", description: "Sent the invoice", leading: <G.Avatar name="Sam Rivera" size="sm" isDecorative />, trailing: <G.Text size="xs" tone="muted">Mon</G.Text> },
]
const placeholderConversations: ReadonlyArray<G.ListBoxItem> = conversations.map((item) => ({ ...item, label: " ", description: " " }))

export const ListBoxStates: Story = {
    render: () => (
        <Matrix maxWidth={420}>
            <State label="Loading" direction="column"><G.ListBox label="Conversations" items={placeholderConversations} isLoading emptyContent={<G.Text>No conversations.</G.Text>} /></State>
            <State label="Content" direction="column"><G.ListBox label="Conversations" items={conversations} emptyContent={<G.Text>No conversations.</G.Text>} /></State>
            <State label="Error" direction="column"><G.ListBox label="Conversations" items={[]} error={failure} emptyContent={<G.Text>No conversations.</G.Text>} /></State>
            <State label="Empty" direction="column"><G.ListBox label="Conversations" items={[]} emptyContent={<G.Text>No conversations.</G.Text>} /></State>
        </Matrix>
    ),
}

const history: ReadonlyArray<G.TimelineItem> = [
    { id: "a", title: "Order placed", timeLabel: "09:12", description: "Paid by card" },
    { id: "b", title: "Packed", timeLabel: "11:40", description: "Warehouse 2" },
]
const placeholderHistory: ReadonlyArray<G.TimelineItem> = history.map((item) => ({ ...item, title: " ", timeLabel: " ", description: " " }))

export const TimelineStates: Story = {
    render: () => (
        <Matrix maxWidth={520}>
            <State label="Loading" direction="column"><G.Timeline label="Order history" items={placeholderHistory} isLoading /></State>
            <State label="Content" direction="column"><G.Timeline label="Order history" items={history} /></State>
            <State label="Error" direction="column"><G.Timeline label="Order history" items={[]} error={failure} /></State>
            <State label="Empty" direction="column"><G.Timeline label="Order history" items={[]} /></State>
        </Matrix>
    ),
}

type Lesson = { readonly id: string; readonly title: string; readonly level: string; readonly minutes: number }
const lessons: ReadonlyArray<Lesson> = [
    { id: "l1", title: "Articles", level: "A1", minutes: 12 },
    { id: "l2", title: "Present simple", level: "A1", minutes: 18 },
]
const noLessons: ReadonlyArray<Lesson> = []
const columns: ReadonlyArray<G.DataTableColumn> = [
    { id: "title", label: "Lesson", isRowHeader: true },
    { id: "level", label: "Level" },
    { id: "minutes", label: "Minutes", align: "end" },
]
const cell = (row: Lesson, columnId: string) => (columnId === "title" ? row.title : columnId === "level" ? row.level : row.minutes)

export const DataTableStates: Story = {
    render: () => (
        <Matrix maxWidth={640}>
            <State label="Loading" direction="column"><G.DataTable label="Lessons" columns={columns} rows={lessons} renderCell={cell} isLoading emptyContent={emptyLine} /></State>
            <State label="Content" direction="column"><G.DataTable label="Lessons" columns={columns} rows={lessons} renderCell={cell} emptyContent={emptyLine} /></State>
            <State label="Error" direction="column"><G.DataTable label="Lessons" columns={columns} rows={noLessons} renderCell={cell} error={failure} emptyContent={emptyLine} /></State>
            <State label="Empty" direction="column"><G.DataTable label="Lessons" columns={columns} rows={noLessons} renderCell={cell} emptyContent={emptyLine} /></State>
        </Matrix>
    ),
}

/* ------------------------------------------------------------------ MessageBubble, PaneSection */

export const MessageBubbleStates: Story = {
    render: () => (
        <Matrix maxWidth={520}>
            <State label="Loading (a thread)" direction="column"><G.MessageBubble isLoading hasAvatar /></State>
            <State label="Content" direction="column">
                <G.MessageBubble body="Can we move the call to Friday?" author="Alex Morgan" meta="09:12" avatar={<G.Avatar name="Alex Morgan" size="sm" isDecorative />} />
                <G.MessageBubble side="outgoing" body="Friday works." meta="09:14" />
            </State>
            <State label="Error" direction="column"><G.MessageBubble error={failure} /></State>
        </Matrix>
    ),
}

export const PaneSectionStates: Story = {
    render: () => (
        <div style={{ blockSize: "30rem" }}>
            <G.PaneGrid label="Three bands" areas={["a b c"]} rows={["fill"]}>
                <G.Pane area="a" surface>
                    <G.PaneSection isLoading>
                        <G.Section kind="list" title="Members" count={3} items={placeholderRows} empty={emptyLine} />
                    </G.PaneSection>
                </G.Pane>
                <G.Pane area="b">
                    <G.PaneSection>
                        <G.Section kind="list" title="Members" count={3} items={rows} empty={emptyLine} />
                    </G.PaneSection>
                </G.Pane>
                <G.Pane area="c" surface>
                    <G.PaneSection error={failure}>
                        <G.Section kind="list" title="Members" count={3} items={rows} empty={emptyLine} />
                    </G.PaneSection>
                </G.Pane>
            </G.PaneGrid>
        </div>
    ),
}
