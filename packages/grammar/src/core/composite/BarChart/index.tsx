"use client"

import type { CSSProperties, ReactNode } from "react"
import { Skeleton } from "../../leaf/Skeleton/index.js"
import { ErrorView, LOADING_ROWS, type ErrorData } from "../../loadingState.js"
import { useIsLoading, useRegionOwnsBusy } from "../../regionScope.js"
import type { NoChildren } from "../../tier.js"

/** One bar: a value for a label (a day, a channel, a week). */
export type BarChartBar = {
    readonly id: string
    /** What the bar is for, drawn under it. */
    readonly label: string
    /** The measured amount; the bars share one scale from zero to the largest value. */
    readonly value: number
    /** How the value reads, drawn over the bar (a formatted number); defaults to the number. */
    readonly valueLabel?: string
}

/** A value axis: three ticks (the largest value, its half and zero) with light grid lines behind the bars. */
export type BarChartValueAxis = {
    /** How a tick reads, e.g. `(value) => "$" + value` or a compact number. Called with the largest value, half of it and 0. */
    readonly format: (value: number) => string
}

export type BarChartProps = NoChildren & {
    /** Names the chart for assistive technology, e.g. "Engagement per day". */
    readonly label: string
    readonly bars: readonly BarChartBar[]
    /** What shows in place of the chart when there are no bars. Required: a chart answers for its empty state. */
    readonly empty: ReactNode
    /** Draws a value axis (3 ticks, light grid lines) at the start of the plot. Default: none, as before. */
    readonly valueAxis?: BarChartValueAxis
    /** Draws the last bar (the latest period) in the accent and the others in its soft tone. Default false: every bar in the accent. */
    readonly highlightLast?: boolean
    /** The first read has no data yet: the bars it was given draw as shimmering geometry with their labels kept (three when none). */
    readonly isLoading?: boolean
    /** The read failed: this takes the chart's place. Loading comes first, then error, then empty. */
    readonly error?: ErrorData
}

/** Bar heights of a loading chart, as a share of the plot: a fixed uneven run, so the shimmer reads as a chart. */
const LOADING_SHARES = [55, 80, 40, 90, 65, 75, 50] as const

type BarStyle = CSSProperties & { readonly "--starci-core-bar-share": string }

/**
 * Bars on one scale: a column per label, its height the value's share of the largest, the value over it as real text and
 * the label under it. A list of values for assistive technology (each item reads "label, value"), never an image. It
 * draws no legend; a `valueAxis` adds three ticks and light grid lines (decorative: the values stay in the list), and
 * `highlightLast` sets the latest bar apart.
 */
export const BarChart = ({ label, bars, empty, valueAxis, highlightLast = false, isLoading: ownLoading, error }: BarChartProps) => {
    const isLoading = useIsLoading(ownLoading)
    const ownsBusy = useRegionOwnsBusy()
    if (!isLoading && error !== undefined) return <ErrorView error={error} />
    if (!isLoading && bars.length === 0) return <>{empty}</>
    const shown: readonly BarChartBar[] = isLoading && bars.length === 0
        ? Array.from({ length: LOADING_ROWS }, (_, index) => ({ id: `loading-${index}`, label: " ", value: 0 }))
        : bars
    const largest = Math.max(...shown.map((bar) => bar.value), 0)
    const ticks = [largest, largest / 2, 0] as const
    const list = (
        <ol className="starci-core-bar-chart-bars" aria-label={label}>
            {shown.map((bar, index) => {
                const share = isLoading ? (LOADING_SHARES[index % LOADING_SHARES.length] ?? 50) : largest === 0 ? 0 : Math.round((bar.value / largest) * 100)
                const style: BarStyle = { "--starci-core-bar-share": `${share}%` }
                const tone = highlightLast && !isLoading ? (index === shown.length - 1 ? "accent" : "soft") : undefined
                return (
                    <li key={bar.id} className="starci-core-bar-chart-bar">
                        <span className="starci-core-bar-chart-value">{isLoading ? <Skeleton shape="text" /> : bar.valueLabel ?? String(bar.value)}</span>
                        <span className="starci-core-bar-chart-plot"><span className="starci-core-bar-chart-fill" style={style} data-grammar-bar-tone={tone} data-grammar-skeleton={isLoading ? "true" : undefined} /></span>
                        <span className="starci-core-bar-chart-label">{bar.label}</span>
                    </li>
                )
            })}
        </ol>
    )
    return (
        <div
            data-tier="composite"
            data-component="BarChart"
            data-contract="GAP-1 STATE-8"
            className="starci-core-bar-chart"
            {...(valueAxis === undefined ? {} : { "data-grammar-bar-axis": "true" })}
            {...(isLoading ? { "data-loading": "true", ...(ownsBusy ? {} : { "aria-busy": true }) } : {})}
        >
            {valueAxis === undefined ? list : (
                <>
                    <div className="starci-core-bar-chart-axis" aria-hidden="true">
                        <div className="starci-core-bar-chart-axis-band">
                            {ticks.map((tick, index) => (
                                <span key={index} className="starci-core-bar-chart-tick" data-grammar-tick={index === 0 ? "max" : index === 1 ? "half" : "zero"}>
                                    {isLoading ? <Skeleton shape="text" /> : valueAxis.format(tick)}
                                </span>
                            ))}
                        </div>
                    </div>
                    <div className="starci-core-bar-chart-body">
                        <div className="starci-core-bar-chart-grid" aria-hidden="true">
                            <span className="starci-core-bar-chart-gridline" />
                            <span className="starci-core-bar-chart-gridline" />
                            <span className="starci-core-bar-chart-gridline" />
                        </div>
                        {list}
                    </div>
                </>
            )}
        </div>
    )
}
