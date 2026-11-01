import type { Meta, StoryObj } from "@storybook/react-vite"
import type { ReactNode } from "react"
import { expect, waitFor } from "storybook/test"
import * as G from "../common/index.js"
import { BellGlyph, SearchGlyph, SettingsGlyph, StarGlyph, UserGlyph, noop } from "./fixtures.js"

/*
 * Skeleton parity: while a slot loads, every leaf draws the Grammar skeleton in its own box, so the loading tree keeps the
 * ready tree's layout. Each group below lists pairs of one component at the same size and props, once with content and
 * once as its skeleton. Three stories per group:
 *
 * - `<Group>` renders the pairs side by side and its play function asserts, per pair, that the skeleton's border box
 *   (width, height) and margins equal the content state's within 1px.
 * - `<Group>Ready` / `<Group>Loading` render one phase each, in the same cells, for the `skeleton-parity` DNA gate:
 *   `parameters.dna = { pair, phase }` names the pair of stories, and every cell carries `data-dna-pair` with the
 *   component pair id.
 */

const meta: Meta = { title: "Leaves/Skeleton parity" }
export default meta
type Story = StoryObj

type Pair = {
    readonly id: string
    readonly ready: ReactNode
    readonly loading: ReactNode
    /** Column width the pair is laid out in; both phases get the same column. */
    readonly width?: string
}

type Phase = "ready" | "loading"

const Cell = ({ pair, phase }: { readonly pair: Pair; readonly phase: Phase }) => (
    <div data-dna-pair={pair.id} data-dna-phase={phase} style={{ minWidth: 0 }}>
        {phase === "ready" ? pair.ready : pair.loading}
    </div>
)

