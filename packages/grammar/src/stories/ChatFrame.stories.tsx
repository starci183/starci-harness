import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import { noop } from './fixtures.js';

/**
 * THE CHAT FRAME (0.37.33, law DNA-COMMON-CHAT-FRAME, the owner-approved drawing chat-frame-anywhere). On ANY page that renders a chat, the chat is one frame (its
 * head, its thread and its composer footer) on the page tone `--background`, whatever surface it stands on; the rest of the page keeps its own rule (the room
 * list and an aside stay white). `Pane content="chat"` names the frame (a pane whose own stack holds a `PaneSection scroll role="log"` is one without the word);
 * the app chooses no tone. The composer field stays white, the 1px lines between the zones stay, every message in the frame is flat. The thread is the only
 * scroller between the fixed head and the fixed composer, and it opens at the newest message (DNA-COMMON-CHAT-FRAME-SCROLL). The four cases of the drawing.
 */
const meta: Meta = { title: 'Navigation & Data/Chat frame (0.37.33)', parameters: { layout: 'fullscreen' } };
export default meta;
type Story = StoryObj;

const lines = [
  'Is this still in stock?', 'Yes, it is', 'Can it ship today?', 'Yes, before 5 pm', 'How much is shipping?',
  'Local delivery is $2', 'Ok I will take 2', 'I will create the order for you', 'Where do I send payment?', 'I will send the QR code now',
  'Payment sent', 'Received, thank you', 'Thanks a lot', 'You are welcome',
];

/** A thread long enough to scroll in a 760px page: others' messages flat white, own messages accent. */
const Thread = ({ count = lines.length }: { readonly count?: number }) => (
  <>
    {lines.slice(0, count).map((text, index) => (
      index % 2 === 0
        ? <G.MessageBubble key={text} author="Sam" meta={`09:${String(10 + index)}`} avatar={<G.Avatar name="Sam" size="sm" />} body={text} />
        : <G.MessageBubble key={text} side="outgoing" meta={`09:${String(10 + index)}`} body={text} />
    ))}
  </>
);

const Composer = ({ placeholder }: { readonly placeholder: string }) => (
  <G.PaneSection as="footer" rule="start" gap="row">
    <G.Textarea label="Message" isLabelHidden placeholder={placeholder} onSubmitShortcut={noop} />
  </G.PaneSection>
);

const Head = ({ title }: { readonly title: string }) => (
  <G.PaneSection align="center">
    <G.PaneHeader title={title} mark={<G.Avatar name={title} size="sm" />} />
  </G.PaneSection>
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

const fill = (element: Element): string => getComputedStyle(element).backgroundColor;

/** The three zones of a chat frame (the pane, its head band, its footer) are --background, the messages in it flat. */
const assertFrame = (frame: HTMLElement) => {
  const background = tokenColour(frame, '--background');
  expect(fill(frame)).toBe(background);
  const head = frame.querySelector<HTMLElement>('.starci-core-pane-stack > .starci-core-pane-section:first-child');
  if (head !== null) expect(fill(head)).toBe(background);
  const thread = frame.querySelector<HTMLElement>('[data-grammar-pane-section-thread="true"]')!;
  expect(fill(thread)).toBe(background);
  const footer = frame.querySelector<HTMLElement>(':scope > .starci-core-pane-footer');
  if (footer !== null) {
    expect(fill(footer)).toBe(background);
    expect(Number.parseFloat(getComputedStyle(footer).borderTopWidth)).toBe(1);
    // the composer field stays white on the frame (the primary field, whatever stands around the frame)
    const field = footer.querySelector<HTMLElement>('textarea');
    if (field !== null) expect(fill(field)).toBe(tokenColour(frame, '--surface'));
  }
  for (const face of frame.querySelectorAll<HTMLElement>('.starci-core-message-bubble[data-grammar-bubble-side="incoming"] .starci-core-message-bubble-body')) {
    expect(Number.parseFloat(getComputedStyle(face).borderTopWidth)).toBe(0);
    expect(getComputedStyle(face).boxShadow).toBe('none');
    expect(fill(face)).toBe(tokenColour(frame, '--surface'));
  }
};

/** Only the thread scrolls: it overflows, the pane body does not, and it opened at its newest message. */
const assertThreadScrolls = (frame: HTMLElement) => {
  const thread = frame.querySelector<HTMLElement>('[data-grammar-pane-section-thread="true"]')!;
  expect(thread.scrollHeight).toBeGreaterThan(thread.clientHeight);
  expect(Math.abs(thread.scrollHeight - thread.scrollTop - thread.clientHeight)).toBeLessThanOrEqual(2);
  const body = frame.querySelector<HTMLElement>(':scope > .starci-core-pane-body');
  if (body !== null) expect(body.scrollHeight).toBeLessThanOrEqual(body.clientHeight + 1);
};

const crumbs = (label: string): G.PageHeaderBreadcrumbs => ({ label: 'Path', items: [{ id: 'home', label: 'Overview', href: '#' }, { id: 'here', label }] });

/** 1. The chat page: the room list white, the room a chat frame (head, thread, composer) on --background; only the thread scrolls. */
export const ChatPage: Story = {
  render: () => (
    <div style={{ height: 760 }}>
      <G.Page chrome="panes" header={{ breadcrumbs: crumbs('Chat') }}>
        <G.PaneGrid label="Chat" areas={{ base: ['room'], medium: ['list room'] }} columns={{ base: ['fill'], medium: ['compact', 'fill'] }}>
          <G.Pane area="list" surface label="Rooms">
            <G.PaneSection align="center"><G.PaneHeader title="Chat" /></G.PaneSection>
            <G.PaneSection><G.Text tone="muted">Chatbot</G.Text></G.PaneSection>
          </G.Pane>
          <G.Pane area="room" content="chat" label="Chatbot room" footer={<Composer placeholder="Type a message..." />}>
            <Head title="Chatbot" />
            <G.PaneSection scroll={{ label: 'Conversation', role: 'log', align: 'end' }}><Thread /></G.PaneSection>
          </G.Pane>
        </G.PaneGrid>
      </G.Page>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelectorAll('.starci-core-message-bubble').length).toBe(lines.length));
    const frame = canvasElement.querySelector<HTMLElement>('[data-grammar-pane-area="room"]')!;
    expect(frame.getAttribute('data-grammar-pane-content')).toBe('chat');
    assertFrame(frame);
    const list = canvasElement.querySelector<HTMLElement>('[data-grammar-pane-area="list"]')!;
    expect(fill(list)).toBe(tokenColour(list, '--surface'));
    await waitFor(() => assertThreadScrolls(frame));
  },
};

