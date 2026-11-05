import type { Meta, StoryObj } from "@storybook/react-vite"
import type { CSSProperties, ReactNode } from "react"
import * as G from "../common/index.js"
import { Matrix, PlusGlyph, State, noop, placeholderImage } from "./fixtures.js"

/* Parts the second round of mockups needs (U2-G6, U2-G8, G7-7..G7-10, G9c-1, G9c-2, the alternative button, the drawer description list, the bar stepper). */

const meta: Meta = { title: "Navigation & Data/Mockup parts" }
export default meta
type Story = StoryObj

const empty = <G.EmptyNotice message="Nothing here" />

/** Radios and checkboxes draw their own ring when the app field border and shadow are transparent (DNA-COMMON-CHOICE-RING). */
export const ChoiceRingWithoutFieldEdge: Story = {
    render: () => (
        <div style={{ "--field-border": "transparent", "--field-shadow": "none" } as CSSProperties}>
            <Matrix maxWidth={420}>
                <State label="RadioGroup rows, nothing chosen / one chosen" direction="column">
                    <G.RadioGroup label="Service" appearance="rows" options={[{ value: "a", label: "Cut", description: "30 minutes" }, { value: "b", label: "Colour", description: "90 minutes" }]} />
                    <G.RadioGroup label="Service chosen" appearance="rows" defaultValue="a" options={[{ value: "a", label: "Cut", description: "30 minutes" }, { value: "b", label: "Colour", description: "90 minutes" }]} />
                </State>
                <State label="Checkbox, unchecked" direction="column"><G.Checkbox label="Remind me" /></State>
            </Matrix>
        </div>
    ),
}

const longColumn = Array.from({ length: 24 }, (_, index) => <G.Text key={index}>Line {index + 1} of a long public page</G.Text>)

/** A flow shell inside a bleed Page grows with its content: the fill is a floor, so the canvas reaches the end (DNA-COMMON-PAGE-FILL-GROWS). */
export const PageFlowGrows: Story = {
    render: () => (
        <G.Page chrome="bleed" minHeight="none">
            <G.WorkspaceShell viewport="flow" primaryLabel="Booking" primary={<G.Stack gap="row">{longColumn}</G.Stack>} />
        </G.Page>
    ),
}

const passages: ReadonlyArray<G.ListRowData> = [
    { id: "p1", title: "Opening hours", description: "Mon to Sat, 9:00 to 18:00", leading: { position: 1, format: "hash" }, action: { label: "Add", press: noop }, actionPlacement: "end" },
    { id: "p2", title: "Cancellation", description: "Free up to 24 hours before", leading: { position: 12, format: "hash" }, action: { label: "Add", press: noop }, actionPlacement: "end" },
    { id: "p3", title: "Deposit", description: "Ordinal numbering as before", leading: { position: 3 }, action: { label: "Add", press: noop } },
]

/** A two-line row keeps its command at the end at a narrow width; "#1" numbering (DNA-COMMON-ROW-ACTION-END). */
export const RowActionEndAndHashNumber: Story = {
    render: () => (
        <Matrix maxWidth={340}>
            <State label="actionPlacement end (rows 1 and 2), default below (row 3); loading twin" direction="column">
                <G.Section title="Passages" kind="list" items={passages} empty={empty} />
                <G.Section title="Passages" kind="list" items={passages} empty={empty} isLoading />
            </State>
        </Matrix>
    ),
}

/** Chevron before the title, and the quiet link-toned disclosure (DNA-COMMON-DISCLOSURE-CHEVRON-START). */
export const DisclosureChevronAndQuiet: Story = {
    render: () => (
        <Matrix maxWidth={420}>
            <State label="chevron end (default) / start / start, open" direction="column">
                <G.Disclosure title="Source text" body={<G.Text>The original passage.</G.Text>} />
                <G.Disclosure title="Source text" chevron="start" body={<G.Text>The original passage.</G.Text>} />
                <G.Disclosure title="Source text" chevron="start" defaultExpanded body={<G.Text>The original passage.</G.Text>} />
            </State>
            <State label="quiet, closed / open" direction="column">
                <G.Disclosure kind="quiet" title="Evidence (2)" body={<G.Text>Two messages from the customer.</G.Text>} />
                <G.Disclosure kind="quiet" title="Evidence (2)" defaultExpanded body={<G.Text>Two messages from the customer.</G.Text>} />
            </State>
        </Matrix>
    ),
}

const filterItems: ReadonlyArray<G.TabItem> = ["All", "Notes", "Files", "Links", "Images", "Audio", "Video", "Other"].map((label) => ({ id: label, label, count: 3 }))

