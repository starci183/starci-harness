"use client"

import { Bar, BarChart as RechartsBarChart, Cell, ResponsiveContainer } from "recharts"
import { cartesianParts, type ChartAxisProps } from "./Axes.js"
import { ChartFrame, asNumberText, asText, readX, readY, type ChartBaseProps, type ChartRow } from "./shared.js"
import { chartToneColor, chartToneSoftColor, type ChartTone } from "./tokens.js"
import type { NoChildren } from "../../tier.js"

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
}

export const DEFAULT_CHART_HEIGHT = 240

/** The fill of each of `count` bars: every bar in the tone, or with `highlightLast` the last in the tone and the others in its soft pair. */
export const barFills = (count: number, tone: ChartTone, highlightLast: boolean): readonly string[] =>
    Array.from({ length: count }, (_unused, index) => (!highlightLast || index === count - 1 ? chartToneColor(tone) : chartToneSoftColor(tone)))
/** The width a chart assumes before its container is measured (the server render and the first paint): the drawing then fills the container. */
export const INITIAL_WIDTH = 320

/**
 * EXT (`@starci/grammar/core/ext/recharts`) - `BarChart`: one series of bars over a category or date axis. Responsive to its
 * container's width; the same look at 1440 and 390, only narrower. Use for charts only; an app never imports `recharts` itself.
 */
export const BarChart = <Row extends ChartRow>({ data, xKey, yKey, tone = "accent", height = DEFAULT_CHART_HEIGHT, ariaLabel, emptyLabel, isLoading, highlightLast = false, ...axes }: BarChartProps<Row>) => {
    const last = highlightLast ? data.at(-1) : undefined
    const formatX = axes.formatX ?? asText
    const formatY = axes.formatY ?? asNumberText
    const fills = barFills(data.length, tone, highlightLast)
    const name = last === undefined ? ariaLabel : `${ariaLabel}, ${formatX(readX(last, xKey))}: ${formatY(readY(last, yKey))}`
    return (
        <ChartFrame component="BarChart" ariaLabel={name} emptyLabel={emptyLabel} isLoading={isLoading} isEmpty={data.length === 0} height={height}>
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: INITIAL_WIDTH, height }}>
                <RechartsBarChart data={[...data]}>
                    {cartesianParts(axes, xKey, yKey)}
                    <Bar dataKey={(row: Row) => readY(row, yKey)} fill={chartToneColor(tone)} isAnimationActive={false}>
                        {highlightLast ? fills.map((fill, index) => <Cell key={index} fill={fill} />) : null}
                    </Bar>
                </RechartsBarChart>
            </ResponsiveContainer>
        </ChartFrame>
    )
}
