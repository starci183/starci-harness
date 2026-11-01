"use client"

import type { Figure } from "../../surfaceCardData.js"
import { IconTile } from "../../leaf/IconTile/index.js"
import { SkeletonPlaceholder } from "../../leaf/Skeleton/index.js"

/**
 * The strip a `kind="figures"` holds: two to four key figures as touching cells, divided by lines, never on the
 * outer edge. It answers its own width, not the viewport's: one row from 40rem, 2 x 2 from 18rem, one column below.
 * A real `<dl>`: the term, then the figure and its unit, then its meta as a second `<dd>` of the same term.
 */
export const FigureCells = ({ items, isLoading }: { readonly items: readonly Figure[]; readonly isLoading: boolean }) => {
    const pending = (value: string | number) => <SkeletonPlaceholder>{value}</SkeletonPlaceholder>
    return (
        <dl
            className="starci-core-description-list"
            data-contract="HIERARCHY-3 TRUTH-1"
            data-grammar-description-layout="stat-strip"
            data-grammar-description-divided="true"
            {...(isLoading ? { "aria-busy": true, "data-loading": "true" } : {})}
        >
            {items.map((item) => (
                <div key={item.id} className="starci-core-description-pair" data-grammar-description-pair="true">
                    <dt className="starci-core-description-term starci-core-description-stat-term">
                        {item.icon === undefined ? null : <IconTile source={item.icon} size="sm" tone="neutral" />}
                        <span>{item.term}</span>
                    </dt>
                    <dd className="starci-core-description-value starci-core-description-figure" data-contract="FONT-5">
                        <span className="starci-core-description-figure-value">{isLoading ? pending(item.value) : item.value}</span>
                        {item.unit === undefined ? null : <span className="starci-core-description-unit">{item.unit}</span>}
                    </dd>
                    {item.meta === undefined ? null : (
                        <dd className="starci-core-description-meta" data-contract="FONT-2">{isLoading ? pending(item.meta) : item.meta}</dd>
                    )}
                </div>
            ))}
        </dl>
    )
}
