import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
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
        <G.MessageBubble author="Linh" meta="09:12" avatar={<G.Avatar name="Linh" size="sm" />} body="Can the order for table 4 move to 19:30?" />
        <G.MessageBubble side="outgoing" meta="09:14" body="Yes, I moved it." />
    </>
)

/** A chat pane: the PaneHeader band ends in one full-width separator above the thread. */
export const ChatPaneHeadLine: Story = {
    render: () => (
        <div style={{ blockSize: "22rem" }}>
            <G.PaneGrid label="Chat" areas={{ base: ["chat"], medium: ["chat"] }} columns={{ base: ["fill"], medium: ["fill"] }} rows={{ base: ["fill"], medium: ["fill"] }}>
                <G.Pane area="chat" surface>
                    <G.PaneSection align="center">
                        <G.PaneHeader title="Support agent" description="Replies in a minute" mark={<G.Avatar name="Support agent" size="sm" />} />
                    </G.PaneSection>
                    <G.PaneSection scroll={{ label: "Conversation", role: "log", align: "end" }}>{thread}</G.PaneSection>
                </G.Pane>
            </G.PaneGrid>
        </div>
    ),
}

const actions: ReadonlyArray<G.MessageCardAction> = [
    { id: "open", kind: "open", label: "Mở đơn hàng", onPress: noop },
    { id: "snooze", label: "Để sau", onPress: noop },
    { id: "approve", kind: "primary", label: "Duyệt", onPress: noop },
]

/** MessageCard: title and chip, then the body or key/value details, then the actions (primary first, the "Mở ..." arrow last), then the meta line. Capped at the bubble measure, avatar at the start. */
export const MessageCards: Story = {
    render: () => (
        <div style={{ display: "grid", gap: "0.75rem", maxWidth: "64rem" }}>
            <G.MessageBubble author="Linh" meta="09:12" avatar={<G.Avatar name="Linh" size="sm" />} body="Can you check the order for table 4?" />
            <G.MessageCard
                author="Agent"
                avatar={<G.Avatar name="Agent" size="sm" />}
                title="Đơn hàng #1042 chờ duyệt"
                chip={<G.Badge tone="warning">Chờ duyệt</G.Badge>}
                body="Khách đặt bàn 4 lúc 19:30, bếp cần giờ mới trước khi món đầu tiên vào."
                actions={actions}
                meta="Sales · 04:38"
            />
            <G.MessageCard
                measure="wide"
                author="Agent"
                avatar={<G.Avatar name="Agent" size="sm" />}
                title="Đặt bàn 4"
                chip={<G.Badge>Mới</G.Badge>}
                details={[{ id: "time", term: "Giờ", description: "19:30" }, { id: "guests", term: "Khách", description: "4 người" }, { id: "owner", term: "Phụ trách", description: "Linh" }]}
                actions={actions}
                meta="Sales · 04:40"
            />
        </div>
    ),
}

/** An EmptyNotice in a thread (a chat scroll band) is centred words with no fill, border or shadow. */
export const EmptyNoticeInThread: Story = {
    render: () => (
        <div style={{ blockSize: "18rem" }}>
            <G.PaneGrid label="Empty chat" areas={{ base: ["chat"], medium: ["chat"] }} columns={{ base: ["fill"], medium: ["fill"] }} rows={{ base: ["fill"], medium: ["fill"] }}>
                <G.Pane area="chat">
                    <G.PaneSection scroll={{ label: "Conversation", role: "log", align: "center" }}>
                        <G.EmptyNotice message="No messages yet" description="Say hello to start the conversation." />
                    </G.PaneSection>
                </G.Pane>
            </G.PaneGrid>
        </div>
    ),
}
