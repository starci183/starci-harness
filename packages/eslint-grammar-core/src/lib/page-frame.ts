/**
 * What R325 reads beyond the owner's own file: whether the one connected block an owner renders draws the `Page`, whether
 * a page owner is mounted only under an auth route group whose layout is its page frame, and whether a route segment
 * `layout` above it already draws the one `Page` of its tabbed segment.
 */
import fs from "node:fs"
import path from "node:path"
import type { TSESTree } from "@typescript-eslint/types"
import { walk } from "@starci/eslint-canon-fe/lib/ast.mjs"
import { hfsOf } from "@starci/eslint-canon-fe/lib/hfs.mjs"
import { importedHeader, parsedSource } from "./app-shell-owner-source.ts"
import type { ParsedContext, ReaderContext } from "./types.ts"

/** The pure half of a unit: the module its connected half draws through. */
export const PURE_HALF = /^\.\/component(?:\.[cm]?[jt]sx?)?$/

/** The name a JSX element is drawn by (`Page`, or `Grammar.Page` as `Page`), or null. */
const openingName = (opening: TSESTree.JSXOpeningElement): string | null => {
  const name = opening.name
  if (name.type === "JSXIdentifier") return name.name
  if (name.type === "JSXMemberExpression") return name.property.name
  return null
}

/** The JSX elements of one parsed file. */
const elementsOf = (context: ParsedContext): TSESTree.JSXElement[] => {
  const found: TSESTree.JSXElement[] = []
  walk(context.sourceCode, context.program, (node) => {
    if (node.type === "JSXElement") found.push(node)
  })
  return found
}

/** The names a parsed file imports from its own pure half (`./component`). */
const pureHalfNames = (context: ParsedContext): Set<string> => {
  const names = new Set<string>()
  for (const statement of context.program.body) {
    if (statement.type !== "ImportDeclaration" || !PURE_HALF.test(String(statement.source.value))) continue
    for (const specifier of statement.specifiers) names.add(specifier.local.name)
  }
  return names
}

/** A unit's file and the pure halves it draws through (`./component`): the files that together draw what the unit draws. */
const withHalves = (context: ParsedContext): ParsedContext[] => {
  const halves = pureHalfNames(context)
  const files = [context]
  for (const element of elementsOf(context)) {
    const name = element.openingElement.name
    if (name.type !== "JSXIdentifier" || !halves.has(name.name)) continue
    const half = importedHeader(context, element.openingElement)
    if (half !== null && !files.includes(half.context)) files.push(half.context)
  }
  return files
}

/** The `Page` elements a parsed file draws itself. */
const pagesIn = (context: ParsedContext): TSESTree.JSXElement[] => elementsOf(context).filter((element) => openingName(element.openingElement) === "Page")

/** The object literal a `header={...}` attribute passes: written in place, or a `const` of the same file. */
const headerObject = (context: ParsedContext, opening: TSESTree.JSXOpeningElement): TSESTree.ObjectExpression | null => {
  const attribute = opening.attributes.find((entry): entry is TSESTree.JSXAttribute => entry.type === "JSXAttribute" && entry.name.name === "header")
  const value = attribute?.value?.type === "JSXExpressionContainer" ? attribute.value.expression : null
  if (value?.type === "ObjectExpression") return value
  if (value?.type !== "Identifier") return null
  let found: TSESTree.ObjectExpression | null = null
  walk(context.sourceCode, context.program, (node) => {
    if (node.type === "VariableDeclarator" && node.id.type === "Identifier" && node.id.name === value.name && node.init?.type === "ObjectExpression") found = node.init
  })
  return found
}

/** True when a `Page` element's `header` carries `tabs`: the page heads a segment whose routes are its tabs. */
const headsTabbedSegment = (context: ParsedContext, opening: TSESTree.JSXOpeningElement): boolean =>
  headerObject(context, opening)?.properties.some((property) => property.type === "Property" && property.key.type === "Identifier" && property.key.name === "tabs") === true

/** The files of an app block (`fe.components`, kind `blocks`) an element draws, with its pure half; null for anything else. */
const blockFiles = (context: ReaderContext, opening: TSESTree.JSXOpeningElement): ParsedContext[] | null => {
  const owner = importedHeader(context, opening)
  if (owner === null) return null
  const found = hfsOf(context).classify(owner.context.filename)
  if (found.slot !== "fe.components" || found.kind !== "blocks") return null
  return withHalves(owner.context)
}

/**
 * True when the element is one of the app's connected blocks (`fe.components`, kind `blocks`) and that block draws a
 * `Page`, in its connected half or in the pure half it draws through (`./component`). One level only: what the block
 * hands to other blocks is not followed.
 */
export const blockDrawsPage = (context: ReaderContext, opening: TSESTree.JSXOpeningElement): boolean =>
  blockFiles(context, opening)?.some((file) => pagesIn(file).length > 0) === true

/**
 * True when a unit (a layout owner) draws a `Page` whose header carries `tabs`: itself, through its pure half, or through
 * the one connected block either renders, read one level deep as for a page owner.
 */
const unitDrawsTabbedPage = (context: ParsedContext): boolean =>
  withHalves(context).some((file) => {
    const tabbed = (target: ParsedContext): boolean => pagesIn(target).some((page) => headsTabbedSegment(target, page.openingElement))
    if (tabbed(file)) return true
    return elementsOf(file).some((element) => blockFiles(file, element.openingElement)?.some(tabbed) === true)
  })

