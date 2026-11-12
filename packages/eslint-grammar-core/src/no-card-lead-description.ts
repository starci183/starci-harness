import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { elementNameOf, grammarName, renderedChildren, stringProp } from "./lib/grammar-jsx.ts"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
import type { Context, Node } from "./lib/types.ts"

/**
 * NO CARD LEAD DESCRIPTION (owner, 2026-11-09, CARD-NO-DESCRIPTION). A card head is its label, a count chip, one fact and one end action: it has NO description. The
 * words that explain a card's data go in the card's `note` (a legend, a source, a period); the words that explain a row are that row's own subtitle (`kind="select"`
 * and `kind="list"`). A free-standing muted line placed directly above a card (the title + description + card pattern) is the same description drawn by hand.
 *
 * WHAT IT READS. In product source, a Grammar `Text` with `tone="muted"` that is the sibling written IMMEDIATELY BEFORE a Grammar `SurfaceCard` in the same children list.
 *
 * WHAT IT LEAVES ALONE. A muted `Text` anywhere else (inside a card, between two cards, below a card), a native `<p>`, and any `Text` with another tone: no static signal tells
 * those apart from a legend or a body line, so the rule stays on the one pattern that is certain.
 */

const isMutedText = (context: Context, node: Node): boolean => {
  if (node.type !== "JSXElement") return false
  return grammarName(context, node.openingElement) === "Text" && stringProp(node.openingElement, "tone") === "muted"
}

const isCard = (context: Context, node: Node | undefined): boolean =>
  node !== undefined && node.type === "JSXElement" && elementNameOf(node) !== null && grammarName(context, node.openingElement) === "SurfaceCard"

/** No free-standing description line directly above a SurfaceCard. */
export const noCardLeadDescription: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "CARD-NO-DESCRIPTION: a card has no lead description; the line goes in a row subtitle or the card `note`." },
    schema: [],
    messages: {
      lead: "A muted `Text` stands directly above a `SurfaceCard` as its description. A card has no description: put the line in the row subtitle (`kind=\"select\"` or `kind=\"list\"`) or, if it explains the card's data (a legend, a source, a period), in the card `note`.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    const check = (children: readonly TSESTree.JSXChild[]): void => {
      const rendered = renderedChildren(children)
      rendered.forEach((child, index) => {
        if (!isMutedText(context, child)) return
        if (!isCard(context, rendered[index + 1])) return
        context.report({ node: child as never, messageId: "lead" })
      })
    }
    return {
      JSXElement(node: TSESTree.JSXElement) { check(node.children) },
      JSXFragment(node: TSESTree.JSXFragment) { check(node.children) },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "no-card-lead-description": noCardLeadDescription,
}

defineFamilyRules(rules, "knowledge/ui/presentation/grammar-laws.yaml#CARD-NO-DESCRIPTION")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
