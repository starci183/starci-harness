"use client"

import { Line, LineChart as RechartsLineChart, ResponsiveContainer } from "recharts"
import { cartesianParts, type ChartAxisProps } from "./Axes.js"
import { DEFAULT_CHART_HEIGHT, INITIAL_WIDTH } from "./BarChart.js"
import { ChartFrame, readY, type ChartBaseProps, type ChartRow } from "./shared.js"
import { chartToneColor, type ChartTone } from "./tokens.js"
import type { NoChildren } from "../../tier.js"

export type LineChartProps<Row extends ChartRow> = NoChildren & ChartBaseProps<Row> & ChartAxisProps & {
    /** The series colour, one of Grammar's tones. Default `accent`. */
    readonly tone?: ChartTone
    /** The chart's height in px. Default 240; the width is the container's. */
    readonly height?: number
}

/** EXT - `LineChart`: one series as a line over a category or date axis, with the grid, axes and tooltip. See `BarChart`. */
export const LineChart = <Row extends ChartRow>({ data, xKey, yKey, tone = "accent", height = DEFAULT_CHART_HEIGHT, ariaLabel, emptyLabel, isLoading, ...axes }: LineChartProps<Row>) => {
    const color = chartToneColor(tone)
    return (
        <ChartFrame component="LineChart" ariaLabel={ariaLabel} emptyLabel={emptyLabel} isLoading={isLoading} isEmpty={data.length === 0} height={height}>
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: INITIAL_WIDTH, height }}>
                <RechartsLineChart data={[...data]}>
                    {cartesianParts(axes, xKey, yKey)}
                    <Line dataKey={(row: Row) => readY(row, yKey)} stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: color, stroke: "var(--surface)" }} isAnimationActive={false} type="monotone" />
                </RechartsLineChart>
            </ResponsiveContainer>
        </ChartFrame>
    )
}
