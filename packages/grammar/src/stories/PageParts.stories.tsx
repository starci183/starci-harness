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
