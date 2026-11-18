"use client"

import type { CSSProperties, ReactNode } from "react"
import { Badge } from "../../leaf/Badge/index.js"
import { Skeleton } from "../../leaf/Skeleton/index.js"
import { ErrorView, LOADING_ROWS, type ErrorData } from "../../loadingState.js"
import { useIsLoading, useRegionOwnsBusy } from "../../regionScope.js"
import type { NoChildren } from "../../tier.js"

/** The tone of one stage: a HeroUI status or brand token pair, so a stage is told from the next by more than its place. */
export type FunnelChartTone = "accent" | "success" | "warning" | "danger" | "neutral"

/** One stage, in the order the reader goes through them: a name and how many reached it. */
export type FunnelChartStage = {
    /** What the stage is, drawn at its start; one per stage, it is the stage's key. */
    readonly label: string
    /** How many reached the stage; the bar is its share of the largest stage and the count is real text inside the bar. */
    readonly count: number
    /** A second reading of the stage at its end, already written by the app (an amount, a share of the first stage). */
    readonly value?: string
    /** The stage's tone; the stages take the accent when it is left out. */
    readonly tone?: FunnelChartTone
    /** Words for the step into this stage, in place of the default drop-off count (e.g. "380 left"). Never read on the first stage. */
    readonly stepLabel?: string
}

export type FunnelChartProps = NoChildren & {
    /** Names the funnel for assistive technology, e.g. "Leads by stage, last 30 days". */
    readonly label: string
    /** The stages in order, first to last (at most about eight read well); each is a list item that reads "label, count, value". */
    readonly stages: readonly FunnelChartStage[]
    /** What shows in place of the funnel when there are no stages. Required: a chart answers for its empty state. */
    readonly empty: ReactNode
    /** How a count reads in a bar and in a drop-off, e.g. a locale's grouped number. Default: the number as it is. */
    readonly format?: (value: number) => string
    /** The first read has no data yet: the stages it was given draw as geometry with their labels kept (four when none). */
    readonly isLoading?: boolean
    /** The read failed: this takes the chart's place. Loading comes first, then error, then empty. */
    readonly error?: ErrorData
}

/** Bars of a loading funnel, as shares of the track: a fixed falling run, so the shimmer reads as a funnel. */
const LOADING_SHARES: readonly number[] = [100, 72, 46, 28, 16]

type StageStyle = CSSProperties & { readonly "--starci-core-funnel-share": string }

const round = (value: number, places = 100) => Math.round(value * places) / places

/** The step into a stage: what share of the stage before it came through, and how many fell away (negative when more came in). */
const stepOf = (previous: number, count: number): { readonly percent: string; readonly drop: number } => ({
    percent: previous > 0 ? `${round((count / previous) * 100, 10)} %` : "–",
    drop: previous - count,
})

/**
 * Stages in order, each a bar on one scale (its count as text inside the bar), with a chip between two bars that says how much of
 * the stage before came through and a drop-off count beside it. The bars start at one edge and are measured against the largest
 * stage, so their lengths compare; the tone is the stage's. A list for assistive technology (each item reads "label, count,
 * value"), never an image. A chart narrower than 33rem stacks each stage (label and value over the bar).
 */
export const FunnelChart = ({ label, stages, empty, format = String, isLoading: ownLoading, error }: FunnelChartProps) => {
    const isLoading = useIsLoading(ownLoading)
    const ownsBusy = useRegionOwnsBusy()
    if (!isLoading && error !== undefined) return <ErrorView error={error} />
    if (!isLoading && stages.length === 0) return <>{empty}</>
    const synthetic = isLoading && stages.length === 0
    const shown: readonly FunnelChartStage[] = synthetic
        ? Array.from({ length: LOADING_ROWS + 1 }, (_, index) => ({ label: `loading-${index}`, count: 0 }))
        : stages
    const largest = Math.max(0, ...shown.map((stage) => (Number.isFinite(stage.count) ? stage.count : 0)))
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
                    const count = Number.isFinite(stage.count) ? Math.max(0, stage.count) : 0
                    const share = isLoading ? (LOADING_SHARES[index % LOADING_SHARES.length] ?? 50) : largest === 0 ? 0 : round((count / largest) * 100)
                    const style: StageStyle = { "--starci-core-funnel-share": `${share}%` }
                    const tone = stage.tone ?? "accent"
                    const previous = index === 0 ? undefined : shown[index - 1]
                    const step = previous === undefined || isLoading ? undefined : stepOf(Math.max(0, previous.count), count)
                    return (
                        <li key={stage.label} className="starci-core-funnel-stage" style={style}>
                            {index === 0 ? null : (
                                <span className="starci-core-funnel-step">
                                    {isLoading || step === undefined ? (
                                        <Skeleton shape="text" />
                                    ) : (
                                        <>
                                            <Badge tone="neutral">{step.percent}</Badge>
                                            <span className="starci-core-funnel-drop" data-grammar-drop={step.drop > 0 ? "lost" : "kept"}>
                                                {stage.stepLabel ?? (step.drop > 0 ? `−${format(step.drop)}` : step.drop < 0 ? `+${format(-step.drop)}` : format(0))}
                                            </span>
                                        </>
                                    )}
                                </span>
                            )}
                            <span className="starci-core-funnel-label">{synthetic ? <Skeleton shape="text" /> : stage.label}</span>
                            <span className="starci-core-funnel-track">
                                <span className="starci-core-funnel-bar" data-grammar-tone={isLoading ? undefined : tone} data-grammar-skeleton={isLoading ? "true" : undefined}>
                                    {isLoading ? null : format(count)}
                                </span>
                            </span>
                            <span className="starci-core-funnel-value">{isLoading ? <Skeleton shape="text" /> : stage.value}</span>
                        </li>
                    )
                })}
            </ol>
        </div>
    )
}
