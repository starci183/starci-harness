/**
 * The type roles (0.54.0, owner 2026-11-21): ten roles, each one size, line height and weight from `ramps.css`
 * (`--grammar-type-<role>-size|line|weight`, dots as dashes). `label.field`, `label.group` and `caption` are muted;
 * `badge` takes its tone from the badge around it; `code` is set in the mono stack. No import: the codemods mirror it.
 */
export type TextRole =
    | "figure"
    | "title.page"
    | "title.section"
    | "label.item"
    | "body"
    | "label.field"
    | "label.group"
    | "caption"
    | "badge"
    | "code"

/** Every type role, in the owner's order. */
export const TEXT_ROLES: readonly TextRole[] = Object.freeze([
    "figure",
    "title.page",
    "title.section",
    "label.item",
    "body",
    "label.field",
    "label.group",
    "caption",
    "badge",
    "code",
])

/** The public class of a role, dots as dashes (`label.item` is `starci-type-label-item`): an app moves a raw size utility onto it. */
export const typeRoleClassName = (role: TextRole): string => `starci-type-${role.replace(".", "-")}`
