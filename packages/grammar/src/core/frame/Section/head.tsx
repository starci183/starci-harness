import { createElement, type ReactNode } from "react"
import { SkeletonPlaceholder } from "../../leaf/Skeleton/index.js"

/** The outline rank of a section title: a section sits under the page's `h1`, so the first rank it takes is `2`. */
export type SectionHeadingLevel = 2 | 3 | 4 | 5 | 6

/** The head every `Section` draws: its title, and the facts and the one command that belong to it. */
export type SectionHeadProps = {
    /** The section's name. It is the heading of the region, and the region's accessible name. */
    readonly title: string
    /** One supporting line under the title. */
    readonly description?: string
    /**
     * How many items the section holds, drawn after the title as a muted "(n)" in the title's own line
     * (e.g. "Installations (2)"). It is part of the heading's accessible name.
     */
    readonly count?: number
    /** Where and when the section's facts come from (a source time, "Inventoried at 10:00"). Muted, at the end of the head row, before `action`. */
    readonly meta?: string
    /** The section's one page command. It hugs its label at the end of the head row. */
    readonly action?: ReactNode
    /** Outline rank of the title. Default `2`; pick the rank that follows the heading above it. */
    readonly headingLevel?: SectionHeadingLevel
    /** The in-page anchor a link targets. */
    readonly id?: string
}

type HeadDrawing = {
    readonly title: string
    readonly description: string | undefined
    readonly count: number | undefined
    readonly meta: string | undefined
    readonly action: ReactNode
    readonly isLoading: boolean
    readonly headingId: string
    readonly level: SectionHeadingLevel
}

const hidden = (isLoading: boolean) => (isLoading ? { "aria-hidden": true } as const : {})

/**
 * The head of a section: a plain `div`, never `<header>` (outside a sectioning element a `<header>` is the page banner,
 * and the banner belongs to the application bar). The row is inline, the title and its line are identity.
 */
export const SectionHead = ({ title, description, count, meta, action, isLoading, headingId, level }: HeadDrawing) => {
    const countPart = count === undefined || isLoading ? null : (
        <span key="count" className="starci-core-section-count" data-grammar-section-count={count} data-contract="TONE-2">{` (${count})`}</span>
    )
    return (
        <div className="starci-core-section-header" data-contract="GAP-2" data-grammar-section-header="true">
            <div className="starci-core-section-header-copy" data-contract="GAP-1">
                {createElement(
                    `h${level}`,
                    { className: "starci-core-section-title", id: headingId, "data-contract": "MARGIN-0 FLOW-3" },
                    title,
                    countPart,
                )}
                {description === undefined ? null : (
                    <div className="starci-core-section-description" {...hidden(isLoading)}>
                        {isLoading ? <SkeletonPlaceholder>{description}</SkeletonPlaceholder> : description}
                    </div>
                )}
            </div>
            {meta === undefined ? null : (
                <div className="starci-core-section-meta" data-contract="FONT-1 TONE-2" {...hidden(isLoading)}>
                    {isLoading ? <SkeletonPlaceholder>{meta}</SkeletonPlaceholder> : meta}
                </div>
            )}
            {action === undefined ? null : (
                <div className="starci-core-section-action" {...hidden(isLoading)}>
                    {isLoading ? <SkeletonPlaceholder shape="block">{action}</SkeletonPlaceholder> : action}
                </div>
            )}
        </div>
    )
}
