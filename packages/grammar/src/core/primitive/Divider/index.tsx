import { Separator } from "@heroui/react"
import { Text } from "../Text/index.js"

/**
 * How an unlabelled hairline is exposed. `separator` is a thematic break a screen reader announces
 * (`role="separator"`, horizontal); `presentation` is a purely visual seam between faces whose own
 * headings already structure the content, so it is hidden from the accessibility tree.
 */
export type DividerSemantics = "separator" | "presentation"

/** The direction of an unlabelled hairline. */
export type DividerOrientation = "horizontal" | "vertical"

type LabelledDivider = {
    /** Visible, localized word naming the alternative boundary. */
    readonly label: string
    readonly semantics?: undefined
}

type UnlabelledDivider = {
    readonly label?: undefined
    /** Default `separator`. */
    readonly semantics?: DividerSemantics
    /**
     * The hairline's direction (HeroUI `Separator orientation`). `horizontal` (default) divides stacked bands; `vertical` divides
     * touching columns of one joined surface (a messenger's list, thread and info panel) and fills the row's height.
     */
    readonly orientation?: DividerOrientation
}

export type DividerProps = LabelledDivider | UnlabelledDivider

/**
 * A labelled alternative boundary ("or") with intrinsic separator semantics, or - without a label - the
 * one-pixel hairline between touching bands (GAP-0 case-1: joined faces of one surface, stacked bands).
 * The unlabelled rule is BOUNDARY-1: a hairline on `--separator`, full width of its container.
 */
export const Divider = (props: DividerProps) => {
    if (props.label === undefined) {
        const semantics = props.semantics ?? "separator"
        const orientation = props.orientation ?? "horizontal"
        return (
            <Separator
                orientation={orientation}
                data-grammar-divider-orientation={orientation}
                data-tier="atom"
                data-component="Divider"
                data-grammar-divider="bare"
                data-grammar-divider-semantics={semantics}
                data-contract="BOUNDARY-1"
                className="starci-core-divider-bare"
                {...(semantics === "presentation" ? { "aria-hidden": true } : {})}
            />
        )
    }
    return (
        <div
            data-tier="atom"
            data-component="Divider"
            data-grammar-divider="labelled"
            data-contract="GAP-3"
            className="starci-core-divider"
        >
            <Separator aria-label={props.label} data-contract="BOUNDARY-5" className="starci-core-divider-rule" />
            <span aria-hidden="true"><Text as="span" size="sm" tone="muted">{props.label}</Text></span>
            <Separator aria-hidden="true" data-contract="BOUNDARY-5" className="starci-core-divider-rule" />
        </div>
    )
}
