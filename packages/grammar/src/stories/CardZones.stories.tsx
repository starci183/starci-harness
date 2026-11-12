import type { Meta, StoryObj } from '@storybook/react-vite';
import { Component, Suspense, createElement, lazy, useState, type ReactNode } from 'react';
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test';
import * as G from '../common/index.js';
import { Matrix, State, noop } from './fixtures.js';

/**
 * Card zones: typed bands above (`headers`) and below (`footers`) a card's body. The shell pads them and draws the ONE divider between
 * neighbouring zones and between a zone and the body. A tab strip's line is the zone's divider (the strip draws none of its own); a
 * standalone strip draws its own. The stories measure both.
 */
const meta: Meta = { title: 'Surfaces/Card zones' };
export default meta;
type Story = StoryObj;

/** The widths the stories draw at, set on the story's own box so the container-driven fold and the measures never depend on the viewport. */
const WIDE = 'min(100%, 1800px)';
const PHONE = 358; // a 390px phone less its 16px page inset on each side

type Member = { readonly id: string; readonly name: string; readonly role: string; readonly status: 'active' | 'invited' };
const MEMBERS: readonly Member[] = [
  { id: 'm1', name: 'Alex Morgan', role: 'Owner', status: 'active' },
  { id: 'm2', name: 'Sam Lee', role: 'Sales agent', status: 'active' },
  { id: 'm3', name: 'Maria Garcia', role: 'Booking agent', status: 'invited' },
  { id: 'm4', name: 'Jordan Kim', role: 'Content agent', status: 'active' },
  { id: 'm5', name: 'Taylor Fox', role: 'Support agent', status: 'invited' },
];

const rowOf = (member: Member): G.ListRowData => ({ id: member.id, title: member.name, description: member.role });
const placeholder: readonly G.ListRowData[] = MEMBERS.map((member) => ({ ...rowOf(member), title: ' ', description: ' ' }));
const empty = <G.EmptyNotice message="Nobody matches." />;
const failure: G.ErrorData = { message: 'Could not load the members.', actionLabel: 'Try again', onAction: noop };

const tabsOf = (query: string): readonly G.TabItem[] => {
  const matching = MEMBERS.filter((member) => member.name.toLowerCase().includes(query.toLowerCase()));
  return [
    { id: 'all', label: 'All', count: matching.length },
    { id: 'active', label: 'Active', count: matching.filter((member) => member.status === 'active').length },
    { id: 'invited', label: 'Invited', count: matching.filter((member) => member.status === 'invited').length, isAttention: true },
    { id: 'owners', label: 'Owners', count: matching.filter((member) => member.role === 'Owner').length },
    { id: 'agents', label: 'Agents', count: matching.filter((member) => member.role.endsWith('agent')).length },
  ];
};

const visibleMembers = (tab: string, query: string): readonly G.ListRowData[] =>
  MEMBERS.filter((member) => member.name.toLowerCase().includes(query.toLowerCase()))
    .filter((member) => tab === 'all' || (tab === 'active' && member.status === 'active') || (tab === 'invited' && member.status === 'invited') || (tab === 'owners' && member.role === 'Owner') || (tab === 'agents' && member.role.endsWith('agent')))
    .map(rowOf);

const filterOf = (tab: string, setTab: (key: string) => void, query: string): G.FilterFields => ({
  label: 'Member status', items: tabsOf(query), selectedKey: tab, onSelect: setTab, overflowLabel: 'More', moreLabel: (count) => `${count} more filters`,
});
const searchOf = (query: string, setQuery: (value: string) => void): G.SearchFields => ({
  label: 'Search members', value: query, onChange: setQuery, placeholder: 'Search members', clearLabel: 'Clear search',
});

/* ---------- measuring: where the line under a tab strip is, and that there is exactly one ---------- */

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

const zoneOf = (canvas: HTMLElement, kind: string): HTMLElement => {
  const zone = canvas.querySelector<HTMLElement>(`[data-grammar-zone="${kind}"]`);
  if (zone === null) throw new Error(`The ${kind} zone renders`);
  return zone;
};

const frameIn = (zone: HTMLElement): HTMLElement => {
  const frame = zone.querySelector<HTMLElement>('[data-grammar-tabs="true"][data-grammar-tabs-client="ready"]');
  if (frame === null) throw new Error('The strip renders');
  return frame;
};

/** The divider between a header zone and what follows it is the zone's own bottom border: the next element draws no top border. */
const assertSeamAfter = (zone: HTMLElement) => {
  expect(px(getComputedStyle(zone).borderBottomWidth)).toBeGreaterThan(0);
  const next = zone.nextElementSibling;
  if (next !== null) expect(px(getComputedStyle(next).borderTopWidth)).toBe(0);
};

/* ---------- a list with a toolbar ---------- */

const ToolbarList = () => {
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  return (
    <G.SurfaceCard
      kind="list"
      label="Members"
      fact={`${MEMBERS.length} people`}
      headers={[{ kind: 'toolbar', filter: filterOf(tab, setTab, query), search: searchOf(query, setQuery) }]}
      items={visibleMembers(tab, query)}
      empty={empty}
    />
  );
};

