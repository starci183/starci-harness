import type { Meta, StoryObj } from '@storybook/react-vite';
import { parseDate, type DateValue } from '@internationalized/date';
import { useState } from 'react';
import { expect, userEvent, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import { MermaidDiagram as GraphMermaidDiagram } from '../core/ext/graph/index.js';
import '../core/ext/graph/styles.css';
import { BookGlyph, HomeGlyph, Matrix, MemoryRouterRoot, State, familyScope, noop, pageLabel, placeholderImage, showRowStates, textContrast } from './fixtures.js';

/**
 * Navigation and data display: wayfinding (tabs, breadcrumbs, pagination, stepper), collections
 * (table, list box, tags, timeline) and disclosure. Selected/current states are shown where they apply.
 */
const meta: Meta = {
  title: 'Navigation & Data',
};
export default meta;

type Story = StoryObj;

const faq: ReadonlyArray<G.AccordionItem> = [
  { id: 'billing', title: 'How does billing work?', content: 'You are billed monthly for active seats.' },
  { id: 'cancel', title: 'Can I cancel any time?', content: 'Yes. Access continues until the end of the period.' },
  { id: 'archived', title: 'Archived plans', content: 'Not available.', isDisabled: true },
];

export const Accordion: Story = {
  render: () => (
    <Matrix maxWidth={560}>
      <State label="One expanded (selected)" direction="column">
        <G.Accordion label="Frequently asked questions" items={faq} defaultExpandedIds={['billing']} />
      </State>
      <State label="Multiple expanded" direction="column">
        <G.Accordion label="Details" items={faq} allowsMultipleExpanded defaultExpandedIds={['billing', 'cancel']} headingLevel={4} />
      </State>
    </Matrix>
  ),
};

export const Disclosure: Story = {
  render: () => (
    <Matrix maxWidth={560}>
      <State label="Collapsed" direction="column">
        <G.Disclosure title="Advanced options" body={"Retention, exports and audit settings."} />
      </State>
      <State label="Expanded" direction="column">
        <G.Disclosure title="What is included?" defaultExpanded body={"Every document, offline access and certificates."} />
      </State>
      <State label="With a summary (closed, open, long)" direction="column">
        <G.Disclosure title="Filters" summary="3 active" body={"Status, owner and date."} />
        <G.Disclosure title="Filters" summary="3 active" defaultExpanded body={"Status, owner and date."} />
        <G.Disclosure title="Links" summary="https://example.com/a-very-long-link-that-must-truncate-on-one-line-and-never-wrap" body={"Body."} />
      </State>
      <State label="Disabled" direction="column">
        <G.Disclosure title="Locked section" isDisabled body={"Hidden."} />
      </State>
    </Matrix>
  ),
};

const people: ReadonlyArray<G.AvatarGroupItem> = [
  { id: 'a', name: 'Alex Morgan' },
  { id: 'b', name: 'Sam Lee', src: placeholderImage('S', 200) },
  { id: 'c', name: 'Robin Park' },
  { id: 'd', name: 'Jordan Kim' },
  { id: 'e', name: 'Taylor Fox' },
  { id: 'f', name: 'Casey Wu' },
];

export const PlainPressable: Story = {
  render: () => (
    <Matrix>
      <State label="Avatar button (round, 40px, press zoom-out, no hover)">
        <G.AvatarButton name="Alex Morgan" seed="user-alex" onPress={() => undefined} />
        <G.AvatarButton name="Sam Lee" seed="user-sam" src={placeholderImage('S', 200)} onPress={() => undefined} />
        <G.AvatarButton name="Robin Park" onPress={() => undefined} />
        <G.AvatarButton name={"Th\u1ea3o V\u00e2n Mkt"} kind="agent" seed="agent-marketing" onPress={() => undefined} />
      </State>
      <State label="Identity lockup (no caret)">
        <G.IdentityLockup title="Hakuen" subtitle="Owner" onPress={() => undefined} />
        <G.IdentityLockup title="Tedo Studio" subtitle="Member" logoSrc={placeholderImage('T', 200)} onPress={() => undefined} />
        <G.IdentityLockup title="Rounded opt-in" subtitle="Member" markShape="rounded" logoSrc={placeholderImage('R', 200)} onPress={() => undefined} />
      </State>
      <State label="As a menu trigger">
        <G.DropdownMenu
          trigger={<G.IdentityLockup title="Hakuen" subtitle="Owner" />}
          entries={[{ id: 'switch', label: 'Switch workspace' }, { id: 'out', label: 'Sign out' }]}
          onAction={() => undefined}
        />
      </State>
      <State label="Disabled">
        <G.IdentityLockup title="Hakuen" subtitle="Owner" isDisabled />
      </State>
    </Matrix>
  ),
};

const connections: ReadonlyArray<G.LogoStackItem> = [
  { id: 'mail', label: 'Mail', src: placeholderImage('M', 200) },
  { id: 'docs', label: 'Docs', iconSource: BookGlyph },
  { id: 'home', label: 'Home', iconSource: HomeGlyph },
  { id: 'chat', label: 'Chat' },
  { id: 'cal', label: 'Calendar', src: placeholderImage('C', 120) },
];

export const LogoStack: Story = {
  render: () => (
    <Matrix>
      <State label="Static: logos, one identity gap apart, no plate">
        <G.LogoStack label="Connections used by this agent" items={connections.slice(0, 3)} />
      </State>
      <State label="Overflow +N pill and caption (max 3)">
        <G.LogoStack label="Connections used by this agent" items={connections} caption="5 connections" />
      </State>
      <State label="Pressable (onPress): focus ring, no button fill">
        <G.LogoStack label="Connections used by this agent" items={connections} caption="5 connections" onPress={() => undefined} />
      </State>
      <State label="Pressable, disabled">
        <G.LogoStack label="Connections used by this agent" items={connections} onPress={() => undefined} isDisabled />
      </State>
      <State label="DropdownMenu trigger">
        <G.DropdownMenu
          trigger={<G.LogoStack isTrigger label="Connections used by this agent" items={connections} caption="5 connections" />}
          entries={connections.map((item) => ({ id: item.id, label: item.label }))}
        />
      </State>
      <State label="Loading (same box)">
        <G.LogoStack label="Connections used by this agent" items={connections} caption="5 connections" isLoading />
      </State>
      <State label="Own content as a trigger (PlainPressable)">
        <G.DropdownMenu
          trigger={<G.PlainPressable aria-label="Workspace"><span>Hakuen</span></G.PlainPressable>}
          entries={[{ id: 'one', label: 'One' }]}
        />
      </State>
    </Matrix>
  ),
};

export const AvatarGroup: Story = {
  render: () => (
    <Matrix>
      <State label="Overflow">
        <G.AvatarGroup label="Project members" items={people} max={4} overflowLabel={(count) => `${count} more members`} />
      </State>
      <State label="Sizes">
        <G.AvatarGroup label="Reviewers" items={people.slice(0, 3)} size="sm" overflowLabel={(count) => `${count} more`} />
        <G.AvatarGroup label="Owners" items={people.slice(0, 2)} size="md" overflowLabel={(count) => `${count} more`} />
      </State>
    </Matrix>
  ),
};

/** The trail is Page `header.breadcrumbs`: alone over a bleed page, or the first row of the band. */
export const PageBreadcrumbs: Story = {
  render: () => (
    <Matrix>
      <State label="Current crumb still loading (isLoading)">
        <G.Page chrome="bleed" minHeight="none" header={{ breadcrumbs: { label: 'Breadcrumb (loading page)', items: [{ id: 'home', label: 'Home', href: '#home' }, { id: 'documents', label: 'Documents', href: '#documents' }, { id: 'document', label: '', isLoading: true }] } }}>
          <span />
        </G.Page>
      </State>
      <State label="Trail ending at the current page">
        <G.Page
          chrome="bleed"
          minHeight="none"
          header={{
            breadcrumbs: {
              label: 'Breadcrumb',
              items: [
                { id: 'home', label: 'Home', href: '#home', leading: <G.Icon source={HomeGlyph} usage="leading" /> },
                { id: 'guides', label: 'Guides', href: '#guides' },
                { id: 'grammar', label: 'Grammar basics' },
              ],
            },
          }}
        >
          <span />
        </G.Page>
      </State>
    </Matrix>
  ),
};

const isWeekend = (date: DateValue) => {
  const day = new Date(date.year, date.month - 1, date.day).getDay();
  return day === 0 || day === 6;
};

export const Calendar: Story = {
  render: () => (
    <Matrix>
      <State label="Selected date, weekends unavailable">
        <G.Calendar label="Delivery date" defaultValue={parseDate('2026-09-23')} isDateUnavailable={isWeekend} previousLabel="Previous month" nextLabel="Next month" />
      </State>
      <State label="Read-only and disabled">
        <G.Calendar label="Published on" value={parseDate('2026-09-10')} isReadOnly previousLabel="Previous month" nextLabel="Next month" />
        <G.Calendar label="Closed" defaultValue={parseDate('2026-09-10')} isDisabled previousLabel="Previous month" nextLabel="Next month" />
      </State>
    </Matrix>
  ),
};

type Doc = { readonly id: string; readonly title: string; readonly level: string; readonly minutes: number };
const docs: ReadonlyArray<Doc> = [
  { id: 'l1', title: 'Articles', level: 'A1', minutes: 12 },
  { id: 'l2', title: 'Present simple', level: 'A1', minutes: 18 },
  { id: 'l3', title: 'Past continuous', level: 'A2', minutes: 22 },
  { id: 'l4', title: 'Conditionals', level: 'B1', minutes: 30 },
];
const docColumns: ReadonlyArray<G.DataTableColumn> = [
  { id: 'title', label: 'Document', isRowHeader: true, allowsSorting: true },
  { id: 'level', label: 'Level', allowsSorting: true },
  { id: 'minutes', label: 'Minutes', align: 'end', allowsSorting: true },
];
const docCell = (row: Doc, columnId: string) => (columnId === 'title' ? row.title : columnId === 'level' ? row.level : row.minutes);

/** The one suggestion pattern: quick replies and suggested questions are a Cluster of neutral sm Buttons (each a pill). */
export const SuggestionButtons: Story = {
  render: () => (
    <G.Cluster gap="inline" label="Suggested questions">
      {['How much does it cost?', 'What can you do?', 'Show my last invoice'].map((q) => (
        <G.Button key={q} size="sm" onPress={() => undefined}>{q}</G.Button>
      ))}
    </G.Cluster>
  ),
};

/** A table is never a card: a lone table is flat, titled by its Section head with one caption under it (lint card-is-object). */
export const LoneTableInSection: Story = {
  render: () => (
    <G.Section title="Documents" caption="Minutes are the median of the last 30 days.">
      <G.DataTable label="Documents" columns={docColumns} rows={docs} renderCell={docCell} emptyContent="No documents yet." />
    </G.Section>
  ),
};

const SortableTable = () => {
  const [sort, setSort] = useState<G.DataTableSort>({ columnId: 'title', direction: 'ascending' });
  const sorted = [...docs].sort((a, b) => {
    const key = sort.columnId as keyof Doc;
    const order = String(a[key]).localeCompare(String(b[key]), undefined, { numeric: true });
    return sort.direction === 'ascending' ? order : -order;
  });
  return (
    <G.DataTable
      label="Documents"
      columns={docColumns}
      rows={sorted}
      renderCell={docCell}
      sort={sort}
      onSortChange={setSort}
      selectionMode="multiple"
      defaultSelectedIds={['l2']}
      selectAllLabel="Select all documents"
      selectRowLabel={(row) => `Select ${row.title}`}
      emptyContent="No documents match."
    />
  );
};

type Seat = { readonly id: string; readonly href?: string; readonly name: string; readonly role: string; readonly seats: number; readonly email: string; readonly team: string };
const seatRows: ReadonlyArray<Seat> = [
  { id: 's1', href: '#member-alex', name: 'Alex Morgan', role: 'editor', seats: 2, email: 'alex@example.com', team: 'Grammar' },
  { id: 's2', href: '#member-sam', name: 'Sam Lee', role: 'viewer', seats: 1, email: 'sam@example.com', team: 'Listening' },
];
const roleOptions = [{ id: 'editor', label: 'Editor' }, { id: 'viewer', label: 'Viewer' }];
const seatColumns = (update: (id: string, patch: Partial<Seat>) => void): ReadonlyArray<G.DataTableColumn<Seat>> => [
  { id: 'name', label: 'Member', isRowHeader: true },
  { id: 'role', label: 'Role', editor: (row) => <G.Select label={`Role of ${row.name}`} isLabelHidden options={roleOptions} value={row.role} onValueChange={(id) => update(row.id, { role: id ?? row.role })} /> },
  { id: 'seats', label: 'Seats', align: 'end', editor: (row) => <G.NumberField label={`Seats for ${row.name}`} isLabelHidden value={row.seats} minValue={0} onValueChange={(value) => update(row.id, { seats: value })} /> },
  { id: 'email', label: 'Email', priority: 'low' },
  { id: 'team', label: 'Team', priority: 'low' },
];
const seatCell = (row: Seat, columnId: string) => String(row[columnId as keyof Seat] ?? '');

const SeatTable = ({ maxWidth }: { readonly maxWidth?: number }) => {
  const [rows, setRows] = useState(seatRows);
  const columns = seatColumns((id, patch) => setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row))));
  return (
    <div style={maxWidth === undefined ? undefined : { maxWidth }}>
      <G.DataTable label="Seats" columns={columns} rows={rows} renderCell={seatCell} emptyContent="No members." />
    </div>
  );
};

