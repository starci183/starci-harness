import type { Meta, StoryObj } from "@storybook/react-vite"
import * as G from "../common/index.js"
import { BookGlyph, HomeGlyph, Matrix, State } from "./fixtures.js"

/** The toolbar applies the selected family's root and packaged stylesheet to every description slot. */
const meta: Meta = { title: "Navigation & Data/Item descriptions" }
export default meta
type Story = StoryObj

const description = "Review the project conversations, shared files and recent decisions before choosing the next step. This longer description keeps its complete accessible text while the visible preview ends with an ellipsis at the selected line count."

const menuEntries: ReadonlyArray<G.DropdownMenuItem> = [
    { id: "default", label: "Default: one line", description, iconSource: HomeGlyph },
    { id: "one", label: "Explicit one line", description, descriptionLines: 1, iconSource: BookGlyph },
    { id: "two", label: "Two lines", description, descriptionLines: 2, iconSource: BookGlyph },
    { id: "three", label: "Three lines", description, descriptionLines: 3, iconSource: BookGlyph },
]

export const Menu: Story = {
    parameters: { grammar: { minHeight: "38rem" } },
    render: () => (
        <Matrix maxWidth={300}>
            <State label="Vendor menu description slots: default, one, two and three lines" direction="column">
                <G.DropdownMenu trigger={<G.Button>Project actions</G.Button>} entries={menuEntries} defaultOpen />
            </State>
        </Matrix>
    ),
}

export const Sidebar: Story = {
    render: () => (
        <Matrix maxWidth={300}>
            <State label="Expanded item descriptions; counts retain their announcements" direction="column">
                <G.Sidebar label="Project navigation" groups={[{ id: "project", items: [
                    { id: "default", label: "Default: one line", description, source: HomeGlyph, badge: 3, badgeLabel: "3 unread conversations" },
                    { id: "one", label: "Explicit one line", description, descriptionLines: 1, source: BookGlyph },
                    { id: "two", label: "Two lines", description, descriptionLines: 2, source: BookGlyph },
                    { id: "three", label: "Three lines", description, descriptionLines: 3, source: BookGlyph },
                    { id: "plain", label: "Label without a description", source: BookGlyph },
                ] }]} />
            </State>
            <State label="Collapsed items retain labels and count tooltips" direction="column">
                <G.Sidebar label="Collapsed project navigation" isCollapsed groups={[{ id: "project", items: [
                    { id: "default", label: "Project conversations", description, source: HomeGlyph, badge: 3, badgeLabel: "3 unread conversations" },
                    { id: "three", label: "Shared files", description, descriptionLines: 3, source: BookGlyph },
                ] }]} />
            </State>
        </Matrix>
    ),
}

export const Select: Story = {
    render: () => (
        <Matrix maxWidth={300}>
            <State label="Open the list to compare option descriptions" direction="column">
                <G.Select label="Project destination" placeholder="Choose a destination" options={[
                    { id: "default", label: "Default: one line", description },
                    { id: "one", label: "Explicit one line", description, descriptionLines: 1 },
                    { id: "two", label: "Two lines", description, descriptionLines: 2 },
                    { id: "three", label: "Three lines", description, descriptionLines: 3 },
                ]} />
            </State>
        </Matrix>
    ),
}
