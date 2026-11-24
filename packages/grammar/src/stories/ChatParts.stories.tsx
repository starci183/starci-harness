import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState, type ReactNode } from "react"
import * as G from "../common/index.js"
import { noop } from "./fixtures.js"

/*
 * Chat and pane-tab parts (0.31.0): a Tabs strip that ends a pane band stands on the band's one full-width line; a chat pane's head
 * band ends in one separator above the thread; MessageCard is an agent's rich message capped at the bubble measure; an EmptyNotice
 * inside a thread has no card surface.
 */

const meta: Meta = { title: "Navigation & Data/Chat parts" }
export default meta
type Story = StoryObj

const regionTabs = [{ id: "all", label: "All" }, { id: "open", label: "Open" }, { id: "done", label: "Done" }] as const

const TabsPaneDemo = () => {
    const [key, setKey] = useState("all")
    return (
        <div style={{ blockSize: "16rem" }}>
            <G.PaneGrid label="Tabs in panes" areas={{ base: ["top", "bottom"], medium: ["top", "bottom"] }} columns={{ base: ["fill"], medium: ["fill"] }} rows={{ base: ["auto", "fill"], medium: ["auto", "fill"] }}>
                <G.Pane area="top" surface>
                    <G.PaneSection>
                        <G.Tabs label="Regions" items={regionTabs} selectedKey={key} onSelect={setKey} />
                    </G.PaneSection>
                </G.Pane>
                <G.Pane area="bottom" surface>
                    <G.PaneSection><G.Text tone="muted">The pane below: its border is the strip's line, not a second one.</G.Text></G.PaneSection>
                </G.Pane>
            </G.PaneGrid>
        </div>
    )
}

/** A Tabs strip as the last content of a PaneSection: the band hosts the line, full pane width, nothing under it, no doubled border. */
export const PaneTabsLine: Story = { render: () => <TabsPaneDemo /> }

const thread = (
    <>
        <G.MessageBubble author="Maria" meta="09:12" avatar={<G.Avatar name="Maria" size="md" />} body="Can the order for table 4 move to 19:30?" />
        <G.MessageBubble side="outgoing" meta="09:14" avatar={<G.Avatar name="You" size="md" />} body="Yes, I moved it." />
    </>
)

/** A chat pane: the frame's header ends in one full-width separator above the thread. */
export const ChatPaneHeadLine: Story = {
    render: () => (
        <div style={{ blockSize: "22rem" }}>
            <G.PaneGrid label="Chat" areas={{ base: ["chat"], medium: ["chat"] }} columns={{ base: ["fill"], medium: ["fill"] }} rows={{ base: ["fill"], medium: ["fill"] }}>
                <G.Pane area="chat" content="chat">
                    <G.ChatFrame label="Conversation" header={<G.PaneHeader title="Support agent" description="Replies in a minute" mark={<G.Avatar name="Support agent" size="md" />} />}>{thread}</G.ChatFrame>
                </G.Pane>
            </G.PaneGrid>
        </div>
    ),
}

const actions: ReadonlyArray<G.MessageCardAction> = [
    { id: "open", kind: "open", label: "Open order", onPress: noop },
    { id: "snooze", label: "Later", onPress: noop },
    { id: "approve", kind: "primary", label: "Approve", onPress: noop },
]

/** MessageCard: title and chip, then the body or key/value details, then the actions (primary first, the "Open ..." arrow last), then the meta line. Capped at the bubble measure, avatar at the start. */
export const MessageCards: Story = {
  parameters: { grammar: { catalog: true } },
    render: () => (
        <div style={{ display: "grid", gap: "0.75rem", maxWidth: "64rem" }}>
            <G.MessageBubble author="Maria" meta="09:12" avatar={<G.Avatar name="Maria" size="md" />} body="Can you check the order for table 4?" />
            <G.MessageCard
                author="Agent"
                avatar={<G.Avatar name="Agent" size="md" />}
                title="Order #1042 awaiting approval"
                chip={<G.Badge tone="warning">Pending</G.Badge>}
                body="The customer booked table 4 at 19:30; the kitchen needs the new time before the first dish."
                actions={actions}
                meta="Sales · 04:38"
            />
            <G.MessageCard
                measure="wide"
                author="Agent"
                avatar={<G.Avatar name="Agent" size="md" />}
                title="Table 4 booking"
                chip={<G.Badge>New</G.Badge>}
                details={[{ id: "time", term: "Time", description: "19:30" }, { id: "guests", term: "Guests", description: "4 people" }, { id: "owner", term: "Owner", description: "Maria" }]}
                actions={actions}
                meta="Sales · 04:40"
            />
        </div>
    ),
}

