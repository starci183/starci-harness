"use client"

import { useId } from "react"
import { Area, AreaChart as RechartsAreaChart, ResponsiveContainer } from "recharts"
import { cartesianParts, type ChartAxisProps } from "./Axes.js"
import { DEFAULT_CHART_HEIGHT, INITIAL_WIDTH } from "./BarChart.js"
import { ChartFrame, ChartLegend, readY, type ChartBaseProps, type ChartRow } from "./shared.js"
import { CHART_AREA_FILL_STACKED_BOTTOM, CHART_AREA_FILL_TOP, CHART_MARK_GAP_STROKE, chartCategoryTone, chartToneColor, type ChartTone } from "./tokens.js"
import type { NoChildren } from "../../tier.js"

/** A further series of an `AreaChart`, read from the same rows: its key, its name (legend and tooltip) and its tone. */
export type AreaChartSeries<Row extends ChartRow> = {
    readonly key: keyof Row & string
    readonly label: string
    /** One of Grammar's tones. Default: the next tone of the categorical order (`success`, `warning`, `danger`, `info`). */
    readonly tone?: ChartTone
}

export type AreaChartProps<Row extends ChartRow> = NoChildren & ChartBaseProps<Row> & ChartAxisProps & {
    /** The colour of the `yKey` series, one of Grammar's tones. Default `accent`. */
    readonly tone?: ChartTone
    /** Further series over the same x, drawn after the `yKey` series. With any, a legend names every series under the chart. */
    readonly series?: readonly AreaChartSeries<Row>[]
    /** Stack the series on one another (a total and its parts) instead of overlaying them. Default false. */
    readonly stacked?: boolean
    /** The chart's height in px. Default 240; the width is the container's. */
    readonly height?: number
}

/** An area's soft fill: a top-down gradient of its series token, from the faded opacity to none (to the dimmed opacity when stacked). */
export const AreaFill = ({ id, color, stacked }: { readonly id: string; readonly color: string; readonly stacked: boolean }) => (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" style={{ stopColor: color, stopOpacity: CHART_AREA_FILL_TOP }} />
        <stop offset="100%" style={{ stopColor: color, stopOpacity: stacked ? CHART_AREA_FILL_STACKED_BOTTOM : 0 }} />
    </linearGradient>
)

type Drawn = { readonly key: string; readonly label: string; readonly color: string; readonly read: (row: object) => number }

/**
 * EXT - `AreaChart`: activity over time, one or more series as lines with a soft fill of their own token (a gradient from the faded
 * opacity), overlaid or `stacked`. The same x and y shape as `LineChart`; `series` adds more keys of the same rows. See `BarChart`.
 */
export const AreaChart = <Row extends ChartRow>({
    data,
    xKey,
    yKey,
    tone = "accent",
    series = [],
    stacked = false,
    height = DEFAULT_CHART_HEIGHT,
    ariaLabel,
    emptyLabel,
    isLoading,
    ...axes
}: AreaChartProps<Row>) => {
    const gradientBase = useId().replace(/[^\w-]/g, "")
    const first: Drawn = { key: yKey, label: axes.seriesLabel ?? yKey, color: chartToneColor(tone), read: (row) => readY(row as Row, yKey) }
    const drawn: readonly Drawn[] = [
        first,
        ...series.map((entry, index): Drawn => ({
            key: entry.key,
            label: entry.label,
            color: chartToneColor(entry.tone ?? chartCategoryTone(index + 1)),
            read: (row) => readY(row as Row, entry.key),
        })),
    ]
    const isMulti = drawn.length > 1
    const legend = isMulti ? <ChartLegend layout="row" items={drawn.map(({ label, color }) => ({ label, color }))} /> : undefined
    return (
        <ChartFrame component="AreaChart" ariaLabel={ariaLabel} emptyLabel={emptyLabel} isLoading={isLoading} isEmpty={data.length === 0} height={height} legend={legend}>
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: INITIAL_WIDTH, height }}>
                <RechartsAreaChart data={[...data]}>
                    <defs>
                        {drawn.map(({ key, color }, index) => (
                            <AreaFill key={key} id={`${gradientBase}-area-${index}`} color={color} stacked={stacked} />
                        ))}
                    </defs>
                    {cartesianParts(axes, xKey, yKey, isMulti ? drawn.map(({ label }) => label) : undefined)}
                    {drawn.map(({ key, label, color, read }, index) => (
                        <Area
                            key={key}
                            dataKey={read}
                            name={label}
                            stroke={color}
                            strokeWidth={2}
                            fill={`url(#${gradientBase}-area-${index})`}
                            dot={false}
                            activeDot={{ r: 4, fill: color, stroke: CHART_MARK_GAP_STROKE }}
                            isAnimationActive={false}
                            type="monotone"
                            {...(stacked ? { stackId: "stack" } : {})}
                        />
                    ))}
                </RechartsAreaChart>
            </ResponsiveContainer>
        </ChartFrame>
    )
}
