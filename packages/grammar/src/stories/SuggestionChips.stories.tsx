import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import * as G from "../common/index.js"
import { Matrix, State, noop } from "./fixtures.js"

/* Quick replies and suggested questions: pill chips in a labelled toolbar; a press sends the chip's own label. */

const meta: Meta = { title: "Navigation & Data/Suggestion chips" }
export default meta
type Story = StoryObj

const questions: ReadonlyArray<G.SuggestionChip> = [
    { id: "hours", label: "What are your opening hours?" },
    { id: "price", label: "How much does it cost?" },
    { id: "book", label: "Book a visit" },
    { id: "human", label: "Talk to a person" },
]

const withGlyphs: ReadonlyArray<G.SuggestionChip> = [
    { id: "search", label: "Search my notes", glyph: "search" },
    { id: "write", label: "Write a reply", glyph: "pencil" },
    { id: "upload", label: "Summarise a file", glyph: "upload" },
    { id: "new", label: "New chat", glyph: "plus" },
]

const Asked = ({ items, isDisabled }: { readonly items: ReadonlyArray<G.SuggestionChip>; readonly isDisabled?: boolean }) => {
    const [sent, setSent] = useState<string>("")
    return (
        <G.Stack gap="row">
            <G.SuggestionChips label="Suggested questions" items={items} onSelect={(id) => setSent(items.find((item) => item.id === id)?.label ?? "")} {...(isDisabled === true ? { isDisabled: true } : {})} />
            <G.Text tone="muted">{sent === "" ? "Nothing sent yet." : `Sent: ${sent}`}</G.Text>
        </G.Stack>
    )
}

export const Default: Story = { render: () => <Asked items={questions} /> }

export const WithGlyphs: Story = {
    render: () => <G.SuggestionChips label="Quick actions" items={withGlyphs} onSelect={noop} />,
}

export const VisibleLabel: Story = {
    render: () => <G.SuggestionChips label="Try asking" isLabelHidden={false} items={questions} onSelect={noop} />,
}

export const NarrowColumn: Story = {
    render: () => (
        <div style={{ maxWidth: 280 }}>
            <G.SuggestionChips label="Suggested questions" items={[...questions, ...withGlyphs]} onSelect={noop} />
        </div>
    ),
}

export const States: Story = {
    render: () => (
        <Matrix>
            <State label="Ready" direction="column"><G.SuggestionChips label="Suggested questions" items={questions} onSelect={noop} /></State>
            <State label="One chip disabled" direction="column"><G.SuggestionChips label="Suggested questions" items={questions.map((item, index) => (index === 1 ? { ...item, isDisabled: true } : item))} onSelect={noop} /></State>
            <State label="Disabled" direction="column"><G.SuggestionChips label="Suggested questions" items={questions} onSelect={noop} isDisabled /></State>
            <State label="Loading (the chips given as pill geometry)" direction="column"><G.SuggestionChips label="Suggested questions" items={questions} onSelect={noop} isLoading /></State>
            <State label="Loading with no data (three pills)" direction="column"><G.SuggestionChips label="Suggested questions" items={[]} onSelect={noop} isLoading /></State>
        </Matrix>
    ),
}

/* An empty state's shortcuts: the notice says what is empty, the chips start the first thing. */
export const InEmptyShortcut: Story = {
    render: () => (
        <G.Stack gap="row">
            <G.EmptyNotice message="Ask anything about your workspace" description="Pick a question to start, or type your own." />
            <G.SuggestionChips label="Ways to start" items={withGlyphs} onSelect={noop} />
        </G.Stack>
    ),
}
