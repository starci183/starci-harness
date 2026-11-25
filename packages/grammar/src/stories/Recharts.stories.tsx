import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';
import * as E from '../core/ext/recharts/index.js';
import { Matrix, State } from './fixtures.js';

/**
 * The charts extension (`@starci/grammar/core/ext/recharts`): BarChart, LineChart, AreaChart, DonutChart and Sparkline, in Grammar tokens. The rows are generic
 * (orders per week); nothing here is a product word. Each chart is one named image whose box keeps its height in every state, at 1440 and 390.
 */
const meta: Meta = { title: 'Navigation & Data/Recharts', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

type Week = { readonly week: string; readonly orders: number };
const weekly: readonly Week[] = [
  { week: '2026-10-05', orders: 42 },
  { week: '2026-10-12', orders: 58 },
  { week: '2026-10-19', orders: 51 },
  { week: '2026-10-26', orders: 73 },
  { week: '2026-11-02', orders: 66 },
  { week: '2026-11-09', orders: 88 },
  { week: '2026-11-16', orders: 94 },
];
const none: readonly Week[] = [];
const day = (value: string | number) => new Date(`${value}T00:00:00Z`).toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const count = (value: number) => value.toLocaleString('en');

const frames = (root: HTMLElement, state: string): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(`[data-grammar-chart][data-state="${state}"]`));

/** One series of bars with axis titles, formatted dates and counts; the tooltip is a shadowless Grammar surface. */
export const BarChart: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="Bars, accent" direction="column">
        <E.BarChart data={weekly} xKey="week" yKey="orders" ariaLabel="Orders per week" emptyLabel="No orders yet" xAxisLabel="Week of" yAxisLabel="Orders" seriesLabel="Orders" formatX={day} formatY={count} />
      </State>
      <State label="Bars, success, short" direction="column">
        <E.BarChart data={weekly} xKey="week" yKey="orders" tone="success" height={160} ariaLabel="Orders per week" emptyLabel="No orders yet" formatX={day} />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getAllByRole('img', { name: 'Orders per week' })).toHaveLength(2));
    await waitFor(() => expect(canvasElement.querySelectorAll('.recharts-bar-rectangle').length).toBeGreaterThan(0));
  },
};

/** highlightLast: the latest week in the full tone, the weeks before it in the soft tone; the chart's name ends with the latest value. */
export const BarChartHighlightLast: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="highlightLast, accent" direction="column">
        <E.BarChart data={weekly} xKey="week" yKey="orders" highlightLast ariaLabel="Orders per week" emptyLabel="No orders yet" formatX={day} formatY={count} />
      </State>
      <State label="highlightLast, success, short" direction="column">
        <E.BarChart data={weekly} xKey="week" yKey="orders" tone="success" height={160} highlightLast ariaLabel="Orders per week" emptyLabel="No orders yet" formatX={day} formatY={count} />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    const last = weekly[weekly.length - 1];
    const name = `Orders per week, ${day(last?.week ?? '')}: ${count(last?.orders ?? 0)}`;
    await waitFor(() => expect(within(canvasElement).getAllByRole('img', { name })).toHaveLength(2));
    await waitFor(() => expect(canvasElement.querySelectorAll('.recharts-bar-rectangle path').length).toBe(weekly.length * 2));
    const fills = Array.from(canvasElement.querySelectorAll('[data-component="BarChart"]')[0]?.querySelectorAll('.recharts-bar-rectangle path') ?? []).map((bar) => bar.getAttribute('fill'));
    expect(fills.at(-1)).toBe('var(--accent)');
    expect(fills.slice(0, -1).every((fill) => fill?.startsWith('color-mix('))).toBe(true);
  },
};

/** One series as a line, each tone in turn. */
export const LineChart: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="Line, info" direction="column">
        <E.LineChart data={weekly} xKey="week" yKey="orders" tone="info" ariaLabel="Orders per week" emptyLabel="No orders yet" xAxisLabel="Week of" yAxisLabel="Orders" seriesLabel="Orders" formatX={day} />
      </State>
      <State label="Line, warning, no titles" direction="column">
        <E.LineChart data={weekly} xKey="week" yKey="orders" tone="warning" height={160} ariaLabel="Orders per week" emptyLabel="No orders yet" formatX={day} />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelectorAll('.recharts-line-curve').length).toBe(2));
  },
};

