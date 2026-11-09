import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { grammarName } from "./lib/grammar-jsx.ts"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
import type { Context, Node } from "./lib/types.ts"

/**
 * ROWS IN A CARD (owner, 2026-11-09, ROWS-IN-CARD). A list of rows or key-value rows is always a card: on the pink well a card with a shadow and no border, on a white
 * surface (aside, pane, drawer) a card with a 1px border and no shadow. Grammar draws that edge itself (the SURFACE-ELEVATION rule) when the rows stand in a
 * `SurfaceCard` or a `Section`; a row primitive written bare on a surface is the repeated bug of a list with no edge.
 *
 * WHAT IT READS. In product source, a Grammar `DescriptionList` (key-value rows) or `DisclosureList` (disclosure rows) that no `SurfaceCard`, `Section`, `DataTable`
 * or `Accordion` of the same file encloses. A row primitive passed as a JSX attribute value (`body={<DescriptionList/>}`) is judged where the receiving component draws it.
 *
 * WHAT IT LEAVES ALONE. `ListBox` (a selectable list pane and a menu are navigation, not rows of data: no static signal tells them apart), a row primitive another
 * file wraps (a file whose only job is to return the rows is flagged here: wrap it in the `Section` or card in the same file), and non-product source.
 */

const ROWS: ReadonlySet<string> = new Set(["DescriptionList", "DisclosureList"])
const CARDS: ReadonlySet<string> = new Set(["SurfaceCard", "Section", "DataTable", "Accordion"])

/** True when the element sits inside a Grammar card of this file, or inside a JSX attribute (the receiver draws it). */
const isHosted = (context: Context, opening: TSESTree.JSXOpeningElement): boolean => {
  let previous: Node = opening
  for (let current: Node | null | undefined = opening.parent?.parent; current !== undefined && current !== null; previous = current, current = current.parent) {
    if (current.type === "JSXAttribute") return true
    if (current.type !== "JSXElement") continue
    if (previous === current.openingElement) continue
    const name = grammarName(context, current.openingElement)
    if (name !== null && CARDS.has(name)) return true
  }
  return false
}

/** A list of rows stands in a card. */
export const rowsInCard: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "ROWS-IN-CARD: a DescriptionList or DisclosureList stands in a SurfaceCard or a Section, so it is a card (shadow on the well, 1px border on a white surface)." },
    schema: [],
    messages: {
      bare: "A `{{name}}` stands with no card around it. Rows are always a card: put them in a `Section` (`kind=\"list\"`) or a `SurfaceCard`; Grammar draws the shadow on the pink well and the 1px border on a white aside, pane or drawer by itself.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return {
      JSXOpeningElement(opening: TSESTree.JSXOpeningElement) {
        const name = grammarName(context, opening)
        if (name === null || !ROWS.has(name)) return
        if (isHosted(context, opening)) return
        context.report({ node: opening as never, messageId: "bare", data: { name } })
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "rows-in-card": rowsInCard,
}

defineFamilyRules(rules, "knowledge/ui/presentation/grammar-laws.yaml#ROWS-IN-CARD")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
