/** Imported shell-band delegation requires its canonical composition in every visible source alternative. */
import { functionOf, importOf } from "./bindings.mjs"
import { isBarControl, propOf, resolveLocal, textProp } from "./app-shell.mjs"
import { isNavigationDrawer } from "./app-shell-scope.mjs"
import { visitFunction, visitVisible } from "./app-shell-visible.mjs"
import { headerProofs, importedHeader } from "./app-shell-owner-source.mjs"

const OVERLAYS = new Set(["Dialog", "AlertDialog", "Drawer", "Popover", "DropdownMenu", "Tooltip"])

const importBinding = (context, opening) => {
  const name = opening.name.type === "JSXMemberExpression" ? opening.name.object : opening.name
  return name.type === "JSXIdentifier" ? importOf(context, name) : null
}

const reactFragment = (context, opening) => {
  const imported = importBinding(context, opening)
  return imported?.source === "react" && (imported.imported === "Fragment" || opening.name.type === "JSXMemberExpression" && opening.name.property.name === "Fragment")
}

const proveOwner = (owner, seen, kind) => {
  if (!owner) return false
  const { context, value } = owner
  const key = `${kind}:${context.filename}:${value.range?.join(":")}`
  const proofs = headerProofs(context)
  if (proofs.has(key)) return proofs.get(key)
  if (seen.has(key)) return false
  const fn = functionOf(context, resolveLocal(context, value))
  const valid = Boolean(fn) && proveComposition(context, (visit, branch) => visitFunction(context, fn, visit, new Set(), branch, []), new Set(seen).add(key), kind)
  proofs.set(key, valid)
  return valid
}

/** Drawer bodies must expose navigation on every branch, outside nested overlay content. */
const proveDrawerBody = (context, opening, seen) => proveComposition(context, (visit, branch) => {
  const children = opening.parent.children.filter((child) => child.type !== "JSXText" || child.value.trim())
  if (children.length) for (const child of children) visitVisible(context, child, visit, new Set(), branch)
  else visitVisible(context, propOf(context, opening, "children").value, visit, new Set(), branch)
}, seen, "sidebar")

const matchesComposition = (context, opening, name, seen, kind) => {
  if (kind === "drawer") return isNavigationDrawer(context, opening) && proveDrawerBody(context, opening, seen)
  if (kind === "sidebar") return name === "Sidebar" && textProp(context, opening, "presentation") === "drawer"
  return ["TopBar", "NavigationFeatureNav"].includes(name)
}

const proveComposition = (context, render, seen, kind) => {
  const pending = [new Map()]
  while (pending.length) {
    const choices = pending.pop()
    const branch = []
    let found = false
    let unknown = false
    render((opening, name) => {
      if (reactFragment(context, opening)) return
      if (matchesComposition(context, opening, name, seen, kind)) { found = true; return false }
      if (OVERLAYS.has(name)) return false
      if (kind === "bar" && (["header", "nav", "main"].includes(name) || isBarControl(context, opening, name))) { unknown = true; return false }
      if (name === null && importBinding(context, opening)) {
        if (proveOwner(importedHeader(context, opening), seen, kind)) found = true
        else unknown = true
        return false
      }
    }, (node) => {
      if (!choices.has(node)) branch.push(node)
      return choices.get(node) ?? "consequent"
    })
    const missing = branch.find((node) => !choices.has(node))
    if (missing) pending.push(new Map([...choices, [missing, "alternate"]]), new Map([...choices, [missing, "consequent"]]))
    else if (!found || unknown) return false
  }
  return true
}

/** True only for an imported JSX header whose owned implementation reaches a canonical Grammar bar. */
export const provesImportedBar = (context, opening) => {
  if (reactFragment(context, opening)) return null
  if (!importBinding(context, opening)) return null
  return proveOwner(importedHeader(context, opening), new Set(), "bar")
}

/** True only when every visible compact-header alternative reaches a left Drawer with a drawer Sidebar. */
export const provesNavigationOpener = (context, expression) => proveComposition(context,
  (visit, branch) => visitVisible(context, expression, visit, new Set(), branch), new Set(), "drawer")
