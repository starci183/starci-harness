import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type DragEvent } from 'react';
import { fireEvent, userEvent, within } from 'storybook/test';
import * as G from '../common/index.js';
import { Matrix, State, noop } from './fixtures.js';

/**
 * ScheduleGrid as a timeline: an entry that crosses columns (a span), with a progress fill, a milestone, dependency arrows, a
 * line for today, a collapsible group row and resize handles on both ends; and an entry dragged in from a list beside the grid.
 * Each story draws a state. Below 48rem of the
 * grid's width the table is an agenda.
 */
const meta: Meta = { title: 'Navigation & Data/Schedule timeline', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

const emptyLine = <G.EmptyNotice message="Nothing planned" description="Entries appear here once something is scheduled." />;

const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon'];
const days = (todayIndex: number | null): readonly G.ScheduleColumn[] =>
  dayNames.map((name, index) => ({
    id: `d${index + 1}`,
    label: name,
    description: String(2 + index),
    ...(index === todayIndex ? { isCurrent: true, todayAt: 0.5 } : {}),
  }));

type Bar = { readonly id: string; readonly row: string; readonly from: number; readonly to: number; readonly title: string; readonly tone: G.ScheduleTone; readonly progress?: number; readonly after?: readonly string[]; readonly form?: 'bar' | 'milestone' };

const initialBars: readonly Bar[] = [
  { id: 'launch', row: 'g1', from: 1, to: 8, title: 'Launch', tone: 'neutral', progress: 0.45 },
  { id: 'design', row: 'r1', from: 1, to: 3, title: 'Design', tone: 'success', progress: 0.8 },
  { id: 'build', row: 'r2', from: 3, to: 6, title: 'Build', tone: 'accent', progress: 0.4, after: ['design'] },
  { id: 'review', row: 'r3', from: 6, to: 7, title: 'Review', tone: 'warning', progress: 0, after: ['build'] },
  { id: 'ship', row: 'r4', from: 8, to: 8, title: 'Ship', tone: 'accent', form: 'milestone', after: ['review'] },
  { id: 'copy', row: 'r5', from: 2, to: 5, title: 'Write copy', tone: 'danger', progress: 0.5 },
  { id: 'shoot', row: 'r6', from: 1, to: 4, title: 'Shoot', tone: 'accent', progress: 0.25 },
  { id: 'edit', row: 'r6', from: 3, to: 6, title: 'Edit', tone: 'neutral' },
];

const baseRows: readonly G.ScheduleRow[] = [
  { id: 'g1', label: 'Launch', isGroup: true },
  { id: 'r1', label: 'Design', parent: 'g1' },
  { id: 'r2', label: 'Build', parent: 'g1' },
  { id: 'r3', label: 'Review', parent: 'g1' },
  { id: 'r4', label: 'Ship', parent: 'g1' },
  { id: 'g2', label: 'Marketing', isGroup: true },
  { id: 'r5', label: 'Copy', parent: 'g2' },
  { id: 'r6', label: 'Media, two overlapping jobs', parent: 'g2' },
];

const dayLabel = (index: number) => `${dayNames[index - 1]} ${1 + index}`;

const Timeline = ({ todayIndex = 2, withResize = false, log }: { readonly todayIndex?: number | null; readonly withResize?: boolean; readonly log?: (text: string) => void }) => {
  const [bars, setBars] = useState(initialBars);
  const [collapsed, setCollapsed] = useState<readonly string[]>([]);
  const columns = days(todayIndex);
  const resize = (bar: Bar, edge: 'start' | 'end', column: string) => {
    const index = Number(column.slice(1));
    log?.(`${bar.id} ${edge} -> ${column}`);
    setBars((current) => current.map((entry) => (entry.id !== bar.id ? entry : edge === 'start' ? { ...entry, from: index } : { ...entry, to: index })));
  };
  const items: readonly G.ScheduleItem[] = bars.map((bar) => ({
    id: bar.id,
    row: bar.row,
    column: `d${bar.from}`,
    ...(bar.to === bar.from ? {} : { endColumn: `d${bar.to}` }),
    title: bar.title,
    meta: bar.progress === undefined ? `${dayLabel(bar.from)} to ${dayLabel(bar.to)}` : `${Math.round(bar.progress * 100)} % done`,
    tone: bar.tone,
    ...(bar.progress === undefined ? {} : { progress: bar.progress }),
    ...(bar.form === undefined ? {} : { form: bar.form }),
    ...(bar.after === undefined ? {} : { after: bar.after }),
    onPress: noop,
    ...(withResize && bar.form !== 'milestone' ? { resize: { onResize: (edge: 'start' | 'end', column: string) => resize(bar, edge, column), startLabel: `Start of ${bar.title}, ${dayLabel(bar.from)}`, endLabel: `End of ${bar.title}, ${dayLabel(bar.to)}` } } : {}),
  }));
  const rows = baseRows.map((row) => (row.isGroup === true ? { ...row, isCollapsed: collapsed.includes(row.id) } : row));
  return (
    <G.ScheduleGrid
      label="Launch plan, 2 to 9 November"
      columns={columns}
      rows={rows}
      items={items}
      empty={emptyLine}
      onRowToggle={(id, isCollapsed) => setCollapsed((current) => (isCollapsed ? [...current, id] : current.filter((entry) => entry !== id)))}
    />
  );
};

const boxOf = (root: ParentNode, selector: string): HTMLElement => {
  const found = root.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`no element for ${selector}`);
  return found;
};
const isWide = (grid: HTMLElement) => grid.getBoundingClientRect().width >= 48 * 16;
const dragEvent = (type: string, target: HTMLElement, dataTransfer: DataTransfer) => { target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer })); };
const headingOf = (grid: HTMLElement, index: number) => boxOf(grid, `thead th:nth-of-type(${index})`).getBoundingClientRect();

