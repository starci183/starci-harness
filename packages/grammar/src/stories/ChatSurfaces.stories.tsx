import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, waitFor } from 'storybook/test';
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

/** Resolve a theme token to the computed colour the browser paints, beside the element that should paint it. */
const tokenColour = (host: Element, token: string): string => {
  const probe = document.createElement('div');
  probe.style.backgroundColor = `var(${token})`;
  host.appendChild(probe);
  const colour = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return colour;
};

/** The thread on the page tone, flat incoming messages and card, the accent own message, the card's replies as a flat list. */
export const ChatPane: Story = {
  render: () => <ChatPage />,
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('[data-component="MessageCard"]')).not.toBeNull());
    const thread = canvasElement.querySelector<HTMLElement>('.starci-core-chat-frame-thread')!;
    expect(thread.getAttribute('data-grammar-scroll-region-tone')).toBe('background');
    expect(getComputedStyle(thread).backgroundColor).toBe(tokenColour(thread, '--background'));

    const incoming = [...canvasElement.querySelectorAll<HTMLElement>('.starci-core-message-bubble:is([data-grammar-bubble-side="incoming"], [data-grammar-bubble-content="card"]) > .starci-core-message-bubble-stack > .starci-core-message-bubble-body')];
    expect(incoming.length).toBe(2);
    for (const face of incoming) {
      const style = getComputedStyle(face);
      expect(style.backgroundColor).toBe(tokenColour(thread, '--surface'));
      expect(style.boxShadow).toBe('none');
      expect(Number.parseFloat(style.borderTopWidth)).toBe(0);
    }

    const own = canvasElement.querySelector<HTMLElement>('.starci-core-message-bubble[data-grammar-bubble-side="outgoing"] .starci-core-message-bubble-body')!;
    expect(getComputedStyle(own).backgroundColor).toBe(tokenColour(thread, '--accent'));
    const foreground = document.createElement('div');
    foreground.style.color = 'var(--accent-foreground)';
    thread.appendChild(foreground);
    expect(getComputedStyle(own).color).toBe(getComputedStyle(foreground).color);
    foreground.remove();

    const list = canvasElement.querySelector<HTMLElement>('[data-grammar-list-layout="suggestions"]')!;
    // The replies are a flat list in the card body, never a nested card.
    expect(list.closest('.starci-core-surface')).toBeNull();
    expect(Number.parseFloat(getComputedStyle(list).borderTopWidth)).toBe(0);
    expect(getComputedStyle(list).boxShadow).toBe('none');
    const rows = [...list.querySelectorAll<HTMLElement>('.starci-core-list-row')];
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(row.querySelector('button.starci-core-list-row-press')).not.toBeNull();
      expect(row.querySelector('[data-grammar-row-chevron="true"]')).not.toBeNull();
      expect(getComputedStyle(row.querySelector<HTMLElement>('.starci-core-list-row-name')!).fontWeight).toBe('400');
    }

    const footer = canvasElement.querySelector<HTMLElement>('.starci-core-chat-frame-footer')!;
    expect(Number.parseFloat(getComputedStyle(footer).borderTopWidth)).toBe(1);
  },
};

/** Outside a thread, on a white surface (a drawer of pinned messages), the bubble keeps its one look: the flat surface, no border, no shadow. */
export const BubblesOnWhite: Story = {
  render: () => (
    <G.Drawer title="Pinned messages" closeLabel="Close" isOpen onOpenChange={noop}>
      <G.Stack gap="row">
        <G.MessageBubble author="Maria" meta="09:12" body="Hi, I have sent the payment." />
        <G.MessageBubble side="outgoing" meta="09:14" body="Ok, let me check." />
      </G.Stack>
    </G.Drawer>
  ),
  play: async () => {
    await waitFor(() => expect(document.querySelector('.starci-core-drawer .starci-core-message-bubble')).not.toBeNull());
    const face = document.querySelector<HTMLElement>('.starci-core-drawer .starci-core-message-bubble[data-grammar-bubble-side="incoming"] .starci-core-message-bubble-body')!;
    expect(Number.parseFloat(getComputedStyle(face).borderTopWidth)).toBe(0);
    expect(getComputedStyle(face).boxShadow).toBe('none');
    expect(getComputedStyle(face).backgroundColor).toBe(tokenColour(face, '--surface'));
  },
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
  play: async ({ canvasElement }) => {
    const own = canvasElement.querySelector<HTMLElement>('.starci-core-message-bubble[data-grammar-bubble-side="outgoing"] .starci-core-message-bubble-body')!;
    const badge = own.querySelector<HTMLElement>('[data-component="Badge"]')!;
    expect(getComputedStyle(badge).backgroundColor).toBe(getComputedStyle(own).color);
    expect(getComputedStyle(badge).color).toBe(getComputedStyle(own).backgroundColor);
  },
};