/** One row per pair: its id, then the phases in columns of the pair's width. */
const PairRows = ({ pairs, phases }: { readonly pairs: ReadonlyArray<Pair>; readonly phases: ReadonlyArray<Phase> }) => (
    <div data-story-parity="true" style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        {pairs.map((pair) => (
            <div key={pair.id} style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                <span style={{ fontSize: "0.75rem", fontWeight: 600, letterSpacing: "0.02em" }}>{pair.id}</span>
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${phases.length}, ${pair.width ?? "22rem"})`, gap: "2rem", alignItems: "start" }}>
                    {phases.map((phase) => <Cell key={phase} pair={pair} phase={phase} />)}
                </div>
            </div>
        ))}
    </div>
)

/** The element a cell measures: its first rendered child (a hidden description span or portal anchor is skipped). */
const measuredChild = (cell: Element): Element | undefined => {
    const child = [...cell.children].find((element) =>
        !(element instanceof HTMLElement && element.hidden) && getComputedStyle(element).display !== "none")
    // A layout-neutral scope (a loading field's `display: contents` wrapper) has no box: measure what it lays out.
    return child !== undefined && getComputedStyle(child).display === "contents" ? measuredChild(child) : child
}

const boxOf = (element: Element) => {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return {
        width: rect.width,
        height: rect.height,
        marginTop: Number.parseFloat(style.marginTop),
        marginRight: Number.parseFloat(style.marginRight),
        marginBottom: Number.parseFloat(style.marginBottom),
        marginLeft: Number.parseFloat(style.marginLeft),
    }
}

/** Every pair whose loading box differs from its ready box by more than 1px on any side. */
const parityMismatches =(canvas: Element): ReadonlyArray<string> => {
    const mismatches: string[] = []
    const ids = new Set([...canvas.querySelectorAll("[data-dna-pair]")].map((cell) => cell.getAttribute("data-dna-pair") ?? ""))
    for (const id of ids) {
        const ready = canvas.querySelector(`[data-dna-pair="${id}"][data-dna-phase="ready"]`)
        const loading = canvas.querySelector(`[data-dna-pair="${id}"][data-dna-phase="loading"]`)
        const readyChild = ready === null ? undefined : measuredChild(ready)
        const loadingChild = loading === null ? undefined : measuredChild(loading)
        if (readyChild === undefined || loadingChild === undefined) {
            mismatches.push(`${id}: a phase rendered nothing`)
            continue
        }
        const a = boxOf(readyChild)
        const b = boxOf(loadingChild)
        const off = (Object.keys(a) as Array<keyof typeof a>).filter((key) => Math.abs(a[key] - b[key]) > 1)
        if (off.length > 0) {
            mismatches.push(`${id}: ${off.map((key) => `${key} ready ${a[key].toFixed(1)} loading ${b[key].toFixed(1)}`).join(", ")}`)
        }
    }
    return mismatches
}

const assertParity: Story["play"] = async ({ canvasElement }) => {
    await waitFor(() => {
        const mismatches = parityMismatches(canvasElement)
        expect(mismatches, `skeleton parity: ${mismatches.join("; ")}`).toEqual([])
    }, { timeout: 4000 })
}

const sideBySide = (pairs: () => ReadonlyArray<Pair>): Story => ({
    render: () => <PairRows pairs={pairs()} phases={["ready", "loading"]} />,
    play: assertParity,
})

const onePhase = (group: string, phase: Phase, pairs: () => ReadonlyArray<Pair>): Story => ({
    parameters: { dna: { pair: group, phase } },
    render: () => <PairRows pairs={pairs()} phases={[phase]} />,
})

/* ------------------------------------------------------------------ typography */

const typography = (): ReadonlyArray<Pair> => [
    ...(["xs", "sm", "md"] as const).map((size) => ({
        id: `text-${size}`,
        ready: <G.Text size={size}>Quarterly revenue</G.Text>,
        loading: <G.Text size={size} isLoading>Quarterly revenue</G.Text>,
    })),
    {
        id: "text-inline-span",
        ready: <p style={{ margin: 0 }}><G.Text as="span" size="sm">Due today</G.Text></p>,
        loading: <p style={{ margin: 0 }}><G.Text as="span" size="sm" isLoading>Due today</G.Text></p>,
    },
    {
        id: "text-start-content",
        ready: <G.Text size="sm" startContent={<StarGlyph />}>Starred</G.Text>,
        loading: <G.Text size="sm" startContent={<StarGlyph />} isLoading>Starred</G.Text>,
    },
    {
        id: "text-truncate",
        ready: <G.Text overflow="truncate">A long line of copy that runs past the column and is cut with an ellipsis</G.Text>,
        loading: <G.Text overflow="truncate" isLoading>A long line of copy that runs past the column and is cut with an ellipsis</G.Text>,
        width: "14rem",
    },
    {
        id: "text-wrap-two-lines",
        ready: <G.Text overflow="wrap">Copy long enough to wrap onto a second line inside this column</G.Text>,
        loading: <G.Text overflow="wrap" isLoading>Copy long enough to wrap onto a second line inside this column</G.Text>,
        width: "14rem",
    },
    ...([1, 2, 3, 4] as const).map((level) => ({
        id: `heading-${level}`,
        ready: <G.Heading level={level}>Billing settings</G.Heading>,
        loading: <G.Heading level={level} isLoading>Billing settings</G.Heading>,
    })),
    {
        id: "heading-display",
        ready: <G.Heading level={1} scale="display">Welcome back</G.Heading>,
        loading: <G.Heading level={1} scale="display" isLoading>Welcome back</G.Heading>,
    },
    ...(["inline", "muted", "route", "plain"] as const).map((appearance) => ({
        id: `text-action-${appearance}`,
        ready: <G.TextAction appearance={appearance} onPress={noop}>View details</G.TextAction>,
        loading: <G.TextAction appearance={appearance} onPress={noop} isLoading>View details</G.TextAction>,
    })),
    {
        id: "text-action-control",
        ready: <G.TextAction appearance="inline" size="control" onPress={noop}>Open report</G.TextAction>,
        loading: <G.TextAction appearance="inline" size="control" onPress={noop} isLoading>Open report</G.TextAction>,
    },
]

/** Text, Heading and TextAction: the skeleton takes the line box of its size and the width of its copy. */
export const Typography: Story = sideBySide(typography)
export const TypographyReady: Story = onePhase("grammar-typography", "ready", typography)
export const TypographyLoading: Story = onePhase("grammar-typography", "loading", typography)

/* ------------------------------------------------------------------ actions */

const actions = (): ReadonlyArray<Pair> => [
    ...(["sm", "md", "lg"] as const).map((size) => ({
        id: `button-${size}`,
        ready: <G.Button size={size} onPress={noop}>Save changes</G.Button>,
        loading: <G.Button size={size} onPress={noop} isLoading>Save changes</G.Button>,
    })),
    {
        id: "button-start-end-content",
        ready: <G.Button intent="commit" startContent={<SearchGlyph />} endContent={<StarGlyph />} onPress={noop}>Search</G.Button>,
        loading: <G.Button intent="commit" startContent={<SearchGlyph />} endContent={<StarGlyph />} onPress={noop} isLoading>Search</G.Button>,
    },
    {
        id: "button-fill",
        ready: <G.Button width="fill" onPress={noop}>Continue</G.Button>,
        loading: <G.Button width="fill" onPress={noop} isLoading>Continue</G.Button>,
    },
    {
        id: "button-href",
        ready: <G.Button href="#docs">Read the docs</G.Button>,
        loading: <G.Button href="#docs" isLoading>Read the docs</G.Button>,
    },
    ...(["sm", "md", "lg"] as const).map((size) => ({
        id: `icon-button-${size}`,
        ready: <G.IconButton source={BellGlyph} label="Notifications" size={size} onPress={noop} />,
        loading: <G.IconButton source={BellGlyph} label="Notifications" size={size} onPress={noop} isLoading />,
    })),
]

/** Button and IconButton: the skeleton keeps the control height and the label (and glyph) width. */
export const Actions: Story = sideBySide(actions)
export const ActionsReady: Story = onePhase("grammar-actions", "ready", actions)
export const ActionsLoading: Story = onePhase("grammar-actions", "loading", actions)

/* ------------------------------------------------------------------ status */

const status = (): ReadonlyArray<Pair> => [
    ...(["neutral", "success", "muted"] as const).map((tone) => ({
        id: `badge-${tone}`,
        ready: <G.Badge tone={tone}>Active</G.Badge>,
        loading: <G.Badge tone={tone} isLoading>Active</G.Badge>,
    })),
    {
        id: "badge-start-content",
        ready: <G.Badge tone="accent" startContent={<StarGlyph />}>Featured</G.Badge>,
        loading: <G.Badge tone="accent" startContent={<StarGlyph />} isLoading>Featured</G.Badge>,
    },
    {
        id: "badge-dot",
        ready: <G.Badge tone="success" isDot>Online</G.Badge>,
        loading: <G.Badge tone="success" isDot isLoading>Online</G.Badge>,
    },
    {
        id: "status-dot-only",
        ready: <G.StatusDot tone="success" aria-label="Online" />,
        loading: <G.StatusDot tone="success" aria-label="Online" isLoading />,
    },
    ...(["md", "sm"] as const).map((size) => ({
        id: `meter-${size}`,
        ready: <G.Meter label="Storage" value={32} size={size} />,
        loading: <G.Meter label="Storage" value={32} size={size} isLoading />,
    })),
    {
        id: "progress",
        ready: <G.Progress label="Upload" value={40} />,
        loading: <G.Progress label="Upload" value={40} isLoading />,
    },
]

/** Badge, StatusDot, Meter and Progress. */
export const Status: Story = sideBySide(status)
export const StatusReady: Story = onePhase("grammar-status", "ready", status)
export const StatusLoading: Story = onePhase("grammar-status", "loading", status)

/* ------------------------------------------------------------------ identity */

const identity = (): ReadonlyArray<Pair> => [
    ...(["sm", "md", "lg"] as const).map((size) => ({
        id: `avatar-${size}`,
        ready: <G.Avatar name="Alex Morgan" size={size} />,
        loading: <G.Avatar name="Alex Morgan" size={size} isLoading />,
    })),
    ...(["chip", "leading", "heading"] as const).map((usage) => ({
        id: `icon-${usage}`,
        ready: <G.Icon source={SettingsGlyph} usage={usage} />,
        loading: <G.Icon source={SettingsGlyph} usage={usage} isLoading />,
    })),
    ...(["sm", "md"] as const).map((size) => ({
        id: `icon-tile-${size}`,
        ready: <G.IconTile source={UserGlyph} size={size} />,
        loading: <G.IconTile source={UserGlyph} size={size} isLoading />,
    })),
]

/** Avatar, Icon and IconTile. */
export const Identity: Story = sideBySide(identity)
export const IdentityReady: Story = onePhase("grammar-identity", "ready", identity)
export const IdentityLoading: Story = onePhase("grammar-identity", "loading", identity)

/* ------------------------------------------------------------------ rows */

/** A list card holding one row; `isLoading` draws the same row as geometry. */
const rowCard = (row: G.ListRowData, isLoading: boolean) => (
    <G.SurfaceCard kind="list" label="Rows" items={[row]} empty={<G.EmptyNotice message="No rows." />} isLoading={isLoading} />
)

/** A Page header with every slot; the tabs variant puts the page tabs on its separator. */
const pageHeader = (withTabs: boolean, isLoading: boolean) => (
    <G.Page
        isLoading={isLoading}
        header={{
            breadcrumbs: { label: "Breadcrumb", items: [{ id: "connections", label: "Connections", href: "#connections" }, { id: "main", label: "Main account" }] },
            title: "Main account",
            mark: <G.Avatar name="Sepay" shape="rounded" isDecorative />,
            status: <><G.Badge isDot tone="success">Connected</G.Badge><G.Badge tone="warning">Test mode</G.Badge></>,
            meta: "Bank transfer · ****6789",
            actions: <G.Button intent="neutral" onPress={noop}>Disconnect</G.Button>,
            ...(withTabs ? { tabs: { label: "Connection", selectedKey: "test", items: [{ id: "overview", label: "Overview" }, { id: "test", label: "Test" }] } } : {}),
        }}
    >
        <G.Text>Body</G.Text>
    </G.Page>
)

const rows = (): ReadonlyArray<Pair> => [
    {
        id: "list-row-title",
        ready: rowCard({ id: "r", title: "Invoices" }, false),
        loading: rowCard({ id: "r", title: "Invoices" }, true),
        width: "28rem",
    },
    {
        id: "list-row-full",
        ready: rowCard({ id: "r", title: "Invoices", description: "12 open, 3 overdue", leading: { icon: BellGlyph }, action: { label: "Open", press: noop } }, false),
        loading: rowCard({ id: "r", title: "Invoices", description: "12 open, 3 overdue", leading: { icon: BellGlyph }, action: { label: "Open", press: noop } }, true),
        width: "28rem",
    },
    {
        id: "list-row-avatar",
        ready: rowCard({ id: "r", title: "Alex Morgan", description: "Owner", leading: { avatar: { name: "Alex Morgan" } } }, false),
        loading: rowCard({ id: "r", title: "Alex Morgan", description: "Owner", leading: { avatar: { name: "Alex Morgan" } } }, true),
        width: "28rem",
    },
    {
        id: "section",
        ready: <G.Section title="Grammar basics" description="Twelve short lessons." meta="Updated now" action={<G.Button size="sm" onPress={noop}>Share</G.Button>}><G.Text>Everything the course covers.</G.Text></G.Section>,
        loading: <G.Section title="Grammar basics" description="Twelve short lessons." meta="Updated now" action={<G.Button size="sm" onPress={noop}>Share</G.Button>} isLoading><G.Text isLoading>Everything the course covers.</G.Text></G.Section>,
        width: "32rem",
    },
    {
        id: "page-header",
        ready: pageHeader(false, false),
        loading: pageHeader(false, true),
        width: "48rem",
    },
    {
        id: "page-header-tabs",
        ready: pageHeader(true, false),
        loading: pageHeader(true, true),
        width: "48rem",
    },
    {
        id: "description-list",
        ready: <G.DescriptionList items={[{ id: "plan", term: "Plan", description: "Team" }, { id: "seats", term: "Seats", description: "8 of 10" }]} />,
        loading: <G.DescriptionList isLoading items={[{ id: "plan", term: "Plan", description: "Team" }, { id: "seats", term: "Seats", description: "8 of 10" }]} />,
        width: "28rem",
    },
    {
        id: "figures-card",
        ready: <G.SurfaceCard kind="figures" label="Today" items={[{ id: "a", term: "Revenue", value: "1,200", meta: "Today" }, { id: "b", term: "Users", value: "40", meta: "Today" }]} />,
        loading: <G.SurfaceCard kind="figures" label="Today" isLoading items={[{ id: "a", term: "Revenue", value: "1,200", meta: "Today" }, { id: "b", term: "Users", value: "40", meta: "Today" }]} />,
        width: "28rem",
    },
    {
        id: "tile-card",
        ready: <G.SurfaceCard kind="tile" name="Google Drive" mark={{ icon: BellGlyph }} description="Reads the files you share." badge={{ label: "Connected", tone: "success" }} action={{ label: "Open", press: noop }} />,
        loading: <G.SurfaceCard kind="tile" isLoading name="Google Drive" mark={{ icon: BellGlyph }} description="Reads the files you share." badge={{ label: "Connected", tone: "success" }} action={{ label: "Open", press: noop }} />,
        width: "20rem",
    },
    {
        id: "message-bubble",
        ready: <G.MessageBubble side="incoming" body={"Two short lines of a message that wraps once in the bubble."} />,
        loading: <G.MessageBubble side="incoming" isLoading />,
        width: "28rem",
    },
]

/** List rows, Section, the Page header, DescriptionList, figures and tile cards, and MessageBubble. */
export const Rows: Story = sideBySide(rows)
export const RowsReady: Story = onePhase("grammar-rows", "ready", rows)
export const RowsLoading: Story = onePhase("grammar-rows", "loading", rows)

/* ------------------------------------------------------------------ collections */

type Lesson = { readonly id: string; readonly title: string; readonly level: string; readonly minutes: number }
const lessons: ReadonlyArray<Lesson> = [
    { id: "l1", title: "Articles", level: "A1", minutes: 12 },
    { id: "l2", title: "Present simple", level: "A1", minutes: 18 },
    { id: "l3", title: "Past continuous", level: "A2", minutes: 22 },
]
const lessonColumns: ReadonlyArray<G.DataTableColumn> = [
    { id: "title", label: "Lesson", isRowHeader: true },
    { id: "level", label: "Level" },
    { id: "minutes", label: "Minutes", align: "end" },
]
const lessonCell = (row: Lesson, columnId: string) => (columnId === "title" ? row.title : columnId === "level" ? row.level : row.minutes)
const folders: ReadonlyArray<G.ListBoxItem> = [
    { id: "inbox", label: "Inbox", description: "12 unread" },
    { id: "drafts", label: "Drafts", description: "3 drafts" },
    { id: "sent", label: "Sent", description: "Synced now" },
]

const collections = (): ReadonlyArray<Pair> => [
    {
        id: "data-table",
        ready: <G.DataTable label="Lessons" columns={lessonColumns} rows={lessons} renderCell={lessonCell} emptyContent="No lessons." />,
        loading: <G.DataTable label="Lessons" columns={lessonColumns} rows={[] as ReadonlyArray<Lesson>} renderCell={lessonCell} isLoading emptyContent="No lessons." />,
        width: "32rem",
    },
    {
        id: "list-box",
        ready: <G.ListBox label="Folders" items={folders} />,
        loading: <G.ListBox label="Folders" items={[]} isLoading />,
        width: "20rem",
    },
    {
        id: "list-card",
        ready: (
            <G.SurfaceCard
                kind="list"
                label="Saved lessons"
                empty={<G.EmptyNotice message="Nothing saved yet." />}
                items={lessons.map((lesson) => ({ id: lesson.id, title: lesson.title, description: `${lesson.minutes} minutes`, action: { label: "Open", press: noop } }))}
            />
        ),
        loading: <G.SurfaceCard kind="list" label="Saved lessons" isLoading items={[]} empty={<G.EmptyNotice message="Nothing saved yet." />} />,
        width: "28rem",
    },
    {
        id: "timeline",
        ready: <G.Timeline label="Order history" items={[{ id: "a", title: "Order placed", timeLabel: "09:12", description: "Paid by card" }, { id: "b", title: "Packed", timeLabel: "11:40", description: "Warehouse 2" }, { id: "c", title: "Shipped", timeLabel: "15:05", description: "Tracking sent" }]} />,
        loading: <G.Timeline label="Order history" items={[]} isLoading />,
        width: "28rem",
    },
]

/** DataTable, ListBox, the list card and Timeline: the loading rows keep the ready rows' rhythm. */
export const Collections: Story = sideBySide(collections)
export const CollectionsReady: Story = onePhase("grammar-collections", "ready", collections)
export const CollectionsLoading: Story = onePhase("grammar-collections", "loading", collections)

/* ------------------------------------------------------------------ forms */

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

const forms = (): ReadonlyArray<Pair> => [
    {
        id: "input",
        ready: <G.Input id="parity-input" name="name" label="Name" />,
        loading: <G.Input id="parity-input-loading" name="name" label="Name" isLoading />,
    },
    {
        id: "input-description",
        ready: <G.Input id="parity-input-d" name="email" label="Email" description="We never share it." />,
        loading: <G.Input id="parity-input-d-loading" name="email" label="Email" description="We never share it." isLoading />,
    },
    {
        id: "input-label-hidden",
        ready: <G.Input id="parity-input-h" name="q" label="Query" isLabelHidden />,
        loading: <G.Input id="parity-input-h-loading" name="q" label="Query" isLabelHidden isLoading />,
    },
    {
        id: "copy-field",
        ready: <G.CopyField label="Webhook URL" value="https://example.com/hooks/26465cdf" description="Paste it into the provider." copyLabel="Copy" copiedLabel="Copied" copyErrorLabel="Could not copy" />,
        loading: <G.CopyField label="Webhook URL" value="https://example.com/hooks/26465cdf" description="Paste it into the provider." copyLabel="Copy" copiedLabel="Copied" copyErrorLabel="Could not copy" isLoading />,
    },
    {
        id: "copy-field-masked",
        ready: <G.CopyField masked label="API key" lastFour="4387" onCopy={() => ""} copyLabel="Copy" copiedLabel="Copied" copyErrorLabel="Could not copy" />,
        loading: <G.CopyField masked label="API key" lastFour="4387" onCopy={() => ""} copyLabel="Copy" copiedLabel="Copied" copyErrorLabel="Could not copy" isLoading />,
    },
    {
        id: "textarea",
        ready: <G.Textarea label="Bio" description="A sentence or two." rows={3} />,
        loading: <G.Textarea label="Bio" description="A sentence or two." rows={3} isLoading />,
    },
    {
        id: "number-field",
        ready: <G.NumberField label="Seats" defaultValue={8} />,
        loading: <G.NumberField label="Seats" defaultValue={8} isLoading />,
    },
    {
        id: "search-field",
        ready: <G.SearchField label="Search" />,
        loading: <G.SearchField label="Search" isLoading />,
    },
    {
        id: "select",
        ready: <G.Select label="Plan" options={planOptions} defaultValue="team" />,
        loading: <G.Select label="Plan" options={planOptions} isLoading />,
    },
    {
        id: "select-description",
        ready: <G.Select label="Plan" description="Billed monthly." options={planOptions} defaultValue="team" />,
        loading: <G.Select label="Plan" description="Billed monthly." options={planOptions} isLoading />,
    },
    {
        id: "combo-box",
        ready: <G.ComboBox label="Plan" options={planOptions} />,
        loading: <G.ComboBox label="Plan" options={planOptions} isLoading />,
    },
    {
        id: "field",
        ready: <G.Field label="Account id" description="Shown on invoices." control={(control) => <input {...control} style={{ boxSizing: "border-box", width: "100%", height: "2.5rem" }} />} />,
        loading: <G.Field label="Account id" description="Shown on invoices." isLoading control={(control) => <input {...control} />} />,
    },
    ...(["md", "lg", "control"] as const).map((size) => ({
        id: `switch-${size}`,
        ready: <G.Switch label="Dark mode" size={size} />,
        loading: <G.Switch label="Dark mode" size={size} isLoading />,
    })),
    {
        id: "checkbox",
        ready: <G.Checkbox label="Accept the terms" />,
        loading: <G.Checkbox label="Accept the terms" isLoading />,
    },
    {
        id: "checkbox-group",
        ready: <G.CheckboxGroup label="Notifications" options={choiceOptions} />,
        loading: <G.CheckboxGroup label="Notifications" options={choiceOptions} isLoading />,
    },
    {
        id: "radio-group",
        ready: <G.RadioGroup label="Digest" options={choiceOptions} defaultValue="email" />,
        loading: <G.RadioGroup label="Digest" options={choiceOptions} isLoading />,
    },
    {
        id: "segmented-control",
        ready: <G.SegmentedControl label="Range" options={segmentOptions} defaultValue="day" />,
        loading: <G.SegmentedControl label="Range" options={segmentOptions} isLoading />,
    },
]

/** Every form control: the label and description stay, the control is a Skeleton of the loaded control's box. */
export const Forms: Story = sideBySide(forms)
export const FormsReady: Story = onePhase("grammar-forms", "ready", forms)
export const FormsLoading: Story = onePhase("grammar-forms", "loading", forms)

/* ------------------------------------------------------------------ content */

const tags: ReadonlyArray<G.TagGroupItem> = [
    { id: "design", label: "Design" },
    { id: "research", label: "Research" },
    { id: "ops", label: "Operations" },
]
const logLines = ["$ starci check loosening", "0 findings", "done in 1.2s"]

const content = (): ReadonlyArray<Pair> => [
    {
        id: "code",
        ready: <p style={{ margin: 0 }}>Run <G.Code>npm ci</G.Code> first.</p>,
        loading: <p style={{ margin: 0 }}>Run <G.Code isLoading>npm ci</G.Code> first.</p>,
    },
    {
        id: "terminal",
        ready: <G.Terminal title="Build log" lines={logLines} />,
        loading: <G.Terminal title="Build log" lines={logLines} isLoading />,
        width: "28rem",
    },
    {
        id: "fenced-code-block",
        ready: <G.FencedCodeBlock language="bash" code={"npm ci\nnpm run build"} action={<G.Button size="sm" onPress={noop}>Copy</G.Button>} />,
        loading: <G.FencedCodeBlock language="bash" code={"npm ci\nnpm run build"} action={<G.Button size="sm" onPress={noop}>Copy</G.Button>} isLoading />,
        width: "28rem",
    },
    {
        id: "alert",
        ready: <G.Alert title="Sync paused" description="Reconnect to resume." action={{ label: "Retry", onAction: noop }} dismissLabel="Dismiss" />,
        loading: <G.Alert title="Sync paused" description="Reconnect to resume." action={{ label: "Retry", onAction: noop }} dismissLabel="Dismiss" isLoading />,
        width: "32rem",
    },
    {
        id: "tag-group",
        ready: <G.TagGroup label="Teams" items={tags} />,
        loading: <G.TagGroup label="Teams" items={tags} isLoading />,
    },
]

/** Code, Terminal, FencedCodeBlock, Alert and TagGroup. */
export const Content: Story = sideBySide(content)
export const ContentReady: Story = onePhase("grammar-content", "ready", content)
export const ContentLoading: Story = onePhase("grammar-content", "loading", content)