/** One toolbar zone: the filter tabs at the leading edge, a compact search at the trailing edge, the zone's divider under the tabs. */
export const ListWithToolbar: Story = {
  render: () => <div style={{ width: 'min(100%, 720px)' }}><ToolbarList /></div>,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const zone = zoneOf(canvasElement, 'toolbar');
      assertOneLine(frameIn(zone), 'host', zone);
      assertSeamAfter(zone);
      // The tabs lead and the search trails, in one row (a card narrower than 36rem folds the search into a button, the fold story).
      const field = zone.querySelector<HTMLElement>('[data-component="SearchField"]');
      const first = zone.querySelector<HTMLElement>('[role="tab"]');
      if (field === null || first === null) throw new Error('tabs and search render');
      if (box(zone).width > 576) {
        expect(box(first).left).toBeLessThan(box(field).left);
        expect(box(field).right).toBeGreaterThan(box(zone).right - 40);
        expect(Math.abs(box(first).top - box(field).top)).toBeLessThanOrEqual(12);
      }
    }, { timeout: 4000 });
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('tab', { name: /Invited/ }));
    await waitFor(() => expect(canvasElement.querySelectorAll('[data-grammar-list="true"] > li').length).toBe(2), { timeout: 4000 });
  },
};

/* ---------- filter and search as two zones ---------- */

const TwoZoneList = () => {
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  return (
    <G.SurfaceCard
      kind="list"
      label="Members"
      headers={[{ kind: 'search', ...searchOf(query, setQuery) }, { kind: 'filter', ...filterOf(tab, setTab, query) }]}
      items={visibleMembers(tab, query)}
      empty={empty}
    />
  );
};

/** A search zone, then a filter zone: one divider between them, and the filter zone's divider is the line under its tabs. */
export const ListWithFilterAndSearchZones: Story = {
  render: () => <div style={{ maxWidth: 560 }}><TwoZoneList /></div>,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const search = zoneOf(canvasElement, 'search');
      const filter = zoneOf(canvasElement, 'filter');
      expect(search.nextElementSibling).toBe(filter);
      assertSeamAfter(search);
      assertOneLine(frameIn(filter), 'host', filter);
      assertSeamAfter(filter);
    }, { timeout: 4000 });
    fireEvent.change(within(canvasElement).getByRole('searchbox', { name: 'Search members' }), { target: { value: 'taylor' } });
    await waitFor(() => expect(canvasElement.querySelectorAll('[data-grammar-list="true"] > li').length).toBe(1), { timeout: 4000 });
  },
};

/* ---------- figures plus a list ---------- */

/** A figures header zone over a list: one divider between the strip and the rows, none doubled. */
export const FiguresAndList: Story = {
  render: () => (
    <div style={{ maxWidth: 720 }}>
      <G.SurfaceCard
        kind="list"
        label="Team"
        headers={[{ kind: 'figures', items: [
          { id: 'a', term: 'People', value: 5 },
          { id: 'b', term: 'Active', value: 3 },
          { id: 'c', term: 'Invited', value: 2 },
        ] }]}
        items={MEMBERS.map(rowOf)}
        empty={empty}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const zone = zoneOf(canvasElement, 'figures');
      assertSeamAfter(zone);
      expect(getComputedStyle(zone).paddingTop).toBe('0px');
      const rows = canvasElement.querySelector<HTMLElement>('[data-grammar-list="true"]');
      if (rows === null) throw new Error('rows render');
      expect(box(rows).top).toBeGreaterThanOrEqual(box(zone).bottom - 0.5);
    }, { timeout: 4000 });
  },
};

/* ---------- figures: the lines run full-bleed ---------- */

const figureCells = (count: number): readonly G.Figure[] =>
  [
    { id: 'a', term: 'People', value: 5 },
    { id: 'b', term: 'Active', value: 3 },
    { id: 'c', term: 'Invited', value: 2 },
    { id: 'd', term: 'Owners', value: 1 },
  ].slice(0, count);

/**
 * Figures are one card whose cells are split by `--separator` lines that run full-bleed: the cells fill the strip edge to edge
 * (no inset, no gap), so a vertical line goes from the strip's top edge to its bottom edge and, wrapped 2 x 2, a horizontal line from
 * its left edge to its right edge; the strip touches the card's inner edges. Measured from the cells: they tile the strip exactly.
 */
