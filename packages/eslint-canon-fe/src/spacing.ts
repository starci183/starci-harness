/**
 * Spacing is the Grammar's (HFS R350): an app names the relation between the blocks it places through a role prop
 * (`<Stack gap="section">`, `<Cluster gap="inline">`, `<Grid kind="cards">`, `PaneSection`, `Page`), and the Grammar
 * resolves the role to its step. A padding, margin, gap or space utility in an app class string is a second owner of
 * a distance the Grammar already owns.
 */
import { classTextVisitors } from "./lib/class-text.ts"
import { exemptFreestyle } from "./lib/freestyle.ts"
import { defineRule, type CountingRecommended, type Rules } from "./lib/rule.ts"

/** The spacing utility families: padding, margin, gap and the space-between utilities, each side and axis. */
const SPACING_UTILITY = /^-?(?:p|px|py|pt|pb|ps|pe|pl|pr|m|mx|my|mt|mb|ms|me|ml|mr|gap|gap-x|gap-y|space-x|space-y)-(.+)$/

/** The role a Tailwind gap step names, as the spacing-roles codemod maps it; a step with no role is a judgement. */
export const GAP_STEP_ROLE: Readonly<Record<string, string>> = Object.freeze({
  "0": "seam (a joined face or a divider)",
  "0.5": "identity",
  "1": "identity",
  "1.5": "identity",
  "2": "inline",
  "2.5": "inline",
  "3": "row",
  "4": "section",
  "5": "section",
  "6": "region",
  "8": "region",
})

/** The utility a class names once its variants (`sm:`, `hover:`, `[&>*]:`) and importance (`!`) are dropped. */
export const baseUtility = (cls: string): string => {
  let depth = 0
  let start = 0
  for (let index = 0; index < cls.length; index += 1) {
    const char = cls[index]
    if (char === "[" || char === "(") depth += 1
    else if (char === "]" || char === ")") depth -= 1
    else if (char === ":" && depth === 0) start = index + 1
  }
  return cls.slice(start).replace(/^!|!$/g, "")
}

/** Every spacing utility of a class string, in the order written. */
export const spacingUtilities = (text: string): string[] => text.split(/\s+/).filter((cls) => SPACING_UTILITY.test(baseUtility(cls)))

/** What to write instead of one spacing utility. */
const instead = (cls: string): string => {
  const base = baseUtility(cls)
  const match = SPACING_UTILITY.exec(base)
  const family = base.replace(/^-/, "").split("-")[0] ?? ""
  if (family === "gap" || family === "space") {
    const role = GAP_STEP_ROLE[match?.[1] ?? ""]
    return role === undefined
      ? "the role of the relation on a Stack, Cluster or Grid gap"
      : `gap="${role}" on the Stack or Cluster that holds these siblings`
  }
  if (family.startsWith("m")) return "the parent's gap (a Stack or Cluster role); the Grammar alone places a margin"
  return "the inset of the Grammar box that holds this content (SurfaceCard, PaneSection, Page, Dialog); a box of your own takes none"
}

/** No padding, margin, gap or space utility in an app class string: the relation is named, the step is the Grammar's. */
export const noSpacingUtility = exemptFreestyle(defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Spacing is the Grammar's: an app names the relation through a role prop, never a spacing utility." },
    schema: [],
    messages: {
      utility: "`{{cls}}` writes a distance the Grammar owns. Use {{instead}} (R350 `FE_SPACING_UTILITY`).",
    },
  },
  create(context) {
    return classTextVisitors(context, (node, text) => {
      if (!text) return
      for (const cls of spacingUtilities(text)) context.report({ node, messageId: "utility", data: { cls, instead: instead(cls) } })
    })
  },
}))

/** The rules of the spacing law. */
export const rules = { "no-spacing-utility": noSpacingUtility } satisfies Rules

/**
 * The rule runs in its counting cohort (lib/config.ts `COUNTING`): every finding is reported and counted by `starci app
 * lint`, none fails the gate, while `starci app codemod spacing-roles` moves the app onto role props.
 */
export const recommended: CountingRecommended = { "starci-fe/no-spacing-utility": "warn" }
