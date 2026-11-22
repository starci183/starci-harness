"use client"

import type { CSSProperties, ReactNode } from "react"
import { Skeleton } from "../../leaf/Skeleton/index.js"
import { ErrorView, LOADING_ROWS, type ErrorData } from "../../loadingState.js"
import { useIsLoading, useRegionOwnsBusy } from "../../regionScope.js"
import type { NoChildren } from "../../tier.js"

/** The tone of one row: a HeroUI status or brand token pair, so a row is told from the next by more than its place. */
export type IntervalChartTone = "accent" | "info" | "success" | "warning" | "danger" | "neutral"

/** One row: a name, the range it was measured in, the point inside it, and what the row reads as. */
export type IntervalChartRow = {
    /** What the row is, drawn at its start (a variant, a channel, a plan); one per row, it is the row's key. The reference row says so in its own words ("A, control"). */
    readonly label: string
    /** The low end of the range, on the same scale as `high` and `point`. */
    readonly low: number
    /** The high end of the range. */
    readonly high: number
    /** The best single reading, drawn as a mark inside the range. */
    readonly point: number
    /** The row's tone; the reference row is neutral and the others take the accent when it is left out. */
    readonly tone?: IntervalChartTone
    /** The row the others are read against: its point draws one dashed line through every row. The first such row wins. */
    readonly isReference?: boolean
    /** How the row reads at its end (formatted words or numbers); defaults to `point (low – high)` through `format`. */
    readonly valueLabel?: string
}

export type IntervalChartProps = NoChildren & {
    /** Names the chart for assistive technology, e.g. "Conversion rate by variant, 90 % interval". */
    readonly label: string
    /** A few rows (at most about six read well); each is a list item that reads "label, value". */
    readonly rows: readonly IntervalChartRow[]
    /** What shows in place of the chart when there are no rows. Required: a chart answers for its empty state. */
    readonly empty: ReactNode
    /** How a number reads in a row's default value and on the scale ends, e.g. `(value) => value + " %"`. Default: the number as it is. */
    readonly format?: (value: number) => string
    /** The first read has no data yet: the rows it was given draw as geometry with their labels kept (three when none). */
    readonly isLoading?: boolean
    /** The read failed: this takes the chart's place. Loading comes first, then error, then empty. */
    readonly error?: ErrorData
}

/** Ranges of a loading chart, as shares of the plot: a fixed uneven run, so the shimmer reads as a chart. */
const LOADING_RANGES: ReadonlyArray<readonly [number, number]> = [[22, 46], [48, 78], [34, 60]]

type ChartStyle = CSSProperties & { readonly "--starci-core-interval-reference"?: string }
type RowStyle = CSSProperties & {
    readonly "--starci-core-interval-low": string
    readonly "--starci-core-interval-span": string
    readonly "--starci-core-interval-point": string
}

const round = (value: number) => Math.round(value * 100) / 100

/** The scale every row shares: the lowest low to the highest high, padded so a mark is never clipped, and rounded out to a round step, and kept at zero when the data starts above it. */
const scaleOf = (rows: readonly IntervalChartRow[]): { readonly min: number; readonly max: number } => {
    const values = rows.flatMap((row) => [row.low, row.high, row.point]).filter(Number.isFinite)
    if (values.length === 0) return { min: 0, max: 1 }
    const low = Math.min(...values)
    const high = Math.max(...values)
    const span = high - low || Math.abs(high) || 1
    const rough = (span * 1.16) / 4
    const magnitude = 10 ** Math.floor(Math.log10(rough))
    const step = magnitude * ([1, 2, 2.5, 5, 10].find((multiple) => multiple * magnitude >= rough) ?? 10)
    const min = Math.floor((low - span * 0.04) / step) * step
    return { min: low >= 0 && min < 0 ? 0 : round(min), max: round(Math.ceil((high + span * 0.04) / step) * step) }
}