const assertFullBleed = (strip: HTMLElement) => {
  const surface = strip.closest<HTMLElement>('.starci-core-surface');
  if (surface === null) throw new Error('the strip stands in a card surface');
  const cells = Array.from(strip.querySelectorAll<HTMLElement>('[data-grammar-description-pair]'));
  expect(cells.length).toBeGreaterThan(1);
  const edge = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(0.5);
  // The strip touches the card's inner left and right edges.
  edge(box(strip).left, box(surface).left);
  edge(box(strip).right, box(surface).right);
  const rows: HTMLElement[][] = [];
  for (const cell of cells) {
    const row = rows.find((candidate) => Math.abs(box(candidate[0] as HTMLElement).top - box(cell).top) <= 0.5);
    if (row === undefined) rows.push([cell]);
    else row.push(cell);
  }
  rows.forEach((row, index) => {
    const first = row[0] as HTMLElement;
    const last = row[row.length - 1] as HTMLElement;
    // Each row runs from the strip's left edge to its right edge, its cells touching: a horizontal line spans the strip.
    edge(box(first).left, box(strip).left);
    edge(box(last).right, box(strip).right);
    row.forEach((cell, at) => {
      // The cells of a row share one top and bottom, so a vertical line runs the row's full height.
      edge(box(cell).top, box(first).top);
      edge(box(cell).bottom, box(first).bottom);
      if (at > 0) edge(box(cell).left, box(row[at - 1] as HTMLElement).right);
      // Every cell draws its start and top lines (the strip clips the ones on its outer edge).
      expect(getComputedStyle(cell).boxShadow).not.toBe('none');
    });
    // The rows touch, and the strip's first row starts at its top and its last ends at its bottom: no inset, no gap.
    if (index === 0) edge(box(first).top, box(strip).top);
    else edge(box(first).top, box((rows[index - 1] as HTMLElement[])[0] as HTMLElement).bottom);
    if (index === rows.length - 1) edge(box(first).bottom, box(strip).bottom);
  });
  return rows.length;
};

/** The figures card and a figures zone: one row at 40rem and over, 2 x 2 wrapped, an odd last cell growing across its row. */
export const FiguresFullBleed: Story = {
  render: () => (
    <Matrix>
      <State label="A figures card, one row" direction="column">
        <div data-story-strip="row" style={{ width: 'min(100%, 720px)' }}><G.SurfaceCard kind="figures" label="Team" items={figureCells(4)} /></div>
      </State>
      <State label="A figures zone over a list, wrapped 2 x 2" direction="column">
        <div data-story-strip="wrap" style={{ width: 360 }}>
          <G.SurfaceCard kind="list" label="Team" headers={[{ kind: 'figures', items: figureCells(4) }]} items={MEMBERS.slice(0, 2).map(rowOf)} empty={empty} />
        </div>
      </State>
      <State label="Four money figures at phone width: wrapped before a value breaks" direction="column">
        <div data-story-strip="money" style={{ width: PHONE }}>
          <G.SurfaceCard
            kind="figures"
            label="Revenue"
            items={[
              { id: 'a', term: 'This month', value: '12,000,000', unit: '$' },
              { id: 'b', term: 'Last month', value: '9,450,000', unit: '$' },
              { id: 'c', term: 'Outstanding', value: '3,200,000', unit: '$' },
              { id: 'd', term: 'Refunded', value: '450,000', unit: '$' },
            ]}
          />
        </div>
      </State>
      <State label="Three figures, wrapped, the odd one across its row" direction="column">
        <div data-story-strip="odd" style={{ width: 360 }}><G.SurfaceCard kind="figures" label="Team" items={figureCells(3)} /></div>
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const strip = (name: string) => {
        const found = canvasElement.querySelector<HTMLElement>(`[data-story-strip="${name}"] [data-grammar-description-layout="stat-strip"]`);
        if (found === null) throw new Error(`the ${name} strip renders`);
        return found;
      };
      expect(assertFullBleed(strip('row'))).toBe(box(strip('row')).width >= 640 ? 1 : 2);
      expect(assertFullBleed(strip('wrap'))).toBe(2);
      expect(assertFullBleed(strip('odd'))).toBe(2);
      // Money figures: no value breaks inside its number. At phone width the strip is 2 x 2 or one column, never a row that crushes a value.
      const money = strip('money');
      const rowsOfMoney = assertFullBleed(money);
      expect([2, 4]).toContain(rowsOfMoney);
      for (const value of Array.from(money.querySelectorAll<HTMLElement>('.starci-core-description-figure-value'))) {
        const cell = value.closest<HTMLElement>('[data-grammar-description-pair]');
        if (cell === null) throw new Error('a value stands in its cell');
        expect(getComputedStyle(value).whiteSpace).toBe('nowrap');
        expect(box(value).height).toBeLessThanOrEqual(Number.parseFloat(getComputedStyle(value).lineHeight) + 1);
        expect(box(value).right).toBeLessThanOrEqual(box(cell).right + 0.5);
      }
    }, { timeout: 4000 });
  },
};

/**
 * The five-figure ribbon at the three tiers (responsive law), answering the strip's own width: 390 (a phone) is 2 + 2 + 1 with the odd last
 * cell across its row; 700 (a tablet) is 3 + 2, two balanced rows; 1000 (a desktop) is one row. Labels keep one or two lines, never a word
 * per line, and the value stays 20 and the meta 12.
 */
