import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactElement } from 'react';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import { BellGlyph, BookGlyph, EllipsisGlyph, HomeGlyph, SettingsGlyph, familyScope, noop } from './fixtures.js';

/*
 * The real shell (0.37.0): the app top bar, the sidebar and a layout B workspace page (list / chat / aside) in one fixed viewport, so the shared head
 * row, the one divider under it and the sticky band offset (the 64px strip class of bug) are checked where an app really stands, not in a box.
 */
const meta: Meta = {
  title: 'Compositions/App shell workspace',
  parameters: { layout: 'fullscreen', grammar: { bleed: true } },
};
export default meta;
type Story = StoryObj;

const groups: ReadonlyArray<G.SidebarGroup> = [
  { id: 'main', label: 'Main', items: [{ id: 'home', label: 'Home', source: HomeGlyph }, { id: 'conversations', label: 'Conversations', source: BookGlyph, badge: 3, badgeLabel: '3 unread conversations' }] },
  { id: 'settings', label: 'Settings', placement: 'end', items: [{ id: 'preferences', label: 'Preferences', source: SettingsGlyph }] },
];

const conversations: ReadonlyArray<G.ListBoxItem> = [
  { id: 'linh', label: 'Sam Lee', description: 'Can the order for table 4 move to 19:30?' },
  { id: 'team', label: 'Kitchen team', description: 'Prep list for tomorrow is ready.' },
  { id: 'supplier', label: 'Supplier', description: 'The delivery slipped to Thursday.' },
];

const Shell = ({ scope, grid }: { readonly scope: ReturnType<typeof familyScope>, readonly grid?: ReactElement<G.PaneGridProps> }) => (
  <G.GrammarRoot {...scope}>
    <G.WorkspaceShell
      viewport="fixed"
      header={<G.TopBar
        position="static"
        brand={<G.IdentityLockup title="Studio" subtitle="Owner" />}
        actions={<>
          <G.IconButton source={BellGlyph} label="Notifications" onPress={noop} />
          <G.AvatarButton name="Alex Morgan" size="control" />
        </>}
      />}
      navigation={<G.Sidebar label="Workspace" groups={groups} selectedKey="conversations" />}
      navigationLabel="Workspace navigation"
      navigationTrack="intrinsic"
      navigationVisibility="wide"
      primaryLabel="Conversations"
      primary={
        <G.Page chrome="panes" layout="workspace" header={{ title: 'Conversations' }}>
          {grid ?? (
          <G.PaneGrid label="Conversations workspace" areas={['list chat aside']} columns={['standard', 'fill', 'standard']}>
            <G.Pane area="list" surface scroll label="Conversation list">
              <G.PaneSection as="header" align="center"><G.PaneHeader title="Conversations" /></G.PaneSection>
              <G.PaneSection><G.ListBox label="Conversations" items={conversations} selectionMode="single" defaultSelectedIds={['linh']} inset="panel" /></G.PaneSection>
            </G.Pane>
            <G.Pane area="chat" label="Chat">
              <G.PaneSection align="center">
                <G.PaneHeader title="Sam Lee" description="Email - 5 minutes ago" actions={<G.IconButton intent="neutral" source={EllipsisGlyph} label="More actions" />} />
              </G.PaneSection>
              <G.PaneSection scroll={{ label: 'Conversation', role: 'log', align: 'end', tone: 'background' }}>
                <G.MessageBubble author="Sam" meta="09:12" body="Can the order for table 4 move to 19:30?" />
                <G.MessageBubble side="outgoing" meta="09:14" body="Yes, I moved it." />
              </G.PaneSection>
            </G.Pane>
            <G.Pane area="aside" surface label="Needs you">
              <G.PaneSection as="header" align="center"><G.Heading level={2}>Needs your review</G.Heading></G.PaneSection>
              <G.PaneSection gap="section"><G.Text isStrong>Refund for table 4</G.Text><G.Text tone="muted">Waiting for your approval.</G.Text><G.Button intent="commit">Approve</G.Button></G.PaneSection>
            </G.Pane>
          </G.PaneGrid>
          )}
        </G.Page>
      }
    />
  </G.GrammarRoot>
);

