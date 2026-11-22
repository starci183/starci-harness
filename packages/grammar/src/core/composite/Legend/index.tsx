"use client"

import { Skeleton } from "../../leaf/Skeleton/index.js"
import { useIsLoading, useRegionOwnsBusy } from "../../regionScope.js"
import type { NoChildren } from "../../tier.js"

/** The tone of one key: the same five the entries it explains take (`ScheduleGrid` items, `IntervalChart` rows). */
export type LegendTone = "neutral" | "accent" | "info" | "success" | "warning" | "danger"

/** One key: the mark of a tone and the words it stands for. */
export type LegendItem = {
    /** One per key. */
    readonly id: string
    /** What the tone means, in words: the meaning is carried by this text, never by the colour. */
    readonly label: string
    readonly tone: LegendTone
    /** The shape of the entry the mark explains: a bar (default) or a milestone, drawn as a diamond. */
    readonly form?: "bar" | "milestone"
}

export type LegendProps = NoChildren & {
    /** Names the key for assistive technology, e.g. "Status colours". */
    readonly label: string
    readonly items: readonly LegendItem[]
    /** The keys are not known yet: the labels given stay, the marks shimmer (three placeholders when none). */
    readonly isLoading?: boolean
}

const PLACEHOLDERS = 3

/**
 * A one-line key that maps each tone to its words: a small mark then the label, in a row that wraps onto the next line when the
 * container is narrow (a phone). A list for assistive technology, each item reading its label. It draws nothing when it holds no
 * key. It explains a tone; it never filters or toggles, so it takes no press.
 */
export const Legend = ({ label, items, isLoading: ownLoading }: LegendProps) => {
    const isLoading = useIsLoading(ownLoading)
    const ownsBusy = useRegionOwnsBusy()
    const synthetic = isLoading && items.length === 0
    if (!isLoading && items.length === 0) return null
    const shown: readonly LegendItem[] = synthetic ? Array.from({ length: PLACEHOLDERS }, (_, index) => ({ id: `loading-${index}`, label: "", tone: "neutral" as const })) : items
    return (
        <ul
            data-tier="composite"
            data-component="Legend"
            data-contract="STATE-8"
            className="starci-core-legend"
            aria-label={label}
            {...(isLoading ? { "data-loading": "true", ...(ownsBusy ? {} : { "aria-busy": true }) } : {})}
        >
            {shown.map((item) => (
                <li key={item.id} className="starci-core-legend-item">
                    <span
                        className="starci-core-legend-mark"
                        aria-hidden="true"
                        data-grammar-form={item.form ?? "bar"}
                        {...(isLoading ? { "data-grammar-skeleton": "true" } : { "data-grammar-tone": item.tone })}
                    />
                    <span className="starci-core-legend-label">{synthetic ? <Skeleton shape="text" /> : item.label}</span>
                </li>
            ))}
        </ul>
    )
}