/** The filter tabs fold into a word of the app, "More", instead of "+n"; the menu is still named with the count. */
export const FilterTabsOverflowLabel: Story = {
    render: () => (
        <Matrix maxWidth={360}>
            <State label="overflowLabel More" direction="column">
                <G.Tabs label="Kinds" kind="filter" panelId="kinds-panel" overflowLabel="More" moreLabel={(count) => `${count} more kinds`} selectedKey="All" onSelect={noop} items={filterItems} />
                <div id="kinds-panel" role="tabpanel" aria-label="Kinds"><G.Text>All kinds</G.Text></div>
            </State>
        </Matrix>
    ),
}

const figures: ReadonlyArray<G.Figure> = [
    { id: "f1", term: "Open", value: 12 },
    { id: "f2", term: "Waiting", value: 3 },
    { id: "f3", term: "Done", value: 128 },
    { id: "f4", term: "Late", value: 1 },
]

/** Figures in a list pane: one bordered row, 2 x 2 only below 20rem (DNA-COMMON-FIGURES-PANE-ROW). */
export const FiguresInPaneRow: Story = {
    render: () => (
        <div style={{ height: "14rem", display: "flex" }}>
            <G.PaneGrid label="Dossiers" areas={["list main"]} columns={["wide", "fill"]}>
                <G.Pane area="list" surface label="List">
                    <G.PaneSection><G.Section kind="figures" ariaLabel="Totals" items={figures} /></G.PaneSection>
                    <G.PaneSection><G.Section kind="figures" ariaLabel="Totals loading" items={figures} isLoading /></G.PaneSection>
                </G.Pane>
                <G.Pane area="main" label="Main"><G.PaneSection><G.Text>Main</G.Text></G.PaneSection></G.Pane>
            </G.PaneGrid>
        </div>
    ),
}

/** The alternative button is outlined, its words in the default foreground, not the brand accent (DNA-COMMON-BUTTON-ALTERNATIVE-OUTLINE). */
export const AlternativeButtonInk: Story = {
    render: () => (
        <div style={{ "--accent-soft-foreground": "rgb(190 24 93)" } as CSSProperties}>
            <Matrix>
                <State label="alternative in a brand-coloured app"><G.Button intent="alternative" onPress={noop}>Try again</G.Button></State>
            </Matrix>
        </div>
    ),
}

const facts: ReadonlyArray<G.DescriptionListItem> = [
    { id: "a", term: "Owner", description: "Ms Trang" },
    { id: "b", term: "Channel", description: "Zalo" },
    { id: "c", term: "Next step", description: "Send the quote today" },
]

/** A term stands beside its value in a phone-wide drawer: the list answers its own width (DNA-COMMON-DESCRIPTION-DRAWER-COLUMNS). */
export const DescriptionListInDrawerWidth: Story = {
    render: () => (
        <Matrix maxWidth={308}>
            <State label="compact, 308px wide (a phone drawer: 372px less 32px padding)" direction="column"><G.DescriptionList items={facts} density="compact" /></State>
            <State label="default, 308px wide" direction="column"><G.DescriptionList items={facts} /></State>
        </Matrix>
    ),
}

const barSteps: ReadonlyArray<G.StepperStep> = [{ id: "a", label: "Profile" }, { id: "b", label: "Channels" }, { id: "c", label: "Agents" }, { id: "d", label: "Done" }]

/** The segmented bar stepper (DNA-COMMON-STEPPER-BAR). */
export const StepperBar: Story = {
    render: () => (
        <Matrix maxWidth={308}>
            <State label="step 2 of 4, pressable at step 3, loading" direction="column">
                <G.Stepper kind="bar" label="Setup" steps={barSteps} currentStepId="b" />
                <G.Stepper kind="bar" label="Setup pick" steps={barSteps} currentStepId="c" onStepSelect={noop} />
                <G.Stepper kind="bar" label="Setup loading" steps={barSteps} currentStepId="b" isLoading />
            </State>
        </Matrix>
    ),
}

const thread = ["Hello", "How can I help?", "Book me a cut for Friday"].map((text, index) => <G.Text key={index}>{text}</G.Text>)

const AlignGrid = ({ align, content }: { readonly align: "end" | "center"; readonly content: ReactNode }) => (
    <div style={{ height: "18rem", display: "flex" }}>
        <G.PaneGrid label="Chat" areas={["main"]} columns={["fill"]}>
            <G.Pane area="main" surface label="Thread">
                <G.PaneSection scroll={{ label: "Messages", role: "log", align }}>{content}</G.PaneSection>
            </G.Pane>
        </G.PaneGrid>
    </div>
)

/** A short thread stands at the foot of its scroll band, an empty one centres its greeting (DNA-COMMON-PANE-SCROLL-ALIGN, -END). */
export const ScrollBandAlign: Story = {
    render: () => (
        <Matrix maxWidth={420}>
            <State label="align end, a short thread" direction="column"><AlignGrid align="end" content={thread} /></State>
            <State label="align center, an empty greeting" direction="column"><AlignGrid align="center" content={<G.Text>Welcome. Ask me anything.</G.Text>} /></State>
        </Matrix>
    ),
}