/**
 * The three heads share one row: the same height and top, one continuous divider under all three, no pink band in the aside. The list and aside heads are
 * white; the chat pane is a chat frame (0.37.33, DNA-COMMON-CHAT-FRAME), so its head is the frame's --background.
 */
export const ThreePaneWorkspace: Story = {
  render: (_, { globals }) => <Shell scope={familyScope(globals)} />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const heads = ['list', 'chat', 'aside'].map((area) => {
        const head = canvasElement.querySelector<HTMLElement>(`[data-grammar-pane-area="${area}"] .starci-core-pane-stack > .starci-core-pane-section:first-child`);
        if (head === null) throw new Error(`the ${area} head renders`);
        return head;
      });
      const [first, ...rest] = heads.map((head) => head.getBoundingClientRect());
      for (const rect of rest) {
        expect(Math.abs(rect.top - (first?.top ?? 0))).toBeLessThanOrEqual(1);
        expect(Math.abs(rect.height - (first?.height ?? 0))).toBeLessThanOrEqual(1);
      }
      const surface = getComputedStyle(heads[0] as HTMLElement).backgroundColor;
      expect(getComputedStyle(heads[2] as HTMLElement).backgroundColor).toBe(surface);
      const thread = canvasElement.querySelector<HTMLElement>('[data-grammar-pane-area="chat"] [data-grammar-pane-section-thread="true"]')!;
      expect(getComputedStyle(heads[1] as HTMLElement).backgroundColor).toBe(getComputedStyle(thread).backgroundColor);
      expect(getComputedStyle(heads[1] as HTMLElement).backgroundColor).not.toBe(surface);
    });
  },
};

const stateAt = (canvasElement: HTMLElement) => {
  const tracks = canvasElement.querySelector<HTMLElement>('.starci-core-pane-grid-tracks');
  if (tracks === null) throw new Error('the grid renders');
  const stack = (area: string) => canvasElement.querySelector<HTMLElement>(`[data-grammar-pane-area="${area}"] .starci-core-pane-stack`);
  return { divider: getComputedStyle(tracks, '::after').content, stackPad: (area: string) => Number.parseFloat(getComputedStyle(stack(area) as HTMLElement).paddingTop) };
};

/** The two-pane workspace shape: a main pane with no head and an aside with one. No shared row, no spacer, no continuous divider: the aside head stands alone at the head height with its own bottom border, and the main pane starts at the top (0.37.3). */
export const AsideHeadOnly: Story = {
  render: (_, { globals }) => <Shell scope={familyScope(globals)} grid={
    <G.PaneGrid label="Workspace" areas={['main aside']} columns={['fill', 'standard']}>
      <G.Pane area="main" label="View"><G.PaneSection gap="section"><G.Text isStrong>View body</G.Text><G.Text tone="muted">No head in this pane.</G.Text></G.PaneSection></G.Pane>
      <G.Pane area="aside" surface label="Needs you">
        <G.PaneSection as="header" align="center"><G.Heading level={2}>Needs your review</G.Heading></G.PaneSection>
        <G.PaneSection><G.Text tone="muted">Waiting for your approval.</G.Text></G.PaneSection>
      </G.Pane>
    </G.PaneGrid>
  } />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const state = stateAt(canvasElement);
      expect(state.divider).toBe('none');
      expect(state.stackPad('main')).toBe(0);
      const head = canvasElement.querySelector<HTMLElement>('[data-grammar-pane-area="aside"] .starci-core-pane-stack > .starci-core-pane-section:first-child')!;
      expect(Number.parseFloat(getComputedStyle(head).borderBottomWidth)).toBeGreaterThan(0);
    });
  },
};

/** A workspace grid in which no pane has a head: no head row, no divider, nothing reserved above the first band (the blank-band regression). */
export const NoHeads: Story = {
  render: (_, { globals }) => <Shell scope={familyScope(globals)} grid={
    <G.PaneGrid label="Workspace" areas={['main aside']} columns={['fill', 'standard']}>
      <G.Pane area="main" label="View"><G.PaneSection gap="section"><G.Text isStrong>View body</G.Text><G.Text tone="muted">No pane has a head.</G.Text></G.PaneSection></G.Pane>
      <G.Pane area="aside" surface label="Details"><G.PaneSection><G.Text tone="muted">Aside body.</G.Text></G.PaneSection></G.Pane>
    </G.PaneGrid>
  } />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const state = stateAt(canvasElement);
      expect(state.divider).toBe('none');
      expect(state.stackPad('main')).toBe(0);
      expect(state.stackPad('aside')).toBe(0);
    });
  },
};