/** The route group whose layout frames sign-in, sign-up, password and auth callback pages. */
export const AUTH_GROUP = "(auth)"

const PAGE_OWNER = /^(.*\/src)\/features\/pages\/([^/]+)\//
const ROUTE_PAGE = /(?:^|[\\/])page\.[cm]?[jt]sx?$/
const ROUTE_LAYOUT = /^layout\.[cm]?[jt]sx?$/

/**
 * True when a route file imports a value of the page owner `owner` (`@/features/pages/<owner>`, or a relative path to it):
 * a default, named or namespace import. A type import, or a re-export such as `export { metadata } from` the owner, mounts
 * nothing: a route that only borrows the owner's metadata renders another page.
 */
const mountsOwner = (text: string, owner: string): boolean =>
  new RegExp(String.raw`\bimport\s+(?!type\s)(?:[\w$]+\s*,?\s*)?(?:\{[^}]*\}|\*\s*as\s+[\w$]+)?\s*from\s+["'][^"']*\/features\/pages\/${owner}(?:\/index)?["']`).test(text)

/** The app's `app/` folder and the route `page` files that mount this page owner; null outside a page owner. */
const mountingRoutes = (context: ReaderContext): { readonly appDirectory: string; readonly routes: string[] } | null => {
  const match = PAGE_OWNER.exec(context.filename.replaceAll("\\", "/"))
  if (match === null) return null
  const [, source = "", owner = ""] = match
  const appDirectory = path.normalize(path.join(source, "app"))
  if (!fs.existsSync(appDirectory)) return null
  const routes = fs.readdirSync(appDirectory, { recursive: true, encoding: "utf8" })
    .filter((relative) => ROUTE_PAGE.test(relative))
    .map((relative) => path.join(appDirectory, relative))
    .filter((route) => mountsOwner(fs.readFileSync(route, "utf8"), owner))
  return { appDirectory, routes }
}

/** The `layout` files of the segments that wrap a route page, nearest first, up to the app folder. */
const layoutsAbove = (route: string, appDirectory: string): string[] => {
  const layouts: string[] = []
  for (let directory = path.dirname(route); directory.length >= appDirectory.length; directory = path.dirname(directory)) {
    for (const name of fs.readdirSync(directory)) if (ROUTE_LAYOUT.test(name)) layouts.push(path.join(directory, name))
    if (directory === appDirectory) break
  }
  return layouts
}

/** True when a route file lies under an auth route group that has its own `layout`, the frame of every page in it. */
const underAuthGroup = (route: string, appDirectory: string): boolean =>
  layoutsAbove(route, appDirectory).some((layout) => path.basename(path.dirname(layout)) === AUTH_GROUP)

/**
 * True when every route page that mounts this page owner lies under the app's auth route group (`app/**\/(auth)/`) with
 * its own layout: that layout draws the auth frame, which is the page frame of the sign-in, sign-up, password and
 * callback pages in it. An owner no route mounts, or one mounted anywhere else too, is not an auth page.
 */
export const mountedOnlyUnderAuthGroup = (context: ReaderContext): boolean => {
  const found = mountingRoutes(context)
  return found !== null && found.routes.length > 0 && found.routes.every((route) => underAuthGroup(route, found.appDirectory))
}

/**
 * True when a route segment `layout` draws the one `Page` of its tabbed segment: the layout file, or a layout owner it
 * renders (`fe.feature`, kind `layouts`) through itself, its pure half or the one connected block it renders as its root,
 * draws a `Page` whose `header` carries `tabs`.
 */
const layoutDrawsSegmentPage = (context: ReaderContext, layout: string): boolean => {
  const file = parsedSource(context, layout)
  if (pagesIn(file).some((page) => headsTabbedSegment(file, page.openingElement))) return true
  return elementsOf(file).some((element) => {
    const owner = importedHeader(file, element.openingElement)
    if (owner === null) return false
    const found = hfsOf(context).classify(owner.context.filename)
    return found.slot === "fe.feature" && found.kind === "layouts" && unitDrawsTabbedPage(owner.context)
  })
}

/** Which of the routes that mount a page owner lie under a segment layout that draws their one `Page`. */
export interface SegmentFrame {
  /** At least one mounting route is framed: the owner draws body content only, and a `Page` of its own is a second one. */
  readonly some: boolean
  /** Every mounting route is framed (and at least one mounts it): the owner needs no `Page`. */
  readonly every: boolean
  /** The nearest such `layout`, relative to the app folder, for the finding. */
  readonly layout: string | null
}

/** Whether the routes that mount this page owner sit under a segment `layout` that draws their one `Page`. */
export const segmentFrame = (context: ReaderContext): SegmentFrame => {
  const found = mountingRoutes(context)
  if (found === null || found.routes.length === 0) return { some: false, every: false, layout: null }
  const framing = found.routes.map((route) => layoutsAbove(route, found.appDirectory).find((layout) => layoutDrawsSegmentPage(context, layout)) ?? null)
  const first = framing.find((layout) => layout !== null) ?? null
  return {
    some: first !== null,
    every: framing.every((layout) => layout !== null),
    layout: first === null ? null : path.relative(found.appDirectory, first).replaceAll("\\", "/"),
  }
}