/** The accent tone: the brand soft pair for a welcome band (DNA-COMMON-ALERT-TONE-PAIR-ACCENT). */
export const AlertAccentTone: Story = {
    render: () => (
        <Matrix maxWidth={460}>
            <State label="accent, with a dismiss / loading" direction="column">
                <G.Alert tone="accent" title="Welcome to NIVO" description="Ask a question to begin." dismissLabel="Dismiss" />
                <G.Alert tone="accent" title="Welcome to NIVO" description="Ask a question to begin." isLoading />
            </State>
        </Matrix>
    ),
}

const dayOptions = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => ({ value: day, label: day }))

/** ChoiceChips width fill: the chips share the row evenly, and wrap only when they cannot fit (DNA-COMMON-CHOICE-CHIPS-FILL). */
export const ChoiceChipsFill: Story = {
    render: () => (
        <Matrix maxWidth={420}>
            <State label="fill, one row / narrow, wrapped / loading" direction="column">
                <G.ChoiceChips label="Days" width="fill" options={dayOptions} defaultValue="Mon" empty={empty} />
                <div style={{ maxWidth: 200 }}><G.ChoiceChips label="Days narrow" width="fill" options={dayOptions} defaultValue="Mon" empty={empty} /></div>
                <G.ChoiceChips label="Days loading" width="fill" options={dayOptions} isLoading empty={empty} />
            </State>
        </Matrix>
    ),
}

/** Filter tabs in a loading region: labels real, counts as geometry (DNA-COMMON-TABS-FILTER-LOADING-COUNTS). */
export const FilterTabsLoading: Story = {
    render: () => (
        <Matrix maxWidth={360}>
            <State label="ready / loading region" direction="column">
                <G.Tabs label="Kinds ready" kind="filter" selectedKey="All" onSelect={noop} items={filterItems.slice(0, 4)} />
                <G.PaneGrid label="Loading" areas={["main"]} columns={["fill"]}>
                    <G.Pane area="main" label="Loading list">
                        <G.PaneSection isLoading><G.Tabs label="Kinds loading" kind="filter" selectedKey="All" onSelect={noop} items={filterItems.slice(0, 4)} /></G.PaneSection>
                    </G.Pane>
                </G.PaneGrid>
            </State>
        </Matrix>
    ),
}

/** Separate buttons that mean one thing stand in a labelled group; not a ButtonGroup (DNA-COMMON-CLUSTER-GROUP-NAMED). */
export const LabelledActionRow: Story = {
    render: () => (
        <Matrix>
            <State label="less / more and a row of actions">
                <G.Cluster gap="inline" label="Quantity">
                    <G.IconButton label="Less" source={PlusGlyph} intent="neutral" onPress={noop} />
                    <G.Text>2</G.Text>
                    <G.IconButton label="More" source={PlusGlyph} intent="neutral" onPress={noop} />
                </G.Cluster>
                <G.Cluster gap="inline" label="Actions on this order">
                    <G.Button intent="alternative" onPress={noop}>Edit</G.Button>
                    <G.Button intent="commit" onPress={noop}>Confirm</G.Button>
                </G.Cluster>
            </State>
        </Matrix>
    ),
}

type SeeRow = { readonly id: string; readonly knowledge: string; readonly customer: string; readonly agent: string }
const seeColumns: ReadonlyArray<G.DataTableColumn<SeeRow>> = [
    { id: "knowledge", label: "Knowledge", isRowHeader: true },
    { id: "customer", label: "Customer", align: "end" },
    { id: "agent", label: "Support agent", align: "end" },
]
const seeRows: ReadonlyArray<SeeRow> = [
    { id: "r1", knowledge: "Public documents", customer: "6", agent: "6" },
    { id: "r2", knowledge: "Internal documents", customer: "-", agent: "-" },
    { id: "r3", knowledge: "Public facts", customer: "31", agent: "31" },
    { id: "r4", knowledge: "Limited by the agent", customer: "-", agent: "-" },
]

/** A compact table in a narrow aside fits its pane and never clips its last column (DNA-COMMON-TABLE-NO-CLIP); the chevron-first disclosure's title follows the chevron. */
export const CompactTableInAside: Story = {
    render: () => (
        <div style={{ height: "22rem", display: "flex" }}>
            <G.PaneGrid label="Ask" areas={["main info"]} columns={["fill", "standard"]}>
                <G.Pane area="main" label="Main"><G.PaneSection><G.Text>Main</G.Text></G.PaneSection></G.Pane>
                <G.Pane area="info" surface label="What the agent sees">
                    <G.PaneSection>
                        <G.DataTable label="Customer and agent" columns={seeColumns} rows={seeRows} renderCell={(row, id) => id === "knowledge" ? row.knowledge : id === "customer" ? row.customer : row.agent} emptyContent={<G.Text>None</G.Text>} />
                    </G.PaneSection>
                </G.Pane>
            </G.PaneGrid>
        </div>
    ),
}

