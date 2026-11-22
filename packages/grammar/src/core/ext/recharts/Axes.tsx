"use client"

import { CartesianGrid, Tooltip, XAxis, YAxis } from "recharts"
import { ChartTooltip, asNumberText, asText, type ChartFormatters } from "./shared.js"
import { CHART_AXIS_STROKE, CHART_GRID_STROKE, CHART_TEXT_FILL, CHART_TEXT_STYLE } from "./tokens.js"

const TICK = { fill: CHART_TEXT_FILL, style: CHART_TEXT_STYLE } as const
const AXIS_LABEL_STYLE = { fill: CHART_TEXT_FILL, ...CHART_TEXT_STYLE } as const

export type ChartAxisProps = ChartFormatters & {
    /** Title of the x axis (e.g. "Week"). None when omitted. */
    readonly xAxisLabel?: string
    /** Title of the y axis (e.g. "Orders"). None when omitted. */
    readonly yAxisLabel?: string
    /** The series name shown beside its value in the tooltip. Defaults to the y key. */
    readonly seriesLabel?: string
}

const X_HEIGHT = 28
const X_HEIGHT_TITLED = 48
const Y_WIDTH = 48
const Y_WIDTH_TITLED = 72

/**
 * The grid, the two axes and the tooltip of a cartesian chart, in tokens: keyed children for the recharts chart to read. `seriesLabels`
 * names each series of a chart with several, in the order they are drawn.
 */
export const cartesianParts = (
    { formatX = asText, formatY = asNumberText, xAxisLabel, yAxisLabel, seriesLabel }: ChartAxisProps,
    xKey: string,
    yKey: string,
    seriesLabels?: readonly string[],
) => [
    <CartesianGrid key="grid" vertical={false} stroke={CHART_GRID_STROKE} />,
    <XAxis
        key="x"
        dataKey={xKey}
        tick={TICK}
        tickLine={false}
        axisLine={{ stroke: CHART_AXIS_STROKE }}
        tickFormatter={(value: string | number) => formatX(value)}
        height={xAxisLabel === undefined ? X_HEIGHT : X_HEIGHT_TITLED}
        {...(xAxisLabel === undefined ? {} : { label: { value: xAxisLabel, position: "insideBottom", style: AXIS_LABEL_STYLE } })}
    />,
    <YAxis
        key="y"
        tick={TICK}
        tickLine={false}
        axisLine={false}
        tickFormatter={(value: number) => formatY(value)}
        width={yAxisLabel === undefined ? Y_WIDTH : Y_WIDTH_TITLED}
        {...(yAxisLabel === undefined ? {} : { label: { value: yAxisLabel, angle: -90, position: "insideLeft", style: { ...AXIS_LABEL_STYLE, textAnchor: "middle" } } })}
    />,
    <Tooltip
        key="tip"
        cursor={{ stroke: CHART_GRID_STROKE, fill: "var(--default)" }}
        content={<ChartTooltip formatX={formatX} formatY={formatY} seriesLabel={seriesLabel ?? yKey} {...(seriesLabels === undefined ? {} : { seriesLabels })} />}
    />,
]
