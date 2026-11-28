import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { attributeOf, grammarName } from "./lib/grammar-jsx.ts"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
import type { Context } from "./lib/types.ts"

/**
 * THE TYPE NESTING LAW (TYPE-NESTING, contexts/ui/presentation.md "Nesting and siblings"; DNA-COMMON-TYPE-NESTED-NOT-LARGER and
 * DNA-COMMON-TYPE-LEAD-PAGE-ONLY). Type steps down, or stays equal, as blocks nest: text inside a block is never larger than the
 * block's own heading, and the reading and lead sizes are the page's own narration, never a nested block's.
 *
 * WHAT IT READS, in product source, the part a file states statically:
 *   - `lead`: a Grammar `Text` with a literal `role` of `reading.body`, `reading.title` or `lead` inside a Grammar block that owns a
 *     heading (`Section`, `SurfaceCard`, `Accordion`, `Disclosure`), at any JSX depth, a prop's JSX (`content={…}`) included;
 *   - `level`: a `Section`, `SurfaceCard`, `Accordion` or `Disclosure` with a literal `headingLevel` that is not deeper than the
 *     literal `headingLevel` of the nearest such block around it in the same file (a sub-block heads one level deeper).
 *
 * A computed role or level is not judged. What the source cannot show (a block another file renders around this one, a sibling's
 * drawn size) is measured on the live page by the lesson type probe and the DNA laws.
 */

/** The roles of long reading and of the site's lead line: larger than body, the page's own narration only. */
export const READING_ROLES: readonly string[] = Object.freeze(["reading.body", "reading.title", "lead"])

/** The Grammar blocks that own a heading, and so a type rank their content must not exceed. */
export const HEADED_BLOCKS: ReadonlySet<string> = new Set(["Section", "SurfaceCard", "Accordion", "Disclosure"])

/** A literal string or number of an attribute (`role="x"`, `headingLevel={3}`), or null when absent or computed. */
const literalOf = (attribute: TSESTree.JSXAttribute | undefined): string | number | null => {
  const value = attribute?.value
  if (value === undefined || value === null) return null
  if (value.type === "Literal" && (typeof value.value === "string" || typeof value.value === "number")) return value.value
  if (value.type === "JSXExpressionContainer" && value.expression.type === "Literal") {
    const literal = value.expression.value
    return typeof literal === "string" || typeof literal === "number" ? literal : null
  }
  return null
}

/** The headed Grammar blocks around a node, nearest first. */
const enclosingBlocks = (context: Context, node: TSESTree.Node): TSESTree.JSXOpeningElement[] => {
  const found: TSESTree.JSXOpeningElement[] = []
  for (let at: TSESTree.Node | null | undefined = node.parent; at !== undefined && at !== null; at = at.parent) {
    if (at.type !== "JSXElement" || at.openingElement === node) continue
    const name = grammarName(context, at.openingElement)
    if (name !== null && HEADED_BLOCKS.has(name)) found.push(at.openingElement)
  }
  return found
}

/** Text inside a block never outranks the block's heading; a sub-block heads one level deeper. */
export const typeNesting: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "TYPE-NESTING: the reading and lead roles stand at page level only; a nested block heads one level deeper than the block around it." },
    schema: [],
    messages: {
      lead: "`role=\"{{role}}\"` inside a `{{block}}`: the reading and lead sizes are the page's own narration, and inside a block they draw larger than the block's heading. Use `body` (no role) here; keep `{{role}}` for narration that stands directly on the page.",
      level: "This `{{block}}` heads at level {{level}} inside a `{{outer}}` at level {{outerLevel}}: a block inside another heads one level deeper (`headingLevel={{deeper}}`), so the outline and the type step down together.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return {
      JSXOpeningElement(node: TSESTree.JSXOpeningElement) {
        const name = grammarName(context, node)
        if (name === null) return
        if (name === "Text") {
          const role = literalOf(attributeOf(node, "role"))
          if (typeof role !== "string" || !READING_ROLES.includes(role)) return
          const [nearest] = enclosingBlocks(context, node)
          if (nearest !== undefined) context.report({ node: node as never, messageId: "lead", data: { role, block: grammarName(context, nearest) ?? "block" } })
          return
        }
        if (!HEADED_BLOCKS.has(name)) return
        const level = literalOf(attributeOf(node, "headingLevel"))
        if (typeof level !== "number") return
        const outer = enclosingBlocks(context, node).find((block) => typeof literalOf(attributeOf(block, "headingLevel")) === "number")
        if (outer === undefined) return
        const outerLevel = literalOf(attributeOf(outer, "headingLevel")) as number
        if (level > outerLevel) return
        context.report({
          node: node as never,
          messageId: "level",
          data: { block: name, level: String(level), outer: grammarName(context, outer) ?? "block", outerLevel: String(outerLevel), deeper: String(outerLevel + 1) },
        })
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "type-nesting": typeNesting,
}

defineFamilyRules(rules, "knowledge/ui/presentation/grammar-laws.yaml#TYPE-NESTING")
