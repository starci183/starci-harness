import type { Meta, StoryObj } from "@storybook/react-vite"
import * as G from "../common/index.js"
import { Matrix, State, UploadGlyph, noop } from "./fixtures.js"

/* Small page parts the mockups use: a fact beside a section title, a headless list under a pane head, a file picker with a word, a destructive text command. */

const meta: Meta = { title: "Navigation & Data/Page parts" }
export default meta
type Story = StoryObj

const rows: ReadonlyArray<G.ListRowData> = [
    { id: "a", title: "Globex", description: "Chat, 2 hours", onPress: noop },
    { id: "b", title: "Sam Lee", description: "Website, 5 hours", onPress: noop },
]
const empty = <G.EmptyNotice message="Nothing here" />

export const PageParts: Story = {
    render: () => (
        <Matrix maxWidth={560}>
            <State label="Section fact on the title line (hidden while loading, like the count)" direction="column">
                <G.Section title="Candidates" fact="Technician" count={2} kind="list" items={rows} empty={empty} />
                <G.Section title="Candidates" fact="Technician" count={2} kind="list" items={rows} empty={empty} isLoading />
            </State>
            <State label="A list under a pane head: no heading of its own, named by ariaLabel" direction="column">
                <G.Section kind="list" ariaLabel="Waiting for you" items={rows} empty={empty} />
            </State>
            <State label="FileButton with a word, a note, and a refusal" direction="column">
                <G.FileButton label="Change picture" text="Change picture" source={UploadGlyph} description="PNG, JPEG or WebP, up to 2 MB." onFilesChange={noop} />
                <G.FileButton label="Change picture" text="Change picture" source={UploadGlyph} errorMessage="Only PNG, JPEG or WebP." onFilesChange={noop} />
            </State>
            <State label="Destructive text command" direction="column"><G.TextAction appearance="destructive" onPress={noop}>Sign out of the other devices</G.TextAction></State>
        </Matrix>
    ),
}

const connectionRows: ReadonlyArray<G.ListRowData> = [
    { id: "c1", title: "Chat channel", description: "Acme support", leading: { icon: UploadGlyph, size: "md" }, badges: [{ label: "Connected", tone: "success" }], control: <G.Select label="Agent for the chat channel" isLabelHidden options={[{ id: "a", label: "Sales" }, { id: "b", label: "Chatbot" }]} defaultValue="a" /> },
    { id: "c2", title: "Email", description: "support@acme.example", leading: { avatar: { name: "Email" }, size: "md" }, control: <G.Switch label="Email enabled" isLabelHidden defaultSelected /> },
]

export const RowControlAndLeading: Story = {
    render: () => (
        <Matrix maxWidth={640}>
            <State label="A row with a control at its end, a 40px leading mark (tile or avatar); loading draws the tile as a rounded square" direction="column">
                <G.SurfaceCard kind="list" label="Connections" items={connectionRows} empty={empty} />
            </State>
            <State label="Loading" direction="column"><G.SurfaceCard kind="list" label="Connections" items={connectionRows} empty={empty} isLoading /></State>
            <State label="Select with a prefix" direction="column"><G.Select label="Position" prefix="Position:" options={[{ id: "a", label: "Technician" }]} defaultValue="a" /></State>
        </Matrix>
    ),
}

const radioOptions = [
    { value: "cut", label: "Standard", description: "30 minutes, $12" },
    { value: "wash", label: "Deep clean", description: "60 minutes, $25" },
    { value: "dye", label: "Extended", description: "90 minutes, $45" },
]

