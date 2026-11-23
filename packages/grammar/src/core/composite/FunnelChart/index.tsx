"use client"

import { ArrowDownIcon } from "@heroicons/react/24/outline"
import type { CSSProperties, ReactNode } from "react"
import { Icon } from "../../leaf/Icon/index.js"
import { Skeleton } from "../../leaf/Skeleton/index.js"
import { ErrorView, LOADING_ROWS, type ErrorData } from "../../loadingState.js"
import { useIsLoading, useRegionOwnsBusy } from "../../regionScope.js"
import type { NoChildren } from "../../tier.js"

/** The tone of one stage's fill: a HeroUI status or brand token, so a stage is told from the next by more than its place. */
export type FunnelChartTone = "accent" | "info" | "success" | "warning" | "danger" | "neutral"

/** One stage, in the order the reader goes through them: a name and how many reached it. */
export type FunnelChartStage = {
    /** What the stage is, drawn on the stage's text row as "label · count"; one per stage, it is the stage's key. */
    readonly label: string
    /** How many reached the stage; the fill is its share of the largest stage. */
    readonly count: number
    /** A second reading of the stage at the end of its text row, already written by the app (an amount, a share of the first stage). */
    readonly value?: string
    /** The fill's tone; the stages take the accent when it is left out. */
    readonly tone?: FunnelChartTone
    /** Words for the step into this stage, in place of the default rate ("60%" after the down arrow icon) (e.g. "380 left"). Never read on the first stage. */
    readonly stepLabel?: string
}

export type FunnelChartProps = NoChildren & {
    /** Names the funnel for assistive technology, e.g. "Leads by stage, last 30 days". */
    readonly label: string
    /** The stages in order, first to last (at most about eight read well); each is a list item that reads "label · count, step, value". */
    readonly stages: readonly FunnelChartStage[]
    /** What shows in place of the funnel when there are no stages, or every stage counts zero. Required: a chart answers for its empty state. */
    readonly empty: ReactNode
    /** How a count reads on the text row, e.g. a locale's grouped number. Default: the number as it is. */
    readonly format?: (value: number) => string
    /** The first read has no data yet: the stages it was given draw as geometry with their labels kept (four when none). */
    readonly isLoading?: boolean
    /** The read failed: this takes the chart's place. Loading comes first, then error, then empty. */
    readonly error?: ErrorData
}

/** Fills of a loading funnel, as shares of the track: a fixed falling run, so the shimmer reads as a funnel. */
const LOADING_SHARES: readonly number[] = [100, 72, 46, 28, 16]

type StageStyle = CSSProperties & { readonly "--starci-core-funnel-share": string }

/** How the step into a stage reads: the largest drop of the chart, another loss, or a stage that kept or gained. */
type StepMark = "largest" | "lost" | "kept"

const round = (value: number, places = 100) => Math.round(value * places) / places

const countOf = (stage: FunnelChartStage) => (Number.isFinite(stage.count) ? Math.max(0, stage.count) : 0)

/** The share of the stage before that came through, as "60%"; a dash when the stage before counted zero. */
const rateOf = (previous: number, count: number): string => (previous > 0 ? `${round((count / previous) * 100, 10)}%` : "–")

/**
 * The index of the stage whose step lost the largest share of the stage before it (the lowest rate through), first on a tie; none
 * when no step lost anything.
 */
const largestDropAt = (counts: readonly number[]): number | undefined => {
    let at: number | undefined
    let lowest = 1
    counts.forEach((count, index) => {
        const previous = index === 0 ? undefined : counts[index - 1]
        if (previous === undefined || previous <= 0 || count >= previous) return
        const rate = count / previous
        if (at === undefined || rate < lowest) {
            at = index
            lowest = rate
        }
    })
    return at
}

/**
 * Stages in order, each a text row ("label · count", the step into it as the down arrow icon and "60%", the app's `value` at its end) over a track of HeroUI
 * ProgressBar's own size (md, 8px, at the vendor's corner; ramps.css "BARS") whose fill is the stage's share of the largest stage.
 * Every track is one width and every fill starts at one edge, so their lengths compare; the step that lost the largest share is the
 * danger tone. A list for assistive technology (each item reads "label · count, step, value"), never an image. A funnel whose
 * stages all count zero shows `empty`.
 */
export const FunnelChart = ({ label, stages, empty, format = String, isLoading: ownLoading, error }: FunnelChartProps) => {
    const isLoading = useIsLoading(ownLoading)
    const ownsBusy = useRegionOwnsBusy()
    if (!isLoading && error !== undefined) return <ErrorView error={error} />
    const counts = stages.map(countOf)
    const largest = Math.max(0, ...counts)
    if (!isLoading && (stages.length === 0 || largest === 0)) return <>{empty}</>
    const synthetic = isLoading && stages.length === 0
    const shown: readonly FunnelChartStage[] = synthetic
        ? Array.from({ length: LOADING_ROWS + 1 }, (_, index) => ({ label: `loading-${index}`, count: 0 }))
        : stages
    const worst = isLoading ? undefined : largestDropAt(counts)
    return (
        <div
            data-tier="composite"
            data-component="FunnelChart"
            data-contract="GAP-1 STATE-8"
            className="starci-core-funnel-chart"
            {...(isLoading ? { "data-loading": "true", ...(ownsBusy ? {} : { "aria-busy": true }) } : {})}
        >
            <ol className="starci-core-funnel-stages" aria-label={label}>
                {shown.map((stage, index) => {
                    const count = countOf(stage)
                    const share = isLoading ? (LOADING_SHARES[index % LOADING_SHARES.length] ?? 50) : round((count / largest) * 100)
                    const style: StageStyle = { "--starci-core-funnel-share": `${share}%` }
                    const previous = index === 0 ? undefined : counts[index - 1]
                    const mark: StepMark = index === worst ? "largest" : previous !== undefined && count < previous ? "lost" : "kept"
                    return (
                        <li key={stage.label} className="starci-core-funnel-stage" style={style}>
                            <span className="starci-core-funnel-head">
                                <span className="starci-core-funnel-label">
                                    {synthetic ? (
                                        <Skeleton shape="text" />
                                    ) : (
                                        <>
                                            {stage.label}
                                            {isLoading ? null : <span className="starci-core-funnel-count"> · {format(count)}</span>}
                                        </>
                                    )}
                                </span>
                                {index === 0 || previous === undefined ? null : (
                                    <span className="starci-core-funnel-step" data-grammar-drop={isLoading ? undefined : mark}>
                                        {isLoading ? (
                                            <Skeleton shape="text" />
                                        ) : (
                                            <>
                                                <span className="starci-core-funnel-step-mark" aria-hidden="true"><Icon source={ArrowDownIcon} usage="text" /></span>
                                                {stage.stepLabel ?? rateOf(previous, count)}
                                            </>
                                        )}
                                    </span>
                                )}
                                {stage.value === undefined && !isLoading ? null : (
                                    <span className="starci-core-funnel-value">{isLoading ? <Skeleton shape="text" /> : stage.value}</span>
                                )}
                            </span>
                            <span className="starci-core-funnel-track" aria-hidden="true">
                                <span
                                    className="starci-core-funnel-bar"
                                    data-grammar-tone={isLoading ? undefined : stage.tone ?? "accent"}
                                    data-grammar-skeleton={isLoading ? "true" : undefined}
                                />
                            </span>
                        </li>
                    )
                })}
            </ol>
        </div>
    )
}
