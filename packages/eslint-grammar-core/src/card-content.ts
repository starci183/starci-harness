import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { attributeOf, grammarName, stringProp } from "./lib/grammar-jsx.ts"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
import type { Context } from "./lib/types.ts"

/**
 * ONE CONTENT PER CARD (owner, 2026-11-09, CARD-ONE-CONTENT). A `SurfaceCard` holds exactly ONE content: a list, an input group (a form), a table, a graph
 * or a figures ribbon. Its own controls are allowed (a tab, search or pagination zone, a form footer with Cancel and Save). Several groups are several
 * cards, each with a `Sublabel` above it; items of the same kind stay in one list. A card inside a card is `no-raised-surface-in-surface` (R340). A
 * label has no description under it: the description is a caption under the card (`Section caption`, `SurfaceCard note`).
 *
 * WHAT IT READS.
 *   - `card-one-content`: a `SurfaceCard` whose body (any depth, through layout wrappers) holds more than one content component (a list, a description
 *     list, a table, a graph, a chart, a timeline, a figures strip, a form group), or whose kind is not `figures` and that carries a `figures` header zone
 *     (a ribbon above another content).
 *   - `no-label-description`: a `Section` with a `description`, and a labelled `SurfaceCard` (not a tile) with a `description`.
 *
 * WHAT IT LEAVES ALONE. A card with one content, a tile (its description is its content), other components, and non-product source.
 */

/** The Grammar components that are one content of a card. */
const CONTENT: ReadonlySet<string> = new Set([
  "ListBox", "ItemList", "ListRow", "DescriptionList", "DataTable", "FlowGraph", "BarChart", "ProportionBar", "Sparkline", "Timeline", "DisclosureList",
  "Accordion", "BubbleMap", "MermaidDiagram", "Form", "FormGrid", "Fieldset", "Gallery", "ScheduleGrid", "Board", "Stepper",
])
/** A Section that is itself one content. */
const SECTION_CONTENT: ReadonlySet<string> = new Set(["list", "figures"])

/** The content components a card body holds, in source order, not descending into a content component. */
const contentsIn = (context: Context, root: TSESTree.Node): TSESTree.JSXOpeningElement[] => {
  const found: TSESTree.JSXOpeningElement[] = []
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object") return
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry)
      return
    }
    const node = value as { type?: string; [key: string]: unknown }
    if (typeof node.type !== "string") return
    if (node.type === "JSXElement") {
      const element = node as unknown as TSESTree.JSXElement
      const name = grammarName(context, element.openingElement)
      if (name !== null && (CONTENT.has(name) || (name === "Section" && SECTION_CONTENT.has(stringProp(element.openingElement, "kind") ?? "")))) {
        found.push(element.openingElement)
        return
      }
    }
    for (const [key, child] of Object.entries(node)) if (key !== "parent" && key !== "loc" && key !== "range") visit(child)
  }
  visit(root)
  return found
}

const hasFiguresZone = (opening: TSESTree.JSXOpeningElement): boolean => {
  const headers = attributeOf(opening, "headers")
  const expression = headers?.value?.type === "JSXExpressionContainer" ? headers.value.expression : undefined
  if (expression === undefined || expression.type !== "ArrayExpression") return false
  return expression.elements.some((entry) => entry !== null && entry.type === "ObjectExpression" && entry.properties.some((property) =>
    property.type === "Property" && property.key.type === "Identifier" && property.key.name === "kind" && property.value.type === "Literal" && property.value.value === "figures"))
}

/** A card holds one content. */
export const cardOneContent: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "CARD-ONE-CONTENT: a SurfaceCard holds exactly one content (a list, a form, a table, a graph or a figures ribbon); several groups are several cards with a Sublabel above each." },
    schema: [],
    messages: {
      many: "This `SurfaceCard` holds {{count}} contents ({{names}}). A card holds ONE: a list, an input group, a table, a graph or a figures ribbon. Several groups are several cards, each with a `Sublabel` above it; items of the same kind stay in one list.",
      ribbon: "A `figures` header zone puts a figures ribbon above another content in one card. A ribbon is its own card (`kind=\"figures\"`), with a `Sublabel` above the cards that follow.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return {
      JSXElement(element: TSESTree.JSXElement) {
        const opening = element.openingElement
        if (grammarName(context, opening) !== "SurfaceCard") return
        const kind = stringProp(opening, "kind")
        if (kind === "figures" || kind === "tile") return
        const contents = contentsIn(context, { type: "Program", children: element.children } as never)
        if (contents.length > 1) {
          const names = contents.map((entry) => grammarName(context, entry) ?? "?").join(", ")
          context.report({ node: opening as never, messageId: "many", data: { count: String(contents.length), names } })
        }
        if (hasFiguresZone(opening)) context.report({ node: opening as never, messageId: "ribbon" })
      },
    }
  },
})

/** A label has no description under it: the description is a caption under the card. */
export const noLabelDescription: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "CARD-ONE-CONTENT: a Section or a card label has no description under it; the description is a caption under the card or list." },
    schema: [],
    messages: {
      section: "A `Section` with a `description`: a head is one row and holds no description. Write the line as `caption`, drawn under the card or list.",
      card: "A labelled `SurfaceCard` with a `description`: the label has no description under it. Put the line under the card as its `note`.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return {
      JSXOpeningElement(opening: TSESTree.JSXOpeningElement) {
        const name = grammarName(context, opening)
        if (name === "Section") {
          const description = attributeOf(opening, "description")
          if (description !== undefined) context.report({ node: description as never, messageId: "section" })
        } else if (name === "SurfaceCard" && stringProp(opening, "kind") !== "tile") {
          const description = attributeOf(opening, "description")
          if (description !== undefined && attributeOf(opening, "label") !== undefined) context.report({ node: description as never, messageId: "card" })
        }
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "card-one-content": cardOneContent,
  "no-label-description": noLabelDescription,
}

defineFamilyRules(rules, "knowledge/ui/presentation/grammar-laws.yaml#CARD-ONE-CONTENT")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