export const PublicPageParts: Story = {
    render: () => (
        <Matrix maxWidth={560}>
            <State label="PageIntro: the plain heading block (accent initials mark, fact lines, a sentence)" direction="column">
                <G.PageIntro title="Acme Studio" mark={<G.Avatar name="Acme Studio" size="lg" shape="rounded" tone="accent" />} lines={[{ id: "a", text: "42 Main Street" }, { id: "h", text: "Open 9:00 to 20:00, closed on Monday" }]} description="Book in a minute: pick a service, a time, leave your phone number." />
            </State>
            <State label="RadioGroup appearance=rows (the chosen row on the accent soft pair)" direction="column"><G.RadioGroup label="Service" appearance="rows" options={radioOptions} defaultValue="wash" /></State>
            <State label="A form field that spans both columns (span=full ends the row before it)" direction="column">
                <G.Grid kind="form" columns={2}>
                    <G.Input id="p1" name="p1" label="Your name" />
                    <G.Textarea label="Note" span="full" />
                </G.Grid>
            </State>
            <State label="An inline failure row inside a card (isInline)" direction="column">
                <G.SurfaceCard label="Times" error={{ message: "Could not load the times", description: "Check the connection.", actionLabel: "Try again", onAction: noop, isInline: true }}><G.Text>never shown</G.Text></G.SurfaceCard>
            </State>
            <State label="Step rows: a mark at the start, the meta at the end" direction="column">
                <G.SurfaceCard kind="accordion" label="Set up" items={[
                    { id: "s1", title: "Connect a channel", meta: "Done", leading: { state: "done", position: 1 }, body: "Connected.", isOpen: false },
                    { id: "s2", title: "Add the webhook", meta: "In progress", leading: { state: "current", position: 2 }, body: "Paste the address.", isOpen: true },
                    { id: "s3", title: "Send a test", meta: "Needs attention", leading: { state: "problem", position: 3 }, body: "The test failed.", isOpen: false },
                    { id: "s4", title: "Go live", leading: { state: "todo", position: 4 }, body: "Later.", isOpen: false },
                ]} onItemOpenChange={noop} />
            </State>
            <State label="Alert with a leading mark and the whole banner as the press target" direction="column">
                <G.Alert tone="informative" leading={<G.Avatar name="Sales AI" size="sm" tone="accent" />} title="3 to approve" description="Quote for Globex" action={{ label: "Open the approvals", onAction: noop, kind: "row" }} />
            </State>
            <State label="Select appearance=pill with a prefix" direction="column"><G.Select label="Position" prefix="Position:" appearance="pill" options={[{ id: "a", label: "Technician" }]} defaultValue="a" /></State>
        </Matrix>
    ),
}

const approvalRows: ReadonlyArray<G.ListRowData> = [
    { id: "q1", title: "Quote for Globex", description: "12,500.00", badges: [{ label: "Waiting", tone: "warning" }], meta: { text: "5 min" }, onPress: noop },
    { id: "q2", title: "Order for Sam Lee", description: "26,000.00", badges: [{ label: "Over limit", tone: "danger" }], meta: { text: "1 hour" }, onPress: noop },
]

const setupItems: ReadonlyArray<G.DisclosureListItem> = [
    { id: "d1", title: "Connect a channel", summary: "Done", leading: { state: "done", position: 1 }, body: "Connected." },
    { id: "d2", title: "Add the webhook", summary: "In progress", leading: { state: "current", position: 2 }, defaultExpanded: true, body: "Paste the address." },
    { id: "d3", title: "Send a test", summary: "Needs attention", leading: { state: "problem", position: 3 }, body: "The test failed." },
]

const twin = (name: string, ready: React.ReactNode, loading: React.ReactNode) => (
    <div data-grammar-twin={name} style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", alignItems: "flex-start" }}>
        <div data-grammar-twin-item="ready" style={{ display: "inline-flex", flexDirection: "column", width: "24rem" }}>{ready}</div>
        <div data-grammar-twin-item="loading" style={{ display: "inline-flex", flexDirection: "column", width: "24rem" }}>{loading}</div>
    </div>
)

