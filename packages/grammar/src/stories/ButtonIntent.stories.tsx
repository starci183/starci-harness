import type { Meta, StoryObj } from "@storybook/react-vite"
import type { ReactNode } from "react"
import * as G from "../common/index.js"
import { BellGlyph, Matrix, State, TrashGlyph, familyScope, noop } from "./fixtures.js"

const meta: Meta = { title: "Primitives/Button intent" }
export default meta
type Story = StoryObj

const actions = (
    <>
        <G.Button intent="dismiss">Cancel</G.Button>
        <G.Button intent="neutral">Details</G.Button>
        <G.Button intent="alternative">Review</G.Button>
        <G.Button intent="commit">Save</G.Button>
        <G.Button intent="destructive" step="entry">Delete…</G.Button>
        <G.Button intent="destructive" step="confirm">Delete permanently</G.Button>
    </>
)

const glyphActions = (
    <>
        <G.IconButton intent="dismiss" source={BellGlyph} label="Dismiss notifications" />
        <G.IconButton intent="neutral" source={BellGlyph} label="Notifications" />
        <G.IconButton intent="alternative" source={BellGlyph} label="Review notifications" />
        <G.IconButton intent="commit" source={BellGlyph} label="Save notifications" />
        <G.IconButton intent="destructive" step="entry" source={TrashGlyph} label="Remove unsaved row" />
    </>
)

/** Static mapping census; application confirms use the AlertDialog story below. */
const IntentMatrix = ({ scope, theme }: { readonly scope: { readonly "data-grammar-family"?: string }; readonly theme: "light" | "dark" }) => (
    <G.GrammarRoot {...scope} theme={theme}>
        <Matrix>
            <State label={`${theme}: decision`}>{actions}{glyphActions}</State>
            <G.CollectionItem>
                <State label={`${theme}: item (a repeated next action resolves secondary)`}>{actions}{glyphActions}</State>
            </G.CollectionItem>
            <G.ToolbarActions>
                <State label={`${theme}: toolbar / panel header`}>{actions}{glyphActions}</State>
            </G.ToolbarActions>
            <G.TopBar position="static" brand={<G.Text>Navbar</G.Text>} actions={
                <G.IconButton intent="neutral" size="control" source={BellGlyph} label="Navbar notifications" />
            } />
        </Matrix>
    </G.GrammarRoot>
)

/** Every intent in decision, item and chrome, with both theme scopes visible together. */
export const EveryPlacement: Story = {
    render: (_, { globals }) => (
        <Matrix>
            <IntentMatrix scope={familyScope(globals)} theme="light" />
            <IntentMatrix scope={familyScope(globals)} theme="dark" />
        </Matrix>
    ),
}

const item = (children: ReactNode) => <G.CollectionItem>{children}</G.CollectionItem>

/** The overlay starts a new decision scope even when its entry belongs to a collection item. */
export const DestructiveConfirmation: Story = {
    render: () => item(
        <G.AlertDialog title="Delete the stored record?" description="This permanently removes the stored record."
            cancelLabel="Cancel" confirmLabel="Delete permanently" onConfirm={noop}
            trigger={<G.Button intent="destructive" step="entry">Delete record…</G.Button>} />,
    ),
}

export const DestinationAndStates: Story = {
    render: () => (
        <Matrix>
            <State label="Destinations follow the same intent"><G.Button intent="commit" href="#next">Continue</G.Button><G.Button intent="dismiss" href="#back">Back</G.Button></State>
            <State label="Action state is independent of intent"><G.Button intent="commit" isPending>Saving</G.Button><G.Button intent="dismiss" isDisabled>Cancel</G.Button><G.Button intent="neutral" isSkeleton>Details</G.Button></State>
            <G.ItemActions><State label="Custom row action slot"><G.Button intent="neutral">Details</G.Button><G.IconButton intent="destructive" step="entry" source={TrashGlyph} label="Remove unsaved row" /></State></G.ItemActions>
        </Matrix>
    ),
}
