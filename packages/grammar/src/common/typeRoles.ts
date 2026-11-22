/**
 * The type roles (0.54.0, owner 2026-11-21): ten roles, each one size, line height and weight from `ramps.css`
 * (`--grammar-type-<role>-size|line|weight`, dots as dashes). `label.field`, `label.group` and `caption` are muted;
 * `badge` takes its tone from the badge around it; `code` is set in the mono stack. No import: the codemods mirror it.
 *
 * THE SITE GROUP (0.55.0, owner 2026-11-21, "3. THÊM NHÓM", then "cook"): five roles for the public marketing site only, never the
 * console: `display.hero`, `display.section`, `display.figure`, `lead` and `title.card`. Their responsive steps (390, from 48rem, from
 * 64rem) live in the tokens, so an app writes one role and no breakpoint. `starci-grammar/site-type-role` refuses them outside the site.
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
    | "display.hero"
    | "display.section"
    | "display.figure"
    | "lead"
    | "title.card"

/** Every type role, in the owner's order: the ten roles, then the site group. */
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
    "display.hero",
    "display.section",
    "display.figure",
    "lead",
    "title.card",
])

/** The site group (0.55.0): the roles of the public marketing site, never of the console. */
export const SITE_TEXT_ROLES: readonly TextRole[] = Object.freeze(["display.hero", "display.section", "display.figure", "lead", "title.card"])

/** The public class of a role, dots as dashes (`label.item` is `starci-type-label-item`): an app moves a raw size utility onto it. */
export const typeRoleClassName = (role: TextRole): string => `starci-type-${role.replace(".", "-")}`
