/** Structural app-shell ownership, distinct from generic flow-based site chrome. */
import type { TSESTree } from "@typescript-eslint/types"
import { walk } from "@starci/eslint-canon-fe/lib/ast.mjs"
import { kindOfFile, roleOfFile } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { grammarName, propOf, textProp } from "./app-shell.ts"
import { visitVisible } from "./app-shell-visible.ts"
import type { Node, ReaderContext, SourceView } from "./types.ts"

/** A workspace identity or a sidebar/navigation slot identifies an application shell structurally. */
export const isAppShell = (context: ReaderContext, opening: TSESTree.JSXOpeningElement): boolean => {
  if (grammarName(context, opening) !== "WorkspaceShell") return false
  const viewport = textProp(context, opening, "viewport")
  if (viewport === "fixed" || viewport !== "flow" && ownsAppFrame(context, opening)) return true
  const navigation = propOf(context, opening, "navigation")
  if (navigation.value !== null || !navigation.known) return true
  let identity = false
  visitVisible(context, propOf(context, opening, "header").value, (_node, name) => {
    if (name === "IdentityLockup") identity = true
  })
  return identity
}

/** A left Drawer containing a drawer Sidebar is the mobile navigation opener, including an extracted client owner. */
export const isNavigationDrawer = (context: ReaderContext, opening: TSESTree.JSXOpeningElement): boolean => {
  if (grammarName(context, opening) !== "Drawer" || textProp(context, opening, "placement") !== "left") return false
  let sidebar = false
  const inspect = (node: TSESTree.JSXOpeningElement, name: string | null): void => {
    if (name === "Sidebar" && textProp(context, node, "presentation") === "drawer") sidebar = true
  }
  for (const child of opening.parent.children) visitVisible(context, child, inspect)
  visitVisible(context, propOf(context, opening, "children").value, inspect)
  return sidebar
}

/** Shell-named React owners and the HFS layout kind compose an app frame, rather than page-local navigation. */
export const ownsAppFrame = (context: ReaderContext, node: TSESTree.JSXOpeningElement): boolean => {
  if (kindOfFile(context) === "layouts" || roleOfFile(context) === "layout") return true
  let rendered: Node | null = null
  let shellName = false
  for (let current: Node | undefined = node.parent; current; current = current.parent) {
    if (current.type === "ReturnStatement") rendered = current.argument
    if (current.type === "FunctionDeclaration") { shellName = /Shell(?:Base)?$/.test(current.id?.name ?? ""); break }
    if (current.type === "ArrowFunctionExpression" || current.type === "FunctionExpression") {
      rendered ??= current.body
      shellName = current.parent?.type === "VariableDeclarator" && /Shell(?:Base)?$/.test(current.parent.id.type === "Identifier" ? current.parent.id.name : "")
      break
    }
  }
  if (shellName) return true
  let sidebar = false
  visitVisible(context, rendered, (_opening, name) => { if (name === "Sidebar") sidebar = true })
  return sidebar
}

const APP_BAR_CACHE = new WeakMap<SourceView, Set<TSESTree.JSXOpeningElement>>()

/** Every visible opening hosted by a structurally identified app shell in this source file. */
export const appBarOpenings = (context: ReaderContext): Set<TSESTree.JSXOpeningElement> => {
  const source = context.sourceCode
  const cached = APP_BAR_CACHE.get(source)
  if (cached) return cached
  const openings = new Set<TSESTree.JSXOpeningElement>()
  walk(source, source.ast, (node) => {
    if (node.type !== "JSXOpeningElement" || !isAppShell(context, node)) return
    for (const slot of ["header", "compactHeader"]) {
      visitVisible(context, propOf(context, node, slot).value, (opening) => { openings.add(opening) })
    }
  })
  APP_BAR_CACHE.set(source, openings)
  return openings
}

/** Grammar bars are app bars unless an explicit generic flow shell establishes site-chrome ownership. */
export const isAppBar = (context: ReaderContext, opening: TSESTree.JSXOpeningElement): boolean => {
  const barName = grammarName(context, opening)
  if (barName !== "TopBar" && barName !== "NavigationFeatureNav") return false
  for (let current: Node | undefined = opening.parent; current; current = current.parent) {
    if (current.type !== "JSXElement") continue
    const shell = current.openingElement
    if (grammarName(context, shell) === "WorkspaceShell" && textProp(context, shell, "viewport") === "flow" && !isAppShell(context, shell)) return false
  }
  return true
}
