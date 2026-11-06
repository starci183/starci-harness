"use client"

import type { CSSProperties, ReactNode } from "react"
import { Skeleton } from "../../leaf/Skeleton/index.js"
import { ErrorView, LOADING_ROWS, type ErrorData } from "../../loadingState.js"
import { useIsLoading, useRegionOwnsBusy } from "../../regionScope.js"
import type { NoChildren } from "../../tier.js"

/** The tone of one part: a HeroUI status or brand token, so a part is told from the next by more than its place. */
export type ProportionBarTone = "accent" | "success" | "warning" | "danger" | "neutral"

/** One part of the whole: a label, an amount, and what the amount reads as. */
export type ProportionBarPart = {
    readonly id: string
    /** What the part is, drawn in the legend. */
    readonly label: string
    /** The amount; each part is its share of the sum of all of them. A part of zero draws no segment but keeps its legend row. */
    readonly value: number
    /** How the amount reads in the legend (a formatted number); defaults to the number. */
    readonly valueLabel?: string
    /** The part's tone; the parts take accent, success, warning, danger and neutral in order when it is left out. */
    readonly tone?: ProportionBarTone
}

export type ProportionBarProps = NoChildren & {
    /** Names the bar for assistive technology, e.g. "Receivables by age". */
    readonly label: string
    readonly parts: readonly ProportionBarPart[]
    /** What shows in place of the bar when there are no parts or their sum is zero. Required: a bar answers for its empty state. */
    readonly empty: ReactNode
    /** The first read has no data yet: one shimmering track with a legend of as many rows as it was given (three when none). */
    readonly isLoading?: boolean
    /** The read failed: this takes the bar's place. Loading comes first, then error, then empty. */
    readonly error?: ErrorData
}

const SEQUENCE: readonly ProportionBarTone[] = ["accent", "success", "warning", "danger", "neutral"]

type SegmentStyle = CSSProperties & { readonly "--starci-core-proportion-share": string }

/**
 * One track split into segments, each part's share of the whole, with a legend under it (a dot in the part's tone, its label and
 * its amount as real text). A list for assistive technology: every item reads "label, amount". It draws no axis, no percentage
 * and no animation; two or three parts of one whole are this, many columns on one scale are a `BarChart`.
 */
export const ProportionBar = ({ label, parts, empty, isLoading: ownLoading, error }: ProportionBarProps) => {
    const isLoading = useIsLoading(ownLoading)
    const ownsBusy = useRegionOwnsBusy()
    if (!isLoading && error !== undefined) return <ErrorView error={error} />
    const sum = parts.reduce((total, part) => total + Math.max(0, part.value), 0)
    if (!isLoading && (parts.length === 0 || sum === 0)) return <>{empty}</>
    const shown: readonly ProportionBarPart[] = isLoading && parts.length === 0
        ? Array.from({ length: LOADING_ROWS }, (_, index) => ({ id: `loading-${index}`, label: " ", value: 1 }))
        : parts
    return (
        <div
            data-tier="composite"
            data-component="ProportionBar"
            data-contract="GAP-1 STATE-8"
            className="starci-core-proportion-bar"
            {...(isLoading ? { "data-loading": "true", ...(ownsBusy ? {} : { "aria-busy": true }) } : {})}
        >
            <div className="starci-core-proportion-track" aria-hidden="true">
                {shown.map((part, index) => {
                    const share = isLoading ? 100 / shown.length : (Math.max(0, part.value) / sum) * 100
                    const style: SegmentStyle = { "--starci-core-proportion-share": `${share}%` }
                    return share === 0 ? null : (
                        <span
                            key={part.id}
                            className="starci-core-proportion-segment"
                            style={style}
                            data-grammar-tone={part.tone ?? SEQUENCE[index % SEQUENCE.length]}
                            data-grammar-skeleton={isLoading ? "true" : undefined}
                        />
                    )
                })}
            </div>
            <ul className="starci-core-proportion-legend" aria-label={label}>
                {shown.map((part, index) => (
                    <li key={part.id} className="starci-core-proportion-item">
                        <span className="starci-core-proportion-dot" aria-hidden="true" data-grammar-tone={part.tone ?? SEQUENCE[index % SEQUENCE.length]} />
                        <span className="starci-core-proportion-label">{isLoading ? <Skeleton shape="text" /> : part.label}</span>
                        <span className="starci-core-proportion-value">{isLoading ? null : part.valueLabel ?? String(part.value)}</span>
                    </li>
                ))}
            </ul>
        </div>
    )
}
