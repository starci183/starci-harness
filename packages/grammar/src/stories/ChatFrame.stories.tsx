import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import { noop } from './fixtures.js';

/**
 * THE CHAT FRAME (law DNA-COMMON-CHAT-FRAME). `ChatFrame` is the one chat on any host: the header zone (who the reader talks to), ONE 1px line, the thread (the only
 * scroller, on `--background`, opening at the newest message), ONE 1px line, the footer zone (the composer or the decision actions). Exactly two dividers; a message of
 * someone else is the flat `--surface`, the reader's own is `--accent`, and every bubble of both sides carries its avatar. Three hosts: a `Pane content="chat"` of a
 * PaneGrid, a `Drawer` body (its title row and the frame header are one zone), and a page section bounded by its host's height.
 */
const meta: Meta = { title: 'Navigation & Data/Chat frame', parameters: { layout: 'fullscreen' } };
export default meta;
type Story = StoryObj;

const lines = [
  'Is this still in stock?', 'Yes, it is', 'Can it ship today?', 'Yes, before 5 pm', 'How much is shipping?',
  'Local delivery is $2', 'Ok I will take 2', 'I will create the order for you', 'Where do I send payment?', 'I will send the QR code now',
  'Payment sent', 'Received, thank you',
];

const Contact = ({ name, context, status }: { readonly name: string; readonly context: string; readonly status?: string }) => (
  <G.PaneHeader title={name} mark={<G.Avatar name={name} size="md" />} {...(status === undefined ? {} : { status: <G.Badge tone="warning">{status}</G.Badge> })} description={context} />
);

/** The header of a customer chat: the contact, then the owner row in the same zone, with no divider between them. */
const CustomerHeader = () => (
  <>
    <Contact name="Sam Carter" status="Waiting for review" context="New lead · writing from the web chat since 09:03" />
    <G.Cluster gap="inline" justify="between">
      <G.Text tone="muted">The assistant is replying. Questions about price wait for the owner first.</G.Text>
      <G.Button size="sm" onPress={noop}>Take over</G.Button>
    </G.Cluster>
  </>
);

/** A thread long enough to scroll in a 760px page: both sides carry an avatar, the last outgoing message is a draft marked by its meta line. */
const Thread = ({ count = lines.length }: { readonly count?: number }) => (
  <>
    <G.Divider label="Today" />
    {lines.slice(0, count).map((text, index) => {
      const time = `09:${String(10 + index)}`;
      const isLast = index === count - 1;
      return index % 2 === 0
        ? <G.MessageBubble key={text} author="Sam Carter" meta={time} avatar={<G.Avatar name="Sam Carter" size="md" />} body={text} />
        : <G.MessageBubble key={text} side="outgoing" meta={isLast ? 'Draft, not sent yet' : time} avatar={<G.Avatar name="Assistant" size="md" />} body={text} />;
    })}
  </>
);

const Composer = ({ placeholder }: { readonly placeholder: string }) => (
  <G.Textarea label="Message" isLabelHidden placeholder={placeholder} onSubmitShortcut={noop} startAction={{ glyph: 'attach', label: 'Attach a file', onPress: noop }} send={{ label: 'Send', onPress: noop }} />
);

