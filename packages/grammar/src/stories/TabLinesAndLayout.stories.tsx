import type { Meta, StoryObj } from '@storybook/react-vite';
import { Component, Suspense, createElement, lazy, useState, type ReactNode } from 'react';
import { expect, waitFor, within } from 'storybook/test';
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
const PHONE = 358; // a 390px phone less its 16px page inset on each side

const box = (element: Element) => element.getBoundingClientRect();
const px = (value: string) => Number.parseFloat(value);

/**
 * The line owner of one strip, measured: the strip's frame draws it (`own`: a bottom border of the frame) or the host's divider
 * is it (`host`: the bottom border of `host`, the frame draws none). Asserts the owner's mode, that exactly one line is drawn under the
 * strip, and that the selected indicator is 2px with its bottom edge on the line's bottom edge.
 */
const assertOneLine = (frame: HTMLElement, mode: 'own' | 'host', host?: HTMLElement) => {
  expect(frame.dataset.grammarTabsLine).toBe(mode);
  const frameStyle = getComputedStyle(frame);
  const frameLine = px(frameStyle.borderBottomWidth);
  const hostLine = host === undefined ? 0 : px(getComputedStyle(host).borderBottomWidth);
  // Exactly one line: the frame's in `own` mode, the host's in `host` mode, never both and never neither. A line is one device pixel
  // (a border snaps to it), so it is measured, not assumed to be 1.
  const [owner, other] = mode === 'own' ? [frameLine, hostLine] : [hostLine, frameLine];
  expect(owner).toBeGreaterThan(0);
  expect(owner).toBeLessThanOrEqual(1.5);
  expect(other).toBe(0);
  expect(frame.querySelectorAll('[data-component="Divider"]').length).toBe(0);
  const line = mode === 'own' ? frame : host;
  if (line === undefined) throw new Error('A hosted strip needs its host');
  const indicator = frame.querySelector<HTMLElement>('[role="tab"][aria-selected="true"] .tabs__indicator');
  if (indicator === null) throw new Error('The selected tab draws its indicator');
  expect(Math.abs(box(indicator).bottom - box(line).bottom)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(box(indicator).height - 2)).toBeLessThanOrEqual(0.5);
  // The strip stands on the line with nothing under it: its last tab ends where the line begins.
  const tab = frame.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
  if (tab === null) throw new Error('A selected tab');
  expect(Math.abs(box(tab).bottom - (box(line).bottom - owner))).toBeLessThanOrEqual(0.5);
  return indicator;
};

const frameIn = (zone: HTMLElement): HTMLElement => {
  const frame = zone.querySelector<HTMLElement>('[data-grammar-tabs="true"][data-grammar-tabs-client="ready"]');
  if (frame === null) throw new Error('The strip renders');
  return frame;
};

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
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const band = canvasElement.querySelector<HTMLElement>('[data-story-views-head="true"] [data-component="PageHeader"]');
      if (band === null) throw new Error('the page header renders');
      assertOneLine(frameIn(band), 'host', band);
      expect(band.querySelector('[data-grammar-page-header-separator]')).toBeNull();
      const own = canvasElement.querySelector<HTMLElement>('[data-story-own="true"]');
      if (own === null) throw new Error('the standalone strip renders');
      assertOneLine(frameIn(own), 'own');
    }, { timeout: 4000 });
  },
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
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      // The primary switch stands in the section head, at its end: a pill in a track with no line.
      const head = canvasElement.querySelector<HTMLElement>('[data-story-switch="head"] .starci-core-section-header');
      if (head === null) throw new Error('the section head renders');
      const switchFrame = frameIn(head);
      expect(switchFrame.dataset.grammarTabsVariant).toBe('primary');
      expect(switchFrame.dataset.grammarTabsLine).toBe('none');
      expect(box(switchFrame).left).toBeGreaterThan(box(head).left);
      // Primary alone: a pill in a track, role tab, no count, no line.
      const alone = canvasElement.querySelector<HTMLElement>('[data-story-primary="alone"]');
      const pill = alone === null ? null : frameIn(alone);
      if (alone === null || pill === null) throw new Error('the primary strip renders');
      expect(pill.dataset.grammarTabsVariant).toBe('primary');
      expect(px(getComputedStyle(pill).borderBottomWidth)).toBe(0);
      expect(alone.querySelectorAll('[role="tab"]').length).toBe(3);
      expect(alone.querySelectorAll('[data-grammar-tab-count]').length).toBe(0);
      const track = alone.querySelector<HTMLElement>('.tabs__list-container');
      if (track === null) throw new Error('the pill track renders');
      expect(getComputedStyle(track).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
      // Secondary standalone: its own line, the indicator on it.
      const own = canvasElement.querySelector<HTMLElement>('[data-story-own="true"]');
      if (own === null) throw new Error('the standalone secondary strip renders');
      expect(frameIn(own).dataset.grammarTabsVariant).toBe('secondary');
      assertOneLine(frameIn(own), 'own');
      expect(canvasElement.scrollWidth).toBeLessThanOrEqual(canvasElement.clientWidth + 1);
    }, { timeout: 5000 });
  },
});