/** The bare trend line: no axes, no tooltip, 32px high, always the neutral muted ink; no data or only zeros draws nothing. */
export const Sparkline: Story = {
  render: () => (
    <Matrix maxWidth={360}>
      <State label="Sparkline, a trend" direction="column">
        <E.Sparkline data={weekly} xKey="week" yKey="orders" ariaLabel="Orders, last 7 weeks" />
      </State>
      <State label="Sparkline, no data or all zeros: nothing is drawn" direction="column">
        <E.Sparkline data={none} xKey="week" yKey="orders" ariaLabel="Orders, last 7 weeks" />
        <E.Sparkline data={weekly.map((row) => ({ ...row, orders: 0 }))} xKey="week" yKey="orders" ariaLabel="Orders, last 7 weeks" />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelectorAll('[data-component="Sparkline"] .recharts-line-curve').length).toBe(1));
    expect(canvasElement.querySelectorAll('[data-component="Sparkline"]')).toHaveLength(1);
    expect(canvasElement.querySelector('[data-component="Sparkline"] .recharts-xAxis')).toBeNull();
  },
};

/** Loading is a Skeleton of the chart's box; empty is the app's words in that same box. */
export const LoadingAndEmpty: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="Loading" direction="column">
        <E.BarChart data={weekly} xKey="week" yKey="orders" isLoading ariaLabel="Orders per week" emptyLabel="No orders yet" />
        <E.Sparkline data={weekly} xKey="week" yKey="orders" isLoading ariaLabel="Orders, last 7 weeks" />
      </State>
      <State label="Empty" direction="column">
        <E.LineChart data={none} xKey="week" yKey="orders" ariaLabel="Orders per week" emptyLabel="No orders yet" />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    expect(frames(canvasElement, 'loading')).toHaveLength(2);
    expect(frames(canvasElement, 'empty')).toHaveLength(1);
    expect(within(canvasElement).getAllByText('No orders yet')).toHaveLength(1);
  },
};

type Day = { readonly day: string; readonly lessons: number; readonly quizzes: number };
const activity: readonly Day[] = [
  { day: '2026-11-10', lessons: 3, quizzes: 1 },
  { day: '2026-11-11', lessons: 5, quizzes: 2 },
  { day: '2026-11-12', lessons: 4, quizzes: 3 },
  { day: '2026-11-13', lessons: 7, quizzes: 2 },
  { day: '2026-11-14', lessons: 6, quizzes: 4 },
  { day: '2026-11-15', lessons: 2, quizzes: 1 },
  { day: '2026-11-16', lessons: 8, quizzes: 5 },
];
const noActivity: readonly Day[] = [];

/** Activity over time: one series with a soft fill of its token, two series stacked with a legend, then loading and empty. */
export const AreaChart: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="Area, one series" direction="column">
        <E.AreaChart data={activity} xKey="day" yKey="lessons" ariaLabel="Lessons per day" emptyLabel="No activity yet" yAxisLabel="Lessons" seriesLabel="Lessons" formatX={day} />
      </State>
      <State label="Area, two series stacked" direction="column">
        <E.AreaChart
          data={activity}
          xKey="day"
          yKey="lessons"
          seriesLabel="Lessons"
          series={[{ key: 'quizzes', label: 'Quizzes' }]}
          stacked
          height={200}
          ariaLabel="Lessons and quizzes per day"
          emptyLabel="No activity yet"
          formatX={day}
        />
      </State>
      <State label="Loading and empty" direction="column">
        <E.AreaChart data={activity} xKey="day" yKey="lessons" isLoading height={160} ariaLabel="Lessons per day" emptyLabel="No activity yet" />
        <E.AreaChart data={noActivity} xKey="day" yKey="lessons" height={160} ariaLabel="Lessons per day" emptyLabel="No activity yet" />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvasElement.querySelectorAll('[data-component="AreaChart"] .recharts-area-area').length).toBe(3));
    expect(canvas.getAllByRole('img', { name: /per day/ })).toHaveLength(2);
    expect(canvas.getByText('Quizzes')).toBeVisible();
    expect(frames(canvasElement, 'loading')).toHaveLength(1);
    expect(frames(canvasElement, 'empty')).toHaveLength(1);
  },
};

