import { createElement, type ComponentPropsWithoutRef, type JSX, type ReactElement } from "react"

/** An intrinsic element a Custom region can render as. */
export type CustomTag = keyof JSX.IntrinsicElements

export type CustomProps<Tag extends CustomTag = "div"> = Omit<ComponentPropsWithoutRef<Tag>, "as" | "reason"> & {
    /** The element the region renders. A `div` by default. */
    readonly as?: Tag
    /**
     * Why no Grammar component fits, in a few words (for example "workflow graph editor"). Required: Custom is a last resort,
     * and the reason is the audit trail, stamped on the DOM as `data-grammar-custom-reason`.
     */
    readonly reason: string
}

/**
 * The sanctioned escape hatch: a region where anything goes. Inside it the app writes any markup and any class name and
 * uses any library (a graph editor, an animation library, a chart toolkit), because no Grammar component fits. The Grammar
 * lint rules report nothing inside it, the rest of the page still follows the Grammar, and every use is listed by the
 * Custom inventory (`starci-custom-inventory`). It adds no paint, inset or radius of its own and is a last resort.
 */
export const Custom = <Tag extends CustomTag = "div">({ as, reason, ...rest }: CustomProps<Tag>): ReactElement =>
    createElement(as ?? "div", {
        ...rest,
        "data-component": "Custom",
        "data-tier": "frame",
        "data-grammar-custom": "true",
        "data-grammar-custom-reason": reason,
    })
