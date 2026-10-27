import type { Meta, StoryObj } from "@storybook/react-vite"
import * as G from "../common/index.js"
import { GroupGlyph } from "./fixtures.js"

const meta: Meta = { title: "Navigation & Data/Panel list" }
export default meta
type Story = StoryObj

const sections: ReadonlyArray<G.ListBoxSection> = [
    { id: "recent", label: "Recent conversations", items: [
        { id: "mina", label: "Mina Nguyen", description: "See you tomorrow" },
        { id: "team", label: "Design team", description: "New member joined" },
    ] },
    { id: "earlier", label: "Earlier", items: [{ id: "alex", label: "Alex Tran", description: "Thanks for the update" }] },
]

/** The field, tabs and list boxes share an edge; content keeps the vendor's padding. */
export const SectionedPanel: Story = {
    render: () => (
        <G.SurfaceCard ariaLabel="Conversations">
            <G.Heading level={2}>Conversations</G.Heading>
            <G.SearchField label="Find a conversation" />
            <G.Tabs label="Conversation views" selectedKey="all" items={[{ id: "all", label: "All" }, { id: "unread", label: "Unread" }]} />
            <G.ListBox label="Conversations" sections={sections} selectionMode="single" defaultSelectedIds={["team"]} />
        </G.SurfaceCard>
    ),
}

export const LoadingPanel: Story = {
    render: () => (
        <G.SurfaceCard ariaLabel="Loading conversations">
            <G.Heading level={2}>Conversations</G.Heading>
            <G.ListBox label="Conversations" items={[]} isLoading />
        </G.SurfaceCard>
    ),
}

export const ExplicitPanelInset: Story = {
    render: () => <G.ListBox label="Conversation picker" sections={sections} inset="panel" />,
}

/** The default inset retains HeroUI's list and item padding, including inside a surface. */
export const ExplicitDefaultInset: Story = {
    render: () => (
        <G.SurfaceCard ariaLabel="Default inset conversations">
            <G.Heading level={2}>Conversations</G.Heading>
            <G.ListBox label="Conversation picker" sections={sections} inset="default" />
        </G.SurfaceCard>
    ),
}

export const EmptyPanel: Story = {
    render: () => (
        <G.SurfaceCard ariaLabel="Empty conversations">
            <G.Heading level={2}>Conversations</G.Heading>
            <G.ListBox label="Conversations" items={[]} emptyContent="No conversations yet." />
        </G.SurfaceCard>
    ),
}

/** A scroll parent cannot clip away row padding because the list never bleeds outside its box. */
export const ScrollingIdentityColumns: Story = {
    render: () => (
        <G.SurfaceCard ariaLabel="Conversation identities">
            <G.Heading level={2}>Conversation identities</G.Heading>
            <G.SearchField label="Find a conversation" />
            <G.NavLandmark label="Conversation list" layout="scrolling" style={{ maxHeight: "8rem", overflowY: "auto", alignItems: "start" }}>
                <G.ListBox label="Conversations" inset="panel" defaultSelectedIds={["group"]} items={[
                    { id: "group", label: "Design team", description: "A 40px group identity", leading: <G.AvatarGroup label="Design team" layout="grid" items={[{ id: "mina", name: "Mina Nguyen" }, { id: "alex", name: "Alex Tran" }, { id: "kim", name: "Kim Le" }, { id: "robin", name: "Robin Park" }]} overflowLabel={(count) => `${count} more members`} /> },
                    { id: "person", label: "Mina Nguyen", description: "A smaller avatar in the same column", leading: <G.Avatar name="Mina Nguyen" size="sm" /> },
                    { id: "icon", label: "Pinned conversations", description: "A glyph in the same column", leading: <G.Icon source={GroupGlyph} usage="leading" /> },
                ]} />
            </G.NavLandmark>
        </G.SurfaceCard>
    ),
}

/** Each row's identity content is centred within the size selected by its list. */
export const LeadingSlotSizes: Story = {
    render: () => (
        <>
            {(["sm", "md", "lg"] as const).map((size) => (
                <G.ListBox key={size} label={`${size} identity slots`} size={size} items={[
                    { id: "person", label: "Mina Nguyen", leading: <G.Avatar name="Mina Nguyen" size={size} /> },
                    { id: "glyph", label: "Pinned conversations", leading: <G.Icon source={GroupGlyph} usage="leading" /> },
                ]} />
            ))}
        </>
    ),
}

/** owner:item-description-one-line: the same preview defaults to one line and can opt into two or three. */
export const PreviewLinesAndUnread: Story = {
    render: () => (
        <G.NavLandmark label="Preview line limits" layout="scrolling" style={{ width: "20rem", maxWidth: "100%" }}>
            <G.ListBox label="Conversation previews" defaultSelectedIds={["unread"]} items={[
                { id: "read", label: "Read conversation with a long title that ends in an ellipsis", description: "Mina: Review the project notes and shared decisions before the meeting tomorrow morning. This preview keeps its full accessible text." },
                { id: "unread", label: "Unread conversation", emphasis: "unread", description: "Alex: Review the project notes and shared decisions before the meeting tomorrow morning. This preview keeps its full accessible text.", trailing: <G.Badge tone="danger">5+</G.Badge> },
                { id: "one", label: "Explicit one line", descriptionLines: 1, description: "One line is also an explicit choice. Review the project notes and shared decisions before the meeting tomorrow morning." },
                { id: "two", label: "Two-line preview", descriptionLines: 2, description: "Two lines are available for a longer summary. Review the project notes and shared decisions before the meeting tomorrow morning. Remaining content ends in an ellipsis." },
                { id: "three", label: "Three-line preview", descriptionLines: 3, description: "Three lines are the largest preview. Review the project notes and shared decisions before the meeting tomorrow morning. Additional text stays in the accessible description while the visible preview ends in an ellipsis." },
            ]} />
        </G.NavLandmark>
    ),
}