/** An EmptyNotice in a thread (the chat frame's thread) is words with no fill, border or shadow. */
export const EmptyNoticeInThread: Story = {
    render: () => (
        <div style={{ blockSize: "18rem" }}>
            <G.PaneGrid label="Empty chat" areas={{ base: ["chat"], medium: ["chat"] }} columns={{ base: ["fill"], medium: ["fill"] }} rows={{ base: ["fill"], medium: ["fill"] }}>
                <G.Pane area="chat" content="chat">
                    <G.ChatFrame label="Conversation" header={<G.PaneHeader title="Support agent" mark={<G.Avatar name="Support agent" size="md" />} />}>
                        <G.EmptyNotice message="No messages yet" description="Say hello to start the conversation." />
                    </G.ChatFrame>
                </G.Pane>
            </G.PaneGrid>
        </div>
    ),
}

/** Messenger grouping (0.32.0): a lone bubble is fully rounded; in a run the touching corners square to 4; the avatar sits beside the last bubble; outgoing mirrors on the end side. */
export const BubbleGrouping: Story = {
    render: () => (
        <div style={{ display: "grid", gap: "0.25rem", maxWidth: "40rem" }}>
            <G.MessageBubble groupPosition="single" body="A lone bubble: fully rounded." avatar={<G.Avatar name="Maria" size="md" />} />
            <div style={{ display: "grid", gap: "0.125rem", marginBlockStart: "0.75rem" }}>
                <G.MessageBubble groupPosition="first" author="Maria" meta="09:12" body="First of a run." avatar={<G.Avatar name="Maria" size="md" />} />
                <G.MessageBubble groupPosition="middle" body="Middle: both start corners squared." avatar={<G.Avatar name="Maria" size="md" />} />
                <G.MessageBubble groupPosition="last" body="Last: the avatar sits beside it." avatar={<G.Avatar name="Maria" size="md" />} />
            </div>
            <div style={{ display: "grid", gap: "0.125rem", marginBlockStart: "0.75rem" }}>
                <G.MessageBubble side="outgoing" groupPosition="first" body="Outgoing first." />
                <G.MessageBubble side="outgoing" groupPosition="middle" body="Outgoing middle." />
                <G.MessageBubble side="outgoing" groupPosition="last" body="Outgoing last." />
            </div>
        </div>
    ),
}

const ReactionsDemo = () => {
    const [reactions, setReactions] = useState<ReadonlyArray<G.MessageReaction>>([{ emoji: "❤️", count: 3, mine: 1 }, { emoji: "👍", count: 2, mine: false }])
    const react = (emoji: string) => setReactions((current) => {
        const found = current.find((reaction) => reaction.emoji === emoji)
        if (found === undefined) return [...current, { emoji, count: 1, mine: 1 }]
        return current.map((reaction) => reaction.emoji === emoji ? { ...reaction, count: reaction.count + 1, mine: (typeof reaction.mine === "number" ? reaction.mine : reaction.mine ? 1 : 0) + 1 } : reaction)
    })
    return (
        <div style={{ display: "grid", gap: "2.5rem", maxWidth: "40rem", paddingBlock: "3rem" }}>
            <G.MessageBubble author="Maria" avatar={<G.Avatar name="Maria" size="md" />} body="Hover (or long-press) for the toolbar; press the pill to add one more." reactions={reactions} onReact={react} onReply={noop} onShare={noop} />
            <G.MessageBubble side="outgoing" body="Outgoing: the pill sits on the start corner." reactions={reactions} onReact={react} onReply={noop} />
            <G.MessageCard author="Agent" avatar={<G.Avatar name="Agent" size="md" />} title="Order #1042" body="The same lifted card with the same pill." reactions={reactions} onReact={react} onShare={noop} />
        </div>
    )
}

/** ReactionBar (hover or long-press: six emoji, reply, share; arrow keys), ReactionPill (up to three emoji and the total; pressing adds the viewer's top reaction) and the burst. */
export const Reactions: Story = { render: () => <ReactionsDemo /> }

const replyBody = (strip: ReactNode, words: string) => (
    <G.Stack gap="inline">
        {strip}
        <G.Text role="body">{words}</G.Text>
    </G.Stack>
)