/** Spans across columns, the progress fill, the milestone, the arrows, the line for today and the overlapping lanes. */
export const ScheduleTimelineSpans: Story = {
  render: () => (
    <Matrix>
      <State label="A plan: groups, spans with progress, a milestone, dependencies, today (Wednesday, mid-column)" direction="column">
        <Timeline />
      </State>
    </Matrix>
  ),
};

/** A group row folds the rows under it, by its own button; the state is the app's (`isCollapsed`, `onRowToggle`). */
export const ScheduleTimelineGroups: Story = {
  render: () => (
    <Matrix>
      <State label="Press a group to fold it" direction="column">
        <Timeline todayIndex={null} />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    const grid = boxOf(canvasElement, '[data-component="ScheduleGrid"]');
    const view = within(grid);
    const toggle = view.getByRole('button', { name: 'Launch' });
    await userEvent.click(toggle);
    await userEvent.click(view.getByRole('button', { name: 'Launch' }));
  },
};

const ResizeDemo = () => {
  const [lines, setLines] = useState<readonly string[]>([]);
  return (
    <>
      <Timeline todayIndex={null} withResize log={(text) => setLines((current) => [...current, text])} />
      <output data-testid="resize-log" aria-live="polite">{lines.join('; ')}</output>
    </>
  );
};

/** Handles on both ends: arrow keys on a focused handle move that end one column; a pointer drag moves it to the column it is released over. */
export const ScheduleTimelineResize: Story = {
  render: () => (
    <Matrix>
      <State label="Focus a handle and press an arrow key, or drag it" direction="column">
        <ResizeDemo />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    const grid = boxOf(canvasElement, '[data-component="ScheduleGrid"]');
    const view = within(grid);
    const end = view.getByRole('button', { name: 'End of Design, Wed 4' });
    end.focus();
    await userEvent.keyboard('{ArrowRight}');
    // The start handle cannot pass the end: pressing right on it at the last column of the bar does nothing.
    const start = view.getByRole('button', { name: 'Start of Review, Sat 7' });
    start.focus();
    await userEvent.keyboard('{ArrowRight}');
    await userEvent.keyboard('{ArrowRight}');
    if (!isWide(grid)) return;
    // A drag from the end handle of Build to the Sunday heading.
    const handle = view.getByRole('button', { name: 'End of Build, Sat 7' });
    const target = headingOf(grid, 7);
    const from = handle.getBoundingClientRect();
    fireEvent.pointerDown(handle, { pointerId: 7, button: 0, clientX: from.left + 2, clientY: from.top + 5, bubbles: true });
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: target.left + target.width / 2, clientY: from.top + 5, bubbles: true });
    fireEvent.pointerUp(handle, { pointerId: 7, clientX: target.left + target.width / 2, bubbles: true });
  },
};

