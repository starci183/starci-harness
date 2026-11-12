import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { attributeOf, grammarName } from "./lib/grammar-jsx.ts"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
import type { Context, Node } from "./lib/types.ts"

/**
 * NO NESTED LABEL (owner, 2026-11-09, LABEL-SUBLABEL-HIERARCHY). A section has exactly ONE Label (its head, 14/500, 12px above its content). The groups nested inside it
 * are named by a Sublabel (12/500 muted, 8px above the card), never by a second Label: a `Section` or `SurfaceCard` inside a labelled one takes `sublabel`, not `title`/`label`.
 *
 * WHAT IT READS. In product source, a Grammar `Section` with a `title` or a `SurfaceCard` with a `label` whose JSX ancestor in the same file is a Grammar `Section` with a
 * `title` or a `SurfaceCard` with a `label`. A Grammar element passed as a JSX attribute value is judged where the receiver draws it.
 *
 * WHAT IT LEAVES ALONE. Nesting across files (a block that returns a labelled card inside a parent's labelled section) and non-product source.
 */

const LABEL_PROP: Readonly<Record<string, string>> = { Section: "title", SurfaceCard: "label" }

/** The Grammar name of the element when it is a Section or SurfaceCard that carries its Label prop, else null. */
const labelOf = (context: Context, opening: TSESTree.JSXOpeningElement): string | null => {
  const name = grammarName(context, opening)
  if (name === null) return null
  const prop = LABEL_PROP[name]
  return prop !== undefined && attributeOf(opening, prop) !== undefined ? name : null
}

const labelledAncestor = (context: Context, opening: TSESTree.JSXOpeningElement): string | null => {
  let previous: Node = opening
  for (let current: Node | null | undefined = opening.parent?.parent; current !== undefined && current !== null; previous = current, current = current.parent) {
    if (current.type === "JSXAttribute") return null
    if (current.type !== "JSXElement" || previous === current.openingElement) continue
    const found = labelOf(context, current.openingElement)
    if (found !== null) return found
  }
  return null
}

/** One Label per section; nested groups use a Sublabel. */
export const noNestedLabel: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "LABEL-SUBLABEL-HIERARCHY: a Section or SurfaceCard inside a labelled Section or SurfaceCard uses `sublabel`, never a second `title`/`label`." },
    schema: [],
    messages: {
      nested: "A `{{name}}` with its own Label stands inside a labelled `{{parent}}`. A section has ONE Label; a group inside it is named by a Sublabel: use `sublabel=\"…\"` instead of `{{prop}}`.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return {
      JSXOpeningElement(opening: TSESTree.JSXOpeningElement) {
        const name = labelOf(context, opening)
        if (name === null) return
        const parent = labelledAncestor(context, opening)
        if (parent === null) return
        context.report({ node: opening as never, messageId: "nested", data: { name, parent, prop: LABEL_PROP[name] ?? "label" } })
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "no-nested-label": noNestedLabel,
}

defineFamilyRules(rules, "knowledge/ui/presentation/grammar-laws.yaml#LABEL-SUBLABEL-HIERARCHY")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