type TopicRow = { readonly id: string; readonly doc: string; readonly topics: ReadonlyArray<string> };
const topicRows: ReadonlyArray<TopicRow> = [
  { id: 't1', doc: 'Present simple', topics: ['Grammar', 'Vocabulary', 'Listening', 'Speaking', 'Reading', 'Writing', 'Pronunciation'] },
  { id: 't2', doc: 'Past continuous', topics: ['Grammar', 'Listening'] },
];
const topicColumns: ReadonlyArray<G.DataTableColumn<TopicRow>> = [
  { id: 'doc', label: 'Document', isRowHeader: true },
  { id: 'topics', label: 'Topics', editor: (row) => <G.TagGroup label={`Topics of ${row.doc}`} items={row.topics.map((topic) => ({ id: topic, label: topic }))} /> },
];
const TopicTable = () => (
  <div style={{ maxWidth: 480 }}>
    <G.DataTable label="Document topics" columns={topicColumns} rows={topicRows} renderCell={(row) => row.doc} emptyContent="No documents." />
  </div>
);

export const DataTableRowLinkEditableAndNarrow: Story = {
  name: 'DataTable (row link, editable cells, narrow mode)',
  render: () => (
    <Matrix maxWidth={720}>
      <State label="Whole-row href with editable Select and NumberField cells (wide)" direction="column"><SeatTable /></State>
      <State label="Narrow container: Email and Team collapse under Member as secondary text" direction="column"><SeatTable maxWidth={420} /></State>
      <State label="A TagGroup editor wraps its chips inside the container" direction="column"><TopicTable /></State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    const tables = [...canvasElement.querySelectorAll<HTMLElement>('[data-component="DataTable"]')];
    const [wide, narrow, topics] = tables;
    if (wide === undefined || narrow === undefined || topics === undefined) throw new Error('Three tables must render');
    await waitFor(() => {
      for (const table of tables) {
        const scroll = table.querySelector<HTMLElement>('[data-grammar-table-scroll]');
        if (scroll === null || scroll.scrollWidth > scroll.clientWidth + 1) throw new Error(`${table.querySelector('table')?.getAttribute('aria-label')}: the table runs past its container (${scroll?.scrollWidth} > ${scroll?.clientWidth})`);
      }
      if (narrow.dataset.grammarTableNarrow !== 'true') throw new Error('The 420px table must be in narrow mode');
      if (narrow.querySelectorAll('[role="columnheader"]').length !== 3) throw new Error('Below collapseBelow the low-priority headers must leave');
      if (narrow.querySelectorAll('[data-grammar-table-secondary-column="email"]').length !== seatRows.length) throw new Error('Each row must fold Email under Member');
      if (wide.dataset.grammarTableNarrow !== 'false' || wide.querySelectorAll('[role="columnheader"]').length !== 5) throw new Error('The wide table keeps every column');
    });
    // The NumberField editor keeps its own keys: ArrowUp steps the value and focus stays in it; Escape returns to the cell.
    const input = wide.querySelector<HTMLInputElement>('[data-grammar-cell-editor] input');
    if (input === null) throw new Error('The Seats editor must render an input');
    // A click into the editor must not follow the row's href either.
    const location = window.location.href;
    await userEvent.click(input);
    if (window.location.href !== location) throw new Error('A click into an editor must not follow the row link');
    await userEvent.keyboard('{ArrowUp}');
    await waitFor(() => { if (input.value !== '3') throw new Error(`ArrowUp must step the NumberField, value is ${input.value}`); });
    if (canvasElement.ownerDocument.activeElement !== input) throw new Error('ArrowUp must keep focus in the editor');
    await userEvent.keyboard('{Escape}');
    if (canvasElement.ownerDocument.activeElement?.getAttribute('role') !== 'gridcell') throw new Error('Escape must return focus to the cell');
  },
};

