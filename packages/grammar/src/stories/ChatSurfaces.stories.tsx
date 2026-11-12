import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import { noop } from './fixtures.js';

/**
 * THE CHAT SURFACES (0.37.31, law DNA-COMMON-CHAT-SURFACES, the owner-approved drawing chat-surfaces). Every chat (team chat, an agent's chat, an inbox
 * thread, the assistant) draws the same three faces: the thread on the page tone (`--background`; a `PaneSection scroll role="log"` paints it even when the
 * app asks for `tone="surface"`), a message of someone else (MessageBubble incoming, MessageCard) the FLAT surface (`--surface`, no border, no shadow), and the
 * reader's own message `--accent` with `--accent-foreground`. The replies a card offers are one bordered list, a pressable plain-text row per reply with a
 * chevron (`SurfaceCard kind="list" layout="suggestions"`, law DNA-COMMON-CARD-SUGGESTIONS); the pills by the composer stay `Button size="sm"`. The pane
 * footer that holds the composer starts at its own hairline: no empty band above the suggestions, no second line.
 */
const meta: Meta = { title: 'Navigation & Data/Chat surfaces (0.37.31)', parameters: { layout: 'fullscreen' } };
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
    <G.SurfaceCard kind="list" layout="suggestions" ariaLabel="Suggested replies" empty={null} items={replies} />
    <G.Cluster gap="inline" align="end" wrap={false}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <G.Textarea label="Reply" isLabelHidden placeholder="Reply to the AI..." />
      </div>
      <G.Button intent="commit" startGlyph="send" onPress={noop}>Send</G.Button>
    </G.Cluster>
  </G.Stack>
);

const Thread = () => (
  <>
    <G.MessageBubble author="Maria" meta="09:12" avatar={<G.Avatar name="Maria" size="sm" />} body="Hi, I have sent the payment." />
    <G.MessageCard
      measure="wide"
      author="Chatbot"
      avatar={<G.Avatar name="Chatbot" size="sm" />}
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
    <G.MessageBubble side="outgoing" meta="14:30" body="Ok, let me check" />
  </>
);

const Composer = () => (
  <G.PaneSection as="footer" rule="start" gap="row">
    <G.Cluster gap="inline" label="Suggestions">
      <G.Button intent="neutral" size="sm" onPress={noop}>What did you do today?</G.Button>
      <G.Button intent="neutral" size="sm" onPress={noop}>Is anything waiting for my approval?</G.Button>
    </G.Cluster>
    <G.Textarea label="Message" isLabelHidden placeholder="Type a message..." onSubmitShortcut={noop} />
  </G.PaneSection>
);

const ChatPage = () => (
  <div style={{ height: 760 }}>
    <G.Page chrome="panes" header={{ breadcrumbs: { label: 'Path', items: [{ id: 'home', label: 'Overview', href: '#' }, { id: 'chat', label: 'Chat' }] } }}>
      <G.PaneGrid label="Chat" areas={{ base: ['room'], medium: ['list room'] }} columns={{ base: ['fill'], medium: ['compact', 'fill'] }}>
        <G.Pane area="list" surface label="Rooms">
          <G.PaneSection align="center"><G.PaneHeader title="Chat" /></G.PaneSection>
          <G.PaneSection><G.Text tone="muted">Chatbot</G.Text></G.PaneSection>
        </G.Pane>
        <G.Pane area="room" surface content="full" label="Chatbot room" footer={<Composer />}>
          <G.PaneSection align="center">
            <G.PaneHeader title="Chatbot" description="Agent" mark={<G.Avatar name="Chatbot" size="sm" />} />
          </G.PaneSection>
          {/* tone="surface" on purpose: a thread is the page tone whatever the app asks. */}
          <G.PaneSection scroll={{ label: 'Conversation', role: 'log', tone: 'surface', align: 'end' }}>
            <Thread />
          </G.PaneSection>
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

/** The approved drawing: the pink thread, flat white incoming messages and card, the accent own message, the card's replies as a bordered list, no band above the composer. */
export const ChatPane: Story = {
  render: () => <ChatPage />,
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('[data-component="MessageCard"]')).not.toBeNull());
    const thread = canvasElement.querySelector<HTMLElement>('[data-grammar-pane-section-thread="true"]')!;
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
    const listCard = list.closest<HTMLElement>('.starci-core-surface')!;
    expect(Number.parseFloat(getComputedStyle(listCard).borderTopWidth)).toBe(1);
    expect(getComputedStyle(listCard).boxShadow).toBe('none');
    const rows = [...list.querySelectorAll<HTMLElement>('.starci-core-list-row')];
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(row.querySelector('button.starci-core-list-row-press')).not.toBeNull();
      expect(row.querySelector('[data-grammar-row-chevron="true"]')).not.toBeNull();
      expect(getComputedStyle(row.querySelector<HTMLElement>('.starci-core-list-row-name')!).fontWeight).toBe('400');
    }

    const footer = canvasElement.querySelector<HTMLElement>('.starci-core-pane-footer')!;
    const stack = footer.querySelector<HTMLElement>(':scope > .starci-core-pane-stack')!;
    const band = stack.querySelector<HTMLElement>(':scope > .starci-core-pane-section')!;
    expect(Number.parseFloat(getComputedStyle(stack).paddingTop)).toBe(0);
    expect(Number.parseFloat(getComputedStyle(band).borderTopWidth)).toBe(0);
    expect(Math.round(band.getBoundingClientRect().top - footer.getBoundingClientRect().top)).toBeLessThanOrEqual(1);
  },
};

/** Outside a thread, on a white surface (a drawer of pinned messages), the flat white bubble and card wear the 1px separator edge, still no shadow. */
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
    expect(Number.parseFloat(getComputedStyle(face).borderTopWidth)).toBe(1);
    expect(getComputedStyle(face).boxShadow).toBe('none');
  },
};
