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
