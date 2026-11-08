import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
import { attributeOf, elementOf, grammarBindings, literalAttribute } from "./lib/row-context.ts"

/**
 * The same line size law (`FE_SAME_LINE_SIZE`): one line, one size. The `Text` children that stand side by side on one line,
 * the direct children of one `Cluster` (and of a `Text` that holds `Text` runs, whose own size starts the line), share one `size`; an absent `size` is `md`, and `sm` is the same 14 step as `md` (the final type scale), so only 14 vs 12 (`xs`) vs display (`figure`) mixes are findings.
 *
 * WHAT IT READS. The direct `Text` children of a `Cluster` or a `Text`, through fragments, `cond && <Text />` and ternaries. A
 * `Text` whose `size` is not a literal (a variable, a spread) is skipped. A `Badge`, `StatusDot`, `Chip` or `TagGroup` is not a
 * `Text`, so it is exempt. The first `Text` sets the line's size; each later `Text` of another size is a finding.
 */

/** The line containers: a Cluster lays its children on one line, a Text holds runs. */
const LINES: ReadonlySet<string> = new Set(["Cluster", "Text"])

/** The size step a Text states: its literal `size` (`sm` folds into `md`, both 14), `md` when it has none, null when it cannot be read. */
const sizeOf = (opening: TSESTree.JSXOpeningElement): string | null => {
  if (opening.attributes.some((entry) => entry.type === "JSXSpreadAttribute")) return null
  if (attributeOf(opening, "size") === null) return "md"
  const size = literalAttribute(opening, "size")
  return size === "sm" ? "md" : size
}

export const sameLineSize: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "FE_SAME_LINE_SIZE: the Text children of one Cluster line share one size." },
    schema: [],
    messages: {
      mixed:
        "This Text is `{{size}}` and its line's first Text is `{{first}}`. One line, one size: sizes are 14 (md, sm), 12 (xs, for a small name such as a meta line, count or timestamp) and display (figure): give every Text of the line the same step. A Badge or a chip may stay as it is.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    let bound: ReadonlyMap<string, string> = new Map()

    /** The Text elements that are direct children of a line, unwrapped through fragments, logical and conditional expressions. */
    const textsOf = (children: readonly TSESTree.Node[]): TSESTree.JSXElement[] => {
      const found: TSESTree.JSXElement[] = []
      const visit = (node: TSESTree.Node | null): void => {
        if (node === null) return
        switch (node.type) {
          case "JSXElement":
            if (elementOf(node.openingElement, bound).grammar === "Text") found.push(node)
            return
          case "JSXFragment":
            node.children.forEach(visit)
            return
          case "JSXExpressionContainer":
            visit(node.expression)
            return
          case "LogicalExpression":
            visit(node.right)
            return
          case "ConditionalExpression":
            visit(node.consequent)
            visit(node.alternate)
            return
          default:
        }
      }
      children.forEach(visit)
      return found
    }

    return {
      Program(program: TSESTree.Program) {
        bound = grammarBindings(program)
      },
      JSXElement(element: TSESTree.JSXElement) {
        const { grammar } = elementOf(element.openingElement, bound)
        if (grammar === null || !LINES.has(grammar)) return
        let first: string | null = grammar === "Text" ? sizeOf(element.openingElement) : null
        for (const text of textsOf(element.children)) {
          const size = sizeOf(text.openingElement)
          if (size === null) continue
          if (first === null) first = size
          else if (size !== first) context.report({ node: text.openingElement, messageId: "mixed", data: { size, first } })
        }
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "same-line-size": sameLineSize,
}

defineFamilyRules(rules, "knowledge/ui/presentation/grammar-laws.yaml#SAME-LINE-SIZE")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