export const InsetAndDisclosureList: Story = {
    render: () => (
        <Matrix>
            <State label="Inset around rows (ready, and loading: the region is the inset; same box)" direction="column">
                {twin("Inset",
                    <G.Inset label="Waiting for you"><G.Section kind="list" ariaLabel="Approvals" items={approvalRows} empty={empty} /></G.Inset>,
                    <G.Inset label="Waiting for you" isLoading><G.Section kind="list" ariaLabel="Approvals" items={approvalRows} empty={empty} /></G.Inset>)}
            </State>
            <State label="DisclosureList: step marks and end meta; loading keeps the titles and draws the data as geometry" direction="column">
                {twin("DisclosureList",
                    <G.SurfaceCard label="Set up"><G.DisclosureList label="Setup steps" items={setupItems} /></G.SurfaceCard>,
                    <G.SurfaceCard label="Set up" isLoading><G.DisclosureList label="Setup steps" items={setupItems} /></G.SurfaceCard>)}
            </State>
        </Matrix>
    ),
}

const infoTheme = { "--info-soft": "#dfe7fc", "--info-soft-foreground": "#203571" } as React.CSSProperties

const infoSample = (
    <>
        <G.Alert tone="informative" title="Let the assistant answer for you" description="You approve first; nothing is sent without you." />
        <G.Cluster gap="inline"><G.Badge tone="info">Info</G.Badge><G.Badge tone="accent">New</G.Badge><G.Badge isDot tone="info">Syncing</G.Badge></G.Cluster>
    </>
)

export const InfoAndAccentTones: Story = {
    render: () => (
        <Matrix maxWidth={560}>
            <State label="A theme without an info soft pair: informative falls back to the accent pair" direction="column">{infoSample}</State>
            <State label="A theme that defines --info-soft and --info-soft-foreground (an app theme: blue): informative and the info Badge use it; accent stays its own tone" direction="column">
                <div style={{ ...infoTheme, display: "flex", flexDirection: "column", gap: "0.75rem" }}>{infoSample}</div>
            </State>
        </Matrix>
    ),
}

const spanOptions = [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }]
const spanFields = (isLoading: boolean) => (
    <G.Grid kind="form" columns={2}>
        <G.Input id="sp-a" name="sp-a" label="Name" isLoading={isLoading} />
        <G.Input id="sp-b" name="sp-b" label="Address" span="full" isLoading={isLoading} />
        <G.Select label="Service" options={spanOptions} span="full" isLoading={isLoading} />
        <G.Textarea label="Note" span="full" isLoading={isLoading} />
        <G.CopyField label="Link" value="https://example.com/hooks/26465cdf" copyLabel="Copy" copiedLabel="Copied" copyErrorLabel="Could not copy" span="full" isLoading={isLoading} />
        <G.Input id="sp-c" name="sp-c" label="City" isLoading={isLoading} />
    </G.Grid>
)

/** Every field component takes `span="full"` from FormGrid; a full field stands alone on its row, and the loading twin keeps the same box. */
export const FormGridSpanEveryField: Story = {
    render: () => (
        <Matrix maxWidth={1600}>
            <State label="Fields with span=full end the row before them (Input, Select, Textarea, CopyField); ready and loading are one box" direction="column">
                <div data-grammar-twin="form-grid-span" style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", alignItems: "flex-start" }}>
                    <div data-grammar-twin-item="ready" style={{ display: "inline-flex", flexDirection: "column", width: "44rem" }}>{spanFields(false)}</div>
                    <div data-grammar-twin-item="loading" style={{ display: "inline-flex", flexDirection: "column", width: "44rem" }}>{spanFields(true)}</div>
                </div>
            </State>
        </Matrix>
    ),
}

const primaryRows: ReadonlyArray<G.ListRowData> = [
    { id: "p1", title: "Connect a channel", description: "Needed before the agent can answer", action: { label: "Continue", intent: "commit", isPrimary: true, press: noop } },
    { id: "p2", title: "Add a knowledge source", description: "Optional", action: { label: "Add", intent: "commit", press: noop } },
    { id: "p3", title: "Invite a teammate", description: "Optional", action: { label: "Invite", press: noop } },
]