const Decisions = () => (
  <G.Cluster gap="inline">
    <G.Button variant="primary" onPress={noop}>Approve and send</G.Button>
    <G.Button onPress={noop}>Edit, then send</G.Button>
    <G.Button onPress={noop}>Ask the agent to edit</G.Button>
    <G.Button onPress={noop}>Do not send</G.Button>
  </G.Cluster>
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
const edge = (element: Element, side: 'Top' | 'Bottom'): number => Number.parseFloat(getComputedStyle(element)[`border${side}Width`]);

/** One look on every host: the zones are --background, exactly two 1px lines divide them, the messages are flat or accent, both sides carry an avatar. */
const assertFrame = (frame: HTMLElement, hasFooter: boolean) => {
  const background = tokenColour(frame, '--background');
  expect(fill(frame)).toBe(background);
  const header = frame.querySelector<HTMLElement>(':scope > .starci-core-chat-frame-header')!;
  const thread = frame.querySelector<HTMLElement>(':scope > .starci-core-chat-frame-thread')!;
  const footer = frame.querySelector<HTMLElement>(':scope > .starci-core-chat-frame-footer');
  expect(fill(header)).toBe(background);
  expect(fill(thread)).toBe(background);
  expect(thread.getAttribute('role')).toBe('log');
  // Exactly two dividers: the line under the header and the line over the footer; the zones draw no other edge.
  const dividers = [edge(header, 'Bottom'), edge(thread, 'Top'), edge(thread, 'Bottom'), edge(header, 'Top')].filter((width) => width > 0);
  expect(dividers).toEqual([1]);
  if (hasFooter) {
    expect(footer).not.toBeNull();
    expect(fill(footer!)).toBe(background);
    expect(edge(footer!, 'Top')).toBe(1);
    expect(edge(footer!, 'Bottom')).toBe(0);
  } else {
    expect(footer).toBeNull();
  }
  const surface = tokenColour(frame, '--surface');
  const accent = tokenColour(frame, '--accent');
  for (const bubble of frame.querySelectorAll<HTMLElement>('.starci-core-message-bubble')) {
    const face = bubble.querySelector<HTMLElement>('.starci-core-message-bubble-body')!;
    expect(Number.parseFloat(getComputedStyle(face).borderTopWidth)).toBe(0);
    expect(getComputedStyle(face).boxShadow).toBe('none');
    expect(fill(face)).toBe(bubble.getAttribute('data-grammar-bubble-side') === 'outgoing' ? accent : surface);
    expect(bubble.querySelector('.starci-core-message-bubble-avatar')).not.toBeNull();
  }
};

/** Only the thread scrolls: it overflows, the frame does not, and it opened at its newest message. */
const assertThreadScrolls = (frame: HTMLElement) => {
  const thread = frame.querySelector<HTMLElement>(':scope > .starci-core-chat-frame-thread')!;
  expect(thread.scrollHeight).toBeGreaterThan(thread.clientHeight);
  expect(Math.abs(thread.scrollHeight - thread.scrollTop - thread.clientHeight)).toBeLessThanOrEqual(2);
  expect(frame.scrollHeight).toBeLessThanOrEqual(frame.clientHeight + 1);
};

const crumbs = (label: string): G.PageHeaderBreadcrumbs => ({ label: 'Path', items: [{ id: 'home', label: 'Overview', href: '#' }, { id: 'here', label }] });

/** 1. In a PaneGrid: the list pane stays white, the chat pane holds one frame with the decision actions as its footer. */
export const InPane: Story = {
  render: () => (
    <div style={{ height: 760 }}>
      <G.Page chrome="panes" header={{ breadcrumbs: crumbs('Conversations') }}>
        <G.PaneGrid label="Conversations" areas={{ base: ['room'], medium: ['list room'] }} columns={{ base: ['fill'], medium: ['compact', 'fill'] }}>
          <G.Pane area="list" surface label="Conversations">
            <G.PaneSection align="center"><G.PaneHeader title="Conversations" /></G.PaneSection>
            <G.PaneSection><G.Text tone="muted">Sam Carter</G.Text></G.PaneSection>
          </G.Pane>
          <G.Pane area="room" content="chat" label="Sam Carter">
            <G.ChatFrame label="Conversation with Sam Carter" header={<CustomerHeader />} footer={<Decisions />}><Thread /></G.ChatFrame>
          </G.Pane>
        </G.PaneGrid>
      </G.Page>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelectorAll('.starci-core-message-bubble').length).toBe(lines.length));
    const pane = canvasElement.querySelector<HTMLElement>('[data-grammar-pane-area="room"]')!;
    expect(pane.getAttribute('data-grammar-pane-content')).toBe('chat');
    const frame = pane.querySelector<HTMLElement>('.starci-core-chat-frame')!;
    assertFrame(frame, true);
    const list = canvasElement.querySelector<HTMLElement>('[data-grammar-pane-area="list"]')!;
    expect(fill(list)).toBe(tokenColour(list, '--surface'));
    await waitFor(() => assertThreadScrolls(frame));
  },
};

