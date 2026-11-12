import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { attributeOf, elementNameOf, grammarName, hasSpread, renderedChildren } from "./lib/grammar-jsx.ts"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
import type { Context } from "./lib/types.ts"
/**
 * The lone surface law (owner, 2026-11-09, SINGLE-CHILD-CARD; aligned 0.37.8): a card groups two or more different parts or carries zones. A card holding a LIST or
 * key-value rows (`SurfaceCard kind="list"`, `kind="table"`, `kind="select"`, a `ListBox`, `DisclosureList`, `Section kind="list"`, a `DescriptionList`) is valid, alone or
 * not: one list card with its head and count chip, or a bordered key-value card on a white aside, is the law. What is wrong is a card wrapping ONE non-list leaf that
 * is a surface on its own: a `DataTable` (standalone it draws its own card) or a chart. The title sits above it as a `Section` head.
 *
 * WHAT IT READS. A Grammar `SurfaceCard` (imported from `@starci/grammar`) with no zones: no `headers` or `footers` prop (an empty array literal counts as none) and no
 * `labelEnd` (head actions). Its body is read through fragments, `cond && <x/>`, `cond ? <x/> : <y/>` and `.map`, ignoring blank text. It is refused when that body is ONE
 * element and that element is a `DataTable` or a chart: `BarChart`, `ProportionBar`, `BubbleMap`, `FlowGraph`, `MermaidDiagram`.
 *
 * DECIDED. Lists and key-value rows are never refused here. `Meter`, `Progress` and `ProgressCircle` are single values, not charts. `SurfaceCard kind="figures"`, `details`,
 * `accordion`, `list`, `table`, `select` and `tile` are not judged. Kinds, depth and nesting stay with `surface-card-kind`, `no-raised-surface-in-surface` and `surface-depth`.
 *
 * WHAT IT LEAVES ALONE. A card with two or more body children, a card with zones or `labelEnd`, a card with a JSX spread, a non-Grammar `SurfaceCard`, and non-product source.
 *
 * WHERE IT APPLIES. Product source (`isProductSource`).
 */

/** The table, list and chart components that are a surface on their own, with the word the message names them by. */
const LONE: ReadonlyMap<string, string> = new Map([
  ["DataTable", "table"],
  ["BarChart", "chart"],
  ["ProportionBar", "chart"],
  ["BubbleMap", "chart"],
  ["FlowGraph", "chart"],
  ["MermaidDiagram", "chart"],
])

/** True when an attribute is an empty array literal (`headers={[]}`), which zones nothing. */
const isEmptyArray = (attribute: TSESTree.JSXAttribute): boolean => {
  const value = attribute.value
  return value?.type === "JSXExpressionContainer" && value.expression.type === "ArrayExpression" && value.expression.elements.length === 0
}

/** True when the card carries a zone or head actions: a `headers` or `footers` prop that is not an empty array, or a `labelEnd`. */
const hasZones = (opening: TSESTree.JSXOpeningElement): boolean => {
  const zoned = ["headers", "footers"].some((name) => {
    const attribute = attributeOf(opening, name)
    return attribute !== undefined && !isEmptyArray(attribute)
  })
  return zoned || attributeOf(opening, "labelEnd") !== undefined
}

/** What the lone child is, as the message names it (`DataTable`, `Section kind="list"`), or null when it is not a surface on its own. */
const loneChild = (context: Context, card: TSESTree.JSXElement): string | null => {
  const body = renderedChildren(card.children)
  if (body.length !== 1) return null
  const child = body[0]
  if (child?.type !== "JSXElement") return null
  const name = elementNameOf(child)
  if (name === null || grammarName(context, child.openingElement) === null) return null
  return LONE.has(name) ? name : null
}

/** A table component or a chart standing alone is the surface, never wrapped in a card; list cards are valid. */
export const singleChildCard: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "SINGLE-CHILD-CARD: a SurfaceCard with no zones whose only content is a DataTable or a chart is a second frame; a card holding list or key-value rows is valid." },
    schema: [],
    messages: {
      lone:
        "A {{child}} standing alone is the surface: drop the SurfaceCard, put its title in a `Section` head (`title`) and one line under it in `Section caption`. A card groups two or more different parts, or carries zones (tabs, search, head actions); a card of list or key-value rows is always valid.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return {
      JSXElement(element) {
        const opening = element.openingElement
        if (grammarName(context, opening) !== "SurfaceCard" || hasSpread(opening) || hasZones(opening)) return
        const child = loneChild(context, element)
        if (child === null) return
        context.report({ node: opening, messageId: "lone", data: { child: `\`${child}\`` } })
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "single-child-card": singleChildCard,
}

defineFamilyRules(rules, "knowledge/ui/presentation/grammar-laws.yaml#SINGLE-CHILD-CARD")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