/** A row command may be the region's one primary (`isPrimary`); the other commit and neutral commands stay the outlined item pill. */
export const RowPrimaryAction: Story = {
    render: () => (
        <Matrix maxWidth={560}>
            <State label="One row command is the filled primary; the other commit and neutral commands stay outlined" direction="column">
                <G.Section title="Set up" kind="list" items={primaryRows} empty={empty} />
            </State>
            <State label="The same, loading (the action is a skeleton of the same box)" direction="column">
                <G.Section title="Set up" kind="list" items={primaryRows} empty={empty} isLoading />
            </State>
        </Matrix>
    ),
}

/** Below 30rem the action stacks under the text, full width, in its tone's intent; the dismiss stays beside the text. */
export const AlertActionNarrow: Story = {
    render: () => (
        <Matrix maxWidth={560}>
            <State label="Informative with an action and a dismiss (commit; stacks under the text on a phone)" direction="column">
                <G.Alert title="Finish setting up" description="Connect a channel so the agent can answer customers." action={{ label: "Continue setup", onAction: noop }} dismissLabel="Dismiss" />
            </State>
        </Matrix>
    ),
}

/** The other tones' actions below 30rem: negative (confirmed destructive intent) and loading (the same box). One accent fill per view, so they stand apart from the informative one. */
export const AlertActionNarrowOtherTones: Story = {
    render: () => (
        <Matrix maxWidth={560}>
            <State label="Negative with an action (confirmed destructive intent)" direction="column">
                <G.Alert tone="negative" title="Could not send" description="Check the connection and try again." action={{ label: "Try again", onAction: noop }} />
            </State>
            <State label="Loading (the same box)" direction="column">
                <G.Alert title="Finish setting up" description="Connect a channel so the agent can answer customers." action={{ label: "Continue setup", onAction: noop }} dismissLabel="Dismiss" isLoading />
            </State>
        </Matrix>
    ),
}

const drawerRows: ReadonlyArray<G.ListRowData> = [
    { id: "d1", title: "Next step", description: "Send the quote", meta: { text: "1 day" } },
    { id: "d2", title: "Context", description: "Ms Garcia, 555 0142" },
    { id: "d3", title: "Channel", description: "Chat" },
]

const DrawerPaneContent = () => (
    <>
        <G.PaneSection gap="section">
            <G.Heading level={3}>Customer</G.Heading>
            <G.Text>Acme, a company with two branches.</G.Text>
        </G.PaneSection>
        <G.PaneSection gap="section">
            <G.Section title="Details" kind="list" items={drawerRows} empty={empty} />
        </G.PaneSection>
    </>
)

const DrawerSpacingDemo = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        <div data-story-pane-grid="aside" style={{ height: "26rem", display: "flex" }}>
            <G.PaneGrid label="Aside" areas={["main info"]} columns={["fill", "standard"]}>
                <G.Pane area="main" label="Main"><G.PaneSection><G.Text>Main</G.Text></G.PaneSection></G.Pane>
                <G.Pane area="info" surface label="Details"><DrawerPaneContent /></G.Pane>
            </G.PaneGrid>
        </div>
        <div data-story-pane-grid="drawer" style={{ height: "4rem", display: "flex" }}>
            <G.PaneGrid label="Drawer" areas={["main info"]} columns={["fill", "standard"]}>
                <G.Pane area="main" label="Main"><G.PaneSection><G.Text>Main</G.Text></G.PaneSection></G.Pane>
                <G.Pane area="info" surface label="Details" collapse="drawer" trigger="none" collapseLabel="Customer info" closeLabel="Close" isOpen onOpenChange={noop}><DrawerPaneContent /></G.Pane>
            </G.PaneGrid>
        </div>
    </div>
)

/** The same pane as a wide aside and opened as a drawer: the drawer is portalled into the Grammar root, so sections, rows and text keep the same spacing (DNA-COMMON-PANE-DRAWER-SPACING, -SECTION-GAP). */
export const PaneDrawerSpacing: Story = {
    render: () => <DrawerSpacingDemo />,
}