const topics: readonly E.DonutSegment[] = [
  { label: 'Algebra', value: 30 },
  { label: 'Geometry', value: 20 },
  { label: 'Calculus', value: 25 },
  { label: 'Statistics', value: 10 },
  { label: 'Logic', value: 5 },
  { label: 'Sets', value: 6 },
  { label: 'Proofs', value: 4 },
];

/** Parts of a whole: topics folded past six into Other, progress with a centre figure, then loading and empty. */
export const DonutChart: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="Topics, folded into Other" direction="column">
        <E.DonutChart data={topics} ariaLabel="Lessons by topic" emptyLabel="No lessons yet" centerFigure="100" centerCaption="lessons" otherLabel="Other" />
      </State>
      <State label="Progress" direction="column">
        <E.DonutChart
          data={[
            { label: 'Done', value: 68, tone: 'success' },
            { label: 'Left', value: 32, tone: 'default' },
          ]}
          ariaLabel="Course progress"
          emptyLabel="Not started"
          centerFigure="68%"
          centerCaption="done"
          size={128}
        />
      </State>
      <State label="Loading and empty" direction="column">
        <E.DonutChart data={topics} isLoading ariaLabel="Lessons by topic" emptyLabel="No lessons yet" />
        <E.DonutChart data={[]} size={96} ariaLabel="Lessons by topic" emptyLabel="No lessons yet" />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvasElement.querySelectorAll('[data-component="DonutChart"] .recharts-pie-sector').length).toBe(8));
    expect(canvas.getByRole('img', { name: 'Lessons by topic' })).toBeVisible();
    expect(canvas.getByText('Other')).toBeVisible();
    expect(canvas.queryByText('Logic')).toBeNull();
    expect(canvasElement.querySelectorAll('[data-component="DonutChart"] [data-slot="center"]')[1]).toHaveTextContent('68%done');
    expect(frames(canvasElement, 'loading')).toHaveLength(1);
    expect(frames(canvasElement, 'empty')).toHaveLength(1);
  },
};

type Booked = { readonly day: string; readonly booked: number };
const bookings: readonly Booked[] = [
  { day: 'Thu', booked: 7 },
  { day: 'Fri', booked: 8 },
  { day: 'Sat', booked: 9 },
  { day: 'Sun', booked: 9 },
  { day: 'Mon', booked: 4 },
  { day: 'Tue', booked: 2 },
  { day: 'Wed', booked: 2 },
];

/**
 * Chosen bars, a capacity line and the quiet colour mode. `highlight` sets the chosen bars apart (the days that need attention) in `highlightTone`, the rest in the muted step;
 * `capacity` draws a dashed line at a level the bars are read against, labelled, and the scale always reaches it; `showValues` writes each bar's value above it; `quiet` keeps the
 * bars to the ink and the muted step so a screen of several charts spends its accent once.
 */
export const BarChartChosenBarsAndCapacity: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="Chosen bars in danger, capacity line, quiet" direction="column">
        <E.BarChart data={bookings} xKey="day" yKey="booked" quiet highlight={['Tue', 'Wed']} highlightTone="danger" capacity={{ value: 9, label: 'Capacity 9' }} showValues height={200} ariaLabel="Bookings per day" emptyLabel="No bookings yet" />
      </State>
      <State label="Chosen bars by test, tone accent" direction="column">
        <E.BarChart data={bookings} xKey="day" yKey="booked" highlight={(row) => row.booked <= 2} capacity={{ value: 12, label: 'Capacity 12' }} height={200} ariaLabel="Bookings per day" emptyLabel="No bookings yet" />
      </State>
      <State label="Quiet only: every bar the ink" direction="column">
        <E.BarChart data={bookings} xKey="day" yKey="booked" quiet height={160} ariaLabel="Bookings per day" emptyLabel="No bookings yet" />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getAllByRole('img', { name: /Bookings per day/ })).toHaveLength(3));
    expect(canvas.getAllByRole('img', { name: 'Bookings per day, Capacity 9: 9' })).toHaveLength(1);
    await waitFor(() => expect(canvasElement.querySelectorAll('.recharts-reference-line').length).toBe(2));
    await waitFor(() => expect(canvasElement.querySelectorAll('.recharts-bar-rectangle').length).toBeGreaterThan(0));
  },
};
