import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
/**
 * The rule that holds the one-way-to-choose law (HFS R380, `FE_GROUPED_CHOICE_CONTROL`): the Grammar draws no group of
 * attached buttons. Choosing among a few is one component by meaning: `Tabs` to switch a view or filter a list, `ChoiceChips`
 * or `RadioGroup` to choose a value of a form, separate `Button`s or a `DropdownMenu` for actions, and the Calendar and
 * `ChoiceChips` for a date and a time.
 *
 * WHAT IT READS. A JSX element named `ButtonGroup`, `FilterButtonGroup` or `SegmentedControl` in product source, written
 * bare or as a member (`Grammar.ButtonGroup`). The components stay exported and deprecated for one release.
 *
 * A second rule holds the same law for loose buttons: two or more adjacent `Button` or `IconButton` elements (or one written in a
 * `.map`) that carry `aria-pressed`, `isSelected` or `isActive` are joined buttons acting as tabs, a pill toggle ("This month / Last
 * month"). A switch between views or periods of one block is `Tabs` (the primary underline) in the block's `filter` header zone;
 * `ChoiceChips` or `RadioGroup` choose a form value; a button holds a command, never a selection state.
 */

/** Each banned component with the replacement its message names. */
export const REPLACEMENTS: Readonly<Record<string, string>> = {
  ButtonGroup: "separate `Button`s (one commit, the rest alternative or dismiss), or a `DropdownMenu` for the overflow",
  FilterButtonGroup: "`Tabs kind=\"filter\"` (compact underline tabs with a `count` each, under the list's search field) to narrow a list that stays in place",
  SegmentedControl: "`ChoiceChips` or `RadioGroup` to choose a value of a form, or `Tabs appearance=\"primary\"` (a `switch` header zone) to switch a mode or period of one block",
}

/** The element name of a JSX opening element (`ButtonGroup`, or `Grammar.ButtonGroup` as `ButtonGroup`). */
const elementName = (opening: TSESTree.JSXOpeningElement): string | null => {
  const name = opening.name
  if (name.type === "JSXIdentifier") return name.name
  if (name.type === "JSXMemberExpression") return name.property.name
  return null
}

/** No ButtonGroup, FilterButtonGroup or SegmentedControl in product source. */
export const noGroupedChoiceControls: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "R380: no ButtonGroup, FilterButtonGroup or SegmentedControl; choose by meaning (Tabs, ChoiceChips, RadioGroup, separate Buttons, DropdownMenu)." },
    schema: [],
    messages: {
      grouped: "`{{component}}` is deprecated: the Grammar draws no group of attached buttons, because a few choices have exactly one component by meaning. Use {{replacement}}.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return {
      JSXOpeningElement(opening) {
        const component = elementName(opening)
        if (component === null) return
        const replacement = REPLACEMENTS[component]
        if (replacement === undefined) return
        context.report({ node: opening, messageId: "grouped", data: { component, replacement } })
      },
    }
  },
})

/** The buttons whose pressed or selected state makes a set of them a switch. */
const BUTTON_COMPONENTS = new Set(["Button", "IconButton"])
const SELECTION_ATTRIBUTES = new Set(["aria-pressed", "isSelected", "isActive"])

/** Whether an opening element is a Button or IconButton carrying a selection attribute. */
const isSelectionButton = (opening: TSESTree.JSXOpeningElement): boolean => {
  const name = elementName(opening)
  if (name === null || !BUTTON_COMPONENTS.has(name)) return false
  return opening.attributes.some((attribute) => attribute.type === "JSXAttribute" && attribute.name.type === "JSXIdentifier" && SELECTION_ATTRIBUTES.has(attribute.name.name))
}

type Candidate = { readonly opening: TSESTree.JSXOpeningElement; readonly inMap: boolean }

/** The selection buttons a child position renders, read through conditionals, `&&` and `.map`. */
const selectionButtonsOf = (node: TSESTree.Node | null | undefined, inMap = false): Candidate[] => {
  if (node === null || node === undefined) return []
  switch (node.type) {
    case "JSXElement":
      return isSelectionButton(node.openingElement) ? [{ opening: node.openingElement, inMap }] : []
    case "JSXFragment":
      return node.children.flatMap((child) => selectionButtonsOf(child, inMap))
    case "JSXExpressionContainer":
      return selectionButtonsOf(node.expression, inMap)
    case "ConditionalExpression":
      return [...selectionButtonsOf(node.consequent, inMap), ...selectionButtonsOf(node.alternate, inMap)]
    case "LogicalExpression":
      return node.operator === "&&" ? selectionButtonsOf(node.right, inMap) : [...selectionButtonsOf(node.left, inMap), ...selectionButtonsOf(node.right, inMap)]
    case "CallExpression": {
      const callee = node.callee
      const method = callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier" ? callee.property.name : null
      const callback = node.arguments[0]
      if (method !== "map" || callback === undefined || (callback.type !== "ArrowFunctionExpression" && callback.type !== "FunctionExpression")) return []
      if (callback.body.type !== "BlockStatement") return selectionButtonsOf(callback.body, true)
      return callback.body.body.flatMap((statement) => (statement.type === "ReturnStatement" ? selectionButtonsOf(statement.argument, true) : []))
    }
    default:
      return []
  }
}

