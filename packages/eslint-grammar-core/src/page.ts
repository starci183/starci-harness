import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { inSlot, isProductSource, kindOfFile } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
import type { ReaderContext } from "./lib/types.ts"
/**
 * The rules that hold the page frame laws: Grammar's `Page` is the one owner of a route page's header band, its inset
 * and its rhythm.
 *
 * - R324 (`FE_PAGE_TABS_OUTSIDE_HEADER`): page tabs are the header's tabs. A `Tabs` that is the first element child of a
 *   `Page` (the top of the body, right under the band), or the next element sibling of a `PageHeader`, is a page tab bar
 *   drawn outside the band: it misses the separator it stands on and takes the body's inset and gap.
 * - R325 (`FE_ROUTE_PAGE_OUTSIDE_PAGE`): a page owner (`fe.feature`, kind `pages`) draws one `Page` and nothing beside it.
 *   A `Page` with an element sibling, or a bare `PageHeader` or `PageContainer` in the page owner, re-decides the inset
 *   and the rhythm `Page` owns.
 *
 * WHAT IT READS. Element names (`Page`, or `Grammar.Page` as `Page`) and the element children of one JSX parent;
 * whitespace text and JSX comments are not children. A `Tabs` lower in the body, a `Page` wrapped alone in a provider,
 * and files outside a page owner (for R325) are not judged.
 */

/** The element name of a JSX child (`Tabs`, or `Grammar.Tabs` as `Tabs`), or null for text and expressions. */
const elementName = (child: TSESTree.JSXChild | TSESTree.Node | null | undefined): string | null => {
  if (child?.type !== "JSXElement") return null
  const name = child.openingElement.name
  if (name.type === "JSXIdentifier") return name.name
  if (name.type === "JSXMemberExpression") return name.property.name
  return null
}

/** The children that render: whitespace-only text and `{/* comments *\/}` are left out. */
const renderedChildren = (children: readonly TSESTree.JSXChild[]): TSESTree.JSXChild[] =>
  children.filter((child) => {
    if (child.type === "JSXText") return child.value.trim() !== ""
    if (child.type === "JSXExpressionContainer") return child.expression.type !== "JSXEmptyExpression"
    return true
  })

/** The `Tabs` element drawn as page tabs outside the header band, among one parent's children, or null. */
export const tabsOutsideHeader = (parent: TSESTree.JSXElement | TSESTree.JSXFragment): TSESTree.JSXElement | null => {
  const children = renderedChildren(parent.children)
  const first = children[0]
  if (elementName(parent) === "Page" && elementName(first) === "Tabs") return first as TSESTree.JSXElement
  for (let index = 0; index + 1 < children.length; index += 1) {
    const next = children[index + 1]
    if (elementName(children[index]) === "PageHeader" && elementName(next) === "Tabs") return next as TSESTree.JSXElement
  }
  return null
}

/** Page tabs are the header's `tabs`, never a `Tabs` at the top of the body or beside a `PageHeader`. */
export const pageTabsInHeader: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "R324: page tabs are Page header.tabs (or PageHeader tabs), never a Tabs at the top of the body." },
    schema: [],
    messages: {
      outside:
        "This `Tabs` is the page's tab bar drawn under the header band instead of on it: it misses the separator the page tabs stand on and takes the body's inset. Pass it as `header.tabs` of `Page` (or `tabs` of `PageHeader`): `{ label, items, selectedKey, onSelect }`.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    const judge = (parent: TSESTree.JSXElement | TSESTree.JSXFragment): void => {
      const tabs = tabsOutsideHeader(parent)
      if (tabs !== null) context.report({ node: tabs, messageId: "outside" })
    }
    return {
      JSXElement(element) { judge(element) },
      JSXFragment(fragment) { judge(fragment) },
    }
  },
})

const PAGE_PARTS = new Set(["PageHeader", "PageContainer"])

/** True for a page owner's file: `fe.feature`, kind `pages`. */
const isPageOwner = (context: ReaderContext): boolean => inSlot(context, "fe.feature") && kindOfFile(context) === "pages"

/** A page owner draws one `Page` and nothing beside it; `PageHeader` and `PageContainer` are Page's own parts. */
export const routePageIsOnePage: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "R325: a page owner draws one Page with nothing beside it, never a bare PageHeader or PageContainer." },
    schema: [],
    messages: {
      sibling:
        "This `Page` has a sibling: a route page is one `Page`, and whatever sits beside it escapes the header band, the measure and the rhythm `Page` owns. Move the sibling into the `Page` body, or into `header` when it heads the page.",
      part:
        "`{{name}}` is drawn by `Page`: a page owner composes `Page` (`header` for the band, `measure` for the body), so the inset and the rhythm have one owner. Replace it with `Page`.",
    },
  },
  create(context) {
    if (!isProductSource(context) || !isPageOwner(context)) return {}
    return {
      JSXElement(element) {
        const name = elementName(element)
        if (name !== null && PAGE_PARTS.has(name)) {
          context.report({ node: element, messageId: "part", data: { name } })
          return
        }
        if (name !== "Page") return
        const parent = element.parent
        if (parent.type !== "JSXElement" && parent.type !== "JSXFragment") return
        if (renderedChildren(parent.children).length > 1) context.report({ node: element, messageId: "sibling" })
      },
    }
  },
})

const tabsRules: Record<string, Rule.RuleModule> = { "page-tabs-in-header": pageTabsInHeader }
const rootRules: Record<string, Rule.RuleModule> = { "route-page-is-one-page": routePageIsOnePage }

defineFamilyRules(tabsRules, "knowledge/hfs/rules.yaml#R324")
defineFamilyRules(rootRules, "knowledge/hfs/rules.yaml#R325")

/** The rules these laws contribute to the plugin. */
export const rules: Record<string, Rule.RuleModule> = { ...tabsRules, ...rootRules }

/** Every rule of these laws is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