/**
 * The Chatbot inbox shape: the page's one grid holds a tab pane, which holds a grid of a main and an aside, whose main holds a list and a thread. The list and the aside have
 * heads and no conversation is open, so the thread has none: the heads are not a shared row (no spacer, no continuous divider); each stands alone at the head height with its own border (0.37.3).
 */
export const NestedGrids: Story = {
  render: (_, { globals }) => <Shell scope={familyScope(globals)} grid={
    <G.PaneGrid label="Tab workspace" areas={['tab']} columns={['fill']}>
      <G.Pane area="tab" inset="flush">
        <G.PaneGrid label="Workspace" areas={['main aside']} columns={['fill', 'standard']}>
          <G.Pane area="main" inset="flush">
            <G.PaneGrid label="Inbox" areas={['list thread']} columns={['standard', 'fill']}>
              <G.Pane area="list" surface label="Conversation list">
                <G.PaneSection align="center"><G.PaneHeader title="Conversations" /></G.PaneSection>
                <G.PaneSection><G.Text tone="muted">Sam Lee</G.Text></G.PaneSection>
              </G.Pane>
              <G.Pane area="thread" label="Thread"><G.PaneSection align="center"><G.Text tone="muted">Pick a conversation.</G.Text></G.PaneSection></G.Pane>
            </G.PaneGrid>
          </G.Pane>
          <G.Pane area="aside" surface label="Needs you">
            <G.PaneSection align="center"><G.PaneHeader title="Needs your review" /></G.PaneSection>
            <G.PaneSection><G.Text tone="muted">Waiting for your approval.</G.Text></G.PaneSection>
          </G.Pane>
        </G.PaneGrid>
      </G.Pane>
    </G.PaneGrid>
  } />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const top = canvasElement.querySelector<HTMLElement>('.starci-core-pane-grid-tracks');
      if (top === null) throw new Error('the grid renders');
      expect(getComputedStyle(top, '::after').content).toBe('none');
      const head = (area: string) => canvasElement.querySelector<HTMLElement>(`[data-grammar-pane-area="${area}"] .starci-core-pane-stack > .starci-core-pane-section:first-child`)!.getBoundingClientRect();
      expect(Math.abs(head('list').height - head('aside').height)).toBeLessThanOrEqual(1);
      const thread = canvasElement.querySelector<HTMLElement>('[data-grammar-pane-area="thread"] .starci-core-pane-stack')!;
      expect(Number.parseFloat(getComputedStyle(thread).paddingTop)).toBe(0);
    });
  },
};

/**
 * THE AGENT CHAT TAB (0.37.5): the real nesting of an app tab with panes: the page band (trail, title, tabs) over an outer grid whose one flush pane hosts a grid of a chat room (head, a long
 * thread that scrolls, a composer) and an aside (head, a long list), in the fixed shell. Only the thread and the aside list scroll: the page, the band, the head and the composer stay put.
 */
const longThread = Array.from({ length: 60 }, (_, index) => (
  <G.MessageBubble key={index} side={index % 3 === 0 ? 'outgoing' : 'incoming'} author={index % 3 === 0 ? undefined : 'Chatbot'} meta={`${String(9 + Math.floor(index / 6)).padStart(2, '0')}:${String((index % 6) * 9).padStart(2, '0')}`} body={`Message ${index + 1}: the support chatbot needs your decision, the assistant plan needs a reviewer.`} />
));
const longAside: ReadonlyArray<G.ListBoxItem> = Array.from({ length: 40 }, (_, index) => ({ id: `s${index}`, label: `Source ${index + 1}`, description: 'Receive messages · Automatic' }));

