import { cn } from "@heroui/react"
import type { ReactNode } from "react"

export type FreestyleProps = {
    /** The app's own elements. Grammar components used inside keep their Grammar paint and contract. */
    readonly children?: ReactNode
    /** The app's own CSS class for this region. */
    readonly className?: string
    /**
     * Why no Grammar component fits, in a few words (for example "sign-in brand art"). Required: Freestyle is a last
     * resort, and the reason is stamped on the DOM as `data-grammar-freestyle-reason`.
     */
    readonly reason: string
}

/**
 * The sanctioned escape hatch (owner ruling grammar-freestyle-region): a region that fills its host where the app writes its
 * own plain elements and app CSS (layout, paint, radius, arbitrary values, absolutely positioned art) because no Grammar
 * component fits. The rest of the page still follows the Grammar. It adds no paint of its own and is a last resort.
 */
export const Freestyle = ({ children, className, reason }: FreestyleProps) => (
    <div
        className={cn("starci-core-freestyle", className)}
        data-component="Freestyle"
        data-tier="composite"
        data-grammar-freestyle="true"
        data-grammar-freestyle-reason={reason}
    >
        {children}
    </div>
)