/** No joined buttons acting as tabs: two or more Buttons carrying a selection state are a view switch. */
export const noButtonViewSwitch: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "R380: no row of Buttons carrying aria-pressed, isSelected or isActive as a view switch; a switch between views or periods is Tabs in the block's filter header zone." },
    schema: [],
    messages: {
      switch: "Buttons that carry `{{attribute}}` side by side are a view switch drawn as joined buttons or pills. Switching between views or periods of one block is `Tabs` (the primary underline) in the block's `filter` header zone; choosing a form value is `ChoiceChips` or `RadioGroup`; a `Button` holds a command, never a selection state.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return {
      JSXElement(element: TSESTree.JSXElement) {
        const found = element.children.flatMap((child) => selectionButtonsOf(child))
        if (found.length < 2 && !found.some(({ inMap }) => inMap)) return
        for (const { opening } of found) {
          const attribute = opening.attributes.find((entry) => entry.type === "JSXAttribute" && entry.name.type === "JSXIdentifier" && SELECTION_ATTRIBUTES.has(entry.name.name))
          const named = attribute !== undefined && attribute.type === "JSXAttribute" && attribute.name.type === "JSXIdentifier" ? attribute.name.name : "aria-pressed"
          context.report({ node: opening, messageId: "switch", data: { attribute: named } })
        }
      },
    }
  },
})

/** The item keys a primary tab never carries: a count, an attention mark or a destination. */
const PRIMARY_FORBIDDEN_KEYS = new Set(["count", "href", "isAttention"])

/** The static `items` array of a primary strip, or null when it is not an array literal. */
const itemsArrayOf = (value: TSESTree.Node | null | undefined): TSESTree.ArrayExpression | null => {
  if (value === null || value === undefined) return null
  const expression = value.type === "JSXExpressionContainer" ? value.expression : value
  return expression.type === "ArrayExpression" ? expression : null
}

/** Whether an object literal has `kind: "<literal>"`. */
const hasKind = (object: TSESTree.ObjectExpression, literal: string): boolean =>
  object.properties.some((property) => property.type === "Property" && property.key.type === "Identifier" && property.key.name === "kind" && property.value.type === "Literal" && property.value.value === literal)

/** Primary tabs (a pill in a track) switch a mode or period: 2 to 4 short fixed options, no count, no destination. */
export const noPrimaryTabsMisuse: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "R380: Tabs appearance=\"primary\" (and the switch header zone) hold two to four short, fixed options with no count, no href and no attention mark; views, filters and navigation are the secondary underline tabs." },
    schema: [],
    messages: {
      primary: "Primary tabs (a pill in a track) switch a mode or period of the same data among two to four short, fixed options: {{problem}}. Views, filters with counts and destinations are the secondary (underline) `Tabs`.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    const check = (items: TSESTree.ArrayExpression | null, node: TSESTree.Node) => {
      if (items === null) return
      const problems: string[] = []
      if (items.elements.length > 4) problems.push(`${String(items.elements.length)} items`)
      if (items.elements.length === 1) problems.push("one item")
      for (const element of items.elements) {
        if (element === null || element.type !== "ObjectExpression") continue
        for (const property of element.properties) {
          if (property.type === "Property" && property.key.type === "Identifier" && PRIMARY_FORBIDDEN_KEYS.has(property.key.name)) problems.push(`an item with \`${property.key.name}\``)
        }
      }
      if (problems.length > 0) context.report({ node, messageId: "primary", data: { problem: [...new Set(problems)].join(", ") } })
    }
    return {
      JSXOpeningElement(opening) {
        if (elementName(opening) !== "Tabs") return
        const appearance = opening.attributes.find((entry) => entry.type === "JSXAttribute" && entry.name.type === "JSXIdentifier" && entry.name.name === "appearance")
        if (appearance === undefined || appearance.type !== "JSXAttribute" || appearance.value === null) return
        const value = appearance.value.type === "JSXExpressionContainer" ? appearance.value.expression : appearance.value
        if (value.type !== "Literal" || value.value !== "primary") return
        const items = opening.attributes.find((entry) => entry.type === "JSXAttribute" && entry.name.type === "JSXIdentifier" && entry.name.name === "items")
        check(items !== undefined && items.type === "JSXAttribute" ? itemsArrayOf(items.value) : null, opening)
      },
      ObjectExpression(object) {
        if (!hasKind(object, "switch")) return
        const items = object.properties.find((property): property is TSESTree.Property => property.type === "Property" && property.key.type === "Identifier" && property.key.name === "items")
        check(items === undefined ? null : itemsArrayOf(items.value), object)
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "no-grouped-choice-controls": noGroupedChoiceControls,
  "no-button-view-switch": noButtonViewSwitch,
  "no-primary-tabs-misuse": noPrimaryTabsMisuse,
}

defineFamilyRules(rules, "knowledge/hfs/rules.yaml#R380")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
