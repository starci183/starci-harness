"use client"

import type { CSSProperties, ReactNode } from "react"
import { Skeleton } from "../../leaf/Skeleton/index.js"
import { ErrorView, LOADING_ROWS, type ErrorData } from "../../loadingState.js"
import { useIsLoading, useRegionOwnsBusy } from "../../regionScope.js"
import type { NoChildren } from "../../tier.js"
import type { ProportionBarSize, ProportionBarTone } from "../ProportionBar/index.js"

/** The tone of one series: a status or brand token, or in the quiet mode the ink and the muted step. */
export type SegmentBarTone = ProportionBarTone | "ink" | "muted"

/** One series, drawn as a segment of every row and as one legend entry: the part that happened (booked) and the part that did not (not yet). */
export type SegmentBarSeries = {
    readonly id: string
    /** What the series is, drawn in the legend. */
    readonly label: string
    /** The segment's tone. Left out, the series take accent, success, warning, danger and neutral in order (the quiet mode: the first the ink, the rest muted). */
    readonly tone?: SegmentBarTone
}

/** One row: a category (a channel, a person, a service) with an amount per series. */
export type SegmentBarRow = {
    readonly id: string
    /** What the row is; the row's name for assistive technology. */
    readonly label: string
    /** The amount of each series by its `id`; a series left out counts zero. */
    readonly values: Readonly<Record<string, number>>
    /** The row's reading at its end, already written by the app ("4 / 10"); defaults to the sum of the amounts. */
    readonly valueLabel?: string
}

export type SegmentBarProps = NoChildren & {
    /** Names the chart for assistive technology, e.g. "Leads by channel, 7 days". */
    readonly label: string
    readonly series: readonly SegmentBarSeries[]
    readonly rows: readonly SegmentBarRow[]
    /** What shows in place of the bars when there are no rows or every row sums to zero. Required: a chart answers for its empty state. */
    readonly empty: ReactNode
    /** The first read has no data yet: the rows it was given draw as shimmering tracks with their labels kept (three when none). */
    readonly isLoading?: boolean
    /** The read failed: this takes the chart's place. Loading comes first, then error, then empty. */
    readonly error?: ErrorData
    /** The track's height, HeroUI ProgressBar's: `md` (default, 8px), `sm` (4px) in a dense row, `lg` (12px). */
    readonly size?: ProportionBarSize
    /**
     * The quiet colour mode: the first series is the ink and every other series the muted step, whatever tones they name, so a screen with other accents on it keeps to the 10%
     * accent budget. The legend and the words still say which is which, so colour is never the only cue.
     */
    readonly quiet?: boolean
}

const SEQUENCE: readonly ProportionBarTone[] = ["accent", "success", "warning", "danger", "neutral"]

type RowStyle = CSSProperties & { readonly "--starci-core-segment-extent": string }
type SegmentStyle = CSSProperties & { readonly "--starci-core-segment-share": string }

const amountOf = (row: SegmentBarRow, id: string): number => {
    const value = row.values[id]
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0
}

/** The tone series `index` is drawn in. */
const toneOf = (series: SegmentBarSeries, index: number, quiet: boolean): SegmentBarTone =>
    quiet ? (index === 0 ? "ink" : "muted") : series.tone ?? SEQUENCE[index % SEQUENCE.length] ?? "accent"

/**
 * Rows of bars on ONE scale (the longest row's sum is the full track), each bar split into the series' segments, a legend of the series under the rows and each row's own reading at
 * its end ("4 / 10"). Where `ProportionBar` is one whole, this is several wholes told against each other (leads by channel and how many of them booked). The track is HeroUI
 * ProgressBar's (8px at md, its corner, never a pill). A list for assistive technology: every row reads "label, reading". No axis and no animation.
 */
export const SegmentBar = ({ label, series, rows, empty, isLoading: ownLoading, error, size = "md", quiet = false }: SegmentBarProps) => {
    const isLoading = useIsLoading(ownLoading)
    const ownsBusy = useRegionOwnsBusy()
    if (!isLoading && error !== undefined) return <ErrorView error={error} />
    const sums = rows.map((row) => series.reduce((total, one) => total + amountOf(row, one.id), 0))
    const largest = Math.max(0, ...sums)
    if (!isLoading && (rows.length === 0 || series.length === 0 || largest === 0)) return <>{empty}</>
    const synthetic = isLoading && rows.length === 0
    const shown: readonly SegmentBarRow[] = synthetic
        ? Array.from({ length: LOADING_ROWS }, (_, index) => ({ id: `loading-${index}`, label: " ", values: {} }))
        : rows
    return (
        <div
            data-tier="composite"
            data-component="SegmentBar"
            data-contract="GAP-1 STATE-8"
            className="starci-core-segment-bar"
            data-size={size}
            {...(quiet ? { "data-grammar-quiet": "true" } : {})}
            {...(isLoading ? { "data-loading": "true", ...(ownsBusy ? {} : { "aria-busy": true }) } : {})}
        >
            <ul className="starci-core-segment-rows" aria-label={label}>
                {shown.map((row, rowIndex) => {
                    const sum = sums[rowIndex] ?? 0
                    const extent = isLoading ? 100 : largest === 0 ? 0 : (sum / largest) * 100
                    const style: RowStyle = { "--starci-core-segment-extent": `${extent}%` }
                    return (
                        <li key={row.id} className="starci-core-segment-row" style={style}>
                            <span className="starci-core-segment-label">{isLoading ? <Skeleton shape="text" /> : row.label}</span>
                            <span className="starci-core-segment-track" aria-hidden="true">
                                <span className="starci-core-segment-fill">
                                    {series.map((one, index) => {
                                        const amount = isLoading ? 1 : amountOf(row, one.id)
                                        const share = isLoading ? 100 / series.length : sum === 0 ? 0 : (amount / sum) * 100
                                        const segment: SegmentStyle = { "--starci-core-segment-share": `${share}%` }
                                        return share === 0 ? null : (
                                            <span
                                                key={one.id}
                                                className="starci-core-segment"
                                                style={segment}
                                                data-grammar-tone={toneOf(one, index, quiet)}
                                                data-grammar-skeleton={isLoading ? "true" : undefined}
                                            />
                                        )
                                    })}
                                </span>
                            </span>
                            <span className="starci-core-segment-value">{isLoading ? <Skeleton shape="text" /> : row.valueLabel ?? String(sum)}</span>
                        </li>
                    )
                })}
            </ul>
            <ul className="starci-core-segment-legend" aria-label={`${label}, series`}>
                {series.map((one, index) => (
                    <li key={one.id} className="starci-core-segment-legend-item">
                        <span className="starci-core-segment-dot" aria-hidden="true" data-grammar-tone={toneOf(one, index, quiet)} />
                        <span>{isLoading ? <Skeleton shape="text" /> : one.label}</span>
                    </li>
                ))}
            </ul>
        </div>
    )
}
