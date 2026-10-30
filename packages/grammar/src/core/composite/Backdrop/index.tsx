import { cn } from "@heroui/react"
import type { ReactNode } from "react"
import type { AccentCorner } from "../../branch/SurfaceCard/classNames.js"

export type BackdropProps = {
    /** The brand copy over the ground: the logo, the heading and the tagline. */
    readonly children?: ReactNode
    /**
     * Decorative art under the copy, usually a `Mascot` at `size="hero"`, which fills the height the copy leaves. The slot
     * is `aria-hidden` and inert to the pointer.
     */
    readonly artwork?: ReactNode
    /** One logical corner at the Common accent radius (`--grammar-accent-corner`); the others stay square. */
    readonly accentCorner?: AccentCorner
    readonly className?: string
}

/**
 * The brand backdrop: a full-bleed ground in the brand's light tint (the family's `accentSoft`) that fills its host, such
 * as the brand half of a sign-in split, with the brand copy at the top and the artwork filling the rest. It is a
 * ground, not a card: no border, no shadow, no card inset (owner ruling backdrop).
 */
export const Backdrop = ({ children, artwork, accentCorner, className }: BackdropProps) => (
    <div
        className={cn("starci-core-backdrop", className)}
        data-component="Backdrop"
        data-tier="composite"
        data-grammar-accent-corner={accentCorner}
        data-grammar-backdrop-artwork={artwork === undefined ? "none" : "art"}
    >
        {children === undefined ? null : <div className="starci-core-backdrop-content" data-contract="FLOW-3">{children}</div>}
        {artwork === undefined ? null : <div aria-hidden="true" className="starci-core-backdrop-artwork">{artwork}</div>}
    </div>
)
