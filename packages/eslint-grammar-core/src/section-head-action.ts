import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { attributeOf, grammarName } from "./lib/grammar-jsx.ts"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
import type { Context } from "./lib/types.ts"

/**
 * THE SECTION HEAD (owner, 2026-11-09, SECTION-HEAD-ACTION). A section's head is ONE row: the label (14, 500) and an optional count chip at the
 * start, and at the end at most ONE thing: a navigation `Link variant="head"` (the label then an arrow that slides on hover) or an info
 * `IconButton`. Navigation is a Link, never a Button, and the head never holds two commands.
 *
 * WHAT IT READS. A Grammar `Section` in product source whose `action` prop holds:
 *   - a Grammar `Button` (message `button`): navigation is a `Link variant="head"`;
 *   - more than one Grammar `Button`, `Link`, `IconButton` or `TextAction` (message `many`): the head has room for one.
 *
 * WHAT IT LEAVES ALONE. A `Section` with no `action`, an `action` that holds one Link or one IconButton, other components, and non-product source.
 */

const COMMANDS: ReadonlySet<string> = new Set(["Button", "Link", "IconButton", "TextAction"])

type Found = { readonly name: string; readonly node: TSESTree.JSXOpeningElement }

/** Every Grammar command element an expression holds, in source order. */
const commandsIn = (context: Context, root: unknown): Found[] => {
  const found: Found[] = []
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object") return
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry)
      return
    }
    const node = value as { type?: string; [key: string]: unknown }
    if (typeof node.type !== "string") return
    if (node.type === "JSXOpeningElement") {
      const opening = node as unknown as TSESTree.JSXOpeningElement
      const name = grammarName(context, opening)
      if (name !== null && COMMANDS.has(name)) found.push({ name, node: opening })
    }
    for (const [key, child] of Object.entries(node)) if (key !== "parent" && key !== "loc" && key !== "range") visit(child)
  }
  visit(root)
  return found
}

/** A section head holds one navigation Link or one info IconButton: no Button, no second command. */
export const sectionHeadAction: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "SECTION-HEAD-ACTION: a Section's head action is one Link variant=\"head\" or one IconButton; never a Button, never more than one." },
    schema: [],
    messages: {
      button: "A `Button` in a `Section` head `action`: the head's navigation is a `Link variant=\"head\"` (the label then a sliding arrow). A command that is not navigation belongs in the card or the page header.",
      many: "A `Section` head holds at most ONE thing at its end (a `Link variant=\"head\"` or an info `IconButton`); this `action` holds {{count}} commands. Keep the one that navigates and move the rest into the body.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return {
      JSXOpeningElement(opening: TSESTree.JSXOpeningElement) {
        if (grammarName(context, opening) !== "Section") return
        const action = attributeOf(opening, "action")
        if (action === undefined || action.value === null) return
        const commands = commandsIn(context, action.value)
        for (const command of commands) if (command.name === "Button") context.report({ node: command.node as never, messageId: "button" })
        if (commands.length > 1) context.report({ node: action as never, messageId: "many", data: { count: String(commands.length) } })
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "section-head-action": sectionHeadAction,
}

defineFamilyRules(rules, "knowledge/ui/presentation/grammar-laws.yaml#SECTION-HEAD-ACTION")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
