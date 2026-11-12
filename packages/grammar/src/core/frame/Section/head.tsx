import { createElement, type ReactNode } from "react"
import { SkeletonPlaceholder } from "../../leaf/Skeleton/index.js"

/** The outline rank of a section title: a section sits under the page's `h1`, so the first rank it takes is `2`. */
export type SectionHeadingLevel = 2 | 3 | 4 | 5 | 6

/**
 * The head every `Section` draws (0.36.0): ONE row. At the start the label (14, weight 500) and an optional count chip (12); at the end at most ONE
 * thing: a navigation `Link variant="head"` (label then an arrow that slides on hover), an info `IconButton`, or a neutral small text `Button` (0.37.25). There is no description under the
 * label: `description` is drawn as a caption below the section's body.
 */
export type SectionHeadProps = {
    /** The section's name. It is the heading of the region, and the region's accessible name. */
    readonly title: string
    /**
     * One muted 12 line BELOW the section's body (0.36.0; before it stood under the label): what the card or list shows, its source or its period.
     * The head is one row and holds no description. `caption` is the same line; a section that sets both draws both, the description first.
     */
    readonly description?: string
    /**
     * How many items the section holds, drawn after the title as a count chip (12, muted, on the default tone), e.g. "Installations" then a chip (a 0 is drawn as a grey "0" chip, 0.37.8: only PAGE tabs hide 0)
     * "2". It is part of the heading's accessible name.
     */
    readonly count?: number
    /** The count is work waiting for the owner (to handle, to approve, an error): the chip is pink (the accent soft pair). Default grey. */
    readonly isAttention?: boolean
    /**
     * One short fact on the title line, right after it, drawn as the same 12px grey chip as `count` (0.36.2; it was "Label \u00b7 fact" text, which is banned);
     * part of the heading's accessible name and, like `count`, not drawn while the section loads. Use `count` for a number.
     */
    readonly fact?: string
    /** Where and when the section's facts come from (a source time, "Inventoried at 10:00"). Muted, at the end of the head row, before `action`. */
    readonly meta?: string
    /**
     * The head's one end-of-row thing: a navigation `Link variant="head"` ("Open the board" then the arrow), an info `IconButton`, or a text
     * `<Button intent="neutral" size="sm">` ("Add provider", 0.37.25; no icon, never the commit). Any other Button and more than one element are errors (lint
     * `section-head-action`). It hugs its label at the end of the head row, on the label's line.
     */
    readonly action?: ReactNode
    /** Outline rank of the title. Default `2`; pick the rank that follows the heading above it. */
    readonly headingLevel?: SectionHeadingLevel
    /** The in-page anchor a link targets. */
    readonly id?: string
}

type HeadDrawing = {
    readonly title: string
    readonly count: number | undefined
    readonly isAttention: boolean | undefined
    readonly fact: string | undefined
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
export const SectionHead = ({ title, count, isAttention, fact, meta, action, isLoading, headingId, level }: HeadDrawing) => {
    const countPart = count === undefined || isLoading ? null : (
        <span key="count" className="starci-core-section-count" data-grammar-section-count={count} {...(isAttention === true ? { "data-grammar-attention": "true" } : {})} data-contract="TONE-2">{count}</span>
    )
    const factPart = fact === undefined || isLoading ? null : (
        <span key="fact" className="starci-core-section-count" data-grammar-section-count={fact} data-grammar-section-fact="true" data-contract="TONE-2">{fact}</span>
    )
    return (
        <div className="starci-core-section-header" data-contract="GAP-2" data-grammar-section-header="true">
            <div className="starci-core-section-header-copy" data-contract="GAP-1">
                {createElement(
                    `h${level}`,
                    { className: "starci-core-section-title", id: headingId, "data-contract": "MARGIN-0 FLOW-3" },
                    <span key="text" className="starci-core-section-title-text">{title}</span>,
                    countPart,
                    factPart,
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

/** The caption under a section's body (0.36.0): `description` and `caption`, muted 12 lines, a row step below the card or list. */
export const SectionCaption = ({ lines, isLoading }: { readonly lines: ReadonlyArray<string | undefined>; readonly isLoading: boolean }) => (
    <>
        {lines.map((line, index) => line === undefined ? null : (
            <p key={index} className="starci-core-section-caption" data-contract="TONE-2 FONT-2" {...hidden(isLoading)}>
                {isLoading ? <SkeletonPlaceholder>{line}</SkeletonPlaceholder> : line}
            </p>
        ))}
    </>
)
