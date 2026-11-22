import type { Meta, StoryObj } from "@storybook/react-vite"
import * as G from "../common/index.js"
import { BellGlyph, Matrix, State, TrashGlyph, familyScope, noop } from "./fixtures.js"

const meta: Meta = { title: "Leaves/Button variant" }
export default meta
type Story = StoryObj

/** The three looks (owner 2026-11-22: "chỉ có danger, border, và primary thôi"): one primary, every other action border, a destruction danger. */
const actions = (
    <>
        <G.Button variant="primary">Save</G.Button>
        <G.Button variant="border">Cancel</G.Button>
        <G.Button>Details</G.Button>
        <G.Button variant="danger">Delete</G.Button>
    </>
)

const glyphActions = (
    <>
        <G.IconButton variant="primary" source={BellGlyph} label="Save notifications" />
        <G.IconButton source={BellGlyph} label="Notifications" />
        <G.IconButton label="Close" />
        <G.IconButton variant="danger" source={TrashGlyph} label="Remove row" />
    </>
)

/** Tones colour a primary only: the action of a toned notice, solid in its tone. */
const tonedPrimaries = (
    <>
        <G.Button variant="primary" tone="info">Info</G.Button>
        <G.Button variant="primary" tone="success">Success</G.Button>
        <G.Button variant="primary" tone="warning">Warning</G.Button>
        <G.Button variant="primary" tone="accent">Accent</G.Button>
    </>
)

/** A theme scope: the mode is `.dark` (or `data-theme`) on an ancestor, as HeroUI reads it; GrammarRoot takes no theme. */
const VariantMatrix = ({ scope, theme }: { readonly scope: { readonly "data-grammar-family"?: string }; readonly theme: "light" | "dark" }) => (
    <div className={theme} data-theme={theme} style={{ padding: "1rem", borderRadius: "0.75rem", background: "var(--background)", color: "var(--foreground)" }}>
    <G.GrammarRoot {...scope}>
        <Matrix>
            <State label={`${theme}: the three looks`}>{actions}{glyphActions}</State>
            <State label={`${theme}: a toned primary`}>{tonedPrimaries}</State>
            <G.TopBar position="static" brand={<G.Text>Navbar</G.Text>} actions={
                <G.IconButton source={BellGlyph} label="Navbar notifications" />
            } />
        </Matrix>
    </G.GrammarRoot>
    </div>
)

/** Every look, in both theme scopes together. */
export const EveryVariant: Story = {
  parameters: { grammar: { catalog: true } },
    render: (_, { globals }) => (
        <Matrix>
            <VariantMatrix scope={familyScope(globals)} theme="light" />
            <VariantMatrix scope={familyScope(globals)} theme="dark" />
        </Matrix>
    ),
}

/** A destruction is danger at its entry and at its confirm. */
export const DestructiveConfirmation: Story = {
    render: () => (
        <G.AlertDialog title="Delete the stored record?" description="This permanently removes the stored record."
            cancelLabel="Cancel" confirmLabel="Delete permanently" onConfirm={noop}
            trigger={<G.Button variant="danger">Delete record…</G.Button>} />
    ),
}

export const DestinationAndStates: Story = {
  parameters: { grammar: { catalog: true } },
    render: () => (
        <Matrix>
            <State label="Destinations take the same looks"><G.Button variant="primary" href="#next">Continue</G.Button><G.Button href="#back">Back</G.Button></State>
            <State label="Action state is independent of the look"><G.Button variant="primary" isPending>Saving</G.Button><G.Button isDisabled>Cancel</G.Button><G.Button isLoading>Details</G.Button></State>
        </Matrix>
    ),
}
