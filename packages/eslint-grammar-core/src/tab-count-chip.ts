import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"

/**
 * THE TAB COUNT CHIP (owner, 2026-11-09, TAB-COUNT-CHIP). A count on any tab (page layer 1 or 2, a filter tab) is a 12px chip drawn by the tab from its
 * `count`, never "· N" text in the label. The chip is grey; it is pink only when the number is work waiting for the owner (`isAttention`).
 *
 * WHAT IT READS. In product source that imports `@starci/grammar`, an object that carries `id` and `label` (a tab item, a filter option) whose `label`
 * is a string ending in a middle dot and a number (`"All · 5"`), or a template literal that ends in a middle dot and an expression (`` `All · ${n}` ``).
 *
 * WHAT IT LEAVES ALONE. A label with no trailing "· N", objects without `id`, files that do not import Grammar, and non-product source.
 */

const TRAILING_COUNT = /·\s*\d+$/
const TRAILING_SLOT = /·\s*$/

const keyName = (property: TSESTree.Property): string | null =>
  property.key.type === "Identifier" && !property.computed ? property.key.name : property.key.type === "Literal" && typeof property.key.value === "string" ? property.key.value : null

/** A tab label never carries its count as text: the count is the tab's `count`, drawn as a chip. */
export const tabCountChip: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "TAB-COUNT-CHIP: a tab count is the `count` prop drawn as a 12px chip, never \"· N\" text in the label." },
    schema: [],
    messages: {
      label: "The tab label `{{label}}` carries its count as text. Pass `count` (and `isAttention` only when the number is work waiting for the owner): the tab draws the 12px chip.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    let importsGrammar = false
    return {
      ImportDeclaration(node: TSESTree.ImportDeclaration) {
        if (typeof node.source.value === "string" && /^@starci\/grammar(?:\/|$)/.test(node.source.value)) importsGrammar = true
      },
      ObjectExpression(node: TSESTree.ObjectExpression) {
        if (!importsGrammar) return
        const properties = node.properties.filter((entry): entry is TSESTree.Property => entry.type === "Property")
        if (!properties.some((entry) => keyName(entry) === "id")) return
        const label = properties.find((entry) => keyName(entry) === "label")
        if (label === undefined) return
        const value = label.value
        if (value.type === "Literal" && typeof value.value === "string" && TRAILING_COUNT.test(value.value)) {
          context.report({ node: label as never, messageId: "label", data: { label: value.value } })
          return
        }
        if (value.type === "TemplateLiteral" && value.expressions.length > 0) {
          const lastQuasi = value.quasis[value.quasis.length - 1]
          const before = value.quasis[value.quasis.length - 2]
          if (lastQuasi !== undefined && before !== undefined && lastQuasi.value.cooked === "" && TRAILING_SLOT.test(before.value.cooked ?? "")) {
            context.report({ node: label as never, messageId: "label", data: { label: context.sourceCode.getText(value as never) } })
          }
        }
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "tab-count-chip": tabCountChip,
}

defineFamilyRules(rules, "knowledge/ui/presentation/grammar-laws.yaml#TAB-COUNT-CHIP")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
