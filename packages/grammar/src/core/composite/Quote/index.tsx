"use client"

import { withRegionLoading } from "../../regionScope.js"
import type { NoChildren } from "../../tier.js"
import { Skeleton } from "../../leaf/Skeleton/index.js"

export type QuoteProps = NoChildren & {
    /** The quoted words. Plain text keeps its line breaks. Ignored (and optional) while `isLoading`. */
    readonly text?: string
    /** A short word naming where the words come from, e.g. "Brain", "Chat", "Template". Drawn above the words. */
    readonly source?: string
    /** Where and when the words were said, muted under them, e.g. "Chat, 09:41". Not drawn by `variant="line"`. */
    readonly byline?: string
    /**
     * `block` (default): the source above the words on the tinted ground. `line`: ONE muted line with a rule on its start edge and no ground, the source then the
     * words, cut with an ellipsis: the quote over an answer in a chat thread ("Trả lời Lan: “chào em”"), where a block would outweigh the answer under it.
     */
    readonly variant?: "block" | "line"
    /**
     * Draw the quote as inert geometry while it is unresolved (knowledge STATE-8): the tinted ground with two Skeleton text
     * lines and no source or byline. The quote is `aria-hidden`; the region that loads it owns `aria-busy`.
     */
    readonly isLoading?: boolean
}

/**
 * COMPOSITE - `Quote`: words taken from a source, as a `<blockquote>` on a tinted ground at the nested inset, one radius below
 * the surface that hosts it. It is not a surface: no shadow, no outline and no action, so it stands in a pane, a card or a
 * drawer without nesting a surface in a surface. Use it to show what was said or stored, never an outcome (that is `Alert`).
 * Contract: INSET-NESTED by `--grammar-inset-nested`, STATE-8 by `isLoading`.
 */
const QuoteInner = ({ text, source, byline, variant = "block", isLoading = false }: QuoteProps) => {
    if (isLoading) {
        return (
            <blockquote
                aria-hidden="true"
                className="starci-core-quote"
                data-component="Quote"
                data-contract="INSET-NESTED STATE-8"
                data-grammar-skeleton="true"
                data-grammar-quote-variant={variant}
                data-tier="composite"
            >
                <Skeleton shape="text" lines={variant === "line" ? 1 : 2} />
            </blockquote>
        )
    }
    return (
        <blockquote
            className="starci-core-quote"
            data-component="Quote"
            data-contract="INSET-NESTED STATE-8"
            data-grammar-quote-variant={variant}
            data-tier="composite"
            {...(variant === "line" && text !== undefined ? { title: source == null ? text : `${source} ${text}` } : {})}
        >
            {source == null ? null : <span className="starci-core-quote-source">{source}</span>}
            <span className="starci-core-quote-words">{text}</span>
            {byline == null || variant === "line" ? null : <span className="starci-core-quote-byline">{byline}</span>}
        </blockquote>
    )
}

/**
 * COMPOSITE - `Quote`: words taken from a source, as a `<blockquote>` on a tinted ground at the nested inset, one radius below
 * the surface that hosts it. It is not a surface: no shadow, no outline and no action, so it stands in a pane, a card or a
 * drawer without nesting a surface in a surface. Use it to show what was said or stored, never an outcome (that is `Alert`).
 * Contract: INSET-NESTED by `--grammar-inset-nested`, STATE-8 by `isLoading`.
 */
export const Quote = withRegionLoading(QuoteInner)
