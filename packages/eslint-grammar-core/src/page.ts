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
 *   and the rhythm `Page` owns. A page owner file that draws JSX but no `Page`, and hands drawing to no pure half of its
 *   own (an element imported from `./component`), has no page frame at all.
 *
 * WHAT IT READS. Element names (`Page`, or `Grammar.Page` as `Page`), the element children of one JSX parent, and the
 * names a file imports from a relative module; whitespace text and JSX comments are not children. A `Tabs` lower in the
 * body, a `Page` wrapped alone in a provider, and files outside a page owner (for R325) are not judged. The segment
 * boundary owners of FE-BOUNDARY-1 (`*ErrorPage`, `*LoadingPage`, `*NotFoundPage`) are not judged for a missing `Page`:
 * an app-level boundary stands in for whichever page failed or waits and draws its notice.
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
        "This `Tabs` is the page's tab bar drawn under the header band instead of on it: it misses the separator the page tabs stand on and takes the body's inset. Pass it as `header.tabs` of `Page` (or `tabs` of `PageHeader`): `{ label, items, selectedKey, onSelect }`, or link tabs whose items carry an `href` each.",
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

/** The segment boundary owners of FE-BOUNDARY-1: an error, loading or not-found page, which may draw a notice. */
const BOUNDARY_OWNER = /\/features\/pages\/[^/]*(?:ErrorPage|LoadingPage|NotFoundPage)\//

/** True when the file is a boundary owner's, judged by its owner folder. */
const isBoundaryOwner = (context: ReaderContext): boolean => BOUNDARY_OWNER.test(context.filename.replaceAll("\\", "/"))

/** The pure half of a page owner: the module its connected half draws through. */
const PURE_HALF = /^\.\/component(?:\.[cm]?[jt]sx?)?$/

/** A page owner draws one `Page` and nothing beside it; `PageHeader` and `PageContainer` are Page's own parts. */
export const routePageIsOnePage: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "R325: a page owner draws one Page with nothing beside it, never a bare PageHeader or PageContainer, and never no Page at all." },
    schema: [],
    messages: {
      sibling:
        "This `Page` has a sibling: a route page is one `Page`, and whatever sits beside it escapes the header band, the measure and the rhythm `Page` owns. Move the sibling into the `Page` body, or into `header` when it heads the page.",
      part:
        "`{{name}}` is drawn by `Page`: a page owner composes `Page` (`header` for the band, `measure` for the body), so the inset and the rhythm have one owner. Replace it with `Page`.",
      missing:
        "This page owner draws no `Page`: a route page is one Grammar `Page`, which owns the header band, the measure and the rhythm, so without it the page has no heading band and its body sits on no inset. Wrap what it draws in a `Page` whose `header.title` is the page heading (never a `Heading` of its own), or draw it through the owner's pure half in `./component`.",
    },
  },
  create(context) {
    if (!isProductSource(context) || !isPageOwner(context)) return {}
    const judgeMissing = !isBoundaryOwner(context)
    const pureHalf = new Set<string>()
    let first: TSESTree.JSXElement | null = null
    let drawsPage = false
    return {
      ImportDeclaration(declaration) {
        if (!PURE_HALF.test(String(declaration.source.value))) return
        for (const specifier of declaration.specifiers) pureHalf.add(specifier.local.name)
      },
      JSXElement(element) {
        first ??= element
        const name = elementName(element)
        const opening = element.openingElement.name
        if (opening.type === "JSXIdentifier" && pureHalf.has(opening.name)) drawsPage = true
        if (name !== null && PAGE_PARTS.has(name)) {
          // The part's own finding already says to draw a `Page` instead; the missing Page is not reported twice.
          drawsPage = true
          context.report({ node: element, messageId: "part", data: { name } })
          return
        }
        if (name !== "Page") return
        drawsPage = true
        const parent = element.parent
        if (parent.type !== "JSXElement" && parent.type !== "JSXFragment") return
        if (renderedChildren(parent.children).length > 1) context.report({ node: element, messageId: "sibling" })
      },
      "Program:exit"() {
        if (judgeMissing && first !== null && !drawsPage) context.report({ node: first, messageId: "missing" })
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
