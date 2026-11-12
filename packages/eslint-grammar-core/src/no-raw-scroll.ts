import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"

/**
 * Grammar never shows scrollbars (owner, 2026-11-09, OVERFLOW-6). Every scroll area is drawn by Grammar, which hides the bar and
 * fades the edge where content continues (HeroUI's ScrollShadow behaviour). An app element that makes its own scroll area with
 * an `overflow-y-auto` / `overflow-auto` class (or the `-x-`, `-scroll` forms) has no such edge and, in a browser that draws bars, shows one.
 *
 * WHAT IT READS. The `className` / `class` attribute of an element in product source: every string in it, a template literal's
 * text included, with any variant prefix (`md:overflow-y-auto`).
 *
 * WHAT IT LEAVES ALONE. `overflow-hidden`, `overflow-clip`, `overflow-visible`, a class that only shares a prefix, and non-product source
 * (Grammar's own sources are not product source).
 */

/** `overflow-auto`, `overflow-y-auto`, `overflow-x-scroll` and the like, not part of a longer class name. */
const RAW_SCROLL = /(?<![\w-])overflow-(?:[xy]-)?(?:auto|scroll)(?![\w-])/

/** An app scroll area is drawn by Grammar's scroller, never by an `overflow-*-auto` class on the app's own element. */
export const noRawScroll: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "OVERFLOW-6: Grammar never shows scrollbars; a scroll area is a Grammar scroller or `PaneSection scroll`, not an `overflow-y-auto` class." },
    schema: [],
    messages: {
      raw: "`{{token}}` makes a scroll area outside Grammar. Grammar never shows scrollbars: every scroll area fades its edge where content continues and hides the bar. Use the Grammar scroller (`VerticalScrollRegion`, `HorizontalScrollRegion`) or `PaneSection scroll`, which keep wheel and keyboard scrolling.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return {
      JSXAttribute(node: TSESTree.JSXAttribute) {
        if (node.name.type !== "JSXIdentifier" || (node.name.name !== "className" && node.name.name !== "class")) return
        if (node.value === null) return
        const match = RAW_SCROLL.exec(context.sourceCode.getText(node.value as never))
        if (match !== null) context.report({ node: node as never, messageId: "raw", data: { token: match[0] } })
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "no-raw-scroll": noRawScroll,
}

defineFamilyRules(rules, "knowledge/ui/presentation/grammar-laws.yaml#NO-RAW-SCROLL")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
