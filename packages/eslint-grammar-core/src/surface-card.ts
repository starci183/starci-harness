import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { importOf } from "@starci/eslint-canon-fe/lib/bindings.mjs"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
import type { Context, Node } from "./lib/types.ts"
/**
 * The card laws (HFS R355 `FE_SURFACE_CARD_KIND`, R366 `FE_LABEL_IN_GRID`): a `SurfaceCard` is one component with a `kind`,
 * and what a kind draws is not drawn by hand around it.
 *
 * R355. A card of the default `body` kind holds copy and controls. It does not hold the things a kind draws for it: a
 * hand-built list (`ul`, `ol`, `li`), a divider, a `SectionHeader` or a `Heading` standing as a second title (the card has a
 * `label`),. Rows are `kind="list"`, key figures
 * `kind="figures"`, bands divided by seams are the typed `headers` and `footers` zones.
 *
 * R355 (zones). A `custom` zone of a card (`headers` or `footers`) holds no `Tabs`, `SearchField` or `Divider`: filter and search are
 * the typed `filter`, `search` and `toolbar` zones, and the card draws its own seams.
 *
 * R366. A card with a `label` heads a section; a peer you recognise and open is a `kind="tile"` and names itself inside. A
 * labelled card repeated in a `Grid kind="cards"` (two or more, or one written in a `.map`) is a tile drawn with the wrong
 * anatomy.
 *
 * WHAT THEY READ. The direct children of one JSX element named `SurfaceCard` or `Grid` imported from
 * `@starci/grammar` (or `G.SurfaceCard`); a child is read through `cond && <x/>`, `cond ? <x/> : <y/>` and `items.map(() =>
 * <x/>)`. A project component placed in a card is judged in its own file.
 *
 * WHERE THEY APPLY. Product source (`isProductSource`).
 */

const GRAMMAR_SOURCE = /^@starci\/grammar(?:\/(?:common|core|offset-pop))?$/

/** The element name of a JSX name: `SurfaceCard`, or `G.SurfaceCard` as `SurfaceCard`. */
const nameOf = (name: TSESTree.JSXTagNameExpression): string | null => {
  if (name.type === "JSXIdentifier") return name.name
  if (name.type === "JSXMemberExpression") return name.property.name
  return null
}

/** The leftmost identifier of a JSX name (`G` of `G.Pane`), or null. */
const rootOf = (name: TSESTree.JSXTagNameExpression): TSESTree.JSXIdentifier | null => {
  if (name.type === "JSXIdentifier") return name
  if (name.type === "JSXMemberExpression") return rootOf(name.object)
  return null
}

/** The Grammar component an opening element names, or null for another source or a plain element. */
const grammarComponent = (context: Context, opening: TSESTree.JSXOpeningElement): string | null => {
  const root = rootOf(opening.name)
  if (root === null || !/^[A-Za-z]/.test(root.name)) return null
  const imported = importOf(context, root)
  if (imported === null || imported === undefined || !GRAMMAR_SOURCE.test(imported.source)) return null
  return nameOf(opening.name)
}

/** The string a static attribute value spells, or null. */
const staticString = (value: TSESTree.JSXAttribute["value"]): string | null => {
  if (value === null) return null
  if (value.type === "Literal") return typeof value.value === "string" ? value.value : null
  if (value.type !== "JSXExpressionContainer") return null
  const expression = value.expression
  if (expression.type === "Literal") return typeof expression.value === "string" ? expression.value : null
  return expression.type === "TemplateLiteral" && expression.expressions.length === 0 ? expression.quasis[0]?.value.cooked ?? null : null
}

/** The attribute of an opening element by name, or undefined. */
const attributeOf = (opening: TSESTree.JSXOpeningElement, name: string): TSESTree.JSXAttribute | undefined => {
  const found = opening.attributes.find((entry) => entry.type === "JSXAttribute" && entry.name.type === "JSXIdentifier" && entry.name.name === name)
  return found !== undefined && found.type === "JSXAttribute" ? found : undefined
}