export const FiguresRibbonFive: Story = {
  render: () => {
    const items: readonly G.Figure[] = [
      { id: 'a', term: 'Visitors, 7 days', value: 128, meta: 'vs last week' },
      { id: 'b', term: 'Conversations', value: 342, meta: 'open 12' },
      { id: 'c', term: 'Orders created', value: 57, meta: 'today 6' },
      { id: 'd', term: 'Close rate', value: '18%', meta: 'target 20%' },
      { id: 'e', term: 'Estimated revenue', value: '12.4M', meta: 'this month' },
    ];
    return (
      <Matrix>
        <State label="Phone 390: 2 + 2 + 1" direction="column"><div data-story-strip="phone" style={{ width: 390 }}><G.SurfaceCard kind="figures" label="Overview" items={items} /></div></State>
        <State label="Tablet 700: 3 + 2" direction="column"><div data-story-strip="tablet" style={{ width: 700 }}><G.SurfaceCard kind="figures" label="Overview" items={items} /></div></State>
        <State label="Desktop 1000: one row" direction="column"><div data-story-strip="desktop" style={{ width: 1000 }}><G.SurfaceCard kind="figures" label="Overview" items={items} /></div></State>
      </Matrix>
    );
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const strip = (name: string) => {
        const found = canvasElement.querySelector<HTMLElement>(`[data-story-strip="${name}"] [data-grammar-description-layout="stat-strip"]`);
        if (found === null) throw new Error(`the ${name} strip renders`);
        return found;
      };
      const phone = strip('phone');
      expect(assertFullBleed(phone)).toBe(3);
      const cells = Array.from(phone.querySelectorAll<HTMLElement>('[data-grammar-description-pair]'));
      // The odd last cell spans the whole row.
      expect(Math.abs(box(cells[4] as HTMLElement).width - box(phone).width)).toBeLessThan(1.5);
      expect(assertFullBleed(strip('tablet'))).toBe(2);
      expect(assertFullBleed(strip('desktop'))).toBe(1);
      for (const term of Array.from(phone.querySelectorAll<HTMLElement>('.starci-core-description-stat-term > span'))) {
        const lines = box(term).height / Number.parseFloat(getComputedStyle(term).lineHeight);
        expect(lines).toBeLessThanOrEqual(2.05);
        expect(getComputedStyle(term).fontSize).toBe('14px');
      }
      for (const meta of Array.from(phone.querySelectorAll<HTMLElement>('.starci-core-description-meta'))) expect(getComputedStyle(meta).fontSize).toBe('12px');
      for (const value of Array.from(phone.querySelectorAll<HTMLElement>('.starci-core-description-figure'))) expect(getComputedStyle(value).fontSize).toBe('20px');
    }, { timeout: 4000 });
  },
};

/* ---------- footers ---------- */

/** A footer `more`: one divider between the rows and the footer, drawn by the footer's top border. */
export const FooterMore: Story = {
  render: () => (
    <div style={{ maxWidth: 560 }}>
      <G.SurfaceCard
        kind="list"
        label="Recent members"
        items={MEMBERS.slice(0, 3).map(rowOf)}
        empty={empty}
        footers={[{ kind: 'more', label: 'See all members', press: noop }]}
        note="Updated just now."
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const footer = zoneOf(canvasElement, 'more');
      expect(px(getComputedStyle(footer).borderTopWidth)).toBeGreaterThan(0);
      const main = footer.previousElementSibling;
      if (main === null) throw new Error('the body precedes the footer');
      expect(px(getComputedStyle(main).borderBottomWidth)).toBe(0);
      expect(within(footer).getByRole('button', { name: 'See all members' })).toBeTruthy();
    }, { timeout: 4000 });
  },
};

/** The two other typed footers: a `more` that is a link, and a minimal pager. */
export const FooterLinkAndPaging: Story = {
  render: () => (
    <Matrix maxWidth={560}>
      <State label="A link footer" direction="column">
        <G.SurfaceCard kind="list" label="Recent members" items={MEMBERS.slice(0, 2).map(rowOf)} empty={empty} footers={[{ kind: 'more', label: 'Open the directory', href: '#directory' }]} />
      </State>
      <State label="A pager footer" direction="column">
        <G.SurfaceCard
          kind="list"
          label="All members"
          items={MEMBERS.slice(0, 2).map(rowOf)}
          empty={empty}
          footers={[{ kind: 'paging', page: 2, pageCount: 6, onPage: noop, labels: { nav: 'Member pages', previous: 'Previous', next: 'Next', page: (page) => `Page ${page}`, summary: '6-10 of 52' } }]}
        />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(within(zoneOf(canvasElement, 'paging')).getByRole('navigation', { name: 'Member pages' })).toBeTruthy();
      expect(within(canvasElement).getByRole('link', { name: 'Open the directory' })).toBeTruthy();
    }, { timeout: 4000 });
  },
};

/* ---------- loading, error and empty draw in the body; the zones keep their geometry ---------- */

const StateCard = ({ mode }: { readonly mode: 'ready' | 'loading' | 'error' | 'empty' }) => {
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  return (
    <div data-story-mode={mode}>
      <G.SurfaceCard
        kind="list"
        label="Members"
        headers={[{ kind: 'toolbar', filter: filterOf(tab, setTab, mode === 'empty' ? 'zzz' : ''), search: searchOf(query, setQuery) }]}
        items={mode === 'loading' ? placeholder : mode === 'empty' || mode === 'error' ? [] : MEMBERS.map(rowOf)}
        empty={empty}
        footers={[{ kind: 'more', label: 'See all members', press: noop }]}
        {...(mode === 'loading' ? { isLoading: true } : {})}
        {...(mode === 'error' ? { error: failure } : {})}
      />
    </div>
  );
};

