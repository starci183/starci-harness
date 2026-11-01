import type { ReactNode } from "react"
import { Skeleton } from "../../leaf/Skeleton/index.js"

export type QuoteProps = {
    /** The quoted words. Plain text keeps its line breaks. Ignored (and optional) while `isSkeleton`. */
    readonly children?: ReactNode
    /** A short word naming where the words come from, e.g. "Brain", "Chat", "Template". Drawn above the words. */
    readonly source?: string
    /** Where and when the words were said, muted under them, e.g. "Zalo, 09:41". */
    readonly byline?: string
    /**
     * Draw the quote as inert geometry while it is unresolved (knowledge STATE-8): the tinted ground with two Skeleton text
     * lines and no source or byline. The quote is `aria-hidden`; the region that loads it owns `aria-busy`.
     */
    readonly isSkeleton?: boolean
}

/**
 * COMPOSITE - `Quote`: words taken from a source, as a `<blockquote>` on a tinted ground at the nested inset, one radius below
 * the surface that hosts it. It is not a surface: no shadow, no outline and no action, so it stands in a pane, a card or a
 * drawer without nesting a surface in a surface. Use it to show what was said or stored, never an outcome (that is `Alert`).
 * Contract: INSET-NESTED by `--grammar-inset-nested`, STATE-8 by `isSkeleton`.
 */
export const Quote = ({ children, source, byline, isSkeleton = false }: QuoteProps) => {
    if (isSkeleton) {
        return (
            <blockquote
                aria-hidden="true"
                className="starci-core-quote"
                data-component="Quote"
                data-contract="INSET-NESTED STATE-8"
                data-grammar-skeleton="true"
                data-tier="composite"
            >
                <Skeleton shape="text" lines={2} />
            </blockquote>
        )
    }
    return (
        <blockquote
            className="starci-core-quote"
            data-component="Quote"
            data-contract="INSET-NESTED STATE-8"
            data-tier="composite"
        >
            {source == null ? null : <span className="starci-core-quote-source">{source}</span>}
            <span className="starci-core-quote-words">{children}</span>
            {byline == null ? null : <span className="starci-core-quote-byline">{byline}</span>}
        </blockquote>
    )
}
