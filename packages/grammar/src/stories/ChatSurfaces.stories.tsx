import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import * as G from '../common/index.js';
import { noop } from './fixtures.js';

/**
 * THE CHAT SURFACES (law DNA-COMMON-CHAT-SURFACES). Every chat (team chat, an agent's chat, an inbox thread, the assistant) draws the same three faces: the
 * thread on the page tone (`--background`, the `ChatFrame` thread), a message of someone else (MessageBubble incoming, MessageCard) one flat look (`--surface`, no
 * border, no shadow), and the reader's own message `--accent` with `--accent-foreground`. The replies a card offers are one flat list, a pressable plain-text row
 * per reply with a chevron (`Section kind="list" layout="suggestions"`, law DNA-COMMON-CARD-SUGGESTIONS); the pills by the composer stay `Button size="sm"`.
 */
const meta: Meta = { title: 'Navigation & Data/Chat surfaces', parameters: { layout: 'fullscreen' } };
export default meta;
type Story = StoryObj;

const replies: readonly G.ListRowData[] = [
  { id: 'paid', title: 'Order ORD-0004 was paid in full, keep the extra $2 as a tip or refund it later', onPress: noop },
  { id: 'check', title: 'No payment yet for order ORD-0004, ask the customer to check the transfer details', onPress: noop },
  { id: 'fix', title: 'Fix the send-message tool, then let me rerun the reply step', onPress: noop },
];

const stopBody = (
  <G.Stack gap="row">
    <G.Text>Has order ORD-0004 been paid yet?</G.Text>
    <G.Section kind="list" layout="suggestions" ariaLabel="Suggested replies" empty={null} items={replies} />
    <G.Cluster gap="inline" align="end" wrap={false}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <G.Textarea label="Reply" isLabelHidden placeholder="Reply to the AI..." />
      </div>
      <G.Button variant="primary" startGlyph="send" onPress={noop}>Send</G.Button>
    </G.Cluster>
  </G.Stack>
);

const Thread = () => (
  <>
    <G.MessageBubble author="Maria" meta="09:12" avatar={<G.Avatar name="Maria" size="md" />} body="Hi, I have sent the payment." />
    <G.MessageCard
      measure="wide"
      author="Chatbot"
      avatar={<G.Avatar name="Chatbot" size="md" />}
      title="Workflow paused"
      chip={<G.Badge tone="accent">Needs your decision</G.Badge>}
      body={stopBody}
      actions={[
        { id: 'retry', label: 'Retry', onPress: noop },
        { id: 'take', label: 'Take over', onPress: noop },
        { id: 'skip', label: 'Skip', onPress: noop },
      ]}
      meta="Chatbot · Answer a question · 14:24"
    />
    <G.MessageBubble side="outgoing" meta="14:30" avatar={<G.Avatar name="You" size="md" />} body="Ok, let me check" />
  </>
);

const Composer = () => (
  <>
    <G.Cluster gap="inline" label="Suggestions">
      <G.Button variant="border" size="sm" onPress={noop}>What did you do today?</G.Button>
      <G.Button variant="border" size="sm" onPress={noop}>Is anything waiting for my approval?</G.Button>
    </G.Cluster>
    <G.Textarea label="Message" isLabelHidden placeholder="Type a message..." onSubmitShortcut={noop} />
  </>
);

const ChatPage = () => (
  <div style={{ height: 760 }}>
    <G.Page chrome="panes" header={{ breadcrumbs: { label: 'Path', items: [{ id: 'home', label: 'Overview', href: '#' }, { id: 'chat', label: 'Chat' }] } }}>
      <G.PaneGrid label="Chat" areas={{ base: ['room'], medium: ['list room'] }} columns={{ base: ['fill'], medium: ['compact', 'fill'] }}>
        <G.Pane area="list" surface label="Rooms">
          <G.PaneSection align="center"><G.PaneHeader title="Chat" /></G.PaneSection>
          <G.PaneSection><G.Text tone="muted">Chatbot</G.Text></G.PaneSection>
        </G.Pane>
        <G.Pane area="room" content="chat" label="Chatbot room">
          <G.ChatFrame label="Conversation" header={<G.PaneHeader title="Chatbot" description="Agent" mark={<G.Avatar name="Chatbot" size="md" />} />} footer={<Composer />}>
            <Thread />
          </G.ChatFrame>
        </G.Pane>
      </G.PaneGrid>
    </G.Page>
  </div>
);

/** The thread on the page tone, flat incoming messages and card, the accent own message, the card's replies as a flat list. */
export const ChatPane: Story = {
  render: () => <ChatPage />,
};