/** Loading, error and empty draw in the body; the toolbar and the footer keep their box in every state. */
export const ZoneStates: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="Ready" direction="column"><StateCard mode="ready" /></State>
      <State label="Loading" direction="column"><StateCard mode="loading" /></State>
      <State label="Error" direction="column"><StateCard mode="error" /></State>
      <State label="Empty" direction="column"><StateCard mode="empty" /></State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const heights = (selector: string) => ['ready', 'loading', 'error', 'empty'].map((mode) => {
        const element = canvasElement.querySelector<HTMLElement>(`[data-story-mode="${mode}"] ${selector}`);
        if (element === null) throw new Error(`${selector} renders in ${mode}`);
        return box(element).height;
      });
      for (const selector of ['[data-grammar-zone="toolbar"]', '[data-grammar-zone="more"]']) {
        const [ready, ...others] = heights(selector);
        for (const height of others) expect(Math.abs(height - (ready ?? 0))).toBeLessThanOrEqual(1);
      }
      const loading = canvasElement.querySelector('[data-story-mode="loading"] [data-grammar-zone="toolbar"] [role="tab"]');
      expect(loading).not.toBeNull();
      expect(canvasElement.querySelector('[data-story-mode="loading"] [aria-busy="true"]')).not.toBeNull();
      expect(canvasElement.querySelector('[data-story-mode="empty"] [data-grammar-collection="empty"]')).not.toBeNull();
      expect(within(canvasElement.querySelector<HTMLElement>('[data-story-mode="error"]') ?? canvasElement).getByText('Could not load the members.')).toBeTruthy();
    }, { timeout: 4000 });
  },
};

/* ---------- the mobile fold at 390px ---------- */

/**
 * At 390px the toolbar's extra tabs fold into "More" and the search is a search button that opens its own row. The fold trigger and the
 * button stand on the zone's line with no bottom padding of their own: their bottom is the line's bottom.
 */