const chatTabGrid = (
  <G.PaneGrid label="Chat tab" areas={['tab']}>
    <G.Pane area="tab" inset="flush">
      <G.PaneGrid label="Chat" areas={{ base: ['room'], medium: ['room rail'] }} columns={{ base: ['fill'], medium: ['fill', 'standard'] }}>
        <G.Pane area="room" surface content="full" inset="flush" label="Room">
          <G.PaneSection align="center"><G.PaneHeader title="Chatbot" description="Agent" /></G.PaneSection>
          <G.PaneSection scroll={{ label: 'Thread', role: 'log', align: 'end', tone: 'background' }}>{longThread}</G.PaneSection>
          <G.PaneSection as="footer" rule="start"><G.Input id="composer" name="composer" label="Message the assistant" kind="text" /></G.PaneSection>
        </G.Pane>
        <G.Pane area="rail" surface scroll content="full" label="Sources">
          <G.PaneSection align="center"><G.PaneHeader title="Assistant answers from" /></G.PaneSection>
          <G.PaneSection><G.ListBox label="Sources" items={longAside} selectionMode="single" inset="panel" /></G.PaneSection>
        </G.Pane>
      </G.PaneGrid>
    </G.Pane>
  </G.PaneGrid>
);

const ChatTabShell = ({ scope }: { readonly scope: ReturnType<typeof familyScope> }) => (
  <G.GrammarRoot {...scope}>
    <G.WorkspaceShell
      viewport="fixed"
      header={<G.TopBar position="static" brand={<G.IdentityLockup title="Studio" subtitle="Owner" />} actions={<G.AvatarButton name="Alex Morgan" size="control" />} />}
      navigation={<G.Sidebar label="Workspace" groups={groups} selectedKey="conversations" />}
      navigationLabel="Workspace navigation"
      navigationTrack="intrinsic"
      navigationVisibility="wide"
      primaryLabel="Chatbot"
      primary={
        <G.Page
          chrome="panes"
          layout="workspace"
          measure="product"
          minHeight="lg"
          header={{
            breadcrumbs: { label: 'Breadcrumb', items: [{ id: 'agents', label: 'Agent', href: '#agents' }, { id: 'bot', label: 'Chatbot' }] },
            title: 'Chatbot',
            tabs: { label: 'Agent', selectedKey: 'chat', items: [{ id: 'work', label: 'Work' }, { id: 'chat', label: 'Chat' }, { id: 'setup', label: 'Setup' }] },
          }}
        >
          {chatTabGrid}
        </G.Page>
      }
    />
  </G.GrammarRoot>
);

export const ChatTab: Story = {
  render: (_, { globals }) => <ChatTabShell scope={familyScope(globals)} />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const thread = canvasElement.querySelector<HTMLElement>('[data-grammar-pane-area="room"] [role="log"]');
      if (thread === null) throw new Error('the thread renders');
      const page = document.scrollingElement as HTMLElement;
      expect(page.scrollHeight).toBeLessThanOrEqual(window.innerHeight + 1);
      const head = canvasElement.querySelector<HTMLElement>('[data-grammar-pane-area="room"] .starci-core-pane-header')!.getBoundingClientRect();
      const composer = canvasElement.querySelector<HTMLElement>('[data-grammar-pane-area="room"] footer')!.getBoundingClientRect();
      const band = canvasElement.querySelector<HTMLElement>('.starci-core-page-header')!.getBoundingClientRect();
      expect(thread.scrollHeight).toBeGreaterThan(thread.clientHeight);
      thread.scrollTop = 400;
      const after = {
        head: canvasElement.querySelector<HTMLElement>('[data-grammar-pane-area="room"] .starci-core-pane-header')!.getBoundingClientRect(),
        composer: canvasElement.querySelector<HTMLElement>('[data-grammar-pane-area="room"] footer')!.getBoundingClientRect(),
        band: canvasElement.querySelector<HTMLElement>('.starci-core-page-header')!.getBoundingClientRect(),
      };
      expect(after.head.top).toBe(head.top);
      expect(after.composer.top).toBe(composer.top);
      expect(after.band.top).toBe(band.top);
      expect(composer.bottom).toBeLessThanOrEqual(window.innerHeight + 1);
      expect(head.top).toBeGreaterThanOrEqual(band.bottom - 1);
    });
  },
};
