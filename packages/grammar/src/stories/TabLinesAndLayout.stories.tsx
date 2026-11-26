import type { Meta, StoryObj } from '@storybook/react-vite';
import { Component, Suspense, createElement, lazy, useState, type ReactNode } from 'react';
import * as G from '../common/index.js';
import { Matrix, State, noop } from './fixtures.js';

/**
 * Measures that do not belong to one component: the one line under any tab strip, the two tab appearances, the card radius token, the content maximum of a workspace
 * and the way a PaneGrid reads its panes.
 */
const meta: Meta = { title: 'Surfaces/Tab lines and layout measures' };
export default meta;
type Story = StoryObj;

/** The widths the stories draw at, set on the story's own box so the container-driven measures never depend on the viewport. */
const WIDE = 'min(100%, 1800px)';
const PHONE = 358;

/* ---------- one line under any tab strip, in both modes ---------- */

const PageHeadTabs = () => {
  const [tab, setTab] = useState('overview');
  return (
    <div data-story-views-head="true">
      <G.Page
        header={{
          title: 'Main account',
          tabs: { label: 'Connection', selectedKey: tab, onSelect: setTab, items: [{ id: 'overview', label: 'Overview' }, { id: 'setup', label: 'Setup' }, { id: 'test', label: 'Test' }] },
        }}
      >
        <G.Text>Page body</G.Text>
      </G.Page>
    </div>
  );
};

const OwnStrip = () => {
  const [tab, setTab] = useState('a');
  return (
    <div data-story-own="true">
      <G.Tabs label="Standalone" selectedKey={tab} onSelect={setTab} items={[{ id: 'a', label: 'First' }, { id: 'b', label: 'Second' }]} />
    </div>
  );
};

/**
 * Measures the line under two strips: `views` in a page header (the band's bottom border is the line) and a standalone strip (its own frame draws it).
 * Each has exactly one line and an indicator whose bottom is the line's bottom, 2px tall.
 */
const lineStory = (width: string | number): Story => ({
  render: () => (
    <div style={{ width }}>
    <Matrix>
      <State label="views in a page header" direction="column"><PageHeadTabs /></State>
      <State label="a standalone strip" direction="column"><OwnStrip /></State>
    </Matrix>
    </div>
  ),
});

/** The measure at 1920px. */
export const OneLineUnderTabs1920: Story = lineStory(WIDE);
/** The same measure at 390px. */
export const OneLineUnderTabs390: Story = lineStory(PHONE);

/* ---------- both appearances: secondary (the underline) and primary (a pill in a track) ---------- */

const PERIODS = [{ id: 'this', label: 'This month' }, { id: 'last', label: 'Last month' }] as const;

const PrimaryAndSecondary = () => {
  const [period, setPeriod] = useState('this');
  return (
    <Matrix>
      <State label="A section head with a primary switch at its end" direction="column">
        <div data-story-switch="head">
          <G.Section
            title="Revenue by period"
            action={<G.Tabs appearance="primary" label="Period" items={PERIODS} selectedKey={period} onSelect={setPeriod} />}
          >
            <G.Text>Revenue for the chosen period.</G.Text>
          </G.Section>
        </div>
      </State>
      <State label="Primary, standalone: three fixed options" direction="column">
        <div data-story-primary="alone">
          <G.Tabs appearance="primary" label="Range" items={[{ id: 'day', label: 'Day' }, { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }]} selectedKey="week" onSelect={noop} />
        </div>
      </State>
      <State label="Secondary, standalone: the underline" direction="column"><OwnStrip /></State>
    </Matrix>
  );
};

/** Secondary (the default, HeroUI's secondary: the underline) keeps the one-line rule; primary (a pill in a track) has no line and no count. */
const appearanceStory = (width: string | number): Story => ({
  render: () => <div style={{ width }}><PrimaryAndSecondary /></div>,
});

/** Both appearances at 1920px. */
export const TabsAppearances1920: Story = appearanceStory(WIDE);
/** Both appearances at 390px. */
export const TabsAppearances390: Story = appearanceStory(PHONE);

/**
 * The card radius is Grammar's default token `--starci-core-surface-radius` (HeroUI's Card radius, `min(32px, var(--radius-3xl))`), and an
 * app's brand CSS may override it: a scoped wrapper that sets the token proves every card kind and the board columns follow it.
 */