export const MobileFold390: Story = {
  render: () => <div style={{ width: PHONE }}><ToolbarList /></div>,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const zone = zoneOf(canvasElement, 'toolbar');
      const frame = frameIn(zone);
      assertOneLine(frame, 'host', zone);
      const more = zone.querySelector<HTMLElement>('.starci-core-tabs-more button, .starci-core-tabs-more [role="button"]');
      if (more === null) throw new Error('the extra tabs fold into More');
      expect(more.textContent).toContain('More');
      const toggle = within(zone).getByRole('button', { name: 'Search members' });
      expect(zone.querySelector<HTMLElement>('.starci-core-surface-zone-search-wide')).toBeTruthy();
      expect(getComputedStyle(zone.querySelector<HTMLElement>('.starci-core-surface-zone-search-wide') as HTMLElement).display).toBe('none');
      // Both sit on the line: their bottom is the line's bottom (within the line's own pixel).
      const lineBottom = box(zone).bottom;
      expect(Math.abs(box(more).bottom - lineBottom)).toBeLessThanOrEqual(1.5);
      expect(Math.abs(box(toggle).bottom - lineBottom)).toBeLessThanOrEqual(1.5);
      expect(canvasElement.scrollWidth).toBeLessThanOrEqual(canvasElement.clientWidth + 1);
    }, { timeout: 4000 });
    const zone = zoneOf(canvasElement, 'toolbar');
    await userEvent.click(within(zone).getByRole('button', { name: 'Search members' }));
    await waitFor(() => {
      const row = canvasElement.querySelector<HTMLElement>('.starci-core-surface-zone-search-open');
      if (row === null) throw new Error('the search row opens');
      expect(within(row).getByRole('searchbox', { name: 'Search members' })).toBeTruthy();
      assertSeamAfter(row);
    });
  },
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
 * Measures the line under three strips: `views` in a page header (the band's bottom border is the line), a `filter` strip in a card zone
 * (the zone's divider is the line) and a standalone strip (its own frame draws it). Each has exactly one line and an indicator whose
 * bottom is the line's bottom, 2px tall.
 */
const lineStory = (width: string | number): Story => ({
  render: () => (
    <div style={{ width }}>
    <Matrix>
      <State label="views in a page header" direction="column"><PageHeadTabs /></State>
      <State label="filter in a card zone" direction="column"><TwoZoneList /></State>
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
      assertOneLine(frameIn(zoneOf(canvasElement, 'filter')), 'host', zoneOf(canvasElement, 'filter'));
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

/* ---------- a board's header zones ---------- */

const PipelineBoard = () => {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('all');
  return (
    <G.Board
      label="Sales pipeline"
      headers={[{ kind: 'toolbar', filter: filterOf(tab, setTab, ''), search: searchOf(query, setQuery) }]}
      columns={[
        { id: 'new', title: 'New', count: 2, items: MEMBERS.slice(0, 2).map(rowOf), empty: <G.Text tone="muted">Nothing here.</G.Text> },
        { id: 'qualified', title: 'Qualified', count: 1, items: MEMBERS.slice(2, 3).map(rowOf), empty: <G.Text tone="muted">Nothing here.</G.Text> },
        { id: 'won', title: 'Won', count: 0, items: [], empty: <G.Text tone="muted">Nothing here.</G.Text> },
      ]}
    />
  );
};

/** A board's header zones draw in one white strip on the well above the columns; the strip is the only added surface. */
export const BoardHeaderZones: Story = {
  render: () => (
    <div style={{ maxWidth: 900, padding: '1rem', background: 'var(--background)' }}>
      <PipelineBoard />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const strip = canvasElement.querySelector<HTMLElement>('[data-grammar-board-header="true"]');
      const columns = canvasElement.querySelector<HTMLElement>('.starci-core-board-columns');
      if (strip === null || columns === null) throw new Error('the header strip and the columns render');
      expect(box(strip).bottom).toBeLessThanOrEqual(box(columns).top);
      expect(getComputedStyle(strip).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
      const zone = zoneOf(canvasElement, 'toolbar');
      assertOneLine(frameIn(zone), 'host', zone);
      // The strip holds no surface card: only the columns' cards stand below it.
      expect(strip.querySelector('[data-component="SurfaceCard"]')).toBeNull();
    }, { timeout: 4000 });
  },
};

/* ---------- the ledger: a table card with day groups ---------- */

const LEDGER_COLUMNS: readonly G.TableColumnData[] = [
  { id: 'what', label: 'Description' },
  { id: 'account', label: 'Account', priority: 'low' },
  { id: 'in', label: 'In', numeric: true, priority: 'low' },
  { id: 'out', label: 'Out', numeric: true, priority: 'low' },
  { id: 'balance', label: 'Balance', numeric: true, priority: 'low' },
];

const ledgerRow = (id: string, what: string, account: string, income: string, expense: string, balance: string): G.TableRowData => ({
  id,
  cells: { what, account, in: income, out: expense, balance },
});

const LEDGER_GROUPS: readonly G.TableGroupData[] = [
  { id: 'd1', label: 'Thu 6 Nov', fact: '48,250,000', rows: [
    ledgerRow('r1', 'Annual plan, Sam Lee', 'Cash', '12,000,000', '', '48,250,000'),
    ledgerRow('r2', 'Supplies', 'Cash', '', '1,850,000', '36,250,000'),
    ledgerRow('r3', 'Deposit, Maria Garcia', 'Bank', '3,200,000', '', '38,100,000'),
  ] },
  { id: 'd2', label: 'Wed 5 Nov', fact: '35,050,000', rows: [
    ledgerRow('r4', 'Rent', 'Bank', '', '15,000,000', '35,050,000'),
    ledgerRow('r5', 'Support hours, Jordan Kim', 'Cash', '450,000', '', '50,050,000'),
  ] },
  { id: 'd3', label: 'Tue 4 Nov', fact: '49,600,000', rows: [
    ledgerRow('r6', 'Wages', 'Bank', '', '9,450,000', '49,600,000'),
  ] },
];

const LedgerCard = ({ mode }: { readonly mode: 'ready' | 'empty' | 'loading' | 'error' }) => (
  <G.SurfaceCard
    kind="table"
    label="Cash book"
    columns={LEDGER_COLUMNS}
    groups={mode === 'ready' || mode === 'loading' ? LEDGER_GROUPS : []}
    empty={<G.EmptyNotice message="No entries yet." />}
    headers={[{ kind: 'search', label: 'Search entries', value: '', onChange: noop, placeholder: 'Search entries' }]}
    footers={[{ kind: 'more', label: 'See older entries', press: noop }]}
    {...(mode === 'loading' ? { isLoading: true } : {})}
    {...(mode === 'error' ? { error: { message: 'Could not load the cash book.', actionLabel: 'Try again', onAction: noop } } : {})}
  />
);

/** Every line of a card runs to the card's inline edges, whatever draws it: measured from the card's own structure. */
const assertCardLines = (card: HTMLElement) => {
  const surface = card.querySelector<HTMLElement>('.starci-core-surface');
  if (surface === null) throw new Error('the card surface renders');
  const flush = (element: Element, what: string) => {
    expect(Math.abs(box(element).left - box(surface).left), `${what} starts at the card's left edge`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(box(element).right - box(surface).right), `${what} ends at the card's right edge`).toBeLessThanOrEqual(0.5);
  };
  let lines = 0;
  // Zone seams.
  for (const zone of Array.from(card.querySelectorAll('.starci-core-surface-zone'))) { flush(zone, 'a zone seam'); lines += 1; }
  // List row separators and accordion seams.
  for (const row of Array.from(card.querySelectorAll('[data-grammar-list="true"] > li'))) { flush(row, 'a list row line'); lines += 1; }
  for (const item of Array.from(card.querySelectorAll('.starci-core-accordion-row'))) { flush(item, 'an accordion seam'); lines += 1; }
  // Figure cells: the vertical lines and the 2 x 2 cross.
  for (const strip of Array.from(card.querySelectorAll<HTMLElement>('[data-grammar-description-layout="stat-strip"]'))) { assertFullBleed(strip); lines += 1; }
  // Table: the heading line, the group heading lines and every row line run from the first cell to the last.
  for (const row of Array.from(card.querySelectorAll<HTMLElement>('[role="row"]'))) {
    const cells = Array.from(row.querySelectorAll<HTMLElement>('[role="columnheader"], [role="gridcell"], [role="rowheader"]'));
    const first = cells[0];
    const last = cells[cells.length - 1];
    if (first === undefined || last === undefined) continue;
    expect(Math.abs(box(first).left - box(surface).left), 'a table line starts at the card edge').toBeLessThanOrEqual(0.5);
    expect(Math.abs(box(last).right - box(surface).right), 'a table line ends at the card edge').toBeLessThanOrEqual(0.5);
    lines += 1;
  }
  return lines;
};

/** The ledger with three day groups: one column header, group rows, every line to the card edges; at phone width the rows fold into a title and muted amounts. */
const ledgerStory = (width: string | number, isPhone: boolean): Story => ({
  render: () => <div data-story-ledger="true" style={{ width }}><LedgerCard mode="ready" /></div>,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const card = canvasElement.querySelector<HTMLElement>('[data-story-ledger="true"] [data-component="SurfaceCard"]');
      if (card === null) throw new Error('the ledger renders');
      // One column header, three group rows, six entries.
      expect(card.querySelectorAll('.starci-core-data-table-header').length).toBe(1);
      expect(card.querySelectorAll('[data-grammar-table-group="true"]').length).toBe(3);
      expect(card.querySelectorAll('[data-grammar-table-row="true"]').length).toBe(6);
      // The group rows show --surface-secondary (computed, not just declared): one probe paints the token to compare with.
      const probe = document.createElement('div');
      probe.style.background = 'var(--surface-secondary)';
      card.append(probe);
      const tint = getComputedStyle(probe).backgroundColor;
      probe.remove();
      expect(tint).not.toBe('rgba(0, 0, 0, 0)');
      for (const cell of Array.from(card.querySelectorAll<HTMLElement>('[data-grammar-table-group="true"] [role="gridcell"], [data-grammar-table-group="true"] .starci-core-data-table-group-cell'))) {
        expect(getComputedStyle(cell).backgroundColor).toBe(tint);
      }
      const narrow = card.querySelector('[data-component="DataTable"]')?.getAttribute('data-grammar-table-narrow');
      expect(narrow).toBe(isPhone ? 'true' : 'false');
      if (isPhone) expect(card.querySelectorAll('[data-grammar-table-secondary="true"]').length).toBe(6);
      expect(assertCardLines(card)).toBeGreaterThan(5);
      // Amounts never wrap and read in tabular numerals.
      for (const cell of Array.from(card.querySelectorAll<HTMLElement>('[data-grammar-table-numeric="true"]'))) {
        expect(getComputedStyle(cell).whiteSpace).toBe('nowrap');
        expect(getComputedStyle(cell).fontVariantNumeric).toContain('tabular-nums');
      }
    }, { timeout: 5000 });
  },
});

/** The ledger at 1920px. */
export const LedgerWide: Story = ledgerStory(WIDE, false);
/** The ledger at 390px. */
export const LedgerPhone: Story = ledgerStory(PHONE, true);

/** Empty, loading and error states of the ledger: the card keeps its zones, the table draws the state in its body. */
export const LedgerStates: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="Empty" direction="column"><div data-story-ledger="empty"><LedgerCard mode="empty" /></div></State>
      <State label="Loading" direction="column"><div data-story-ledger="loading"><LedgerCard mode="loading" /></div></State>
      <State label="Error" direction="column"><div data-story-ledger="error"><LedgerCard mode="error" /></div></State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const of = (name: string) => {
        const found = canvasElement.querySelector<HTMLElement>(`[data-story-ledger="${name}"]`);
        if (found === null) throw new Error(`the ${name} ledger renders`);
        return found;
      };
      expect(of('empty').querySelector('[data-grammar-table-empty="true"]')).not.toBeNull();
      expect(of('empty').querySelector('[data-grammar-zone="search"]')).not.toBeNull();
      expect(of('loading').querySelector('[data-grammar-skeleton="true"]')).not.toBeNull();
      expect(of('loading').querySelectorAll('[role="columnheader"]').length).toBe(LEDGER_COLUMNS.length);
      expect(within(of('error')).getByText('Could not load the cash book.')).toBeTruthy();
      // The zones keep their box in every state.
      for (const name of ['empty', 'loading', 'error']) expect(of(name).querySelector('[data-grammar-zone="more"]')).not.toBeNull();
    }, { timeout: 5000 });
  },
};

