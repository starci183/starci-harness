import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isGrammarFragment } from "@starci/eslint-canon-fe/lib/fragment.mjs"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
/**
 * The Fragment law: `<Fragment reason="...">` is the one sanctioned place where anything goes (any markup, any class name, any
 * library) because no Grammar component fits, so it always says why. `reason` is a non-empty string literal such as
 * `"workflow graph editor"`, and it serves the lint and the inventory (a Fragment renders no element, so there is nothing to stamp).
 *
 * WHAT IT READS. A Grammar `Fragment` element (`Fragment`, its import alias such as `GrammarFragment`, or `<ns>.Fragment`; never React's Fragment or `<>`) whose `reason` attribute is missing, is not a string literal (a literal, or an
 * expression container holding a string literal or a template without substitutions), or is blank. An element with a spread
 * attribute is not judged (the spread may carry the reason).
 *
 * THE OTHER HALF. Every other rule of this plugin leaves a Fragment subtree alone (`exemptFragmentRules` in `index.ts`: nothing inside is
 * reported, nor an import whose every use is inside). This law is the one that judges the `<Fragment>` element itself, so it is not
 * wrapped. The inventory of every use is `fragment-inventory.ts`, a report and never an error.
 *
 * WHERE IT APPLIES. Product source (`isProductSource`).
 */

/** The statically known text of an attribute value; null when it is computed. */
const literalText = (value: TSESTree.JSXAttribute["value"]): string | null => {
  if (value === null) return null
  const node = value.type === "JSXExpressionContainer" ? value.expression : value
  if (node.type === "Literal") return typeof node.value === "string" ? node.value : null
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0]?.value.cooked ?? ""
  return null
}

/** A Fragment region always says why no Grammar component fits. */
export const fragmentHasReason: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "A Fragment region names its reason, a non-empty string literal saying why no Grammar component fits." },
    schema: [],
    messages: {
      reason:
        "`<Fragment>` needs `reason=\"...\"`, a non-empty string saying why no Grammar component fits (for example \"workflow graph editor\"). Fragment is a last resort and the reason is the audit trail: name it, or compose a Grammar component instead.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return {
      JSXOpeningElement(node) {
        if (node.parent.type !== "JSXElement" || !isGrammarFragment(context, node.parent)) return
        if (node.attributes.some((entry) => entry.type === "JSXSpreadAttribute")) return
        const reason = node.attributes.find((entry): entry is TSESTree.JSXAttribute => entry.type === "JSXAttribute" && entry.name.type === "JSXIdentifier" && entry.name.name === "reason")
        const text = reason === undefined ? null : literalText(reason.value)
        if (text === null || text.trim() === "") context.report({ node, messageId: "reason" })
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "fragment-has-reason": fragmentHasReason,
}

defineFamilyRules(rules, "knowledge/patterns/fe/ui.yaml#FE-UI")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