export const DataTable: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="Sortable with a selected row" direction="column"><SortableTable /></State>
      <State label="Loading (pending)" direction="column">
        <G.DataTable label="Documents loading" columns={docColumns} rows={[] as ReadonlyArray<Doc>} renderCell={docCell} isLoading emptyContent="No documents." />
      </State>
      <State label="Loading (3 skeleton rows, real headers)" direction="column">
        <G.DataTable label="Documents skeleton" columns={docColumns} rows={[] as ReadonlyArray<Doc>} renderCell={docCell} isLoading emptyContent="No documents." />
      </State>
      <State label="Empty" direction="column">
        <G.DataTable label="No documents" columns={docColumns} rows={[] as ReadonlyArray<Doc>} renderCell={docCell} emptyContent="No documents match these filters." />
      </State>
    </Matrix>
  ),
};

export const DescriptionList: Story = {
  render: () => (
    <Matrix maxWidth={560}>
      <State label="Loading (terms stay, values become skeletons)" direction="column">
        <G.DescriptionList isLoading items={[{ id: 'plan', term: 'Plan', description: 'Team' }, { id: 'seats', term: 'Seats', description: '8 of 10' }]} />
      </State>
      <State label="Columns, divided" direction="column">
        <G.DescriptionList
          isDivided
          items={[
            { id: 'plan', term: 'Plan', description: 'Team' },
            { id: 'seats', term: 'Seats', description: '8 of 10' },
            { id: 'renews', term: 'Renews', description: '1 October 2026' },
          ]}
        />
      </State>
      <State label="Stacked" direction="column">
        <G.DescriptionList layout="stacked" items={[{ id: 'owner', term: 'Owner', description: 'Alex Morgan' }, { id: 'created', term: 'Created', description: '2 March 2026' }]} />
      </State>
    </Matrix>
  ),
};

