/**
 * The type roles (0.54.0, owner 2026-11-21): ten roles, each one size, line height and weight from `ramps.css`
 * (`--grammar-type-<role>-size|line|weight`, dots as dashes). `label.field`, `label.group` and `caption` are muted;
 * `badge` takes its tone from the badge around it; `code` is set in the mono stack. No import: the codemods mirror it.
 *
 * THE SITE GROUP (0.55.0, owner 2026-11-21, "3. THÊM NHÓM", then "cook"): five roles for the public marketing site only, never the
 * console: `display.hero`, `display.section`, `display.figure`, `lead` and `title.card`. Their responsive steps (390, from 48rem, from
 * 64rem) live in the tokens, so an app writes one role and no breakpoint. `starci-grammar/site-type-role` refuses them outside the site.
 *
 * THE READING GROUP (0.55.1, owner 2026-11-23, lesson pages): `reading.title` (28 / 38, 500; 23 / 32 at most 30rem) and `reading.body`
 * (17 / 29, 400; 16 / 27 at most 30rem), for long-form prose a learner reads (a lesson, the interview question), never console chrome.
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
    | "reading.title"
    | "reading.body"

/** Every type role, in the owner's order: the ten roles, the site group, then the reading group. */
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
    "reading.title",
    "reading.body",
])

/** The site group (0.55.0): the roles of the public marketing site, never of the console. */
export const SITE_TEXT_ROLES: readonly TextRole[] = Object.freeze(["display.hero", "display.section", "display.figure", "lead", "title.card"])

/** The public class of a role, dots as dashes (`label.item` is `starci-type-label-item`): an app moves a raw size utility onto it. */
export const typeRoleClassName = (role: TextRole): string => `starci-type-${role.replace(".", "-")}`

/** The reading group (0.55.1): long-form prose a learner reads. */
export const READING_TEXT_ROLES: readonly TextRole[] = Object.freeze(["reading.title", "reading.body"])
