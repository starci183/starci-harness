export type LeadingNumberProps = {
    /** One-based position of the item inside its authored sequence. */
    readonly position: number
    /** `ordinal` (default) draws "1."; `hash` draws "#1", muted and semibold, for numbered passages or results. */
    readonly format?: "ordinal" | "hash"
}

import { leadingNumberClassName } from "./classNames.js"

/**
 * Product-neutral ordinal prefix for readable ordered rows.
 *
 * The punctuation and treatment are intentionally closed: an ordinal prefix is
 * quiet reading structure (`1.`), never a badge, chip, status, or decoration.
 */
export const LeadingNumber = (props: LeadingNumberProps) => (
    <span
        className={leadingNumberClassName}
        data-component="LeadingNumber"
        data-grammar-number-format={props.format ?? "ordinal"}
        data-tier="leaf"
        data-contract="FONT-2 TONE-2"
    >
        {props.format === "hash" ? `#${props.position}` : `${props.position}.`}
    </span>
)
