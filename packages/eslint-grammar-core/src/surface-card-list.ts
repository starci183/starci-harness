import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { grammarName, stringProp } from "./lib/grammar-jsx.ts"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"

/**
 * ONE LOOK FOR A LIST (owner, 2026-11-17, LIST-ONE-LOOK). A list is one thing: `Section kind="list"` of `ListRow`s, plain rows on the
 * surface divided by hairlines and aligned with the section title, with no frame, fill, radius or shadow. A list is never a card;
 * cards stay for real objects. The Grammar family 0.43.0 removed `SurfaceCard kind="list"`, so the compiler refuses it where the types
 * are read; this rule says how to fix it where an app still writes it (a pinned older Grammar, a JavaScript file, an `any` prop).
 *
 * WHAT IT READS. In product source, a Grammar `SurfaceCard` (named or `G.SurfaceCard`) whose `kind` is the literal `"list"`.
 *
 * WHAT IT LEAVES ALONE. A `kind` that is not a literal, another source's `SurfaceCard`, and non-product source.
 *
 * NO AUTOFIX. The move is not one rename: `label` becomes `title`, `labelEnd` becomes `action`, the card's zones (`headers`,
 * `footers`) have no list form (a filter or search is the list's `filter`; figures and a list together are a body card holding both),
 * the import changes, and the look changes from a card to flat rows, which the author should see.
 */

/** `SurfaceCard kind="list"` is refused: the list is `Section kind="list"`. */
export const surfaceCardList: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "LIST-ONE-LOOK: a list is `Section kind=\"list\"` with `ListRow` rows, never `SurfaceCard kind=\"list\"` (removed in the Grammar family 0.43.0)." },
    schema: [],
    messages: {
      list: "`SurfaceCard kind=\"list\"` is removed: a list is never a card. Use `<Section kind=\"list\" title=\"…\" items={rows} empty={…} />` with `ListRow` rows (flat rows divided by hairlines, aligned with the title): `label` becomes `title`, `labelEnd` becomes `action`, a filter or search goes in the list's `filter`, and `layout=\"keyValue\" | \"suggestions\"` stays on the Section.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return {
      JSXOpeningElement(opening: TSESTree.JSXOpeningElement) {
        if (grammarName(context, opening) !== "SurfaceCard") return
        if (stringProp(opening, "kind") !== "list") return
        context.report({ node: opening as never, messageId: "list" })
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "surface-card-list": surfaceCardList,
}

defineFamilyRules(rules, "knowledge/ui/presentation/grammar-laws.yaml#LIST-ONE-LOOK")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
