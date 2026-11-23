"use client"

import { useId, useState, type KeyboardEvent } from "react"

export type GlossaryTermProps = {
    /** The term as it stands in the sentence. */
    readonly children: string
    /** Its one-line definition, already in the reader's language. */
    readonly definition: string
}

/**
 * LEAF - `GlossaryTerm`: a term in running text that carries its one-line definition (owner 2026-11-23, a lesson's vocabulary). The
 * term keeps the words around it (size, weight, colour) with a dotted underline; the definition shows in a small bubble under it on
 * hover, on keyboard focus and on a tap (a tap again, Escape or leaving closes it). It is a real button, and the definition is its
 * description (`aria-describedby`), so a screen reader hears it with the term whether or not the bubble is open.
 * Contract: A11Y-2 (named by its words, described by the definition), FOCUS-1.
 */
export const GlossaryTerm = ({ children, definition }: GlossaryTermProps) => {
    const id = useId()
    const [isPinned, setPinned] = useState(false)
    const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => { if (event.key === "Escape") setPinned(false) }
    return (
        <span className="starci-core-glossary-term" data-component="GlossaryTerm" data-tier="leaf" data-contract="A11Y-2 FOCUS-1" data-grammar-term-open={isPinned ? "true" : "false"}>
            <button
                type="button"
                className="starci-core-glossary-term-word"
                aria-describedby={id}
                aria-expanded={isPinned}
                onClick={() => setPinned((open) => !open)}
                onBlur={() => setPinned(false)}
                onKeyDown={onKeyDown}
            >
                {children}
            </button>
            <span id={id} role="tooltip" className="starci-core-glossary-term-definition">{definition}</span>
        </span>
    )
}
