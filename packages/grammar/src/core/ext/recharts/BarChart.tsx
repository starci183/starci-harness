"use client"

import { Bar, BarChart as RechartsBarChart, Cell, LabelList, ReferenceLine, ResponsiveContainer } from "recharts"
import { cartesianParts, type ChartAxisProps } from "./Axes.js"
import { ChartFrame, asNumberText, asText, readX, readY, type ChartBaseProps, type ChartRow } from "./shared.js"
import { CHART_QUIET_INK, CHART_QUIET_MUTED, CHART_TEXT_FILL, CHART_TEXT_STYLE, chartToneColor, chartToneSoftColor, type ChartTone } from "./tokens.js"
import type { NoChildren } from "../../tier.js"

/** Which bars are set apart: the x values of the chosen bars, or a test run on each row. */
export type BarChartHighlight<Row extends ChartRow> = readonly (string | number)[] | ((row: Row, index: number) => boolean)

/** A line across the chart at a level the bars are read against (a day's capacity, a target), with its label. */
export type BarChartCapacity = {
    /** The level, on the y scale. The scale always reaches it, so a line above every bar is still drawn. */
    readonly value: number
    /** What the line is, in the app's words, e.g. "Capacity 9". It is drawn at the line's end and ends the chart's accessible name. */
    readonly label: string
}

export type BarChartProps<Row extends ChartRow> = NoChildren & ChartBaseProps<Row> & ChartAxisProps & {
    /** The series colour, one of Grammar's tones. Default `accent`. */
    readonly tone?: ChartTone
    /** The chart's height in px. Default 240; the width is the container's. */
    readonly height?: number
    /**
     * Sets the latest period apart: the last bar in the full tone, the others in its soft tone, and the chart's accessible name ends with the
     * latest value ("Orders per week, 2026-11-16: 120", through `formatX` and `formatY`). Default false: every bar in the full tone.
     */
    readonly highlightLast?: boolean
    /**
     * Sets the CHOSEN bars apart (the days that need attention): they take `highlightTone` (default `tone`), the others the quiet muted step. A list of x values or a test on a row; none
     * chosen draws every bar in the full tone. It replaces `highlightLast` when both are given.
     */
    readonly highlight?: BarChartHighlight<Row>
    /** The tone of the chosen bars when it differs from `tone`, e.g. `danger` for the days that are nearly empty. */
    readonly highlightTone?: ChartTone
    /** A dashed line across the chart at a level (see `BarChartCapacity`). */
    readonly capacity?: BarChartCapacity
    /** Writes each bar's value above it (through `formatY`), so the reading never depends on the grid. Default false. */
    readonly showValues?: boolean
    /**
     * The quiet colour mode: the bars are the ink and the muted step, never an accent or a status tone, except the chosen bars when `highlightTone` is given (the one mark on the screen
     * that asks for the eye). Keeps a screen of several charts within the 10% accent budget. With `highlight` and no `highlightTone` the chosen bars are the ink and the rest muted.
     */
    readonly quiet?: boolean
}

export const DEFAULT_CHART_HEIGHT = 240

/** The fill of each of `count` bars: every bar in the tone, or with `highlightLast` the last in the tone and the others in its soft pair. */
export const barFills = (count: number, tone: ChartTone, highlightLast: boolean): readonly string[] =>
    Array.from({ length: count }, (_unused, index) => (!highlightLast || index === count - 1 ? chartToneColor(tone) : chartToneSoftColor(tone)))

/** Whether bar `index` of `rows` is one of the chosen bars. */
const isChosen = <Row extends ChartRow>(highlight: BarChartHighlight<Row>, row: Row, index: number, xKey: keyof Row & string): boolean =>
    typeof highlight === "function" ? highlight(row, index) : highlight.some((chosen) => chosen === readX(row, xKey) || String(chosen) === String(readX(row, xKey)))

/**
 * The fill of every bar of a chart with chosen bars: the chosen in `chosenTone` (or in the ink of the quiet mode), the rest in the muted step (the quiet mode's, or the tone's soft pair);
 * with none chosen, every bar in the tone (the quiet mode: the ink).
 */
