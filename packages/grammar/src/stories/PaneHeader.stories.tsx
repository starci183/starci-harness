import type { Meta, StoryObj } from "@storybook/react-vite"
import * as G from "../common/index.js"
import { EllipsisGlyph, Matrix, State, noop } from "./fixtures.js"

/*
 * The head of a pane (contexts/ui/components/pane-grid.md): the heads of a grid row share one height, the back control
 * appears only where one pane shows at a time, a long title truncates, and a loading head keeps its box. The PaneGrid
 * below is drawn in its own width, so the three-pane row shows the wide arrangement and the narrow story the phone's.
 */

const meta: Meta = { title: "Navigation & Data/Pane header" }
export default meta
type Story = StoryObj

const actions = <G.IconButton intent="neutral" source={EllipsisGlyph} label="More actions" />

const row = (title: string, isLoading = false) => (
    <div style={{ blockSize: "14rem" }}>
        <G.PaneGrid label="Heads" areas={{ base: ["head", "main"], medium: ["listHead head", "list main"] }} columns={{ base: ["fill"], medium: ["standard", "fill"] }} rows={{ base: ["auto", "fill"], medium: ["auto", "fill"] }}>
            <G.Pane area="list" surface>
                <G.PaneSection><G.Text tone="muted">The list.</G.Text></G.PaneSection>
            </G.Pane>
            <G.Pane area="listHead" surface>
                <G.PaneSection align="center">
                    <G.PaneHeader title="Inbox" actions={actions} isLoading={isLoading} />
                </G.PaneSection>
            </G.Pane>
            <G.Pane area="head" surface>
                <G.PaneSection align="center">
                    <G.PaneHeader
                        title={title}
                        headingLevel={1}
                        description="Chat on the website - 5 minutes ago"
                        status={<G.Badge tone="warning">Needs a decision</G.Badge>}
                        actions={actions}
                        back={{ label: "Back to the list", onPress: noop }}
                        isLoading={isLoading}
                    />
                </G.PaneSection>
            </G.Pane>
            <G.Pane area="main" surface>
                <G.PaneSection><G.Text tone="muted">The pane body.</G.Text></G.PaneSection>
            </G.Pane>
        </G.PaneGrid>
    </div>
)

export const PaneHeaderStates: Story = {
    render: () => (
        <Matrix>
            <State label="Ready" direction="column">{row("Alex Morgan")}</State>
            <State label="Loading (same box)" direction="column">{row("Alex Morgan", true)}</State>
            <State label="Long title" direction="column">{row("Alex Morgan and the whole of the extended family from the south")}</State>
        </Matrix>
    ),
}

/**
 * `drawerOpener` on a PaneHeader opens the drawer of a pane of the same grid (`collapse="drawer" trigger="head"`): the grid owns the open
 * state, so no page state is held. The icon button shows only where the rail's area is not arranged (below 48rem here) and takes the
 * action slot's place, so the head keeps its height at every width.
 */
export const HeadDrawerOpener: Story = {
    render: () => (
        <div style={{ height: "28rem", display: "flex" }}>
            <G.PaneGrid label="Conversation" areas={["main rail"]} columns={["fill", "standard"]}>
                <G.Pane area="main" label="Conversation">
                    <G.PaneSection align="center">
                        <G.PaneHeader title="Thu Trang" description="Zalo, 2 min ago" actions={actions} drawerOpener={{ pane: "rail", icon: EllipsisGlyph, label: "Customer info" }} />
                    </G.PaneSection>
                    <G.PaneSection><G.Text>Messages</G.Text></G.PaneSection>
                </G.Pane>
                <G.Pane area="rail" surface label="Customer" collapse="drawer" trigger="head" collapseLabel="Customer info" closeLabel="Close">
                    <G.PaneSection gap="section">
                        <G.Heading level={3}>Customer</G.Heading>
                        <G.Text>Moc An, two branches.</G.Text>
                    </G.PaneSection>
                </G.Pane>
            </G.PaneGrid>
        </div>
    ),
}

const roomMembers: ReadonlyArray<G.AvatarGroupItem> = [
    { id: "mina", name: "Mina Nguyen" },
    { id: "alex", name: "Alex Tran" },
    { id: "kim", name: "Kim Le" },
    { id: "robin", name: "Robin Park" },
    { id: "sam", name: "Sam Lee" },
]

/** A group room's head: `mark` takes a round `AvatarGroup layout="grid"` (the size of one Avatar, so the head keeps its height); 2, 3, 4 and 5+ members. */
export const GroupRoomHead: Story = {
    render: () => (
        <Matrix>
            {[2, 3, 4, 5].map((count) => (
                <State key={count} label={`${count} members`} direction="column">
                    <G.PaneHeader
                        title="Design team"
                        description={`${count} members`}
                        mark={<G.AvatarGroup label={`Design team, ${count} members`} layout="grid" items={roomMembers.slice(0, count)} overflowLabel={(hidden) => `${hidden} more members`} />}
                        actions={actions}
                    />
                </State>
            ))}
            <State label="Loading (same box)" direction="column">
                <G.PaneHeader
                    title="Design team"
                    description="5 members"
                    mark={<G.AvatarGroup label="Design team, 5 members" layout="grid" items={roomMembers} overflowLabel={(hidden) => `${hidden} more members`} />}
                    isLoading
                />
            </State>
        </Matrix>
    ),
}
