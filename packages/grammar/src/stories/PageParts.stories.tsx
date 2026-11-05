import type { Meta, StoryObj } from "@storybook/react-vite"
import * as G from "../common/index.js"
import { Matrix, State, UploadGlyph, noop } from "./fixtures.js"

/* Small page parts the mockups use: a fact beside a section title, a headless list under a pane head, a file picker with a word, a destructive text command. */

const meta: Meta = { title: "Navigation & Data/Page parts" }
export default meta
type Story = StoryObj

const rows: ReadonlyArray<G.ListRowData> = [
    { id: "a", title: "Hoa Sen Spa", description: "Zalo, 2 hours", onPress: noop },
    { id: "b", title: "Anh Tuan", description: "Website, 5 hours", onPress: noop },
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
    { id: "c1", title: "Zalo OA", description: "Mây Bakery OA", leading: { icon: UploadGlyph, size: "md" }, badges: [{ label: "Connected", tone: "success" }], control: <G.Select label="Agent for Zalo OA" isLabelHidden options={[{ id: "a", label: "Sales" }, { id: "b", label: "Chatbot" }]} defaultValue="a" /> },
    { id: "c2", title: "Telegram", description: "@maybakery_bot", leading: { avatar: { name: "Telegram" }, size: "md" }, control: <G.Switch label="Telegram enabled" isLabelHidden defaultSelected /> },
]

export const RowControlAndLeading: Story = {
    render: () => (
        <Matrix maxWidth={640}>
            <State label="A row with a control at its end, a 40px leading mark (tile or avatar); loading draws the tile as a rounded square" direction="column">
                <G.SurfaceCard kind="list" label="Connections" items={connectionRows} empty={empty} />
            </State>
            <State label="Loading" direction="column"><G.SurfaceCard kind="list" label="Connections" items={connectionRows} empty={empty} isLoading /></State>
            <State label="Select with a prefix" direction="column"><G.Select label="Position" prefix="Position:" options={[{ id: "a", label: "Spa technician" }]} defaultValue="a" /></State>
        </Matrix>
    ),
}

const radioOptions = [
    { value: "cut", label: "Haircut", description: "30 minutes, 120,000" },
    { value: "wash", label: "Herbal wash", description: "60 minutes, 250,000" },
    { value: "dye", label: "Colour", description: "90 minutes, 450,000" },
]

export const PublicPageParts: Story = {
    render: () => (
        <Matrix maxWidth={560}>
            <State label="PageIntro: the plain heading block (accent initials mark, fact lines, a sentence)" direction="column">
                <G.PageIntro title="Minh Sang Salon" mark={<G.Avatar name="Minh Sang" size="lg" shape="rounded" tone="accent" />} lines={[{ id: "a", text: "42 Le Loi, District 1" }, { id: "h", text: "Open 9:00 to 20:00, closed on Monday" }]} description="Book in a minute: pick a service, a time, leave your phone number." />
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
                    { id: "s1", title: "Connect Zalo", meta: "Done", leading: { state: "done", position: 1 }, body: "Connected.", isOpen: false },
                    { id: "s2", title: "Add the webhook", meta: "In progress", leading: { state: "current", position: 2 }, body: "Paste the address.", isOpen: true },
                    { id: "s3", title: "Send a test", meta: "Needs attention", leading: { state: "problem", position: 3 }, body: "The test failed.", isOpen: false },
                    { id: "s4", title: "Go live", leading: { state: "todo", position: 4 }, body: "Later.", isOpen: false },
                ]} onItemOpenChange={noop} />
            </State>
            <State label="Alert with a leading mark and the whole banner as the press target" direction="column">
                <G.Alert tone="informative" leading={<G.Avatar name="Sales AI" size="sm" tone="accent" />} title="3 to approve" description="Quote for Hoa Sen Spa" action={{ label: "Open the approvals", onAction: noop, kind: "row" }} />
            </State>
            <State label="Select appearance=pill with a prefix" direction="column"><G.Select label="Position" prefix="Position:" appearance="pill" options={[{ id: "a", label: "Spa technician" }]} defaultValue="a" /></State>
        </Matrix>
    ),
}