/** One measuring story that walks every line inside a card, for each kind that draws lines. */
const linesStory = (width: string | number): Story => ({
  render: () => (
    <div data-story-lines="true" style={{ width }}>
      <Matrix>
        <State label="Zones, rows and footer" direction="column"><ToolbarList /></State>
        <State label="Figures, one row or 2 x 2" direction="column"><G.SurfaceCard kind="figures" label="Team" items={figureCells(4)} /></State>
        <State label="A figures zone over rows" direction="column">
          <G.SurfaceCard kind="list" label="Team" headers={[{ kind: 'figures', items: figureCells(3) }]} items={MEMBERS.slice(0, 3).map(rowOf)} empty={empty} footers={[{ kind: 'more', label: 'See all', press: noop }]} />
        </State>
        <State label="An accordion" direction="column">
          <G.SurfaceCard
            kind="accordion"
            label="Help"
            items={[
              { id: 'a', title: 'How do I invite someone?', body: <G.Text>Open Members.</G.Text>, isOpen: false },
              { id: 'b', title: 'How do I change the plan?', body: <G.Text>Open Billing.</G.Text>, isOpen: true },
              { id: 'c', title: 'Where are my invoices?', body: <G.Text>In Billing.</G.Text>, isOpen: false },
            ]}
            onItemOpenChange={noop}
          />
        </State>
        <State label="A table with day groups" direction="column"><LedgerCard mode="ready" /></State>
      </Matrix>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const cards = Array.from(canvasElement.querySelectorAll<HTMLElement>('[data-story-lines="true"] [data-component="SurfaceCard"]'));
      expect(cards.length).toBe(5);
      for (const card of cards) expect(assertCardLines(card)).toBeGreaterThan(0);
    }, { timeout: 5000 });
  },
});