/** Both appearances at 1920px. */
export const TabsAppearances1920: Story = appearanceStory(WIDE);
/** Both appearances at 390px. */
export const TabsAppearances390: Story = appearanceStory(PHONE);

/* ---------- the surface radius token, and the content maximum ---------- */

/** What `min(32px, var(--radius-3xl))` computes to here, from a probe: the card radius HeroUI's own Card draws. */
const probedRadius = (host: HTMLElement, expression: string): string => {
  const probe = document.createElement('div');
  probe.style.borderRadius = expression;
  host.append(probe);
  const radius = getComputedStyle(probe).borderTopLeftRadius;
  probe.remove();
  return radius;
};

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
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const surfacesOf = (name: string) => {
        const scope = canvasElement.querySelector<HTMLElement>(`[data-story-radius="${name}"]`);
        if (scope === null) throw new Error(`the ${name} scope renders`);
        return { scope, surfaces: Array.from(scope.querySelectorAll<HTMLElement>('.starci-core-surface, .starci-core-board-column')) };
      };
      const fallback = surfacesOf('default');
      expect(fallback.surfaces.length).toBeGreaterThanOrEqual(3);
      const expected = probedRadius(fallback.scope, 'min(32px, var(--radius-3xl))');
      for (const surface of fallback.surfaces) expect(getComputedStyle(surface).borderTopLeftRadius).toBe(expected);
      const overridden = surfacesOf('override');
      for (const surface of overridden.surfaces) expect(getComputedStyle(surface).borderTopLeftRadius).toBe('6px');
    }, { timeout: 5000 });
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
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const primary = canvasElement.querySelector<HTMLElement>('[data-grammar-workspace-primary="true"]');
      const content = canvasElement.querySelector<HTMLElement>('[data-story-content="true"]');
      if (primary === null || content === null) throw new Error('the shell renders');
      const max = Number.parseFloat(getComputedStyle(primary).fontSize) * 80;
      const maxPx = probedWidth(primary, 'var(--grammar-content-max)');
      expect(maxPx).toBeGreaterThan(0);
      expect(box(content).width).toBeLessThanOrEqual(maxPx + 0.5);
      expect(Math.abs(maxPx - max)).toBeLessThanOrEqual(1);
      // Centered in its column: the room between the content and its neighbours (the navigation, the rail, or the shell's edge) is the same on both sides.
      const shell = canvasElement.querySelector<HTMLElement>('[data-grammar-workspace-shell="true"]');
      if (shell === null) throw new Error('the shell renders');
      const navigation = canvasElement.querySelector<HTMLElement>('[data-grammar-workspace-navigation-region="true"]');
      const rail = canvasElement.querySelector<HTMLElement>('[data-grammar-workspace-rail-region="true"]');
      const areaStart = navigation === null ? box(shell).left : box(navigation).right;
      const areaEnd = rail === null ? box(shell).right : box(rail).left;
      const before = box(content).left - areaStart;
      const after = areaEnd - box(content).right;
      expect(Math.abs(before - after)).toBeLessThanOrEqual(Number.parseFloat(getComputedStyle(primary).paddingLeft) + 24 + 1);
      expect(box(content).width).toBeLessThanOrEqual(areaEnd - areaStart + 0.5);
      if (hasRail) expect(rail).not.toBeNull();
    }, { timeout: 5000 });
  },
});

const probedWidth = (host: HTMLElement, expression: string): number => {
  const probe = document.createElement('div');
  probe.style.inlineSize = expression;
  probe.style.position = 'absolute';
  host.append(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width;
};

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
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(canvasElement.querySelectorAll('[data-grammar-pane-area]').length).toBeGreaterThanOrEqual(2);
      expect(within(canvasElement).getByText('First pane')).toBeTruthy();
      expect(within(canvasElement).getByText('Second pane')).toBeTruthy();
    }, { timeout: 5000 });
  },
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
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const refusal = canvasElement.querySelector<HTMLElement>('[data-story-refusal="true"]');
      if (refusal === null) throw new Error('the grid refuses the child');
      expect(refusal.textContent).toContain('PANE_GRID_CHILD_NOT_PANE');
      expect(refusal.textContent).toContain('"use client"');
    }, { timeout: 5000 });
  },
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
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const refusal = canvasElement.querySelector<HTMLElement>('[data-story-refusal="true"]');
      if (refusal === null) throw new Error('the grid refuses the child');
      expect(refusal.textContent).toContain('PANE_GRID_CHILD_NOT_PANE: div');
      expect(canvasElement.querySelector('[data-component="PaneGrid"]')).toBeNull();
    }, { timeout: 5000 });
  },
};