/**
 * Ranges on one scale: a row per label with its range as a bar, the best reading as a mark inside it and, when one row is the
 * reference, a dashed line through every row at that row's point. The value of each row is real text at the end, the scale ends
 * are text under the plots, and a chart narrower than 33rem stacks each row (label and value over the plot). A list for
 * assistive technology (each item reads "label, value"), never an image; the tone is the row's, not a verdict the chart draws.
 */
export const IntervalChart = ({ label, rows, empty, format = String, isLoading: ownLoading, error }: IntervalChartProps) => {
    const isLoading = useIsLoading(ownLoading)
    const ownsBusy = useRegionOwnsBusy()
    if (!isLoading && error !== undefined) return <ErrorView error={error} />
    if (!isLoading && rows.length === 0) return <>{empty}</>
    const synthetic = isLoading && rows.length === 0
    const shown: readonly IntervalChartRow[] = synthetic
        ? Array.from({ length: LOADING_ROWS }, (_, index) => ({ label: `loading-${index}`, low: 0, high: 1, point: 0.5 }))
        : rows
    const { min, max } = scaleOf(shown)
    const span = max - min || 1
    const share = (value: number) => round(Math.min(100, Math.max(0, ((value - min) / span) * 100)))
    const reference = isLoading ? undefined : shown.find((row) => row.isReference === true)
    const chartStyle: ChartStyle = reference === undefined ? {} : { "--starci-core-interval-reference": `${share(reference.point)}%` }
    return (
        <div
            data-tier="composite"
            data-component="IntervalChart"
            data-contract="GAP-1 STATE-8"
            className="starci-core-interval-chart"
            style={chartStyle}
            {...(reference === undefined ? {} : { "data-grammar-interval-reference": "true" })}
            {...(isLoading ? { "data-loading": "true", ...(ownsBusy ? {} : { "aria-busy": true }) } : {})}
        >
            <div className="starci-core-interval-body">
            <ol className="starci-core-interval-rows" aria-label={label}>
                {shown.map((row, index) => {
                    const loadingRange = LOADING_RANGES[index % LOADING_RANGES.length] ?? [30, 60]
                    const low = isLoading ? loadingRange[0] : share(Math.min(row.low, row.high))
                    const high = isLoading ? loadingRange[1] : share(Math.max(row.low, row.high))
                    const point = isLoading ? (low + high) / 2 : share(row.point)
                    const tone = row.tone ?? (row.isReference === true ? "neutral" : "accent")
                    const style: RowStyle = {
                        "--starci-core-interval-low": `${low}%`,
                        "--starci-core-interval-span": `${round(high - low)}%`,
                        "--starci-core-interval-point": `${point}%`,
                    }
                    const isRef = row === reference
                    return (
                        <li key={row.label} className="starci-core-interval-row" style={style} {...(isRef ? { "data-grammar-interval-is-reference": "true" } : {})}>
                            <span className="starci-core-interval-label">
                                {synthetic ? <Skeleton shape="text" /> : row.label}
                            </span>
                            <span className="starci-core-interval-plot" aria-hidden="true">
                                <span className="starci-core-interval-axis" />
                                {reference === undefined ? null : <span className="starci-core-interval-reference" />}
                                <span className="starci-core-interval-range" data-grammar-tone={isLoading ? undefined : tone} data-grammar-skeleton={isLoading ? "true" : undefined} />
                                {isLoading ? null : <span className="starci-core-interval-point" data-grammar-tone={tone} />}
                            </span>
                            <span className="starci-core-interval-value">
                                {isLoading ? <Skeleton shape="text" /> : row.valueLabel ?? `${format(row.point)} (${format(row.low)} – ${format(row.high)})`}
                            </span>
                        </li>
                    )
                })}
            </ol>
            <div className="starci-core-interval-scale" aria-hidden="true">
                <span className="starci-core-interval-scale-plot">
                    <span>{isLoading ? <Skeleton shape="text" /> : format(round(min))}</span>
                    <span>{isLoading ? <Skeleton shape="text" /> : format(round(max))}</span>
                </span>
            </div>
            </div>
        </div>
    )
}
