import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { inSlot, isProductSource, kindOfFile } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { PURE_HALF, blockDrawsPage, mountedOnlyUnderAuthGroup } from "./lib/page-frame.ts"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
import type { ReaderContext } from "./lib/types.ts"
/**
 * The rules that hold the page frame laws: Grammar's `Page` is the one owner of a route page's header band, its inset
 * and its rhythm.
 *
 * - R324 (`FE_PAGE_TABS_OUTSIDE_HEADER`): page tabs are the header's tabs. A `Tabs` that is the first element child of a
 *   `Page` (the top of the body, right under the band), or the next element sibling of a `PageHeader`, is a page tab bar
 *   drawn outside the band: it misses the separator it stands on and takes the body's inset and gap.
 * - R325 (`FE_ROUTE_PAGE_OUTSIDE_PAGE`): a route draws exactly one `Page` and nothing beside it. The page owner
 *   (`fe.feature`, kind `pages`) draws it itself, through its pure half (`./component`), or through the one connected
 *   block it renders as its root, where client data builds the header a server owner cannot build. A `Page` (or a block
 *   that draws one) with an element sibling, a `Page` inside another, or a bare `PageHeader` or `PageContainer` in the
 *   page owner re-decides the inset and the rhythm `Page` owns. A page owner file that draws JSX but no `Page` in one of
 *   those ways has no page frame at all, unless every route that mounts it lies under the auth route group `(auth)` with
 *   its own layout: that layout draws the auth frame, the page frame of its sign-in, sign-up, password and callback pages.
 *
 * WHAT IT READS. Element names (`Page`, or `Grammar.Page` as `Page`), the element children of one JSX parent, and the
 * names a file imports from a relative module; whitespace text and JSX comments are not children. For R325 it also reads,
 * one level deep, the source of each app block (`fe.components`, kind `blocks`) the owner draws with that block's pure
 * half, and the app's route `page` files that import the owner. A page owner that draws no JSX (its body only calls
 * `redirect()` or `notFound()`, or returns null) draws no UI and is not judged. A `Tabs` lower in the
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

/** An import of the app's own source (`@/...` or a relative path), where its blocks come from. */
const APP_SOURCE = /^(?:@\/|\.\.?\/)/

/** The nearest JSX element that encloses a node, or null. */
const enclosingElement = (node: TSESTree.Node): TSESTree.JSXElement | null => {
  for (let parent = node.parent; parent; parent = parent.parent) if (parent.type === "JSXElement") return parent
  return null
}

/**
 * A route draws exactly one `Page` and nothing beside it: the page owner draws it, its pure half does, or the one connected
 * block it renders as its root does. `PageHeader` and `PageContainer` are Page's own parts.
 */
export const routePageIsOnePage: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "R325: a route draws one Page (in its page owner, its pure half or its one root block) with nothing beside it, never a bare PageHeader or PageContainer, and never no Page at all." },
    schema: [],
    messages: {
      sibling:
        "This `{{name}}` draws the route's `Page` and has a sibling: a route page is one `Page`, and whatever sits beside it escapes the header band, the measure and the rhythm `Page` owns. Move the sibling into the `Page` body (as the block's children when a block draws the `Page`), or into `header` when it heads the page.",
      twice:
        "This `{{name}}` draws a second `Page` inside the route's `Page`: a route page is exactly one `Page`, so the band, the measure and the rhythm would be decided twice. Draw its content as the body of the one `Page`.",
      part:
        "`{{name}}` is drawn by `Page`: a page owner composes `Page` (`header` for the band, `measure` for the body), so the inset and the rhythm have one owner. Replace it with `Page`.",
      missing:
        "This page owner draws no `Page`: a route page is one Grammar `Page`, which owns the header band, the measure and the rhythm, so without it the page has no heading band and its body sits on no inset. Wrap what it draws in a `Page` whose `header.title` is the page heading (never a `Heading` of its own), draw it through the owner's pure half in `./component`, or render as the root the one connected block that draws the `Page` from client data.",
    },
  },
  create(context) {
    if (!isProductSource(context) || !isPageOwner(context)) return {}
    const judgeMissing = !isBoundaryOwner(context)
    const pureHalf = new Set<string>()
    const appImports = new Set<string>()
    const frames = new Set<TSESTree.JSXElement>()
    let first: TSESTree.JSXElement | null = null
    let drawsPage = false
    /** True when the element draws the route's `Page`: a `Page`, or an app block whose source draws one. */
    const drawsFrame = (element: TSESTree.JSXElement, name: string | null): boolean => {
      if (name === "Page") return true
      const opening = element.openingElement.name
      return opening.type === "JSXIdentifier" && appImports.has(opening.name) && blockDrawsPage(context, element.openingElement)
    }
    return {
      ImportDeclaration(declaration) {
        const source = String(declaration.source.value)
        const into = PURE_HALF.test(source) ? pureHalf : APP_SOURCE.test(source) ? appImports : null
        if (into === null || declaration.importKind === "type") return
        for (const specifier of declaration.specifiers) into.add(specifier.local.name)
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
        if (!drawsFrame(element, name)) return
        drawsPage = true
        frames.add(element)
        const label = name ?? "Page"
        for (let outer = enclosingElement(element); outer; outer = enclosingElement(outer)) {
          if (!frames.has(outer)) continue
          context.report({ node: element, messageId: "twice", data: { name: label } })
          return
        }
        const parent = element.parent
        if (parent.type !== "JSXElement" && parent.type !== "JSXFragment") return
        if (renderedChildren(parent.children).length > 1) context.report({ node: element, messageId: "sibling", data: { name: label } })
      },
      "Program:exit"() {
        if (!judgeMissing || first === null || drawsPage) return
        if (!mountedOnlyUnderAuthGroup(context)) context.report({ node: first, messageId: "missing" })
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