const listItems: ReadonlyArray<G.ListBoxItem> = [
  { id: 'inbox', label: 'Inbox', description: '3 unread', leading: <G.Icon source={BookGlyph} usage="leading" /> },
  { id: 'drafts', label: 'Drafts' },
  { id: 'archive', label: 'Archive', trailing: <G.Badge>12</G.Badge> },
  { id: 'spam', label: 'Spam', isDisabled: true },
];



const mermaidSource = `flowchart LR
  A[Request] --> B{In cache?}
  B -- yes --> C[Serve cached]
  B -- no --> D(Fetch origin)
  D --> C`;

const mermaidSequence = `sequenceDiagram
  participant Browser
  participant API
  Browser->>API: POST /sign-in
  API-->>Browser: 200 session`;

/** A Mermaid diagram on the graph ext's canvas (`@starci/grammar/core/ext/graph`), a sequence diagram, the loading box and a refused source shown as code. */
export const MermaidDiagram: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="Flowchart" direction="column">
        <GraphMermaidDiagram label="Cache lookup" source={mermaidSource} />
      </State>
      <State label="Sequence" direction="column">
        <GraphMermaidDiagram label="Sign-in request" source={mermaidSequence} />
      </State>
      <State label="Skeleton (the same box)" direction="column">
        <GraphMermaidDiagram label="Cache lookup (loading)" source={mermaidSource} isLoading />
      </State>
      <State label="Error: the source as code" direction="column">
        <GraphMermaidDiagram label="Broken diagram" source={'flowchart LR\n  A --> {'} errorTitle="This diagram could not be drawn." />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const diagrams = [...canvasElement.querySelectorAll<HTMLElement>('[data-component="MermaidDiagram"]')];
      expect(diagrams.map((diagram) => diagram.dataset.grammarMermaidState)).toEqual(['ready', 'ready', 'loading', 'error']);
      const [flowchart, , skeleton, broken] = diagrams;
      const drawing = flowchart!.querySelector('[data-grammar-mermaid-canvas] > [role="img"]');
      if (drawing === null) throw new Error('The flowchart must draw its canvas');
      expect(drawing.getAttribute('aria-label')).toBe('Cache lookup');
      expect(drawing.textContent).toContain('In cache?');
      // The skeleton keeps the ready frame's least box: both canvases reserve the sm height.
      const box = (diagram: HTMLElement) => diagram.querySelector<HTMLElement>('[data-grammar-mermaid-canvas]')!.getBoundingClientRect().height;
      expect(Math.round(box(skeleton!))).toBe(256);
      expect(box(flowchart!)).toBeGreaterThanOrEqual(256);
      expect(skeleton!.getAttribute('aria-busy')).toBe('true');
      expect(broken!.querySelector('[data-grammar-mermaid-error] code')?.textContent).toContain('A --> {');
      expect(broken!.querySelector('[data-component="Alert"]')).not.toBeNull();
    }, { timeout: 15000 });
  },
};

type NavRow = { readonly id: string; readonly href: string; readonly title: string; readonly status: string };
const navRows: ReadonlyArray<NavRow> = [
  { id: 'r1', href: '/documents/1', title: 'Present simple', status: 'Published' },
  { id: 'r2', href: '/documents/2', title: 'Past continuous', status: 'Draft' },
];
const navColumns: ReadonlyArray<G.DataTableColumn<NavRow>> = [{ id: 'title', label: 'Document', isRowHeader: true }, { id: 'status', label: 'Status' }];