/** True when the card opens as the default `body` kind: no `kind`, or `kind="body"`. */
const isBodyCard = (opening: TSESTree.JSXOpeningElement): boolean => {
  const kind = attributeOf(opening, "kind")
  return kind === undefined || staticString(kind.value) === "body"
}

type Found = { readonly node: TSESTree.JSXElement; readonly inMap: boolean }

/** The elements a child position renders, read through conditionals, logical `&&` and `.map`. */
const elementsOf = (node: Node | null | undefined, inMap = false): Found[] => {
  if (node === null || node === undefined) return []
  switch (node.type) {
    case "JSXElement":
      return [{ node, inMap }]
    case "JSXFragment":
      return node.children.flatMap((child) => elementsOf(child, inMap))
    case "JSXExpressionContainer":
      return elementsOf(node.expression, inMap)
    case "ConditionalExpression":
      return [...elementsOf(node.consequent, inMap), ...elementsOf(node.alternate, inMap)]
    case "LogicalExpression":
      return node.operator === "&&" ? elementsOf(node.right, inMap) : [...elementsOf(node.left, inMap), ...elementsOf(node.right, inMap)]
    case "CallExpression": {
      const callee = node.callee
      const method = callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier" ? callee.property.name : null
      const callback = node.arguments[0]
      if (method !== "map" || callback === undefined || (callback.type !== "ArrowFunctionExpression" && callback.type !== "FunctionExpression")) return []
      if (callback.body.type !== "BlockStatement") return elementsOf(callback.body, true)
      return callback.body.body.flatMap((statement) => (statement.type === "ReturnStatement" ? elementsOf(statement.argument, true) : []))
    }
    default:
      return []
  }
}

/** The elements a JSX element renders as direct children. */
const childElements = (element: TSESTree.JSXElement): Found[] => element.children.flatMap((child) => elementsOf(child))

/** The raw elements a body card never holds by hand. */
const HAND_ELEMENTS = new Set(["ul", "ol", "li", "dl"])
/** The Grammar components a body card never holds as a direct child. */
const HAND_COMPONENTS = new Map<string, string>([
  ["Divider", "divider"],
  ["SectionHeader", "title"],
  ["Heading", "title"],
])

/** The Grammar components a `custom` zone never holds: the typed zones draw them. */
const ZONE_COMPONENTS = new Set(["Tabs", "SearchField", "Divider"])

/** Every JSX element below a node, whatever holds it (an object property, a fragment, a call). */
const jsxBelow = (node: unknown, seen = new Set<unknown>()): TSESTree.JSXElement[] => {
  if (typeof node !== "object" || node === null || seen.has(node)) return []
  seen.add(node)
  const found: TSESTree.JSXElement[] = []
  if ("type" in node && node.type === "JSXElement") found.push(node as TSESTree.JSXElement)
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent" || key === "loc" || key === "range") continue
    if (Array.isArray(value)) for (const item of value) found.push(...jsxBelow(item, seen))
    else found.push(...jsxBelow(value, seen))
  }
  return found
}

/** The `children` of every `{ kind: "custom" }` object of a `headers` or `footers` array. */
const customZoneChildren = (opening: TSESTree.JSXOpeningElement): unknown[] => {
  const zones: unknown[] = []
  for (const name of ["headers", "footers"]) {
    const value = attributeOf(opening, name)?.value
    if (value === null || value === undefined || value.type !== "JSXExpressionContainer" || value.expression.type !== "ArrayExpression") continue
    for (const zone of value.expression.elements) {
      if (zone === null || zone.type !== "ObjectExpression") continue
      const props = zone.properties.filter((property): property is TSESTree.Property => property.type === "Property" && property.key.type === "Identifier")
      const kind = props.find((property) => property.key.type === "Identifier" && property.key.name === "kind")
      if (kind === undefined || kind.value.type !== "Literal" || kind.value.value !== "custom") continue
      const children = props.find((property) => property.key.type === "Identifier" && property.key.name === "children")
      if (children !== undefined) zones.push(children.value)
    }
  }
  return zones
}