/** Every line of every card kind is flush to the card's edges, at 1920px. */
export const EveryLineIsFlush1920: Story = linesStory(WIDE);
/** The same walk at 390px. */
export const EveryLineIsFlush390: Story = linesStory(PHONE);

/* ---------- both appearances: secondary (the underline) and primary (a pill in a track) ---------- */

const PERIODS = [{ id: 'this', label: 'This month' }, { id: 'last', label: 'Last month' }] as const;

const PrimaryAndSecondary = () => {
  const [period, setPeriod] = useState('this');
  const [mode, setMode] = useState('list');
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  return (
    <Matrix>
      <State label="A card with a switch row inside it (title and pill, one line), then a toolbar zone" direction="column">
        <div data-story-switch="labelled">
          <G.SurfaceCard
            kind="list"
            label="Revenue"
            headers={[
              { kind: 'switch', label: 'Period', title: 'Revenue by period', items: PERIODS, selectedKey: period, onSelect: setPeriod },
              { kind: 'toolbar', filter: filterOf(tab, setTab, query), search: searchOf(query, setQuery) },
            ]}
            items={visibleMembers(tab, query)}
            empty={empty}
          />
        </div>
      </State>
      <State label="A card with no label: the same first header row, the pill at the trailing edge" direction="column">
        <div data-story-switch="unlabelled">
          <G.SurfaceCard
            kind="list"
            ariaLabel="Members"
            headers={[{ kind: 'switch', label: 'Layout', items: [{ id: 'list', label: 'List' }, { id: 'board', label: 'Board' }], selectedKey: mode, onSelect: setMode }]}
            items={MEMBERS.slice(0, 2).map(rowOf)}
            empty={empty}
          />
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
      // The switch zone is the card's first header row, INSIDE the surface (the label stays above on the well): the pill at the trailing
      // edge, an optional title at the leading edge, the zone's one line under it.
      const labelled = canvasElement.querySelector<HTMLElement>('[data-story-switch="labelled"]');
      if (labelled === null) throw new Error('the labelled card renders');
      const surface = labelled.querySelector<HTMLElement>('.starci-core-surface');
      const label = labelled.querySelector<HTMLElement>('.starci-core-surface-label');
      const zone = zoneOf(labelled, 'switch');
      const switchFrame = frameIn(zone);
      if (surface === null || label === null) throw new Error('the card surface and its label render');
      expect(surface.contains(zone)).toBe(true);
      expect(surface.contains(label)).toBe(false);
      expect(box(label).bottom).toBeLessThanOrEqual(box(surface).top + 0.5);
      expect(zone.previousElementSibling).toBeNull();
      expect(switchFrame.dataset.grammarTabsVariant).toBe('primary');
      expect(switchFrame.dataset.grammarTabsLine).toBe('none');
      assertSeamAfter(zone);
      const title = zone.querySelector<HTMLElement>('.starci-core-surface-zone-title');
      if (title === null) throw new Error('the switch title renders');
      expect(box(title).left).toBeLessThan(box(switchFrame).left);
      const padEnd = Number.parseFloat(getComputedStyle(zone).paddingRight);
      expect(Math.abs(box(switchFrame).right - (box(zone).right - padEnd))).toBeLessThanOrEqual(1);
      // The toolbar below it is secondary, and keeps its one line.
      const toolbar = zoneOf(labelled, 'toolbar');
      const secondary = frameIn(toolbar);
      expect(secondary.dataset.grammarTabsVariant).toBe('secondary');
      assertOneLine(secondary, 'host', toolbar);
      // A card with no label draws the same first header row, the pill at the trailing edge and empty space at the leading edge.
      const unlabelled = canvasElement.querySelector<HTMLElement>('[data-story-switch="unlabelled"]');
      if (unlabelled === null) throw new Error('the unlabelled card renders');
      const strip = zoneOf(unlabelled, 'switch');
      assertSeamAfter(strip);
      expect(strip.querySelector('.starci-core-surface-zone-title')).toBeNull();
      expect(Math.abs(box(frameIn(strip)).right - (box(strip).right - Number.parseFloat(getComputedStyle(strip).paddingRight)))).toBeLessThanOrEqual(1);
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
        <G.SurfaceCard kind="list" label="List" items={MEMBERS.slice(0, 2).map(rowOf)} empty={empty} />
        <G.SurfaceCard kind="figures" label="Figures" items={figureCells(3)} />
        <G.Board label="Board" columns={[{ id: 'a', title: 'New', count: 1, items: MEMBERS.slice(0, 1).map(rowOf), empty: <G.Text tone="muted">Nothing.</G.Text> }]} />
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
      expect(fallback.surfaces.length).toBeGreaterThanOrEqual(4);
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
