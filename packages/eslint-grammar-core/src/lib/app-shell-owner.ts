/** Imported shell-band delegation requires its canonical composition in every visible source alternative. */
import type { TSESTree } from "@typescript-eslint/types"
import { functionOf, importOf } from "@starci/eslint-canon-fe/lib/bindings.mjs"
import { isBarControl, propOf, realNode, resolveLocal, textProp } from "./app-shell.ts"
import { isNavigationDrawer } from "./app-shell-scope.ts"
import { visitFunction, visitVisible } from "./app-shell-visible.ts"
import type { Branch, Visit } from "./app-shell-visible.ts"
import { headerProofs, importedHeader } from "./app-shell-owner-source.ts"
import type { Owner } from "./app-shell-owner-source.ts"
import type { Node, ReaderContext, Resolved } from "./types.ts"

const OVERLAYS = new Set(["Dialog", "AlertDialog", "Drawer", "Popover", "DropdownMenu", "Tooltip"])

/** What a proof is looking for: a bar, a drawer opener, or a drawer's sidebar body. */
type Kind = "bar" | "drawer" | "sidebar"

/** Renders the visible composition under test through the given visit and branch callbacks. */
type Render = (visit: Visit, branch: Branch) => void

const importBinding = (context: ReaderContext, opening: TSESTree.JSXOpeningElement): { readonly source: string; readonly imported: string | null } | null => {
  const name = opening.name.type === "JSXMemberExpression" ? opening.name.object : opening.name
  return name.type === "JSXIdentifier" ? importOf(context, name) : null
}

const reactFragment = (context: ReaderContext, opening: TSESTree.JSXOpeningElement): boolean => {
  const imported = importBinding(context, opening)
  return imported?.source === "react" && (imported.imported === "Fragment" || opening.name.type === "JSXMemberExpression" && opening.name.property.name === "Fragment")
}

const proveOwner = (owner: Owner | null, seen: Set<string>, kind: Kind): boolean => {
  if (!owner) return false
  const { context, value } = owner
  const key = `${kind}:${context.filename}:${value.range.join(":")}`
  const proofs = headerProofs(context)
  const known = proofs.get(key)
  if (known !== undefined) return known
  if (seen.has(key)) return false
  const fn = functionOf(context, realNode(resolveLocal(context, value)))
  const valid = fn !== null && proveComposition(context, (visit, branch) => visitFunction(context, fn, visit, new Set(), branch, []), new Set(seen).add(key), kind)
  proofs.set(key, valid)
  return valid
}

/** Drawer bodies must expose navigation on every branch, outside nested overlay content. */
const proveDrawerBody = (context: ReaderContext, opening: TSESTree.JSXOpeningElement, seen: Set<string>): boolean => proveComposition(context, (visit, branch) => {
  const children = opening.parent.children.filter((child) => child.type !== "JSXText" || child.value.trim())
  if (children.length) for (const child of children) visitVisible(context, child, visit, new Set(), branch)
  else visitVisible(context, propOf(context, opening, "children").value, visit, new Set(), branch)
}, seen, "sidebar")

const matchesComposition = (context: ReaderContext, opening: TSESTree.JSXOpeningElement, name: string | null, seen: Set<string>, kind: Kind): boolean => {
  if (kind === "drawer") return isNavigationDrawer(context, opening) && proveDrawerBody(context, opening, seen)
  if (kind === "sidebar") return name === "Sidebar" && textProp(context, opening, "presentation") === "drawer"
  return name !== null && ["TopBar", "NavigationFeatureNav"].includes(name)
}

const proveComposition = (context: ReaderContext, render: Render, seen: Set<string>, kind: Kind): boolean => {
  const pending: Map<Node, "consequent" | "alternate">[] = [new Map()]
  for (let choices = pending.pop(); choices; choices = pending.pop()) {
    const current = choices
    const branch: Node[] = []
    let found = false
    let unknown = false
    render((opening, name) => {
      if (reactFragment(context, opening)) return
      if (matchesComposition(context, opening, name, seen, kind)) { found = true; return false }
      if (name !== null && OVERLAYS.has(name)) return false
      if (kind === "bar" && (name !== null && ["header", "nav", "main"].includes(name) || isBarControl(context, opening, name))) { unknown = true; return false }
      if (name === null && importBinding(context, opening)) {
        if (proveOwner(importedHeader(context, opening), seen, kind)) found = true
        else unknown = true
        return false
      }
      return undefined
    }, (node) => {
      if (!current.has(node)) branch.push(node)
      return current.get(node) ?? "consequent"
    })
    const missing = branch.find((node) => !current.has(node))
    if (missing) pending.push(new Map<Node, "consequent" | "alternate">([...choices, [missing, "alternate"]]), new Map<Node, "consequent" | "alternate">([...choices, [missing, "consequent"]]))
    else if (!found || unknown) return false
  }
  return true
}

/** True only for an imported JSX header whose owned implementation reaches a canonical Grammar bar. */
export const provesImportedBar = (context: ReaderContext, opening: TSESTree.JSXOpeningElement): boolean | null => {
  if (reactFragment(context, opening)) return null
  if (!importBinding(context, opening)) return null
  return proveOwner(importedHeader(context, opening), new Set(), "bar")
}

/** True only when every visible compact-header alternative reaches a left Drawer with a drawer Sidebar. */
export const provesNavigationOpener = (context: ReaderContext, expression: Resolved | null | undefined): boolean => proveComposition(context,
  (visit, branch) => visitVisible(context, expression, visit, new Set(), branch), new Set(), "drawer")
