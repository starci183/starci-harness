import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
/**
 * The Freestyle law (HFS R341 `FE_FREESTYLE_REASON_MISSING`; owner ruling `grammar-freestyle-region`): Freestyle is the one
 * sanctioned escape hatch of the Grammar, a region where the app writes its own plain elements and app CSS because no
 * Grammar component fits. It is a last resort, so it always says why: `reason` is a non-empty string literal such as
 * `"sign-in brand art"`, and the Grammar stamps it on the DOM (`data-grammar-freestyle-reason`).
 *
 * WHAT IT READS. A `Freestyle` element (or `<ns>.Freestyle`) whose `reason` attribute is missing, is not a string literal
 * (a literal, or an expression container holding a string literal or a template without substitutions), or is blank. An
 * element with a spread attribute is not judged (the spread may carry the reason).
 *
 * THE OTHER HALF. The rules that judge hand-written elements, classes, styles and generated art leave the raw elements of a
 * Freestyle subtree alone (`exemptFreestyle`); a Grammar component inside it is judged as before.
 *
 * WHERE IT APPLIES. Product source (`isProductSource`).
 */

/** The element name of a JSX name: `Freestyle`, or `G.Freestyle` as `Freestyle`. */
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

/** A Freestyle region always says why no Grammar component fits. */
export const freestyleHasReason: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "R341: a Freestyle region names its reason, a non-empty string literal saying why no Grammar component fits." },
    schema: [],
    messages: {
      reason:
        "`<Freestyle>` needs `reason=\"...\"`, a non-empty string saying why no Grammar component fits (for example \"sign-in brand art\"). Freestyle is a last resort: name the reason, or compose a Grammar component instead.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return {
      JSXOpeningElement(node) {
        if (nameOf(node.name) !== "Freestyle") return
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
  "freestyle-has-reason": freestyleHasReason,
}

defineFamilyRules(rules, "knowledge/hfs/rules.yaml#R341")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
