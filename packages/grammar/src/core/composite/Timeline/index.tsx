"use client"

import type { ReactNode } from "react"
import { assertPresentationState, type PresentationState } from "../../../common/state.js"
import { Skeleton } from "../../leaf/Skeleton/index.js"
import { ErrorView, LOADING_ROWS, useIsLoading, type ErrorData } from "../../loadingState.js"
import type { NoChildren } from "../../tier.js"

export type TimelineItem = {
    readonly id: string
    readonly title: ReactNode
    /** A machine-readable instant for `<time dateTime>`; `timeLabel` is what the reader sees. */
    readonly dateTime?: string
    readonly timeLabel?: ReactNode
    readonly description?: ReactNode
    readonly state?: PresentationState
    /** The entry the reader is at now (`aria-current="step"`). */
    readonly isCurrent?: boolean
    /**
     * The entry needs the reader (a failed step, a pending approval): the whole row takes a tone background, not just
     * the marker. The tone follows `state` (negative danger, affirmative success, informative accent, otherwise warning).
     */
    readonly isAttention?: boolean
    /** App-owned marker glyph; defaults to a dot. */
    readonly marker?: ReactNode
}

export type TimelineProps = NoChildren & {
    /** Names the list, e.g. "Order history". */
    readonly label: string
    readonly items: ReadonlyArray<TimelineItem>
    /**
     * The first read has no data yet (knowledge STATE-8). The list draws one skeleton entry per item it was given (a static marker,
     * a title line, and a time and a description line where that item has them), or a default few when it has none, in the same
     * named list, which is `aria-busy`. A refresh that has data is not loading. Loading comes first, then `error`.
     */
    readonly isLoading?: boolean
    /** The read failed: this takes the place of the entries. */
    readonly error?: ErrorData
}

const DEFAULT_ENTRIES: ReadonlyArray<TimelineItem> = Array.from({ length: LOADING_ROWS }, (_, index) => ({ id: String(index), title: " ", timeLabel: " ", description: " " }))

/**
 * An ordered history of events. Each entry exposes `data-grammar-timeline-state` from the Common
 * presentation states and `data-grammar-current`; the connector line is drawn by the stylesheet.
 * Contract: list HIERARCHY-3, entry STATE-1 TRUTH-1 (closed presentation states, neutral default), marker A11Y-2.
 */
export const Timeline = ({ label, items, isLoading: ownLoading, error }: TimelineProps) => {
    const isLoading = useIsLoading(ownLoading)
    if (!isLoading && error !== undefined) {
        return <div aria-label={label} role="group" className="starci-core-timeline" data-component="Timeline" data-contract="HIERARCHY-3" data-tier="composite" data-grammar-timeline-error="true"><ErrorView error={error} /></div>
    }
    return (
    <ol
        aria-label={label}
        data-loading={String(isLoading)}
        {...(isLoading ? { "aria-busy": true } : {})}
        className="starci-core-timeline"
        data-component="Timeline"
        data-contract="HIERARCHY-3"
        data-tier="composite"
    >
        {isLoading ? (items.length > 0 ? items : DEFAULT_ENTRIES).map((entry) => (
            <li key={entry.id} aria-hidden="true" className="starci-core-timeline-item" data-contract="STATE-1 STATE-8" data-grammar-timeline-state="neutral" data-grammar-current="false" data-grammar-skeleton="true">
                <span aria-hidden="true" className="starci-core-timeline-marker starci-core-timeline-skeleton-marker" data-grammar-timeline-marker="true"><Skeleton shape="circle" size="sm" /></span>
                <div className="starci-core-timeline-copy">
                    <div className="starci-core-timeline-title"><Skeleton shape="text" /></div>
                    {entry.timeLabel === undefined ? null : <span className="starci-core-timeline-time"><Skeleton shape="text" /></span>}
                    {entry.description === undefined ? null : <div className="starci-core-timeline-description"><Skeleton shape="text" /></div>}
                </div>
            </li>
        )) : items.map((item) => {
            const state = item.state ?? "neutral"
            assertPresentationState(state)
            return (
                <li
                    key={item.id}
                    aria-current={item.isCurrent ? "step" : undefined}
                    className="starci-core-timeline-item"
                    data-contract="STATE-1 TRUTH-1"
                    data-grammar-timeline-state={state}
                    data-grammar-current={item.isCurrent ? "true" : "false"}
                    data-grammar-attention={item.isAttention ? "true" : undefined}
                >
                    <span aria-hidden="true" className="starci-core-timeline-marker" data-contract="A11Y-2" data-grammar-timeline-marker="true">{item.marker}</span>
                    <div className="starci-core-timeline-copy">
                        <p className="starci-core-timeline-title">{item.title}</p>
                        {item.timeLabel === undefined ? null : (
                            <time className="starci-core-timeline-time" {...(item.dateTime === undefined ? {} : { dateTime: item.dateTime })}>{item.timeLabel}</time>
                        )}
                        {item.description === undefined ? null : <div className="starci-core-timeline-description">{item.description}</div>}
                    </div>
                </li>
            )
        })}
    </ol>
    )
}