/** Outside a thread, on a white surface (a drawer of pinned messages), the bubble keeps its one look: the flat surface, the edge line, no shadow. */
export const BubblesOnWhite: Story = {
  render: () => (
    <G.Drawer title="Pinned messages" closeLabel="Close" isOpen onOpenChange={noop}>
      <G.Stack gap="row">
        <G.MessageBubble author="Maria" meta="09:12" body="Hi, I have sent the payment." />
        <G.MessageBubble side="outgoing" meta="09:14" body="Ok, let me check." />
      </G.Stack>
    </G.Drawer>
  ),
};

/** A chip and a quote in the reader's own message stay readable on the brand fill: the Badge is the inverse pair, the Quote the foreground tint. */
export const OwnBubbleChips: Story = {
  render: () => (
    <div style={{ padding: 24, maxWidth: 640 }}>
      <G.Stack gap="row">
        <G.MessageBubble author="Maria" meta="09:12" body="Can someone check order ORD-0004?" />
        <G.MessageBubble
          side="outgoing"
          meta="09:14"
          body={<G.Stack gap="identity"><G.Quote source="Maria" text="Can someone check order ORD-0004?" /><G.Cluster gap="identity"><G.Badge>@Sales AI</G.Badge><G.Text>please check the transfer</G.Text></G.Cluster></G.Stack>}
        />
      </G.Stack>
    </div>
  ),
};

const longPress = async (target: HTMLElement) => {
  target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
  await new Promise((resolve) => setTimeout(resolve, 520));
  target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
};

const TrayThread = () => {
  const [picked, setPicked] = useState<string | null>(null);
  const copy = <><G.IconButton glyph="pin" label="Pin" onPress={noop} /><G.IconButton glyph="more" label="More" onPress={noop} /></>;
  return (
    <div style={{ padding: 12, maxWidth: 720 }}>
      <G.Stack gap="row">
        <G.MessageBubble author="Maria" meta="09:12" avatar={<G.Avatar name="Maria" size="md" />} body="The order for table 4 moved to 19:30, and the kitchen has the new time for the first dish." />
        <G.MessageBubble id="tray-incoming" author="Sam" meta="09:13" avatar={<G.Avatar name="Sam" size="md" />} body="Thanks, noted." actions={copy} onReact={setPicked} onReply={noop} onShare={noop} />
        <G.MessageBubble side="outgoing" meta="09:14" body="I will confirm with the guests in a minute." />
        <G.MessageBubble id="tray-outgoing" side="outgoing" meta="09:15" body="Done." actions={copy} onReact={setPicked} onReply={noop} />
        {picked === null ? null : <G.Text role="body" tone="muted">{`Picked ${picked}`}</G.Text>}
      </G.Stack>
    </div>
  );
};

/**
 * The reaction toolbar and the message actions are ONE tray. From 48rem the toolbar floats above the bubble and the actions beside it, as
 * before. Below 48rem the tray is closed (hover opens nothing) until a long press on the bubble, then opens in the thread's flow above the
 * body: one bordered piece whose buttons wrap inside the row, so it never covers the bubble above and never runs past the row's edge.
 */
export const ReactionTray: Story = {
  render: () => <TrayThread />,
  play: async ({ canvasElement }) => {
    const message = canvasElement.querySelector<HTMLElement>('#tray-incoming')!;
    const tray = message.querySelector<HTMLElement>('[data-grammar-bubble-tray="true"]')!;
    await longPress(message.querySelector<HTMLElement>('.starci-core-message-bubble-body')!);
    tray.querySelector<HTMLElement>('button[aria-label="React with 👍"]')!.click();
    const own = canvasElement.querySelector<HTMLElement>('#tray-outgoing')!;
    await longPress(own.querySelector<HTMLElement>('.starci-core-message-bubble-body')!);
  },
};

/** A loading thread: the outgoing face is the brand's soft pair (`--accent-soft`, lines in its soft foreground), never the solid fill of a real message. */
export const LoadingThread: Story = {
  render: () => (
    <div style={{ padding: 24, maxWidth: 640 }}>
      <G.MessageBubble isLoading hasAvatar />
    </div>
  ),
};

/** A thread whose read failed: the band in the place of the messages, its retry the 40px control height at every width. */
export const FailedThread: Story = {
  render: () => (
    <div style={{ blockSize: '18rem' }}>
      <G.PaneGrid label="Failed chat" areas={{ base: ['chat'], medium: ['chat'] }} columns={{ base: ['fill'], medium: ['fill'] }} rows={{ base: ['fill'], medium: ['fill'] }}>
        <G.Pane area="chat" content="chat">
          <G.ChatFrame label="Conversation" header={<G.PaneHeader title="Chatbot" mark={<G.Avatar name="Chatbot" size="md" />} />}>
            <G.MessageBubble error={{ message: 'Could not load the messages', description: 'Check the connection, then try again.', actionLabel: 'Try again', onAction: noop }} />
          </G.ChatFrame>
        </G.Pane>
      </G.PaneGrid>
    </div>
  ),
};