export const ClientNavigation: Story = {
  name: 'Client navigation (memory router)',
  render: (_, { globals }) => (
    <MemoryRouterRoot globals={globals}>
      <Matrix maxWidth={560}>
        <State label="Link and Button href">
          <G.Link href="/settings">Settings</G.Link>
          <G.Button variant="border" href="/documents/new">New document</G.Button>
        </State>
        <State label="DataTable row href" direction="column">
          <G.DataTable label="Documents" columns={navColumns} rows={navRows} renderCell={(row, columnId) => (columnId === 'title' ? row.title : row.status)} emptyContent="No documents." />
        </State>
      </Matrix>
    </MemoryRouterRoot>
  ),
  play: async ({ canvasElement }) => {
    const path = () => canvasElement.querySelector('[data-story-router-path]')?.getAttribute('data-story-router-path');
    const expectPath = (expected: string, how: string) => waitFor(() => { if (path() !== expected) throw new Error(`${how} must navigate to ${expected}, got ${path()}`); });
    const pick = (selector: string) => {
      const found = canvasElement.querySelector<HTMLElement>(selector);
      if (found === null) throw new Error(`${selector} must render`);
      return found;
    };
    const location = window.location.href;
    await userEvent.click(pick('a[href="/settings"]'));
    await expectPath('/settings', 'A Link click');
    await userEvent.click(pick('a[href="/documents/new"]'));
    await expectPath('/documents/new', 'A Button href click');
    const rows = [...canvasElement.querySelectorAll<HTMLElement>('[data-grammar-table-row-link="true"]')];
    const cell = rows[1]?.querySelector<HTMLElement>('[role="gridcell"], [role="rowheader"]');
    if (cell === null || cell === undefined) throw new Error('A linked row must render its cells');
    await userEvent.click(cell);
    await expectPath('/documents/2', 'A DataTable row click');
    rows[0]?.focus();
    await userEvent.keyboard('{Enter}');
    await expectPath('/documents/1', 'Enter on a DataTable row');
    if (window.location.href !== location) throw new Error('Navigation must stay in-app; the document location changed');
  },
};

const memberItems: ReadonlyArray<G.ListBoxItem> = [
  { id: 'alex', label: 'Alex Morgan', description: 'alex@example.com', leading: <G.Avatar name="Alex Morgan" size="md" isDecorative /> },
  { id: 'sam', label: 'Sam Lee', description: 'sam@example.com', leading: <G.Avatar name="Sam Lee" size="md" isDecorative /> },
  { id: 'kim', label: 'Kim Tran', description: 'kim@example.com', leading: <G.Avatar name="Kim Tran" size="md" isDecorative />, isDisabled: true },
];

/** HeroUI's ListBox docs examples: rows with an avatar and a description, single and multiple selection, a disabled row. */
export const ListBoxWithDescriptions: Story = {
  name: 'ListBox (avatars, descriptions, disabled row)',
  render: () => (
    <Matrix maxWidth={420}>
      <State label="Single selection" direction="column">
        <G.ListBox label="Members" items={memberItems} selectionMode="single" defaultSelectedIds={['alex']} />
      </State>
      <State label="Multiple selection" direction="column">
        <G.ListBox label="Reviewers" items={memberItems} selectionMode="multiple" defaultSelectedIds={['alex', 'sam']} />
      </State>
    </Matrix>
  ),
};

const wrappingItems: ReadonlyArray<G.ListBoxItem> = [
  { id: 'a', label: 'Release notes', description: 'Everything that changed in this release, including the new grading rules, the renamed document types and the fixes to the import flow, written out in full.' },
  { id: 'b', label: 'Migration guide', description: 'Short note.' },
];

export const ListBoxDescriptionWrap: Story = {
  name: 'ListBox (descriptions wrap or keep one line)',
  render: () => (
    <Matrix maxWidth={360}>
      <State label="Default: the description wraps onto as many lines as it needs" direction="column"><G.ListBox label="Documents" items={wrappingItems} /></State>
      <State label="descriptionLines={1}: one line with an ellipsis" direction="column"><G.ListBox label="Documents, one line" descriptionLines={1} items={wrappingItems} /></State>
    </Matrix>
  ),
};

const groupMembers: ReadonlyArray<G.AvatarGroupItem> = [
  { id: 'alex', name: 'Alex Morgan', seed: 'user-alex' },
  { id: 'sam', name: 'Sam Lee', seed: 'user-sam' },
  { id: 'kim', name: 'Kim Tran', seed: 'user-kim' },
];

const conversationItems: ReadonlyArray<G.ListBoxItem> = [
  {
    id: 'study-group',
    label: 'Study group',
    description: 'Sam: Please review the shared notes before we meet at seven this evening; the full preview stays accessible.',
    emphasis: 'unread',
    trailing: <G.Badge tone="danger">3</G.Badge>,
    leading: <G.AvatarGroup label="Study group" layout="grid" size="sm" items={groupMembers} overflowLabel={(count) => `${count} more members`} />,
  },
  { id: 'alex', label: 'Alex Morgan', description: 'Thanks!', leading: <G.Avatar name="Alex Morgan" seed="user-alex" size="md" isDecorative /> },
  {
    id: 'reading-club',
    label: 'Reading club',
    description: 'You: The next chapter is ready.',
    leading: <G.AvatarGroup label="Reading club" layout="grid" size="sm" items={groupMembers.slice(0, 2)} overflowLabel={(count) => `${count} more members`} />,
  },
];

/** Chat rows use member identities and one-line previews; unread emphasis belongs to the selected family's DNA. */
export const ChatRows: Story = {
  name: 'ListBox (chat rows, read and unread)',
  render: () => (
    <Matrix maxWidth={360}>
      <State label="Unread strong copy, read normal copy; no group glyph" direction="column">
        <G.ListBox label="Conversations" descriptionLines={1} items={conversationItems} selectionMode="single" defaultSelectedIds={['study-group']} />
      </State>
    </Matrix>
  ),
};

/** A selected row that already reads from its fill omits the vendor check. */
export const ListBoxNoIndicator: Story = {
  name: 'ListBox (selected fill, no check)',
  render: () => (
    <Matrix maxWidth={360}>
      <State label="selectionIndicator none" direction="column">
        <G.ListBox label="Conversations" descriptionLines={1} items={conversationItems} selectionMode="single" selectionIndicator="none" defaultSelectedIds={['study-group']} />
      </State>
    </Matrix>
  ),
};

/** The optional title-leading slot remains available for decorative, non-chat labels. */
export const ListBoxTitleGlyph: Story = {
  name: 'ListBox (optional title-line glyph)',
  render: () => <G.ListBox label="Reading shelves" items={[{ id: 'books', label: 'Reading list', labelLeading: <G.Icon source={BookGlyph} usage="chip" /> }]} />,
};

