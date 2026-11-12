import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { attributeOf, grammarName, literalString } from "./lib/grammar-jsx.ts"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
import type { Context } from "./lib/types.ts"

/**
 * THE SECTION HEAD (owner, 2026-11-09, SECTION-HEAD-ACTION). A section's head is ONE row: the label (14, 500) and an optional count chip at the
 * start, and at the end at most ONE thing: a navigation `Link variant="head"` (the label then an arrow that slides on hover), an info `IconButton`,
 * or (0.37.25) a neutral small `Button` ("Gắn thêm provider"). The head never holds two commands.
 *
 * WHAT IT READS. A Grammar `Section` in product source whose `action` prop holds:
 *   - a Grammar `Button` that is not exactly `intent="neutral" size="sm"` (message `button`: a primary/commit or any other size is refused);
 *   - a `Button` that carries an icon (`startGlyph`, `startContent`, `endContent`, `icon`; message `icon`);
 *   - more than one Grammar `Button`, `Link`, `IconButton` or `TextAction` (message `many`): the head has room for one.
 *
 * WHAT IT LEAVES ALONE. A `Section` with no `action`, an `action` that holds one Link, one IconButton or one neutral sm text Button, other components, and non-product source.
 */

const COMMANDS: ReadonlySet<string> = new Set(["Button", "Link", "IconButton", "TextAction"])
const ICON_PROPS = ["startGlyph", "startContent", "endContent", "icon", "iconSource"] as const

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

/** A section head holds one navigation Link, one info IconButton or one neutral small Button: no commit, no icon Button, no second command. */
export const sectionHeadAction: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "SECTION-HEAD-ACTION: a Section's head action is one Link variant=\"head\", one IconButton or one neutral sm Button; never a commit Button, never more than one." },
    schema: [],
    messages: {
      button: "A `Button` in a `Section` head `action` must be `intent=\"neutral\" size=\"sm\"` (a small quiet pill at the end of the label row); a primary or commit Button spends the view's one CTA, and another size breaks the head's 32px row. Navigation can also be a `Link variant=\"head\"`.",
      icon: "A `Button` in a `Section` head `action` has no icon (`{{prop}}`): the head's neutral sm Button is text only.",
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
        for (const command of commands) {
          if (command.name !== "Button") continue
          const isNeutralSmall = literalString(attributeOf(command.node, "intent")) === "neutral" && literalString(attributeOf(command.node, "size")) === "sm"
          if (!isNeutralSmall) context.report({ node: command.node as never, messageId: "button" })
          const icon = ICON_PROPS.find((name) => attributeOf(command.node, name) !== undefined)
          if (icon !== undefined) context.report({ node: command.node as never, messageId: "icon", data: { prop: icon } })
        }
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
