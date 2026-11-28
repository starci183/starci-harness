"use client"

import { Tooltip as HeroTooltip } from "@heroui/react"
import { useState } from "react"
import { useOverlayContainer } from "../../overlayScope.js"
import { tooltipContentClassName } from "../../tooltipClassName.js"

export type GlossaryTermProps = {
    /** The term as it stands in the sentence. */
    readonly children: string
    /** Its one-line definition, already in the reader's language. */
    readonly definition: string
}

/** How long the pointer rests on the term before its definition shows (owner 2026-11-28: one short beat, then a fade). */
const OPEN_DELAY_MS = 250

/**
 * LEAF - `GlossaryTerm`: a term in running text that carries its one-line definition (owner 2026-11-23, a lesson's vocabulary). The
 * term keeps the words around it (size, weight, colour) with a dotted underline. Its definition is HeroUI's Tooltip (owner 2026-11-28:
 * "hover phải là tooltip của heroui"): a small bubble above the term with an arrow pointing at it, shown after a short rest of the
 * pointer, on keyboard focus and on a tap (a phone has no hover; a tap again, Escape or leaving closes it). The bubble is a portal
 * overlay, so it never covers the line below or pushes the text. The trigger is an inline span with the button role, so the term
 * stays in the sentence; React Aria ties the bubble to it as its description.
 * Contract: A11Y-2 (named by its words, described by the definition), FOCUS-1.
 */
export const GlossaryTerm = ({ children, definition }: GlossaryTermProps) => {
    const { anchor, container } = useOverlayContainer("Tooltip")
    const [isOpen, setOpen] = useState(false)
    return (
        <HeroTooltip delay={OPEN_DELAY_MS} isOpen={isOpen} onOpenChange={setOpen}>
            <HeroTooltip.Trigger<"span">
                render={(props) => <span {...props} />}
                className="starci-core-glossary-term-word"
                data-component="GlossaryTerm"
                data-tier="leaf"
                data-contract="A11Y-2 FOCUS-1"
                data-grammar-term-open={isOpen ? "true" : "false"}
                // A tap opens the bubble a touch screen cannot hover; a second tap closes it.
                onClick={() => setOpen((open) => !open)}
            >
                {children}
            </HeroTooltip.Trigger>
            {anchor}
            {container === null ? null : (
                <HeroTooltip.Content
                    UNSTABLE_portalContainer={container}
                    placement="top"
                    showArrow
                    className={tooltipContentClassName}
                    data-grammar-tooltip-content="true"
                    data-grammar-glossary-definition="true"
                >
                    <HeroTooltip.Arrow />
                    {definition}
                </HeroTooltip.Content>
            )}
        </HeroTooltip>
    )
}