export const barMarkFills = <Row extends ChartRow>(
    rows: readonly Row[],
    xKey: keyof Row & string,
    options: { readonly tone: ChartTone; readonly highlight?: BarChartHighlight<Row>; readonly highlightTone?: ChartTone; readonly quiet?: boolean },
): readonly string[] => {
    const { tone, highlight, highlightTone, quiet = false } = options
    const base = quiet ? CHART_QUIET_INK : chartToneColor(tone)
    const chosenFill = highlightTone === undefined ? base : chartToneColor(highlightTone)
    const resting = quiet ? CHART_QUIET_MUTED : chartToneSoftColor(tone)
    const chosen = highlight === undefined ? undefined : rows.map((row, index) => isChosen(highlight, row, index, xKey))
    if (chosen === undefined || !chosen.some(Boolean)) return rows.map(() => base)
    return chosen.map((is) => (is ? chosenFill : resting))
}

/** The width a chart assumes before its container is measured (the server render and the first paint): the drawing then fills the container. */
export const INITIAL_WIDTH = 320

const CAPACITY_LABEL = { fill: CHART_TEXT_FILL, ...CHART_TEXT_STYLE } as const

/**
 * EXT (`@starci/grammar/core/ext/recharts`) - `BarChart`: one series of bars over a category or date axis. Responsive to its
 * container's width; the same look at 1440 and 390, only narrower. Use for charts only; an app never imports `recharts` itself.
 */
export const BarChart = <Row extends ChartRow>({
    data,
    xKey,
    yKey,
    tone = "accent",
    height = DEFAULT_CHART_HEIGHT,
    ariaLabel,
    emptyLabel,
    isLoading,
    highlightLast = false,
    highlight,
    highlightTone,
    capacity,
    showValues = false,
    quiet = false,
    ...axes
}: BarChartProps<Row>) => {
    const formatX = axes.formatX ?? asText
    const formatY = axes.formatY ?? asNumberText
    const hasMarks = highlight !== undefined || highlightTone !== undefined || quiet
    const fills: readonly string[] = hasMarks
        ? barMarkFills(data, xKey, { tone, ...(highlight === undefined && highlightLast ? { highlight: (_row: Row, index: number) => index === data.length - 1 } : highlight === undefined ? {} : { highlight }), ...(highlightTone === undefined ? {} : { highlightTone }), quiet })
        : barFills(data.length, tone, highlightLast)
    const painted = hasMarks || highlightLast
    const last = highlightLast && highlight === undefined ? data.at(-1) : undefined
    const lastName = last === undefined ? ariaLabel : `${ariaLabel}, ${formatX(readX(last, xKey))}: ${formatY(readY(last, yKey))}`
    const name = capacity === undefined ? lastName : `${lastName}, ${capacity.label}: ${formatY(capacity.value)}`
    const peak = Math.max(0, ...data.map((row) => readY(row, yKey)))
    const yMax = capacity === undefined ? undefined : Math.max(peak, capacity.value)
    return (
        <ChartFrame component="BarChart" ariaLabel={name} emptyLabel={emptyLabel} isLoading={isLoading} isEmpty={data.length === 0} height={height}>
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: INITIAL_WIDTH, height }}>
                <RechartsBarChart data={[...data]} margin={{ top: showValues || capacity !== undefined ? 24 : 8, right: 8, bottom: 0, left: 0 }}>
                    {cartesianParts(axes, xKey, yKey, undefined, yMax)}
                    {capacity === undefined ? null : (
                        <ReferenceLine
                            y={capacity.value}
                            stroke={CHART_QUIET_MUTED}
                            strokeDasharray="4 4"
                            ifOverflow="extendDomain"
                            label={{ value: capacity.label, position: "insideTopRight", offset: 6, ...CAPACITY_LABEL }}
                        />
                    )}
                    <Bar dataKey={(row: Row) => readY(row, yKey)} fill={quiet ? CHART_QUIET_INK : chartToneColor(tone)} isAnimationActive={false}>
                        {painted ? fills.map((fill, index) => <Cell key={index} fill={fill} />) : null}
                        {showValues ? <LabelList dataKey={(row: Row) => readY(row, yKey)} position="top" formatter={(value: unknown) => (typeof value === "number" ? formatY(value) : "")} {...CAPACITY_LABEL} /> : null}
                    </Bar>
                </RechartsBarChart>
            </ResponsiveContainer>
        </ChartFrame>
    )
}