const tokenColor = (host: HTMLElement, token: string): string => {
  const probe = document.createElement('span');
  probe.style.background = `var(${token})`;
  host.append(probe);
  const color = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return color;
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
    expect(tray.querySelector('[data-grammar-reaction-bar="true"]')).not.toBeNull();
    expect(tray.querySelector('[data-grammar-bubble-actions="toolbar"] button[aria-label="Pin"]')).not.toBeNull();
    if (window.innerWidth >= 768) {
      expect(getComputedStyle(tray).display).toBe('contents');
      expect(getComputedStyle(tray.querySelector<HTMLElement>('[data-grammar-reaction-bar="true"]')!).position).toBe('absolute');
      return;
    }
    expect(getComputedStyle(tray).display).toBe('none');
    const above = canvasElement.querySelectorAll<HTMLElement>('.starci-core-message-bubble-body')[0]!.getBoundingClientRect();
    const before = message.getBoundingClientRect().height;
    await longPress(message.querySelector<HTMLElement>('.starci-core-message-bubble-body')!);
    await waitFor(() => expect(getComputedStyle(tray).display).toBe('flex'));
    const box = tray.getBoundingClientRect();
    const row = message.getBoundingClientRect();
    // In the flow: the message grew by the tray, the tray starts below the bubble above and stays inside the row.
    expect(row.height).toBeGreaterThan(before);
    expect(box.top).toBeGreaterThanOrEqual(above.bottom);
    expect(box.left).toBeGreaterThanOrEqual(row.left - 0.5);
    expect(box.right).toBeLessThanOrEqual(row.right + 0.5);
    expect(box.right).toBeLessThanOrEqual(document.documentElement.clientWidth);
    for (const part of tray.querySelectorAll<HTMLElement>(':scope > *')) expect(getComputedStyle(part).position).toBe('static');
    tray.querySelector<HTMLElement>('button[aria-label="React with 👍"]')!.click();
    await waitFor(() => expect(getComputedStyle(tray).display).toBe('none'));
    const own = canvasElement.querySelector<HTMLElement>('#tray-outgoing')!;
    await longPress(own.querySelector<HTMLElement>('.starci-core-message-bubble-body')!);
    const ownTray = own.querySelector<HTMLElement>('[data-grammar-bubble-tray="true"]')!;
    await waitFor(() => expect(getComputedStyle(ownTray).display).toBe('flex'));
    expect(ownTray.getBoundingClientRect().right).toBeLessThanOrEqual(own.getBoundingClientRect().right + 0.5);
  },
};

/** A loading thread: the outgoing face is the brand's soft pair (`--accent-soft`, lines in its soft foreground), never the solid fill of a real message. */
export const LoadingThread: Story = {
  render: () => (
    <div style={{ padding: 24, maxWidth: 640 }}>
      <G.MessageBubble isLoading hasAvatar />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const face = canvasElement.querySelector<HTMLElement>('.starci-core-message-bubble[data-grammar-skeleton="true"][data-grammar-bubble-side="outgoing"] .starci-core-message-bubble-body')!;
    expect(getComputedStyle(face).backgroundColor).toBe(tokenColor(canvasElement, '--accent-soft'));
    expect(getComputedStyle(face).backgroundColor).not.toBe(tokenColor(canvasElement, '--accent'));
    const incoming = canvasElement.querySelector<HTMLElement>('.starci-core-message-bubble[data-grammar-skeleton="true"][data-grammar-bubble-side="incoming"] .starci-core-message-bubble-body')!;
    expect(getComputedStyle(incoming).backgroundColor).toBe(tokenColor(canvasElement, '--surface'));
  },
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
  play: async ({ canvasElement }) => {
    const retry = canvasElement.querySelector<HTMLElement>('[data-grammar-error="true"] [data-grammar-notice-actions] > [data-component="Button"]')!;
    expect(retry.getAttribute('data-size')).toBe('md');
    expect(Math.round(retry.getBoundingClientRect().height)).toBe(40);
  },
};
