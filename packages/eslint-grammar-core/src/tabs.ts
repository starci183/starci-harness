import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
/**
 * The Tabs laws (`contexts/ui/components/tabs.md`, owner-approved 2026-11-09): where the pill stands, and how many
 * underline layers a page stacks.
 *
 * `tabs-switch-zone`. The pill (`Tabs appearance="primary"`) is a mode or period switch of one block. The Grammar draws it
 * only as the `switch` header zone of a `SurfaceCard` (`headers={[{ kind: "switch", label, items, selectedKey, onSelect }]}`);
 * a `<Tabs appearance="primary">` written in JSX (a page body, under the page tabs, a pane, a drawer) is a finding. The
 * item checks (two to four, no count, no href) stay in `no-primary-tabs-misuse`.
 *
 * `tabs-depth`. A page stacks at most two underline layers: the page tabs (`Page header.tabs`) and one region set. A `Tabs`
 * is nested in another when it stands in the panel the other selects: inside a conditional or `&&` whose test reads the
 * other's `selectedKey`, or, for page tabs, in the children of a `Page` whose `header` carries `tabs`. A drawer, dialog,
 * modal, popover or sheet starts its own surface and ends the climb. Every tab is one size, so a layer's size is not judged; only the count is.
 */

/** The element name of a JSX opening element (`Tabs`, or `Grammar.Tabs` as `Tabs`). */
const elementName = (opening: TSESTree.JSXOpeningElement): string | null => {
  const name = opening.name
  if (name.type === "JSXIdentifier") return name.name
  if (name.type === "JSXMemberExpression") return name.property.name
  return null
}

/** The attribute of an opening element by name, or undefined. */
const attributeOf = (opening: TSESTree.JSXOpeningElement, name: string): TSESTree.JSXAttribute | undefined =>
  opening.attributes.find((entry): entry is TSESTree.JSXAttribute => entry.type === "JSXAttribute" && entry.name.type === "JSXIdentifier" && entry.name.name === name)

/** The string literal an attribute passes (`kind="filter"` or `kind={"filter"}`), or null when it is absent or dynamic. */
const literalOf = (attribute: TSESTree.JSXAttribute | undefined): string | null => {
  if (attribute === undefined || attribute.value === null) return null
  const value = attribute.value.type === "JSXExpressionContainer" ? attribute.value.expression : attribute.value
  return value.type === "Literal" && typeof value.value === "string" ? value.value : null
}

/** Whether a `Tabs` element draws the pill. */
const isPill = (opening: TSESTree.JSXOpeningElement): boolean => literalOf(attributeOf(opening, "appearance")) === "primary"

/** No pill in JSX: the pill is the `switch` header zone of a card. */
export const tabsSwitchZone: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "A pill (Tabs appearance=\"primary\") stands only as the switch header zone of a SurfaceCard; written in JSX anywhere else it is a finding.",
      url: "knowledge/ui/presentation/grammar-laws.yaml#TABS-SWITCH-ZONE",
    },
    schema: [],
    messages: {
      pill: "A pill (`Tabs appearance=\"primary\"`) switches a mode or period of one block and is drawn only as the `switch` header zone of its card: `headers={[{ kind: \"switch\", label, items, selectedKey, onSelect }]}`, two to four short options with no count and no href. Written here it stands loose in the page. Views of a page are page tabs (`Page header.tabs`); views or filters inside a region are underline `Tabs`.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return {
      JSXOpeningElement(opening) {
        if (elementName(opening) !== "Tabs" || !isPill(opening)) return
        context.report({ node: opening, messageId: "pill" })
      },
    }
  },
})

/** A boundary that starts its own surface: the page tabs above it are not its parent layer. */
const SURFACE_BOUNDARIES: ReadonlySet<string> = new Set(["Drawer", "Dialog", "Modal", "Popover", "Sheet"])

type Underline = {
  readonly opening: TSESTree.JSXOpeningElement
  /** The source text of its `selectedKey`, or null. */
  readonly key: string | null
}

