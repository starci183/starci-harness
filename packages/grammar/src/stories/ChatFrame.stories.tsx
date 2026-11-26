import type { Meta, StoryObj } from '@storybook/react-vite';
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
};

/** 2. In a Drawer: the sheet's title row and the frame header are one zone (no line, no gap between them), and only the thread scrolls. */
export const InDrawer: Story = {
  render: () => (
    <G.Drawer title="Reply to a message" description="Drafted by the assistant at 21:45" closeLabel="Close" isOpen onOpenChange={noop} placement="right" bodyInset="none">
      <G.ChatFrame label="Conversation with Sam Carter" header={<CustomerHeader />} footer={<Decisions />}><Thread /></G.ChatFrame>
    </G.Drawer>
  ),
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
};

/** 4. Without a footer: the frame draws no footer and no line above it, so it has one divider. */
export const WithoutFooter: Story = {
  render: () => (
    <div style={{ height: 420 }}>
      <G.ChatFrame label="Conversation with Sam Carter" header={<Contact name="Sam Carter" context="Closed conversation"/>}><Thread count={4} /></G.ChatFrame>
    </div>
  ),
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