const agentOptions = [{ id: "all", label: "All agents" }, { id: "care", label: "Care agent" }, { id: "sales", label: "Sales agent" }]

/** The compact field step: a single-line field 32px tall for a list head or toolbar (DNA-COMMON-FIELD-SM); hidden label and loading keep the box. */
export const CompactFields: Story = {
    render: () => (
        <Matrix maxWidth={360}>
            <State label="Select sm: visible label, hidden label, loading region" direction="column">
                <G.Select label="Agent" size="sm" options={agentOptions} defaultValue="all" />
                <G.Select label="Agent for the list" size="sm" isLabelHidden options={agentOptions} defaultValue="all" />
                <G.Select label="Agent loading" size="sm" isLabelHidden options={agentOptions} defaultValue="all" isLoading />
            </State>
            <State label="Same step on SearchField, NumberField, Input, and the md twin" direction="column">
                <G.SearchField label="Search" size="sm" isLabelHidden placeholder="Search" clearLabel="Clear" />
                <G.NumberField label="Quantity" size="sm" isLabelHidden defaultValue={2} />
                <G.Input id="compact-input" name="compact" label="Name" size="sm" isLabelHidden placeholder="Name" />
                <G.Select label="Agent md" isLabelHidden options={agentOptions} defaultValue="all" />
            </State>
        </Matrix>
    ),
}

const gapRows: ReadonlyArray<G.ListRowData> = [
    { id: "g1", title: "Return and exchange policy", description: "Customers ask about it most", leading: { icon: PlusGlyph }, action: { label: "Add", press: noop }, actionPlacement: "end", menu: { label: "More", entries: [{ kind: "section", id: "s", items: [{ id: "x", label: "Dismiss", onAction: noop }] }] } },
    { id: "g2", title: "Opening hours", description: "One command stays at the end", leading: { icon: PlusGlyph }, action: { label: "Add", press: noop }, actionPlacement: "end" },
]

/** Text first: with an action and a menu in a 20rem pane the commands stand under the text; one command stays at the end (DNA-COMMON-ROW-TEXT-FIRST). */
export const RowTextFirst: Story = {
    render: () => (
        <div data-story-narrow-rows="true" style={{ maxWidth: "20rem" }}>
            <G.Section title="To add" kind="list" items={gapRows} empty={empty} />
            <G.Section title="To add loading" kind="list" items={gapRows} empty={empty} isLoading />
        </div>
    ),
}

/** A Select with no placeholder shows no vendor English "Select an item" (DNA-COMMON-SELECT-NO-VENDOR-ENGLISH). */
export const SelectWithoutPlaceholder: Story = {
    render: () => (
        <Matrix maxWidth={360}>
            <State label="no placeholder, nothing chosen / with the app's words" direction="column">
                <G.Select label="Agent" options={agentOptions} />
                <G.Select label="Agent again" placeholder="Choose an agent" options={agentOptions} />
            </State>
        </Matrix>
    ),
}

/** A media link keeps the width and height it is given: a 113 x 40 logo stays 113 x 40 (DNA-COMMON-LINK-MEDIA-KEEPS-BOX). */
export const LinkMediaKeepsBox: Story = {
    render: () => (
        <Matrix maxWidth={600}>
            <State label="logo 113 x 40 in a wide bar" direction="column">
                <div style={{ display: "flex", width: "100%", alignItems: "center", blockSize: "4rem" }}>
                    <G.Link href="#home" label="Home" media={{ src: placeholderImage("NIVO OS", 340), alt: "", width: 113, height: 40 }} />
                </div>
            </State>
        </Matrix>
    ),
}

const LinkOn = ({ ground, label }: { readonly ground: string; readonly label: string }) => (
    <div style={{ background: `var(${ground})`, padding: "0.75rem", borderRadius: "0.5rem" }}>
        <G.Text>{label}: <G.Link href="#next">See the details</G.Link></G.Text>
    </div>
)

/** A text link is the accent as text, underlined, on every ground (DNA-COMMON-LINK-ACCENT-TEXT). */
export const LinkAccentOnEveryGround: Story = {
    render: () => (
        <Matrix maxWidth={420}>
            <State label="background / surface / secondary / tertiary" direction="column">
                <LinkOn ground="--background" label="Page" />
                <LinkOn ground="--surface" label="Surface" />
                <LinkOn ground="--surface-secondary" label="Secondary" />
                <LinkOn ground="--surface-tertiary" label="Tertiary" />
            </State>
        </Matrix>
    ),
}