export const SurfaceRadiusToken: Story = {
  render: () => {
    const cards = (
      <Matrix maxWidth={560}>
        <G.SurfaceCard label="Body">
          <G.Text>A body card.</G.Text>
        </G.SurfaceCard>
        <G.SurfaceCard label="Recommended" emphasis="accent">
          <G.Text>An emphasised card.</G.Text>
        </G.SurfaceCard>
        <G.Board label="Board" columns={[{ id: 'a', title: 'New', count: 1, items: [{ id: 'm1', title: 'Alex Morgan', description: 'Owner' }], empty: <G.Text tone="muted">Nothing.</G.Text> }]} />
      </Matrix>
    );
    return (
      <Matrix>
        <div data-story-radius="default">{cards}</div>
        <div data-story-radius="override" style={{ '--starci-core-surface-radius': '6px' } as React.CSSProperties}>{cards}</div>
      </Matrix>
    );
  },
};

/**
 * The content maximum: the content of a workspace's main column and of a page never grows past `--grammar-content-max` (80rem) and is
 * centered in its column, with and without an aside rail; the white header band and the aside stay full width.
 */
const contentMaxStory = (width: number, hasRail: boolean): Story => ({
  render: () => {
    const content = <div data-story-content="true" style={{ blockSize: 40, background: 'var(--surface-secondary)' }}>Content</div>;
    return (
      <div style={{ inlineSize: width }}>
        {hasRail
          ? <G.WorkspaceShell navigation={<div>Navigation</div>} navigationLabel="Workspace" primaryLabel="Page" primary={content} rail={<div>Aside</div>} railLabel="Aside" />
          : <G.WorkspaceShell primaryLabel="Page" primary={content} />}
      </div>
    );
  },
});

/** The content maximum at 1920px and 2560px widths, with and without the aside. */
export const ContentMax1920: Story = contentMaxStory(1920, false);
export const ContentMax1920WithAside: Story = contentMaxStory(1920, true);
export const ContentMax2560: Story = contentMaxStory(2560, false);
export const ContentMax2560WithAside: Story = contentMaxStory(2560, true);

/* ---------- PaneGrid and a Pane built in a server component ---------- */

/** What a server component's `<Pane>` is on the client: a lazy client reference that resolves to `Pane`, not the `Pane` function. */
const ServerBuiltPane = lazy(async () => ({ default: G.Pane }));
/** A lazy client reference that is NOT a Pane. */
const ServerBuiltOther = lazy(async () => ({ default: () => <div>Not a pane</div> }));

class RefusalBoundary extends Component<{ readonly children: ReactNode }, { readonly message: string | null }> {
  override state: { readonly message: string | null } = { message: null };
  static getDerivedStateFromError(error: unknown) { return { message: error instanceof Error ? error.message : String(error) }; }
  override render() { return this.state.message === null ? this.props.children : <div data-story-refusal="true">{this.state.message}</div>; }
}

/** A Pane built in a server component reaches PaneGrid as a lazy client reference: it is recognised and drawn, never dropped. */
export const PaneGridServerBuiltPane: Story = {
  render: () => (
    <div style={{ blockSize: 240 }}>
      <Suspense fallback={<G.Text>Loading</G.Text>}>
        <G.PaneGrid label="Server built panes" areas={['a b']}>
          {createElement(ServerBuiltPane, { area: 'a', label: 'First', surface: true, children: <G.PaneSection><G.Text>First pane</G.Text></G.PaneSection> } as never)}
          {createElement(ServerBuiltPane, { area: 'b', label: 'Second', surface: true, children: <G.PaneSection><G.Text>Second pane</G.Text></G.PaneSection> } as never)}
        </G.PaneGrid>
      </Suspense>
    </div>
  ),
};

/** A client reference that is not a Pane is refused loudly (in production too), with the message that says what to do. */
export const PaneGridServerBuiltPaneRefused: Story = {
  render: () => (
    <RefusalBoundary>
      <Suspense fallback={<G.Text>Loading</G.Text>}>
        <G.PaneGrid label="Refused" areas={['a']}>
          {createElement(ServerBuiltOther, { area: 'a' } as never)}
        </G.PaneGrid>
      </Suspense>
    </RefusalBoundary>
  ),
};

/** A real non-Pane child (a plain element) fails loudly too: the error names it, there is no silent empty grid. */
export const PaneGridStrayChildRefused: Story = {
  render: () => (
    <RefusalBoundary>
      <G.PaneGrid label="Stray" areas={['a']}>
        <div>Stray child</div>
      </G.PaneGrid>
    </RefusalBoundary>
  ),
};
