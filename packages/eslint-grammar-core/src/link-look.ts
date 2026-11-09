import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { attributeOf, grammarName } from "./lib/grammar-jsx.ts"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"

/**
 * THE LINK LOOK (owner, 2026-11-09, LINK-LOOK). Grammar's `Link` is HeroUI v3's own link: the primary colour, the underline on hover only
 * and the anchor icon at the end of its label. Its type size and leading are INHERITED from the line it stands in (14 in a body, 12 in
 * meta or caption text). An app never restyles it.
 *
 * WHAT IT READS. A Grammar `Link` (imported from `@starci/grammar`) in product source with:
 *   - a `size` prop;
 *   - a `className` / `class` attribute that holds a text-size utility (`text-sm`, `text-[13px]`), a weight or leading utility is left
 *     to the raw-class laws, or an `underline` / `no-underline` / `decoration-*` utility.
 *
 * WHAT IT LEAVES ALONE. A `Link` with neither, other elements, and non-product source.
 */

const TEXT_SIZE = /(?<![\w-])(?:[\w[\]&>*:-]+:)?text-(?:xs|sm|base|md|lg|[2-9]?xl|\[[^\]]+\])(?![\w-])/
const UNDERLINE = /(?<![\w-])(?:[\w[\]&>*:-]+:)?(?:underline|no-underline|decoration-[\w[\]./-]+|underline-offset-[\w[\]./-]+)(?![\w-])/

/** A Grammar Link takes its size from the line and its underline from the vendor: no size prop, no size, underline or decoration class. */
export const linkLook: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "LINK-LOOK: a Link inherits its size from the line and keeps HeroUI's hover underline and anchor icon; no size prop, size class or underline class." },
    schema: [],
    messages: {
      size: "A `Link` takes no `size`: it inherits the type size of the line it stands in (14 in a body, 12 in meta or caption text). Remove the prop and put the link in a `Text` of the size you want.",
      class: "A `Link` is HeroUI's own link: the primary colour, the underline on hover only, the anchor icon at the end, the size of the line around it. Remove `{{token}}` from its class; the app never restyles a Link.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return {
      JSXOpeningElement(opening: TSESTree.JSXOpeningElement) {
        if (grammarName(context, opening) !== "Link") return
        const size = attributeOf(opening, "size")
        if (size !== undefined) context.report({ node: size as never, messageId: "size" })
        for (const name of ["className", "class"]) {
          const attribute = attributeOf(opening, name)
          if (attribute === undefined || attribute.value === null) continue
          const text = context.sourceCode.getText(attribute.value as never)
          const found = TEXT_SIZE.exec(text) ?? UNDERLINE.exec(text)
          if (found !== null) context.report({ node: attribute as never, messageId: "class", data: { token: found[0].replace(/^.*:/, "") } })
        }
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "link-look": linkLook,
}

defineFamilyRules(rules, "knowledge/ui/presentation/grammar-laws.yaml#LINK-LOOK")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
