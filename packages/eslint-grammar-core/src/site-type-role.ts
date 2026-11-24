import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { classTextVisitors } from "@starci/eslint-canon-fe/lib/class-text.mjs"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
import { isSiteFile } from "./lib/site-scope.ts"

/**
 * THE SITE GROUP (SITE-TYPE-ROLES). The Grammar has five type roles for the public
 * marketing site: `display.hero`, `display.section`, `display.figure`, `lead` and `title.card`. They are the site's and never the
 * console's: a console draws with the ten roles, so a display size there is a second, louder type scale.
 *
 * WHAT IT READS, in product source outside the site (`isSiteFile`: the `Site…`/`Marketing…` owners, the `(site)` route group,
 * `modules/site…`, or the proposed `fe.site` slot):
 *   - `<Text role="display.hero">` (and the other four) with a literal role;
 *   - the public class of one of them in a class string (`starci-type-display-hero`, `starci-type-lead`, `starci-type-title-card`, …).
 *
 * It is one general rule, approved with the group. Unlike `no-raw-type-size` it is not a counting rule: no console uses the group yet.
 * Freestyle regions are not exempt: a display role is a Grammar role, not a raw style.
 */

/** The site group's roles and their public classes (dots as dashes). */
export const SITE_ROLES: readonly string[] = Object.freeze(["display.hero", "display.section", "display.figure", "lead", "title.card"])
const SITE_CLASSES: ReadonlySet<string> = new Set(SITE_ROLES.map((role) => `starci-type-${role.replace(".", "-")}`))
const SITE_CLASS = new RegExp(`(?<![\\w-])(${[...SITE_CLASSES].join("|")})(?![\\w-])`)

const literalRole = (node: TSESTree.JSXAttribute): string | null => {
  const value = node.value
  if (value?.type === "Literal" && typeof value.value === "string") return value.value
  if (value?.type === "JSXExpressionContainer" && value.expression.type === "Literal" && typeof value.expression.value === "string") return value.expression.value
  return null
}

/** A site role (`display.*`, `lead`, `title.card`) is drawn on the public site only. */
export const siteTypeRole: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "SITE-TYPE-ROLES: display.hero, display.section, display.figure, lead and title.card are the public site's roles, never the console's." },
    schema: [],
    messages: {
      role: "`{{role}}` is a role of the public marketing site (the site group), and this file is not the site. A console draws with the ten roles: title.page for a page heading, title.section for a section or card title, figure for a value, body for copy.",
    },
  },
  create(context) {
    const file = context.filename || context.getFilename()
    if (!isProductSource(context) || isSiteFile(context, file)) return {}
    const reported = new Set<TSESTree.Node>()
    const report = (node: TSESTree.Node, role: string): void => {
      if (reported.has(node)) return
      reported.add(node)
      context.report({ node: node as never, messageId: "role", data: { role } })
    }
    const classes = classTextVisitors(context, (node, text) => {
      const found = text === null ? null : SITE_CLASS.exec(text)
      if (found?.[1] !== undefined) report(node, found[1])
    })
    return {
      ...classes,
      JSXAttribute(node: TSESTree.JSXAttribute) {
        classes.JSXAttribute?.(node)
        if (node.name.type !== "JSXIdentifier") return
        if (node.name.name === "role" && node.parent.name.type === "JSXIdentifier" && node.parent.name.name === "Text") {
          const role = literalRole(node)
          if (role !== null && SITE_ROLES.includes(role)) report(node, role)
        }
        // A class expression the static reader cannot follow (`cn("flex", big && "starci-type-lead")`) is read as its source text.
        if ((node.name.name === "className" || node.name.name === "class") && node.value !== null) {
          const found = SITE_CLASS.exec(context.sourceCode.getText(node.value as never))
          if (found?.[1] !== undefined) report(node, found[1])
        }
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "site-type-role": siteTypeRole,
}

defineFamilyRules(rules, "knowledge/ui/presentation/grammar-laws.yaml#SITE-TYPE-ROLES")
