import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"

/**
 * ICONS ARE OUTLINE ONLY (owner, 2026-11-09, ICONS-OUTLINE). Never a filled or solid icon: no `@heroicons/react/16/solid`, `/20/solid` or `/24/solid`
 * (and the same for `@starci/heroicons`' solid sets), no filled glyph, no filled-circle status mark. An icon that STANDS ALONE as the mark of a row, a
 * card, an empty state or a graph step sits in an icon tile (a soft-tone square holding an outline icon); an icon INLINE with text (a status beside a
 * label, a search field, a button start icon, a link arrow, meta) is a plain outline icon at text size with no tile. A status is a tone-coloured outline
 * icon, never a tile.
 *
 * WHAT IT READS. Every import (and `require` of a literal) whose source is a solid icon set: `@heroicons/react/<size>/solid`, `@heroicons/react/solid`, or
 * `@starci/heroicons/<size>/solid`. It applies anywhere, in product source and in packages alike.
 *
 * WHAT IT LEAVES ALONE. The outline sets (`/24/outline`) and any other import.
 */

const SOLID = /^@(?:heroicons\/react|starci\/heroicons)(?:\/(?:16|20|24))?\/solid(?:\/|$)/

/** An icon is outline: a solid icon set is never imported. */
export const outlineIconsOnly: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "ICONS-OUTLINE: icons are outline only; no import from a solid icon set (`@heroicons/react/<size>/solid`)." },
    schema: [],
    messages: {
      solid: "`{{source}}` is a solid icon set. Icons are OUTLINE only: import the same name from `@heroicons/react/24/outline`. A standalone mark of a row, card, empty state or graph step sits in an `IconTile`; an icon inline with text is a plain outline icon, and a status is a tone-coloured outline icon with no tile.",
    },
  },
  create(context) {
    const check = (node: TSESTree.Node, source: unknown): void => {
      if (typeof source === "string" && SOLID.test(source)) context.report({ node: node as never, messageId: "solid", data: { source } })
    }
    return {
      ImportDeclaration(node: TSESTree.ImportDeclaration) {
        check(node.source, node.source.value)
      },
      ExportNamedDeclaration(node: TSESTree.ExportNamedDeclaration) {
        if (node.source !== null && node.source !== undefined) check(node.source, node.source.value)
      },
      ImportExpression(node: TSESTree.ImportExpression) {
        if (node.source.type === "Literal") check(node.source, node.source.value)
      },
      CallExpression(node: TSESTree.CallExpression) {
        const [argument] = node.arguments
        if (node.callee.type === "Identifier" && node.callee.name === "require" && argument?.type === "Literal") check(argument, argument.value)
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "outline-icons-only": outlineIconsOnly,
}

defineFamilyRules(rules, "knowledge/ui/presentation/grammar-laws.yaml#ICONS-OUTLINE")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
