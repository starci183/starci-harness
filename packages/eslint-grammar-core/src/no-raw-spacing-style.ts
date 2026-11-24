import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { defineFamilyRules, defineRule, exemptFreestyle } from "./lib/rule-contract.ts"

/**
 * THE SPACING ROLES (SPACING-ROLES; contexts/ui/scale.md "The spacing roles"). A distance between two things an app
 * places is a ROLE the Grammar resolves (`Stack gap`, `Cluster gap`, `Grid`, `PaneSection`, `Page`, the inset of a Grammar box), never
 * a raw value. The class-string half is the canon's `starci-fe/no-spacing-utility` (R350); this rule is the `style` half.
 *
 * WHAT IT READS, in product source: a key of the object a JSX `style` attribute holds that writes a gap, a padding or a margin
 * (`gap`, `rowGap`, `columnGap`, `padding`, `paddingInline`, `paddingTop`, …, `margin`, `marginBlockStart`, …), whatever its value.
 *
 * WHAT IT LEAVES ALONE. Every other style key (a width, a transform, a colour variable), an object that is not a JSX `style` (a chart
 * option, a canvas measure), Freestyle and Fragment regions and non-product source.
 *
 * It is a counting rule (`COUNTING` in index.ts): reported and counted at warn until both apps have moved onto the roles, then blocking.
 */

/** A style key that writes a gap, a padding or a margin, on any side or axis. */
export const SPACING_KEY = /^(?:gap|rowGap|columnGap|row-gap|column-gap|(?:padding|margin)(?:Inline|Block|Top|Bottom|Left|Right)?(?:Start|End)?|(?:padding|margin)(?:-(?:inline|block|top|bottom|left|right)(?:-(?:start|end))?)?)$/

const keyName = (node: TSESTree.Property): string | null => {
  if (node.computed) return null
  if (node.key.type === "Identifier") return node.key.name
  return node.key.type === "Literal" && typeof node.key.value === "string" ? node.key.value : null
}

/** The object literal a JSX `style={{ … }}` attribute holds, when the property belongs to it. */
const inStyleAttribute = (node: TSESTree.Property): boolean => {
  const object = node.parent
  if (object?.type !== "ObjectExpression") return false
  const container = object.parent
  if (container?.type !== "JSXExpressionContainer") return false
  const attribute = container.parent
  return attribute?.type === "JSXAttribute" && attribute.name.type === "JSXIdentifier" && attribute.name.name === "style"
}

/** No raw gap, padding or margin in a JSX `style`: the relation is a Grammar spacing role. */
export const noRawSpacingStyle: Rule.RuleModule = exemptFreestyle(defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "SPACING-ROLES: spacing is a Grammar role (Stack or Cluster `gap`, the inset of a Grammar box); no gap, padding or margin in a JSX style." },
    schema: [],
    messages: {
      raw: "`{{key}}` in a style writes a distance the Grammar owns. Name the relation: `gap` on the Stack, Cluster or Grid that holds the siblings (identity 4, inline 8, row 12, section 24, region 32), or the inset of the Grammar box that holds the content (SurfaceCard, PaneSection, Page, Dialog).",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return {
      Property(node: TSESTree.Property) {
        const key = keyName(node)
        if (key === null || !SPACING_KEY.test(key) || !inStyleAttribute(node)) return
        context.report({ node: node as never, messageId: "raw", data: { key } })
      },
    }
  },
}))

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "no-raw-spacing-style": noRawSpacingStyle,
}

defineFamilyRules(rules, "knowledge/ui/presentation/grammar-laws.yaml#SPACING-ROLES")

/** The rule runs in the counting cohort (index.ts `COUNTING`): a warning until both apps migrate. */
export const recommended: Record<string, "warn"> = { "starci-grammar/no-raw-spacing-style": "warn" }
