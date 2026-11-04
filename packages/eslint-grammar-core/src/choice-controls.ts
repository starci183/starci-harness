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
 */

/** Each banned component with the replacement its message names. */
export const REPLACEMENTS: Readonly<Record<string, string>> = {
  ButtonGroup: "separate `Button`s (one commit, the rest alternative or dismiss), or a `DropdownMenu` for the overflow",
  FilterButtonGroup: "`Tabs kind=\"filter\"` (compact underline tabs with a `count` each, under the list's search field) to narrow a list that stays in place",
  SegmentedControl: "`ChoiceChips` or `RadioGroup` to choose a value of a form, or `Tabs` only to switch a view",
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

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "no-grouped-choice-controls": noGroupedChoiceControls,
}

defineFamilyRules(rules, "knowledge/hfs/rules.yaml#R380")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