const unscheduled = [
  { id: 'u1', title: 'Call the supplier', meta: '1 h' },
  { id: 'u2', title: 'Prepare the brief', meta: '2 h' },
] as const;

const hourRows: readonly G.ScheduleRow[] = [{ id: 'h9', label: '09:00' }, { id: 'h10', label: '10:00' }, { id: 'h11', label: '11:00' }];

const OutsideDemo = () => {
  const [waiting, setWaiting] = useState<readonly string[]>(['u1', 'u2']);
  const [placed, setPlaced] = useState<readonly G.ScheduleItem[]>([{ id: 'fixed', row: 'h9', column: 'd1', title: 'Stand-up', meta: '15 min', tone: 'neutral' }]);
  const [picked, setPicked] = useState<string | null>(null);
  const [log, setLog] = useState('');
  const place = (id: string, row: string, column: string, source: G.ScheduleDropSource) => {
    const entry = unscheduled.find((item) => item.id === id);
    setLog(`${id} -> ${row}/${column} (${source})`);
    if (entry === undefined) return;
    setWaiting((current) => current.filter((item) => item !== id));
    setPlaced((current) => [...current, { id, row, column, title: entry.title, meta: entry.meta, tone: 'accent' }]);
    setPicked(null);
  };
  return (
    <G.Stack gap="row">
      <G.Text isStrong>Not scheduled</G.Text>
      <G.Cluster gap="inline" label="Not scheduled">
        {unscheduled.filter((item) => waiting.includes(item.id)).map((item) => (
          <G.DragItem
            key={item.id}
            isSelected={picked === item.id}
            onDragStart={(event: DragEvent<HTMLDivElement>) => G.startScheduleDrag(event, item.id)}
            body={<G.Button variant="border" onPress={() => setPicked(picked === item.id ? null : item.id)}>{`${picked === item.id ? 'Picked' : 'Pick'}: ${item.title}`}</G.Button>}
          />
        ))}
      </G.Cluster>
      <G.ScheduleGrid
        label="Day plan, 2 to 5 November"
        columns={days(null).slice(0, 4)}
        rows={hourRows}
        items={placed}
        empty={emptyLine}
        onDrop={place}
        onCellPress={(row, column) => { if (picked !== null) place(picked, row, column, 'outside'); }}
        cellPressLabel={(row, column) => `${column.label} ${column.description ?? ''}, ${row.label}`}
      />
      <output data-testid="drop-log">{log}</output>
    </G.Stack>
  );
};

/** An entry from a list beside the grid: dragged in (`startScheduleDrag`, then `onDrop` with source `outside`), or picked and placed with the keyboard through the cells' buttons. */
export const ScheduleDropFromList: Story = {
  render: () => (
    <Matrix>
      <State label="Drag a chip onto a cell, or press a chip (Pick) and then a cell" direction="column">
        <OutsideDemo />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    const grid = boxOf(canvasElement, '[data-component="ScheduleGrid"]');
    const view = within(canvasElement);
    // The drag path: an outside chip over a cell, then dropped.
    const source = view.getByRole('button', { name: 'Pick: Call the supplier' }).closest<HTMLElement>('[data-component="DragItem"]') as HTMLElement;
    const dataTransfer = new DataTransfer();
    dragEvent("dragstart", source, dataTransfer);
    const cell = boxOf(grid, `button[aria-label="Tue 3, 10:00"]`).closest('td') as HTMLElement;
    dragEvent("dragover", cell, dataTransfer);
    dragEvent("drop", cell, dataTransfer);
    // A drag that is not ours (a text selection) is refused: the cell does not light.
    const stray = new DataTransfer();
    stray.setData('text/plain', 'u2');
    const other = boxOf(grid, `button[aria-label="Wed 4, 11:00"]`).closest('td') as HTMLElement;
    dragEvent("dragover", other, stray);
    // The keyboard path: pick the second chip, then press a cell.
    await userEvent.click(view.getByRole('button', { name: 'Pick: Prepare the brief' }));
    await userEvent.click(boxOf(grid, `button[aria-label="Wed 4, 11:00"]`));
  },
};
