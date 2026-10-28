/**
 * What R325 reads beyond the page owner's own file: whether the one connected block an owner renders draws the `Page`,
 * and whether the owner is mounted only under an auth route group whose layout is its page frame.
 */
import fs from "node:fs"
import path from "node:path"
import type { TSESTree } from "@typescript-eslint/types"
import { walk } from "@starci/eslint-canon-fe/lib/ast.mjs"
import { hfsOf } from "@starci/eslint-canon-fe/lib/hfs.mjs"
import { importedHeader } from "./app-shell-owner-source.ts"
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

/** True when a parsed file draws a `Page` element itself. */
const drawsPageIn = (context: ParsedContext): boolean => elementsOf(context).some((element) => openingName(element.openingElement) === "Page")

/**
 * True when the element is one of the app's connected blocks (`fe.components`, kind `blocks`) and that block draws a
 * `Page`, in its connected half or in the pure half it draws through (`./component`). One level only: what the block
 * hands to other blocks is not followed.
 */
export const blockDrawsPage = (context: ReaderContext, opening: TSESTree.JSXOpeningElement): boolean => {
  const owner = importedHeader(context, opening)
  if (owner === null) return false
  const found = hfsOf(context).classify(owner.context.filename)
  if (found.slot !== "fe.components" || found.kind !== "blocks") return false
  if (drawsPageIn(owner.context)) return true
  const halves = pureHalfNames(owner.context)
  return elementsOf(owner.context).some((element) => {
    const name = element.openingElement.name
    if (name.type !== "JSXIdentifier" || !halves.has(name.name)) return false
    const half = importedHeader(owner.context, element.openingElement)
    return half !== null && drawsPageIn(half.context)
  })
}

/** The route group whose layout frames sign-in, sign-up, password and auth callback pages. */
export const AUTH_GROUP = "(auth)"

const PAGE_OWNER = /^(.*\/src)\/features\/pages\/([^/]+)\//
const ROUTE_PAGE = /(?:^|[\\/])page\.[cm]?[jt]sx?$/

/** True when a route file imports the page owner `owner` (`@/features/pages/<owner>`, or a relative path to it). */
const mountsOwner = (text: string, owner: string): boolean =>
  new RegExp(String.raw`from\s+["'][^"']*\/features\/pages\/${owner}(?:\/index)?["']`).test(text)

/** True when a route file lies under an auth route group that has its own `layout`, the frame of every page in it. */
const underAuthGroup = (route: string, appDirectory: string): boolean => {
  for (let directory = path.dirname(route); directory.length > appDirectory.length; directory = path.dirname(directory)) {
    if (path.basename(directory) !== AUTH_GROUP) continue
    if (fs.readdirSync(directory).some((name) => /^layout\.[cm]?[jt]sx?$/.test(name))) return true
  }
  return false
}

/**
 * True when every route page that mounts this page owner lies under the app's auth route group (`app/**\/(auth)/`) with
 * its own layout: that layout draws the auth frame, which is the page frame of the sign-in, sign-up, password and
 * callback pages in it. An owner no route mounts, or one mounted anywhere else too, is not an auth page.
 */
export const mountedOnlyUnderAuthGroup = (context: ReaderContext): boolean => {
  const match = PAGE_OWNER.exec(context.filename.replaceAll("\\", "/"))
  if (match === null) return false
  const [, source = "", owner = ""] = match
  const appDirectory = path.normalize(path.join(source, "app"))
  if (!fs.existsSync(appDirectory)) return false
  const routes = fs.readdirSync(appDirectory, { recursive: true, encoding: "utf8" })
    .filter((relative) => ROUTE_PAGE.test(relative))
    .map((relative) => path.join(appDirectory, relative))
    .filter((route) => mountsOwner(fs.readFileSync(route, "utf8"), owner))
  return routes.length > 0 && routes.every((route) => underAuthGroup(route, appDirectory))
}