export const ListBox: Story = {
  render: () => (
    <Matrix maxWidth={360}>
      <State label="Loading (isLoading)" direction="column">
        <G.ListBox label="Folders" items={[]} isLoading />
      </State>
      <State label="Single selection (selected)" direction="column">
        <G.ListBox label="Folders" items={listItems} selectionMode="single" defaultSelectedIds={['inbox']} />
      </State>
      <State label="Multiple selection" direction="column">
        <G.ListBox label="Labels" items={listItems} selectionMode="multiple" defaultSelectedIds={['drafts', 'archive']} />
      </State>
      <State label="Empty" direction="column">
        <G.ListBox label="Nothing here" items={[]} emptyContent="No folders yet." />
      </State>
    </Matrix>
  ),
};

const rowsIn = (canvasElement: HTMLElement, selector: string, minimum: number) =>
  waitFor(() => {
    const found = canvasElement.querySelectorAll<HTMLElement>(selector);
    if (found.length < minimum) throw new Error(`waiting for ${selector}`);
    return found;
  });

/** ListBox interactive rows: selected, hovered and keyboard-focused in one frame. */
export const ListBoxRowStates: Story = {
  name: 'ListBox (selected, hover, focus rows)',
  render: () => (
    <Matrix maxWidth={360}>
      <State label="Inbox selected, Drafts hovered, Archive keyboard-focused" direction="column">
        <G.ListBox label="Folders with row states" items={listItems} selectionMode="single" defaultSelectedIds={['inbox']} />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    const options = await rowsIn(canvasElement, '[role="option"]', 3);
    await showRowStates(options[1], options[2]);
  },
};

/** Selectable DataTable rows: selected, hovered and keyboard-focused in one frame. */
export const DataTableRowStates: Story = {
  name: 'DataTable (selected, hover, focus rows)',
  render: () => (
    <Matrix maxWidth={720}>
      <State label="Present simple selected, Past continuous hovered, Conditionals keyboard-focused" direction="column">
        <G.DataTable
          label="Documents with row states"
          columns={docColumns}
          rows={docs}
          renderCell={docCell}
          selectionMode="multiple"
          defaultSelectedIds={['l2']}
          selectAllLabel="Select all documents"
          selectRowLabel={(row) => `Select ${row.title}`}
          onRowAction={noop}
          emptyContent="No documents."
        />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    const rows = await rowsIn(canvasElement, '[data-grammar-table-row]', 4);
    await showRowStates(rows[2], rows[3]);
  },
};

const PaginationDemo = ({ label, pageCount, initial }: { readonly label: string; readonly pageCount: number; readonly initial: number }) => {
  const [page, setPage] = useState(initial);
  return (
    <G.Pagination
      label={label}
      page={page}
      pageCount={pageCount}
      onPageChange={setPage}
      previousLabel="Previous"
      nextLabel="Next"
      pageLabel={pageLabel}
      summary={`Page ${page} of ${pageCount}`}
    />
  );
};

export const Pagination: Story = {
  render: () => (
    <Matrix>
      <State label="First page (previous disabled)"><PaginationDemo label="Short results pages" pageCount={5} initial={1} /></State>
      <State label="Middle page with ellipses (current)"><PaginationDemo label="Long results pages" pageCount={20} initial={10} /></State>
      <State label="Last page"><PaginationDemo label="Final results pages" pageCount={20} initial={20} /></State>
    </Matrix>
  ),
};

const steps: ReadonlyArray<G.StepperStep> = [
  { id: 'account', label: 'Account' },
  { id: 'profile', label: 'Profile', description: 'Name and photo' },
  { id: 'billing', label: 'Billing' },
  { id: 'done', label: 'Done', isDisabled: true },
];

export const Stepper: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="Loading (isLoading)" direction="column">
        <G.Stepper label="Sign-up progress (loading)" steps={steps} currentStepId="profile" isLoading />
      </State>
      <State label="Horizontal, current step" direction="column">
        <G.Stepper label="Sign-up progress" steps={steps} currentStepId="profile" onStepSelect={noop} />
      </State>
      <State label="Vertical with an error step" direction="column">
        <G.Stepper
          label="Import progress"
          orientation="vertical"
          steps={[{ id: 'upload', label: 'Upload' }, { id: 'map', label: 'Map columns', state: 'error', description: 'Two columns are missing.' }, { id: 'review', label: 'Review' }]}
          currentStepId="map"
        />
      </State>
    </Matrix>
  ),
};

/** The dense stepper of a list row, with a paused step: the circle is dashed, so the state is a form as well as a colour. */
export const StepperDense: Story = {
  name: 'Stepper (dense, paused)',
  render: () => (
    <Matrix maxWidth={640}>
      <State label="Dense, one row of steps with a paused step" direction="column">
        <G.Stepper
          label="Indexing steps"
          size="dense"
          steps={[{ id: 'upload', label: 'Uploaded' }, { id: 'read', label: 'Reading', state: 'paused' }, { id: 'split', label: 'Splitting' }, { id: 'ready', label: 'Ready' }]}
          currentStepId="read"
          stateLabel={(state) => (state === 'paused' ? 'paused' : undefined)}
        />
      </State>
      <State label="Dense, vertical" direction="column">
        <G.Stepper label="Indexing steps (vertical)" size="dense" orientation="vertical" steps={[{ id: 'a', label: 'Uploaded' }, { id: 'b', label: 'Reading' }, { id: 'c', label: 'Ready' }]} currentStepId="b" />
      </State>
      <State label="Default size, for comparison" direction="column">
        <G.Stepper label="Indexing steps (default)" steps={[{ id: 'a', label: 'Uploaded' }, { id: 'b', label: 'Reading', state: 'paused' }, { id: 'c', label: 'Ready' }]} currentStepId="b" />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const dense = canvasElement.querySelector<HTMLElement>('[data-grammar-stepper-size="dense"] [data-grammar-step-marker]');
      if (dense === null || Math.round(dense.getBoundingClientRect().width) !== 20) throw new Error('A dense marker is 20px');
      if (canvasElement.querySelector('[data-grammar-step-state="paused"]') === null) throw new Error('A paused step must render');
    });
  },
};