/** Whether a source text reads a name as a whole word or member chain (`view` in `view === "a"`, not in `preview`). */
const reads = (text: string, name: string): boolean => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(?<![\\w$.])${escaped}(?![\\w$])`).test(text)
}

/** Whether a `Page` element's `header` passes an object literal that carries `tabs`. */
const pageHasHeaderTabs = (page: TSESTree.JSXElement): boolean => {
  const header = attributeOf(page.openingElement, "header")
  const value = header?.value?.type === "JSXExpressionContainer" ? header.value.expression : null
  return value?.type === "ObjectExpression" && value.properties.some((property) => property.type === "Property" && property.key.type === "Identifier" && property.key.name === "tabs")
}

/** At most two underline layers. */
export const tabsDepth: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "A page stacks at most two underline Tabs layers (page tabs and one region set).",
      url: "knowledge/ui/presentation/grammar-laws.yaml#TABS-DEPTH",
    },
    schema: [],
    messages: {
      depth: "This underline `Tabs` is layer {{layers}} ({{chain}}). A page stacks at most two underline layers: the page tabs (`Page header.tabs`) and one region set inside a tab's panel. Fold the third level into a `switch` zone, a filter zone of a card, a list, or a drawer.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    const underlines: Underline[] = []
    return {
      JSXOpeningElement(opening) {
        if (elementName(opening) !== "Tabs" || isPill(opening)) return
        const key = attributeOf(opening, "selectedKey")
        const expression = key?.value?.type === "JSXExpressionContainer" ? key.value.expression : null
        const readable = expression !== null && expression.type !== "JSXEmptyExpression" && expression.type !== "Literal"
        underlines.push({ opening, key: readable ? context.sourceCode.getText(expression) : null })
      },
      "Program:exit"() {
        for (const current of underlines) {
          const owners = new Set<Underline>()
          let pageTabs = false
          let child: TSESTree.Node = current.opening
          for (let node: TSESTree.Node | null | undefined = child.parent; node !== undefined && node !== null; child = node, node = node.parent) {
            if (node.type === "JSXElement") {
              const name = elementName(node.openingElement)
              if (name !== null && SURFACE_BOUNDARIES.has(name)) break
              if (name === "Page" && node.children.includes(child as TSESTree.JSXChild) && pageHasHeaderTabs(node)) pageTabs = true
              continue
            }
            let test: TSESTree.Node | null = null
            if (node.type === "ConditionalExpression" && child !== node.test) test = node.test
            else if (node.type === "LogicalExpression" && node.operator === "&&" && child === node.right) test = node.left
            else if (node.type === "SwitchCase" && node.parent.type === "SwitchStatement" && node.consequent.includes(child as TSESTree.Statement)) test = node.parent.discriminant
            if (test === null) continue
            const text = context.sourceCode.getText(test)
            for (const other of underlines) if (other !== current && other.key !== null && reads(text, other.key)) owners.add(other)
          }
          const layers = owners.size + 1 + (pageTabs ? 1 : 0)
          if (layers < 2) continue
          const chain = `${pageTabs ? "page tabs, " : ""}${owners.size > 0 ? `${String(owners.size)} enclosing set${owners.size > 1 ? "s" : ""}, ` : ""}this set`
          if (layers > 2) context.report({ node: current.opening, messageId: "depth", data: { layers: String(layers), chain } })
        }
      },
    }
  },
})

/** The pink well and the panes: underline Tabs written in their children sit on the well, not in the white header band. */
const WELL_HOSTS: ReadonlySet<string> = new Set(["Page", "Pane", "PaneSection"])

/**
 * The second tab layer stands in the white header band (owner, 2026-11-09, TABS-IN-WELL): `Page header={{ tabs, subTabs }}`, on its own
 * full-width separator, flush with the band's left inset. An underline `Tabs` written as a child of a `Page`, `Pane` or `PaneSection`
 * stands on the pink well or in a pane body, so it is a finding. A drawer, dialog, modal, popover or sheet starts its own surface.
 */
export const tabsInWell: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "An underline Tabs stands in the white header band (Page header.subTabs), never in the pink well or a pane body.",
      url: "knowledge/ui/presentation/grammar-laws.yaml#TABS-IN-WELL",
    },
    schema: [],
    messages: {
      well: "This underline `Tabs` stands in the body of a `{{host}}`, on the pink well or in a pane. The second tab layer sits in the white header band under the page tabs: `Page header` with `subTabs`, on its own full-width separator and flush with the band left inset. Move it to `header.subTabs`, or make the views a `switch` zone or a filter zone of a card.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return {
      JSXOpeningElement(opening) {
        if (elementName(opening) !== "Tabs" || isPill(opening)) return
        let child: TSESTree.Node = opening.parent ?? opening
        for (let node: TSESTree.Node | null | undefined = child.parent; node !== undefined && node !== null; child = node, node = node.parent) {
          if (node.type !== "JSXElement") continue
          const name = elementName(node.openingElement)
          if (name === null) continue
          if (SURFACE_BOUNDARIES.has(name) || name === "SurfaceCard") return
          if (WELL_HOSTS.has(name) && node.children.includes(child as TSESTree.JSXChild)) {
            context.report({ node: opening, messageId: "well", data: { host: name } })
            return
          }
        }
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "tabs-switch-zone": tabsSwitchZone,
  "tabs-depth": tabsDepth,
  "tabs-in-well": tabsInWell,
}

defineFamilyRules(rules, "knowledge/ui/presentation/grammar-laws.yaml#TABS-SWITCH-ZONE")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
