import type { ReactNode } from "react"

export type MarqueeProps = {
    /** The items of the strip in reading order (logos, names, short facts): give it enough to fill the width once, because the strip repeats them to loop. */
    readonly children: ReactNode
    /** Names the strip for assistive technology, e.g. "Trusted by". Required: the strip is a group, and a group is named. */
    readonly label: string
}

/**
 * An endless horizontal strip (0.47.3): the items drift toward the start and loop with no seam, pausing while the pointer rests on the strip or focus is inside it.
 * The content is drawn twice so the loop closes; the second run is `aria-hidden` and `inert`, so assistive technology and the keyboard meet each item once.
 * Under reduced motion nothing drifts and nothing is drawn twice: the one run wraps onto as many lines as it needs.
 */
export const Marquee = ({ children, label }: MarqueeProps) => (
    <div
        data-tier="frame"
        data-component="Marquee"
        data-contract="MOTION-1 MOTION-2 MOTION-3"
        className="starci-core-marquee"
        role="group"
        aria-label={label}
    >
        <div className="starci-core-marquee-track">
            <div className="starci-core-marquee-run" data-grammar-marquee-run="source">{children}</div>
            <div className="starci-core-marquee-run" data-grammar-marquee-run="copy" aria-hidden="true" inert>{children}</div>
        </div>
    </div>
)