const THEMES = ['light', 'dark'] as const;
const wizardSteps: ReadonlyArray<G.StepperStep> = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'channels', label: 'Channels' },
  { id: 'team', label: 'Invite the team' },
  { id: 'import', label: 'Import', state: 'error' },
];

/**
 * Every step number reads against its own circle (COLOR-5, `contrast.text`) on the card, in light and dark: the marker's circle and numeral follow the card's ground as a pair.
 */
export const StepperOnTheCard: Story = {
  render: (_args, { globals }) => (
    <Matrix maxWidth={720}>
      {THEMES.map((theme) => (
        <G.GrammarRoot key={theme} {...familyScope(globals)} style={{ padding: '1rem', background: 'var(--background, Canvas)' }}>
          <State label={theme} direction="column">
            <div data-story-card={theme}>
              <G.SurfaceCard ariaLabel={`Onboarding on ${theme}`}>
                <G.Stepper label={`Onboarding progress (${theme})`} orientation="vertical" steps={wizardSteps} currentStepId="channels" />
              </G.SurfaceCard>
            </div>
          </State>
        </G.GrammarRoot>
      ))}
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const markers = Array.from(canvasElement.querySelectorAll('[data-story-card] [data-grammar-step-marker]'));
      expect(markers).toHaveLength(THEMES.length * wizardSteps.length);
      const unreadable = markers
        .map((marker) => {
          const where = marker.closest('[data-story-card]');
          const state = marker.closest('[data-grammar-step-state]')?.getAttribute('data-grammar-step-state');
          return { at: `${where?.getAttribute('data-story-card')} ${state}`, ratio: textContrast(marker) };
        })
        .filter(({ ratio }) => ratio < 4.5)
        .map(({ at, ratio }) => `${at} ${ratio}:1`);
      if (unreadable.length > 0) throw new Error(`step numbers below 4.5:1 on their circle: ${unreadable.join('; ')}`);
    });
  },
};

const tags: ReadonlyArray<G.TagGroupItem> = [
  { id: 'grammar', label: 'Grammar' },
  { id: 'vocab', label: 'Vocabulary' },
  { id: 'listening', label: 'Listening' },
  { id: 'archived', label: 'Archived', isDisabled: true },
];

const RemovableTags = () => {
  const [items, setItems] = useState(tags);
  return (
    <G.TagGroup
      label="Active filters"
      items={items}
      onRemove={(ids) => setItems((current) => current.filter((item) => !ids.includes(item.id)))}
      removeLabel={(label) => `Remove ${label}`}
      emptyContent="No filters."
    />
  );
};

const ReorderableTags = () => {
  const [items, setItems] = useState(tags.slice(0, 3));
  return (
    <G.TagGroup
      label="Pinned topics"
      items={items}
      onReorder={(ids) => setItems((current) => ids.flatMap((id) => current.filter((item) => item.id === id)))}
      reorderInstructions="Drag a tag, or hold Alt and press an arrow key, to move it."
      reorderAnnouncement={(label, position, total) => `${label} moved to position ${position} of ${total}`}
    />
  );
};

export const TagGroup: Story = {
  render: () => (
    <Matrix>
      <State label="Selectable (secondary face + border; selected = accent-soft + accent border)">
        <G.TagGroup label="Topics" items={tags} />
      </State>
      <State label="Removable"><RemovableTags /></State>
      <State label="Reorderable (drag, or Alt+arrow on a focused tag)"><ReorderableTags /></State>
      <State label="Off chip (muted outline, still focusable, named off)">
        <G.TagGroup label="Capabilities" items={[{ id: 'quotes', label: 'Quotes' }, { id: 'pipeline', label: 'Pipeline' }, { id: 'orders', label: 'Order lookup', isOff: true, offLabel: 'off' }]} />
      </State>
      <State label="Sizes">
        <G.TagGroup label="Small tags" size="sm" items={tags.slice(0, 2)} />
        <G.TagGroup label="Large tags" size="lg" items={tags.slice(0, 2)} />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    const group = canvasElement.querySelector<HTMLElement>('[data-grammar-tag-reorderable="true"]');
    if (group === null) throw new Error('The reorderable group must render');
    const order = () => [...group.querySelectorAll<HTMLElement>('[data-grammar-tag-id]')].map((tag) => tag.dataset.grammarTagId).join(',');
    const tag = (id: string) => {
      const found = group.querySelector<HTMLElement>(`[data-grammar-tag-id="${id}"]`);
      if (found === null) throw new Error(`Tag ${id} must render`);
      return found;
    };
    const announcement = () => canvasElement.querySelector('[data-grammar-tag-announcement]')?.textContent ?? '';
    await waitFor(() => {
      if (!tag('grammar').draggable) throw new Error('Reorderable tags must be draggable');
      const describedBy = group.querySelector('[role="grid"]')?.getAttribute('aria-describedby') ?? '';
      if (!describedBy.split(' ').some((id) => canvasElement.ownerDocument.getElementById(id)?.textContent?.includes('Alt') === true)) throw new Error('The grid must be described by the reorder instructions');
    });
    // Keyboard: Alt+ArrowRight moves the focused tag one place, keeps focus on it and announces the move.
    await userEvent.click(tag('grammar'));
    await userEvent.keyboard('{Alt>}{ArrowRight}{/Alt}');
    await waitFor(() => { if (order() !== 'vocab,grammar,listening') throw new Error(`Alt+ArrowRight must move Grammar right, order is ${order()}`); });
    await waitFor(() => { if (announcement() !== 'Grammar moved to position 2 of 3') throw new Error(`The move must be announced, got "${announcement()}"`); });
    await waitFor(() => { if (canvasElement.ownerDocument.activeElement !== tag('grammar')) throw new Error('Focus must stay on the moved tag'); });
    // Drag: dropping Listening on Vocabulary moves it to the front.
    const transfer = new DataTransfer();
    tag('listening').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
    await waitFor(() => { if (tag('listening').dataset.grammarTagDragging !== 'true') throw new Error('The dragged tag must lift'); });
    tag('vocab').dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    tag('vocab').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    tag('listening').dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
    await waitFor(() => { if (order() !== 'listening,vocab,grammar') throw new Error(`A drop must move Listening to the front, order is ${order()}`); });
    await waitFor(() => { if (announcement() !== 'Listening moved to position 1 of 3') throw new Error(`The drop must be announced, got "${announcement()}"`); });
  },
};

