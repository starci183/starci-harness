import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { elementNameOf, grammarName, hasSpread, renderedChildren, stringProp } from "./lib/grammar-jsx.ts"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
import type { Context } from "./lib/types.ts"
/**
 * The two-axis layout law (owner, 2026-11-09, LAYOUT-5): a REPORT page (`Page` standard: the pink well) stacks its card surfaces in ONE
 * direction, a vertical column 24 apart. Cards stand side by side only as siblings of the same role and height (figure cells, short
 * equal cards). A card beside a column of other cards makes two axes in one well, and two cards of different roles side by side
 * are unequal in height. A page that needs a persistent selection column or a full-height chat or editor is a WORKSPACE page
 * (`Page chrome="panes"`, side panes are white surfaces at full height, never cards).
 *
 * WHAT IT READS. A Grammar `Grid` or `Cluster` (imported from `@starci/grammar`) and its rendered children (fragments, `cond && x`,
 * ternaries and `.map` looked through):
 *   - `beside`: a `SurfaceCard` child together with a `Stack` child that holds two or more `SurfaceCard`s;
 *   - `unequal`: two or more `SurfaceCard` children of different `kind` (an absent `kind` is `body`).
 *
 * WHAT IT LEAVES ALONE. `Grid kind="main-rail"` (a task and its subordinate support), a `SurfaceCard` with a JSX spread (its kind may
 * arrive), a card repeated by `.map` (one element, one role), a `Stack` of cards on its own (that is the column), and non-product source.
 *
 * WHERE IT APPLIES. Product source (`isProductSource`).
 */

/** The containers whose children stand side by side. */
const ROW_CONTAINERS = new Set(["Grid", "Cluster"])

/** The `SurfaceCard` elements among a list of rendered nodes. */
const cardsOf = (context: Context, nodes: readonly TSESTree.Node[]): TSESTree.JSXElement[] =>
  nodes.filter((node): node is TSESTree.JSXElement => node.type === "JSXElement" && grammarName(context, node.openingElement) === "SurfaceCard")

/** True for a Grammar `Stack` that holds two or more cards. */
const isColumnOfCards = (context: Context, node: TSESTree.Node): boolean =>
  node.type === "JSXElement" && grammarName(context, node.openingElement) === "Stack" && cardsOf(context, renderedChildren(node.children)).length >= 2

/** Cards stand side by side only when they share a role and height; a card beside a column of cards is two axes. */
export const layoutTwoAxis: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "LAYOUT-5: a report page stacks cards in one direction; a card beside a column of cards, or cards of different kinds side by side, is two axes." },
    schema: [],
    messages: {
      beside:
        "A card stands beside a column of cards ({{where}}): two axes in one well. A report page stacks its cards in one vertical column (24 apart); side by side is only for sibling cards of the same role and height. If the page needs a persistent selection column or a full-height chat or editor, it is a workspace page: `Page chrome=\"panes\"`, side panes are white surfaces, never cards.",
      unequal:
        "Cards of different kinds ({{kinds}}) stand side by side in a {{where}}: they differ in role and height. Stack them in one column, or keep only sibling cards of one role in the row (figure cells, short equal cards).",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return {
      JSXElement(element: TSESTree.JSXElement) {
        const opening = element.openingElement
        const where = grammarName(context, opening)
        if (where === null || !ROW_CONTAINERS.has(where)) return
        if (where === "Grid" && stringProp(opening, "kind") === "main-rail") return
        const children = renderedChildren(element.children)
        const cards = cardsOf(context, children)
        if (cards.length > 0 && children.some((child) => isColumnOfCards(context, child))) {
          context.report({ node: opening, messageId: "beside", data: { where } })
          return
        }
        const sure = cards.filter((card) => !hasSpread(card.openingElement))
        const kinds = [...new Set(sure.map((card) => stringProp(card.openingElement, "kind") ?? "body"))]
        if (sure.length >= 2 && kinds.length > 1 && children.every((child) => elementNameOf(child) !== null)) {
          context.report({ node: opening, messageId: "unequal", data: { where, kinds: kinds.join(", ") } })
        }
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "layout-two-axis": layoutTwoAxis,
}

defineFamilyRules(rules, "knowledge/ui/presentation/grammar-laws.yaml#LAYOUT-TWO-AXIS")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
