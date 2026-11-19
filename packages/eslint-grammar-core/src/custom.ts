import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
/**
 * The Custom law: `<Custom reason="...">` is the one sanctioned place where anything goes (any markup, any class name, any
 * library) because no Grammar component fits, so it always says why. `reason` is a non-empty string literal such as
 * `"workflow graph editor"`, and the Grammar stamps it on the DOM (`data-grammar-custom-reason`) for the audit.
 *
 * WHAT IT READS. A `Custom` element (or `<ns>.Custom`) whose `reason` attribute is missing, is not a string literal (a literal, or an
 * expression container holding a string literal or a template without substitutions), or is blank. An element with a spread
 * attribute is not judged (the spread may carry the reason).
 *
 * THE OTHER HALF. Every other rule of this plugin leaves a Custom subtree alone (`exemptCustomRules` in `index.ts`: nothing inside is
 * reported, nor an import whose every use is inside). This law is the one that judges the `<Custom>` element itself, so it is not
 * wrapped. The inventory of every use is `custom-inventory.ts`, a report and never an error.
 *
 * WHERE IT APPLIES. Product source (`isProductSource`).
 */

/** The element name of a JSX name: `Custom`, or `G.Custom` as `Custom`. */
const nameOf = (name: TSESTree.JSXTagNameExpression): string | null => {
  if (name.type === "JSXIdentifier") return name.name
  if (name.type === "JSXMemberExpression") return name.property.name
  return null
}

/** The statically known text of an attribute value; null when it is computed. */
const literalText = (value: TSESTree.JSXAttribute["value"]): string | null => {
  if (value === null) return null
  const node = value.type === "JSXExpressionContainer" ? value.expression : value
  if (node.type === "Literal") return typeof node.value === "string" ? node.value : null
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0]?.value.cooked ?? ""
  return null
}

/** A Custom region always says why no Grammar component fits. */
export const customHasReason: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "A Custom region names its reason, a non-empty string literal saying why no Grammar component fits." },
    schema: [],
    messages: {
      reason:
        "`<Custom>` needs `reason=\"...\"`, a non-empty string saying why no Grammar component fits (for example \"workflow graph editor\"). Custom is a last resort and the reason is the audit trail: name it, or compose a Grammar component instead.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return {
      JSXOpeningElement(node) {
        if (nameOf(node.name) !== "Custom") return
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
  "custom-has-reason": customHasReason,
}

defineFamilyRules(rules, "knowledge/patterns/fe/ui.yaml#FE-UI")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
