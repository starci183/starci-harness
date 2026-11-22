"use client"

import { Bar, BarChart as RechartsBarChart, ResponsiveContainer } from "recharts"
import { cartesianParts, type ChartAxisProps } from "./Axes.js"
import { ChartFrame, readY, type ChartBaseProps, type ChartRow } from "./shared.js"
import { chartToneColor, type ChartTone } from "./tokens.js"
import type { NoChildren } from "../../tier.js"

export type BarChartProps<Row extends ChartRow> = NoChildren & ChartBaseProps<Row> & ChartAxisProps & {
    /** The series colour, one of Grammar's tones. Default `accent`. */
    readonly tone?: ChartTone
    /** The chart's height in px. Default 240; the width is the container's. */
    readonly height?: number
}

export const DEFAULT_CHART_HEIGHT = 240
/** The width a chart assumes before its container is measured (the server render and the first paint): the drawing then fills the container. */
export const INITIAL_WIDTH = 320

/**
 * EXT (`@starci/grammar/core/ext/recharts`) - `BarChart`: one series of bars over a category or date axis. Responsive to its
 * container's width; the same look at 1440 and 390, only narrower. Use for charts only; an app never imports `recharts` itself.
 */
export const BarChart = <Row extends ChartRow>({ data, xKey, yKey, tone = "accent", height = DEFAULT_CHART_HEIGHT, ariaLabel, emptyLabel, isLoading, ...axes }: BarChartProps<Row>) => (
    <ChartFrame component="BarChart" ariaLabel={ariaLabel} emptyLabel={emptyLabel} isLoading={isLoading} isEmpty={data.length === 0} height={height}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: INITIAL_WIDTH, height }}>
            <RechartsBarChart data={[...data]}>
                {cartesianParts(axes, xKey, yKey)}
                <Bar dataKey={(row: Row) => readY(row, yKey)} fill={chartToneColor(tone)} isAnimationActive={false} />
            </RechartsBarChart>
        </ResponsiveContainer>
    </ChartFrame>
)
