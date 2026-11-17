import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { grammarName } from "./lib/grammar-jsx.ts"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
import type { Context, Node } from "./lib/types.ts"

/**
 * ROWS IN A SECTION OR AN OBJECT CARD (ROWS-IN-CARD). Key-value rows (`DescriptionList`) and disclosure rows (`DisclosureList`) stand in a `Section`
 * (the facts or the disclosures of a collection, flat on the surface) or in the body of an object card (a `SurfaceCard` of body kind: the facts of ONE
 * object beside its name or a control). A row primitive written bare, with neither around it, is the repeated bug of rows with no head and no place.
 *
 * WHAT IT READS. In product source, a Grammar `DescriptionList` or `DisclosureList` that no `SurfaceCard` or `Section` of the same file encloses. A row
 * primitive passed as a JSX attribute value (`body={<DescriptionList/>}`) is judged where the receiving component draws it.
 *
 * WHAT IT LEAVES ALONE. `ListBox` (a selectable list pane and a menu are navigation, not rows of data: no static signal tells them apart), a row primitive another
 * file wraps (a file whose only job is to return the rows is flagged here: wrap it in the `Section` or the object card in the same file), and non-product source.
 * A card whose ONLY content is the rows is `card-is-object`.
 */

const ROWS: ReadonlySet<string> = new Set(["DescriptionList", "DisclosureList"])
const HOSTS: ReadonlySet<string> = new Set(["SurfaceCard", "Section"])

/** True when the element sits inside a Grammar `Section` or `SurfaceCard` of this file, or inside a JSX attribute (the receiver draws it). */
const isHosted = (context: Context, opening: TSESTree.JSXOpeningElement): boolean => {
  let previous: Node = opening
  for (let current: Node | null | undefined = opening.parent?.parent; current !== undefined && current !== null; previous = current, current = current.parent) {
    if (current.type === "JSXAttribute") return true
    if (current.type !== "JSXElement") continue
    if (previous === current.openingElement) continue
    const name = grammarName(context, current.openingElement)
    if (name !== null && HOSTS.has(name)) return true
  }
  return false
}

/** Key-value and disclosure rows stand in a `Section` or in an object card. */
export const rowsInCard: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "ROWS-IN-CARD: a DescriptionList or DisclosureList stands in a Section or in the body of an object SurfaceCard." },
    schema: [],
    messages: {
      bare: "A `{{name}}` stands with no `Section` or object card around it. Key-value and disclosure rows stand flat in a `Section` (`<Section title ...><DescriptionList isDivided items={...} /></Section>`), or, as the facts of ONE object, in the body of that object's `SurfaceCard`; a plain list of rows is `Section kind=\"list\"`.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return {
      JSXOpeningElement(opening: TSESTree.JSXOpeningElement) {
        const name = grammarName(context, opening)
        if (name === null || !ROWS.has(name)) return
        if (isHosted(context, opening)) return
        context.report({ node: opening as never, messageId: "bare", data: { name } })
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "rows-in-card": rowsInCard,
}

defineFamilyRules(rules, "knowledge/ui/presentation/grammar-laws.yaml#ROWS-IN-CARD")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
