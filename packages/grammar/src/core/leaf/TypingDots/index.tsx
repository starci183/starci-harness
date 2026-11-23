import type { NoChildren } from "../../tier.js"

export type TypingDotsProps = NoChildren & {
    /** Who is writing, in the app's language ("Mạng xã hội đang soạn tin"). Announced through `role="status"`; the dots are silent. */
    readonly label: string
}

/**
 * LEAF - `TypingDots`: someone is writing a reply. Three dots in the current text colour that rise and fade in turn (one cycle of `--grammar-loop-typing`, each dot
 * `--grammar-typing-stagger` after the one before, `--grammar-typing-travel` high). It is the body of the writer's bubble while the reply is on its way, so the reply
 * takes the same place when it comes. Under `prefers-reduced-motion: reduce` the dots do not move; they only pulse in opacity.
 * Contract: MOTION-1 MOTION-2 (a loop with its own cycle, reduced motion keeps it perceivable), A11Y-2 (the dots are decorative; the label is the status).
 */
export const TypingDots = ({ label }: TypingDotsProps) => (
    <span className="starci-core-typing-dots" data-component="TypingDots" data-tier="leaf" data-contract="MOTION-1 MOTION-2 A11Y-2" role="status" aria-label={label}>
        <span aria-hidden="true" className="starci-core-typing-dot" />
        <span aria-hidden="true" className="starci-core-typing-dot" />
        <span aria-hidden="true" className="starci-core-typing-dot" />
    </span>
)
