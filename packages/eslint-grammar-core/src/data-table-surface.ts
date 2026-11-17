import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { attributeOf, grammarName } from "./lib/grammar-jsx.ts"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"

/**
 * ONE FLAT TABLE (DATA-TABLE-SURFACE). A `DataTable` has one flat look: no frame, no card, no fill. The Grammar family 0.45.0 deleted its `surface` prop
 * (`card`, `frame`, `none`), so the compiler refuses it where the types are read; this rule names the fix, and applies it, where an app still writes it (a
 * pinned older Grammar, a JavaScript file, an `any` prop).
 *
 * WHAT IT READS. In product source, a Grammar `DataTable` (named or `G.DataTable`) with a `surface` attribute, whatever its value.
 *
 * WHAT IT LEAVES ALONE. A `surface` on another component (`Pane surface` is its own prop), a non-Grammar `DataTable` and non-product source.
 *
 * AUTOFIX. The attribute and the whitespace before it are removed. The table keeps its columns, rows and `footer`.
 */

/** A `surface` on a `DataTable` is refused, and removed by the fix. */
export const dataTableSurface: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    fixable: "code",
    docs: { description: "DATA-TABLE-SURFACE: a DataTable has one flat look; its `surface` prop is removed in the Grammar family 0.45.0." },
    schema: [],
    messages: {
      surface: "`DataTable surface` is removed: a table has one flat look. Drop the `surface` attribute and put the table under its `Section` (`<Section title ...><DataTable .../></Section>`).",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return {
      JSXOpeningElement(opening: TSESTree.JSXOpeningElement) {
        if (grammarName(context, opening) !== "DataTable") return
        const attribute = attributeOf(opening, "surface")
        if (attribute === undefined) return
        context.report({
          node: attribute,
          messageId: "surface",
          fix: (fixer) => {
            const text = context.sourceCode.text
            let start = attribute.range[0]
            while (start > 0 && /\s/.test(text.charAt(start - 1))) start -= 1
            return fixer.removeRange([start, attribute.range[1]])
          },
        })
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "data-table-surface": dataTableSurface,
}

defineFamilyRules(rules, "knowledge/ui/presentation/grammar-laws.yaml#DATA-TABLE-SURFACE")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