/** 2. In a Drawer: the sheet's title row and the frame header are one zone (no line, no gap between them), and only the thread scrolls. */
export const InDrawer: Story = {
  render: () => (
    <G.Drawer title="Reply to a message" description="Drafted by the assistant at 21:45" closeLabel="Close" isOpen onOpenChange={noop} placement="right" bodyInset="none">
      <G.ChatFrame label="Conversation with Sam Carter" header={<CustomerHeader />} footer={<Decisions />}><Thread /></G.ChatFrame>
    </G.Drawer>
  ),
  play: async () => {
    await waitFor(() => expect(document.querySelector('.starci-core-drawer .starci-core-chat-frame-thread')).not.toBeNull());
    const drawer = document.querySelector<HTMLElement>('.starci-core-drawer')!;
    expect(fill(drawer)).toBe(tokenColour(drawer, '--background'));
    const frame = drawer.querySelector<HTMLElement>('.starci-core-chat-frame')!;
    assertFrame(frame, true);
    const title = drawer.querySelector<HTMLElement>(':scope > .starci-core-overlay-header')!;
    expect(edge(title, 'Bottom')).toBe(0);
    const gap = frame.querySelector<HTMLElement>(':scope > .starci-core-chat-frame-header')!.getBoundingClientRect().top - title.getBoundingClientRect().bottom;
    expect(Math.abs(gap)).toBeLessThanOrEqual(1);
    await waitFor(() => assertThreadScrolls(frame));
  },
};

/** 3. Inline: a frame in a page, bounded by the height its host gives it, with the composer as its footer. */
export const Inline: Story = {
  render: () => (
    <G.Page header={{ breadcrumbs: crumbs('Assistant'), title: 'Assistant' }}>
      <div style={{ height: 520 }}>
        <G.ChatFrame label="Conversation with the assistant" header={<Contact name="Assistant" context="Answers questions about orders" />} footer={<Composer placeholder="Ask the assistant..." />}>
          <Thread />
        </G.ChatFrame>
      </div>
    </G.Page>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelectorAll('.starci-core-message-bubble').length).toBe(lines.length));
    const frame = canvasElement.querySelector<HTMLElement>('.starci-core-chat-frame')!;
    assertFrame(frame, true);
    expect(frame.getBoundingClientRect().height).toBeLessThanOrEqual(520);
    await waitFor(() => assertThreadScrolls(frame));
  },
};

/** 4. Without a footer: the frame draws no footer and no line above it, so it has one divider. */
export const WithoutFooter: Story = {
  render: () => (
    <div style={{ height: 420 }}>
      <G.ChatFrame label="Conversation with Sam Carter" header={<Contact name="Sam Carter" context="Closed conversation"/>}><Thread count={4} /></G.ChatFrame>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelectorAll('.starci-core-message-bubble').length).toBe(4));
    const frame = canvasElement.querySelector<HTMLElement>('.starci-core-chat-frame')!;
    expect(frame.querySelector(':scope > .starci-core-chat-frame-footer')).toBeNull();
    expect(edge(frame.querySelector<HTMLElement>(':scope > .starci-core-chat-frame-header')!, 'Bottom')).toBe(1);
  },
};

/** 5. Loading and failing: the thread draws its loading structure, then the failure in the place of the messages. */
export const LoadingAndError: Story = {
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', height: 420 }}>
      <G.ChatFrame label="Conversation" header={<Contact name="Sam Carter" context="Loading" />} footer={<Composer placeholder="Type a message..." />} isLoading><G.MessageBubble isLoading hasAvatar /></G.ChatFrame>
      <G.ChatFrame label="Conversation" header={<Contact name="Sam Carter" context="Failed" />} footer={<Composer placeholder="Type a message..." />} error={{ message: 'The conversation did not load', description: 'Try again in a moment.' }}>{null}</G.ChatFrame>
    </div>
  ),
};
