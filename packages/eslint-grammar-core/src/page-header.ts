import type { Rule } from "eslint"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { refuseGrammarExports } from "./lib/grammar-imports.ts"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
/**
 * The rule that holds the page header law (HFS R323, `FE_PAGE_HEADER_HAND_ROLLED`): a page is headed by Grammar's `Page`,
 * whose `header` is the band. `PageHeader` and `Breadcrumbs` are Page's own parts and are not exported; a page head
 * composed from them by hand has no band, no top inset and no separator, and every page re-decides its spacing.
 *
 * WHAT IT READS. The imports of a file: a `PageHeader` or `Breadcrumbs` imported from `@starci/grammar` (by name, or
 * as a member of a namespace import) is the finding. The law is the export that is gone, so it reads nothing else.
 */

/** The Grammar exports that are Page's parts and no longer public. */
export const PAGE_HEAD_PARTS: ReadonlySet<string> = new Set(["PageHeader", "Breadcrumbs"])

/** A page head is Page `header`, never `PageHeader` or `Breadcrumbs` reached for by hand. */
export const noHandRolledPageHeader: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "R323: a page head is Page header (title, breadcrumbs, slots), never PageHeader or Breadcrumbs imported by hand." },
    schema: [],
    messages: {
      handRolled:
        "`{{name}}` is a part of `Page`, not an export to compose: a head built from it has no band, no top inset and no separator, and each page re-decides its spacing. Pass the head as `header` of `Page`: `{ breadcrumbs, title, description, meta, status, mark, actions, tabs }`.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return refuseGrammarExports(PAGE_HEAD_PARTS, ({ node, name }) => { context.report({ node, messageId: "handRolled", data: { name } }) })
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "no-hand-rolled-page-header": noHandRolledPageHeader,
}

defineFamilyRules(rules, "knowledge/hfs/rules.yaml#R323")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