/** 2. The inbox: the customer thread between the list and the aside is a chat frame (found by its thread, no word); the list and the aside stay white. */
export const InboxThread: Story = {
  render: () => (
    <div style={{ height: 760 }}>
      <G.Page layout="workspace" chrome="panes" header={{ breadcrumbs: crumbs('Inbox'), title: 'Inbox' }}>
        <G.PaneGrid label="Inbox" areas={{ base: ['main'], wide: ['list main aside'] }} columns={{ base: ['fill'], wide: ['compact', 'fill', 'compact'] }}>
          <G.Pane area="list" surface label="Customers">
            <G.PaneSection><G.Text tone="muted">Sam</G.Text></G.PaneSection>
          </G.Pane>
          <G.Pane area="main" label="Customer conversation" footer={<Composer placeholder="Reply to the customer..." />}>
            <Head title="Chat customer · Sam" />
            <G.PaneSection scroll={{ label: 'Conversation', role: 'log', align: 'end' }}><Thread count={4} /></G.PaneSection>
          </G.Pane>
          <G.Pane area="aside" surface label="Customers">
            <G.PaneSection align="center"><G.PaneHeader title="Customers" /></G.PaneSection>
            <G.PaneSection><G.Text tone="muted">Chat · 2 orders</G.Text></G.PaneSection>
          </G.Pane>
        </G.PaneGrid>
      </G.Page>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('[data-grammar-pane-area="main"] .starci-core-message-bubble')).not.toBeNull());
    assertFrame(canvasElement.querySelector<HTMLElement>('[data-grammar-pane-area="main"]')!);
    for (const area of ['list', 'aside']) {
      const pane = canvasElement.querySelector<HTMLElement>(`[data-grammar-pane-area="${area}"]`);
      if (pane !== null && getComputedStyle(pane).display !== 'none') expect(fill(pane)).toBe(tokenColour(pane, '--surface'));
    }
  },
};

/** 3. An agent's chat tab under its white page head: the room pane is the frame, the page head stays white. */
export const AgentChatTab: Story = {
  render: () => (
    <div style={{ height: 760 }}>
      <G.Page chrome="panes" header={{ breadcrumbs: crumbs('Sales'), title: 'Sales' }}>
        <G.PaneGrid label="Chat with Sales" areas={['room']}>
          <G.Pane area="room" content="chat" label="Sales" footer={<Composer placeholder="Message Sales..." />}>
            <G.PaneSection scroll={{ label: 'Conversation', role: 'log', align: 'end' }}><Thread /></G.PaneSection>
          </G.Pane>
        </G.PaneGrid>
      </G.Page>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelectorAll('.starci-core-message-bubble').length).toBe(lines.length));
    const frame = canvasElement.querySelector<HTMLElement>('[data-grammar-pane-area="room"]')!;
    assertFrame(frame);
    const head = canvasElement.querySelector<HTMLElement>('[data-component="PageHeader"]')!;
    expect(fill(head)).toBe(tokenColour(head, '--surface'));
    await waitFor(() => assertThreadScrolls(frame));
  },
};

/** 4. The assistant in a drawer: the drawer that holds the chat is the frame as a whole, its own head included; a message in it is flat. */
export const AssistantDrawer: Story = {
  render: () => (
    <G.Drawer title="Assistant" closeLabel="Close" isOpen onOpenChange={noop} placement="right" bodyInset="none">
      <div style={{ height: '100%', minHeight: 0 }}>
        <G.PaneGrid label="Assistant" areas={['chat']}>
          <G.Pane area="chat" content="chat" label="Assistant" footer={<Composer placeholder="Ask the assistant..." />}>
            <G.PaneSection scroll={{ label: 'Conversation', role: 'log', align: 'end' }}>
              <G.MessageBubble author="Assistant" avatar={<G.Avatar name="Assistant" size="sm" />} body="How can I help?" />
              <G.MessageBubble side="outgoing" body="Summarize today" />
            </G.PaneSection>
          </G.Pane>
        </G.PaneGrid>
      </div>
    </G.Drawer>
  ),
  play: async () => {
    await waitFor(() => expect(document.querySelector('.starci-core-drawer [data-grammar-pane-section-thread="true"]')).not.toBeNull());
    const drawer = document.querySelector<HTMLElement>('.starci-core-drawer')!;
    expect(fill(drawer)).toBe(tokenColour(drawer, '--background'));
    assertFrame(drawer.querySelector<HTMLElement>('[data-grammar-pane-area="chat"]')!);
  },
};
