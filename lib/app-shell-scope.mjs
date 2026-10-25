/** Structural app-shell ownership, distinct from generic flow-based site chrome. */
import { walk } from "./ast.mjs"
import { kindOfFile, roleOfFile } from "./scope.mjs"
import { grammarName, propOf, textProp } from "./app-shell.mjs"
import { visitVisible } from "./app-shell-visible.mjs"

/** A workspace identity or a sidebar/navigation slot identifies an application shell structurally. */
export const isAppShell = (context, opening) => {
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
export const isNavigationDrawer = (context, opening) => {
  if (grammarName(context, opening) !== "Drawer" || textProp(context, opening, "placement") !== "left") return false
  let sidebar = false
  const inspect = (node, name) => {
    if (name === "Sidebar" && textProp(context, node, "presentation") === "drawer") sidebar = true
  }
  for (const child of opening.parent.children) visitVisible(context, child, inspect)
  visitVisible(context, propOf(context, opening, "children").value, inspect)
  return sidebar
}

/** Shell-named React owners and the HFS layout kind compose an app frame, rather than page-local navigation. */
export const ownsAppFrame = (context, node) => {
  if (kindOfFile(context) === "layouts" || roleOfFile(context) === "layout") return true
  let rendered = null
  let shellName = false
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === "ReturnStatement") rendered = current.argument
    if (current.type === "FunctionDeclaration") { shellName = /Shell(?:Base)?$/.test(current.id?.name ?? ""); break }
    if (current.type === "ArrowFunctionExpression" || current.type === "FunctionExpression") {
      rendered ??= current.body
      shellName = current.parent?.type === "VariableDeclarator" && /Shell(?:Base)?$/.test(current.parent.id.name ?? "")
      break
    }
  }
  if (shellName) return true
  let sidebar = false
  visitVisible(context, rendered, (_opening, name) => { if (name === "Sidebar") sidebar = true })
  return sidebar
}

const APP_BAR_CACHE = new WeakMap()

/** Every visible opening hosted by a structurally identified app shell in this source file. */
export const appBarOpenings = (context) => {
  const source = context.sourceCode
  if (APP_BAR_CACHE.has(source)) return APP_BAR_CACHE.get(source)
  const openings = new Set()
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
export const isAppBar = (context, opening) => {
  if (!["TopBar", "NavigationFeatureNav"].includes(grammarName(context, opening))) return false
  for (let current = opening.parent; current; current = current.parent) {
    if (current.type !== "JSXElement") continue
    const shell = current.openingElement
    if (grammarName(context, shell) === "WorkspaceShell" && textProp(context, shell, "viewport") === "flow" && !isAppShell(context, shell)) return false
  }
  return true
}