/**
 * ReplyStrip (0.55.1): the message an answer replies to, one line at the top inside the answer's bubble. A person's in the neutral tone, an agent's in the app's
 * tone slot, on the reader's own brand face; the long one is cut with an ellipsis. Pressing one takes the reader to the original.
 */
export const ReplyStrips: Story = {
    render: () => (
        <div style={{ display: "grid", gap: "0.75rem", maxWidth: "40rem" }}>
            <G.MessageBubble
                author="Mạng xã hội"
                isAgent
                agentLabel="Agent"
                avatar={<G.Avatar name="Mạng xã hội" kind="agent" size="md" />}
                body={replyBody(<G.ReplyStrip author="Lan Nguyễn" text="Bài đăng hôm qua có bao nhiêu lượt thích vậy em, chị cần số liệu để báo cáo cho sếp trước 5 giờ chiều nay" label="Trả lời tin của Lan Nguyễn" onPress={noop} />, "Dạ, bài hôm qua có 1.240 lượt thích ạ.")}
            />
            <G.MessageBubble
                author="Chăm sóc khách"
                isAgent
                agentLabel="Agent"
                avatar={<G.Avatar name="Chăm sóc khách" kind="agent" size="md" />}
                body={replyBody(<G.ReplyStrip author="Mạng xã hội" text="Em vừa đăng bài khuyến mãi tuần này." tone={{ soft: "oklch(95% 0.03 300)", ink: "oklch(45% 0.15 300)" }} label="Trả lời tin của Mạng xã hội" onPress={noop} />, "Em sẽ nhắn khách cũ về bài này.")}
            />
            <G.MessageBubble side="outgoing" body={replyBody(<G.ReplyStrip author="Chăm sóc khách" text="Em sẽ nhắn khách cũ về bài này." tone={{ soft: "oklch(95% 0.03 255)", ink: "oklch(45% 0.15 255)" }} label="Trả lời tin của Chăm sóc khách" onPress={noop} />, "Ok em, gửi trước 6 giờ nhé.")} />
        </div>
    ),
}

const CHOICE_OPTIONS = [
    { value: "one", label: "Số liệu một bài đăng", hint: "xong 21:19" },
    { value: "round", label: "Vòng số liệu hằng ngày", hint: "xong 06:00" },
    { value: "video", label: "Video ngắn", hint: "đang chạy" },
    { value: "compose", label: "Soạn bài" },
] as const

const ChoiceCardDemo = (props: { readonly destructive?: boolean }) => {
    const [chosen, setChosen] = useState<string | null>(null)
    const options = CHOICE_OPTIONS.map((option) => ({ ...option, ...(props.destructive === true ? { isDestructive: true } : {}) }))
    return (
        <G.MessageBubble
            author="Mạng xã hội"
            isAgent
            agentLabel="Agent"
            avatar={<G.Avatar name="Mạng xã hội" kind="agent" size="md" />}
            content="card"
            measure="wide"
            body={
                <G.ChoiceCard
                    question={props.destructive === true ? "Bạn muốn dừng việc nào?" : "Bạn đang hỏi việc nào?"}
                    options={options}
                    other={{ label: "Việc khác…", onPress: noop }}
                    chosen={chosen}
                    onChoose={setChosen}
                    labels={{ confirm: (label) => `Bấm lần nữa để dừng: ${label}` }}
                />
            }
        />
    )
}

/**
 * ChoiceCard (owner 2026-11-23): a clarifying question with its answers as ONE card: the question on top, the answers as cells separated by hairlines, a long
 * one on its own row, two short ones to a row, "Việc khác…" last. Choosing one fills it with the accent soft pair and the check and closes the card. A destructive
 * answer is the danger ink only and asks once more.
 */
export const ChoiceCards: Story = {
    render: () => (
        <div style={{ display: "grid", gap: "0.75rem", maxWidth: "40rem" }}>
            <ChoiceCardDemo />
            <ChoiceCardDemo destructive />
            <G.MessageBubble
                author="Mạng xã hội"
                isAgent
                agentLabel="Agent"
                avatar={<G.Avatar name="Mạng xã hội" kind="agent" size="md" />}
                content="card"
                measure="wide"
                body={<G.ChoiceCard question="Bạn đang hỏi việc nào?" options={CHOICE_OPTIONS} other={{ label: "Việc khác…", onPress: noop }} chosen="one" />}
            />
        </div>
    ),
}
