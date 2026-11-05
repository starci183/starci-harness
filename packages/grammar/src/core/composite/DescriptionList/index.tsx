"use client"

import { useRegionOwnsBusy, withRegionLoading } from "../../regionScope.js"
import type { ReactNode } from "react"
import { SkeletonPlaceholder } from "../../leaf/Skeleton/index.js"
import type { NoChildren } from "../../tier.js"

export type DescriptionListItem = {
    readonly id: string
    readonly term: ReactNode
    readonly description: ReactNode
}

export type DescriptionListLayout = "columns" | "stacked"

export type DescriptionListProps = NoChildren & {
    /**
     * `columns` pairs each term with its value on one row and falls back to `stacked` below 16rem of the list's own width (a phone-wide drawer keeps the pairs side by side);
     * `stacked` always puts the value under its term.
     */
    readonly layout?: DescriptionListLayout
    readonly items: ReadonlyArray<DescriptionListItem>
    /** Draw a separator between pairs. Default: yes, and no in the compact density. */
    readonly isDivided?: boolean
    /**
     * `compact`: the detail of an item in a side pane or a card (a 9rem term column, 13px rows about 28px tall, no separators);
     * `default`: a settings or summary list with room around each pair.
     */
    readonly density?: "default" | "compact"
    /**
     * Unresolved values (knowledge STATE-8): every `term` stays real text; each `description` is laid out unseen under a
     * shimmer bar, so every pair keeps its ready size (skeleton parity). The list is `aria-busy`.
     */
    readonly isLoading?: boolean
}

/**
 * Term/value pairs (details, metadata, settings summaries) as a real `<dl>`. Key figures are not pairs: a strip of
 * them is `SurfaceCard kind="figures"`, which owns the cells, the lines between them and the figure scale.
 * Contract: HIERARCHY-3 (term precedes value in source and paint), TRUTH-1 (no tone carrier on facts).
 */
const DescriptionListInner = (props: DescriptionListProps) => {
    const { density = "default", isLoading = false, layout = "columns" } = props
    const ownsBusy = useRegionOwnsBusy()
    const isDivided = props.isDivided ?? density === "default"
    // Skeleton parity: a loading value is laid out unseen under the shimmer, so the pair keeps the ready value's box.
    const pending = (value: ReactNode) => <SkeletonPlaceholder>{value}</SkeletonPlaceholder>
    return (
        <dl
            className="starci-core-description-list"
            data-component="DescriptionList"
            data-contract="HIERARCHY-3 TRUTH-1"
            data-tier="composite"
            {...(isLoading ? { "data-loading": "true", ...(ownsBusy ? {} : { "aria-busy": true }) } : {})}
            data-grammar-description-layout={layout}
            data-grammar-description-divided={isDivided ? "true" : "false"}
            data-grammar-description-density={density}
        >
            {props.items.map((item) => (
                <div key={item.id} className="starci-core-description-pair" data-grammar-description-pair="true">
                    <dt className="starci-core-description-term">{item.term}</dt>
                    <dd className="starci-core-description-value">{isLoading ? pending(item.description) : item.description}</dd>
                </div>
            ))}
        </dl>
    )
}

/**
 * Term/value pairs (details, metadata, settings summaries) as a real `<dl>`. Key figures are not pairs: a strip of
 * them is `SurfaceCard kind="figures"`, which owns the cells, the lines between them and the figure scale.
 * Contract: HIERARCHY-3 (term precedes value in source and paint), TRUTH-1 (no tone carrier on facts).
 */
export const DescriptionList = withRegionLoading(DescriptionListInner)