export const Timeline: Story = {
  render: () => (
    <Matrix maxWidth={560}>
      <State label="Loading (isLoading)" direction="column">
        <G.Timeline label="Order history" items={[]} isLoading />
      </State>
      <State label="States with a current item" direction="column">
        <G.Timeline
          label="Order history"
          items={[
            { id: 'placed', title: 'Order placed', dateTime: '2026-09-20T09:00', timeLabel: '20 Sep, 09:00', state: 'affirmative' },
            { id: 'packed', title: 'Packed', dateTime: '2026-09-21T14:30', timeLabel: '21 Sep, 14:30', state: 'affirmative' },
            { id: 'transit', title: 'In transit', description: 'Arriving tomorrow.', state: 'pending', isCurrent: true },
            { id: 'delivered', title: 'Delivered', state: 'neutral' },
          ]}
        />
      </State>
      <State label="Attention entry (row background)" direction="column">
        <G.Timeline
          label="Deploy"
          items={[
            { id: 'a1', title: 'Build passed', state: 'affirmative', timeLabel: '09:00' },
            { id: 'a2', title: 'Approval needed', state: 'cautionary', isAttention: true, description: 'Waiting for a reviewer.' },
            { id: 'a3', title: 'Smoke test failed', state: 'negative', isAttention: true, description: '1 failure.' },
            { id: 'a4', title: 'Release', state: 'neutral' },
          ]}
        />
      </State>
      <State label="Negative item" direction="column">
        <G.Timeline label="Build log" items={[{ id: 'b1', title: 'Build started', state: 'informative' }, { id: 'b2', title: 'Tests failed', state: 'negative', description: '2 failures.' }]} />
      </State>
    </Matrix>
  ),
};

const tabItems: ReadonlyArray<G.TabItem> = [
  { id: 'overview', label: 'Overview' },
  { id: 'documents', label: 'Documents', leading: <G.Icon source={BookGlyph} usage="leading" /> },
  { id: 'members', label: 'Members' },
];

const TabsDemo = ({ variant = 'primary' }: { readonly variant?: 'primary' | 'secondary' }) => {
  const [selected, setSelected] = useState('overview');
  return (
    <div>
      <G.Tabs label={`Guide sections (${variant})`} items={tabItems} selectedKey={selected} onSelect={setSelected} panelId={(key) => `story-tab-panel-${variant}-${key}`} labelVisibility="always" />
      {tabItems.map((item) => (
        <div key={item.id} role="tabpanel" id={`story-tab-panel-${variant}-${item.id}`} aria-label={item.label} hidden={item.id !== selected} style={{ paddingTop: '1rem' }}>
          <G.Text>{item.label} panel</G.Text>
        </div>
      ))}
    </div>
  );
};

const RenamingTabs = () => {
  const [name, setName] = useState('Documents');
  const items: ReadonlyArray<G.TabItem> = [{ id: 'overview', label: 'Overview' }, { id: 'documents', label: name }, { id: 'members', label: 'Members' }];
  return (
    <div>
      <G.Tabs label="Renaming tabs" items={items} selectedKey="documents" panelId="story-rename-panel" labelVisibility="always" />
      <div role="tabpanel" id="story-rename-panel" aria-label="Renaming tabs" style={{ paddingTop: '1rem' }}>
        <G.Text>{name} panel</G.Text>
      </div>
      <G.Button variant="border" onPress={() => setName((current) => (current === 'Documents' ? 'All documents and exercises' : 'Documents'))}>Change the selected tab label</G.Button>
    </div>
  );
};

const DisabledTabsDemo = ({ mode }: { readonly mode: 'one' | 'all' | 'links' }) => {
  const [selected, setSelected] = useState('overview');
  const panelId = `story-disabled-tabs-${mode}-panel`;
  const items = tabItems.map((item) => ({
    ...item,
    isDisabled: mode === 'all' || item.id === 'documents',
    ...(mode === 'links' ? { href: `#story-disabled-tabs-${mode}-${item.id}` } : {}),
  }));
  return (
    <div>
      <G.Tabs label={`Disabled tabs (${mode})`} items={items} selectedKey={selected} onSelect={setSelected} panelId={panelId} labelVisibility="always" />
      <div role="tabpanel" id={panelId} aria-label={`Disabled tabs (${mode})`}>
        <G.Text>{items.find((item) => item.id === selected)?.label} panel</G.Text>
      </div>
    </div>
  );
};

export const TabsDisabled: Story = {
  name: 'Tabs (disabled items and links)',
  render: () => (
    <Matrix maxWidth={560}>
      <State label="One unavailable tab: arrow keys skip Documents" direction="column"><DisabledTabsDemo mode="one" /></State>
      <State label="All tabs locked: the selected panel stays visible" direction="column"><DisabledTabsDemo mode="all" /></State>
      <State label="Link tabs: Documents cannot navigate" direction="column"><DisabledTabsDemo mode="links" /></State>
    </Matrix>
  ),
};

export const TabsLabelChange: Story = {
  name: 'Tabs (selected label changes)',
  render: () => <Matrix><State label="The underline follows the new label width at once" direction="column"><RenamingTabs /></State></Matrix>,
};

export const Tabs: Story = {
  render: () => (
    <Matrix maxWidth={560}>
      <State label="Primary (default): the page's main area switcher" direction="column"><TabsDemo /></State>
      <State label="Secondary: a pill strip for a drawer, card, dialog or rail" direction="column"><TabsDemo variant="secondary" /></State>
    </Matrix>
  ),
};

