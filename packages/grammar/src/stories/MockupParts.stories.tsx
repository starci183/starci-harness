import type { Meta, StoryObj } from "@storybook/react-vite"
import type { CSSProperties, ReactNode } from "react"
import * as G from "../common/index.js"
import { Matrix, State, noop } from "./fixtures.js"

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

/** The alternative button writes its words in the default foreground, not the brand accent (DNA-COMMON-BUTTON-ALTERNATIVE-INK). */
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
        <Matrix maxWidth={358}>
            <State label="compact, 358px wide" direction="column"><G.DescriptionList items={facts} density="compact" /></State>
            <State label="default, 358px wide" direction="column"><G.DescriptionList items={facts} /></State>
        </Matrix>
    ),
}

const barSteps: ReadonlyArray<G.StepperStep> = [{ id: "a", label: "Profile" }, { id: "b", label: "Channels" }, { id: "c", label: "Agents" }, { id: "d", label: "Done" }]

/** The segmented bar stepper (DNA-COMMON-STEPPER-BAR). */
export const StepperBar: Story = {
    render: () => (
        <Matrix maxWidth={380}>
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