/** A body card does not hold what a kind draws: hand rows, a divider, a second title; a custom zone holds none of the typed zones' parts. */
export const surfaceCardKind: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "R355: a SurfaceCard of the body kind holds no hand list, no Divider and no SectionHeader or Heading." },
    schema: [],
    messages: {
      list: "`<{{element}}>` is a hand-built list in a `body` card. Rows are `<SurfaceCard kind=\"list\" items={...} empty={...} />`, and the card draws every row the same way.",
      divider: "A `Divider` in a card is refused: the card draws its own seams. Bands divided by a line are the typed `headers` and `footers` zones: `<SurfaceCard headers={[{ kind: \"figures\", items }]} />`.",
      zone: "`<{{element}}>` stands in a `custom` zone of a card. Filter and search are the typed zones (`{ kind: \"filter\" | \"search\" | \"toolbar\" }`) and the card draws its own seams, so a `custom` zone holds no `Tabs`, `SearchField` or `Divider`.",
      title: "`<{{element}}>` stands as a second title inside a card. The card has a `label` (and `fact`, `labelEnd`, `note`); a sub-section of one subject is a typed header or footer zone.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return {
      JSXElement(element: TSESTree.JSXElement) {
        const opening = element.openingElement
        const component = grammarComponent(context, opening)
        if (component === "SurfaceCard" || component === "Board") {
          for (const content of customZoneChildren(opening)) {
            for (const node of jsxBelow(content)) {
              const inner = grammarComponent(context, node.openingElement)
              if (inner !== null && ZONE_COMPONENTS.has(inner)) context.report({ node: node.openingElement, messageId: "zone", data: { element: inner } })
            }
          }
        }
        if (component === "SurfaceCard" && isBodyCard(opening)) {
          for (const { node } of childElements(element)) {
            const child = node.openingElement
            if (child.name.type === "JSXIdentifier" && HAND_ELEMENTS.has(child.name.name)) {
              context.report({ node: child, messageId: "list", data: { element: child.name.name } })
              continue
            }
            const childComponent = grammarComponent(context, child)
            const rule = childComponent === null ? undefined : HAND_COMPONENTS.get(childComponent)
            if (rule === "divider") context.report({ node: child, messageId: "divider" })
            else if (rule === "title") context.report({ node: child, messageId: "title", data: { element: childComponent ?? "" } })
          }
        }
      },
    }
  },
})

/** A labelled card repeated in a card grid is a tile. */
export const noLabelInGrid: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "R366: a labelled SurfaceCard repeated in a Grid kind=\"cards\" is a tile: it names itself inside." },
    schema: [],
    messages: {
      tile: "A card with a `label` repeated in a `Grid kind=\"cards\"`: the label sits outside the material, so the grid reads as headings over boxes. A peer you recognise and open is `<SurfaceCard kind=\"tile\" name mark description badge action />`, named inside beside its mark. Comparing a fact across peers is a `kind=\"list\"` card.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return {
      JSXElement(element: TSESTree.JSXElement) {
        const opening = element.openingElement
        if (grammarComponent(context, opening) !== "Grid") return
        const kind = attributeOf(opening, "kind")
        if (kind === undefined || staticString(kind.value) !== "cards") return
        const labelled = childElements(element).filter(({ node }) => {
          const card = node.openingElement
          return grammarComponent(context, card) === "SurfaceCard" && attributeOf(card, "label") !== undefined && attributeOf(card, "kind") === undefined
        })
        const repeated = labelled.length >= 2 || labelled.some(({ inMap }) => inMap)
        if (!repeated) return
        for (const { node } of labelled) context.report({ node: node.openingElement, messageId: "tile" })
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "surface-card-kind": surfaceCardKind,
  "no-label-in-grid": noLabelInGrid,
}

defineFamilyRules(rules, "knowledge/hfs/rules.yaml#R355")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
