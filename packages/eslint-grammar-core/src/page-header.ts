import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
/**
 * The rule that holds the page header law (HFS R323, `FE_PAGE_HEADER_HAND_ROLLED`): a page is headed by Grammar's
 * `PageHeader`. A page head composed by hand from a `Breadcrumbs` trail and a `SectionHeader` has no band, no top
 * inset and no separator, and every page re-decides its spacing, so the heads of an app drift apart.
 *
 * WHAT IT READS. The children of one JSX element or fragment. A `Breadcrumbs` element followed, among the same parent's
 * element children, by a `SectionHeader` element is the hand-rolled head: the trail and the heading of one page, which
 * is exactly what `PageHeader` composes. A `Breadcrumbs` and a `SectionHeader` in different parents, a `SectionHeader`
 * before the trail, or either alone are not judged: a region's `SectionHeader` under the page head stays legal.
 */

/** The element name of a JSX opening element (`SectionHeader`, or `Grammar.SectionHeader` as `SectionHeader`). */
const elementName = (child: TSESTree.JSXChild): string | null => {
  if (child.type !== "JSXElement") return null
  const name = child.openingElement.name
  if (name.type === "JSXIdentifier") return name.name
  if (name.type === "JSXMemberExpression") return name.property.name
  return null
}

/** The `SectionHeader` that follows a `Breadcrumbs` among the element children, or null. */
export const handRolledHead = (children: readonly TSESTree.JSXChild[]): TSESTree.JSXElement | null => {
  let trail = false
  for (const child of children) {
    const name = elementName(child)
    if (name === "Breadcrumbs") trail = true
    if (name === "SectionHeader" && trail && child.type === "JSXElement") return child
  }
  return null
}

/** A page head is Grammar's `PageHeader`, never a `Breadcrumbs` and a `SectionHeader` composed by hand. */
export const noHandRolledPageHeader: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "R323: a page head is Grammar's PageHeader, never Breadcrumbs and SectionHeader composed by hand." },
    schema: [],
    messages: {
      handRolled:
        "A `Breadcrumbs` trail followed by a `SectionHeader` is a page head composed by hand: it has no band, no top inset and no separator, and each page re-decides its spacing. Use Grammar's `PageHeader` with `breadcrumbs`, `title` and the slots the head needs (`description`, `meta`, `status`, `mark`, `actions`, `tabs`).",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    const judge = (children: readonly TSESTree.JSXChild[]): void => {
      const header = handRolledHead(children)
      if (header !== null) context.report({ node: header, messageId: "handRolled" })
    }
    return {
      JSXElement(element) { judge(element.children) },
      JSXFragment(fragment) { judge(fragment.children) },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "no-hand-rolled-page-header": noHandRolledPageHeader,
}

defineFamilyRules(rules, "knowledge/hfs/rules.yaml#R323")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
