/** Imported header delegation requires an actual canonical bar in every visible source alternative. */
import { functionOf, importOf } from "./bindings.mjs"
import { isBarControl, resolveLocal } from "./app-shell.mjs"
import { visitFunction } from "./app-shell-visible.mjs"
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

const proveOwner = (owner, seen) => {
  if (!owner) return false
  const { context, value } = owner
  const key = `${context.filename}:${value.range?.join(":")}`
  const proofs = headerProofs(context)
  if (proofs.has(key)) return proofs.get(key)
  if (seen.has(key)) return false
  const fn = functionOf(context, resolveLocal(context, value))
  const valid = Boolean(fn) && proveReturns(context, fn, new Set(seen).add(key))
  proofs.set(key, valid)
  return valid
}

const proveReturns = (context, fn, seen) => {
  const pending = [new Map()]
  while (pending.length) {
    const choices = pending.pop()
    const branch = []
    let bar = false
    let unknown = false
    visitFunction(context, fn, (opening, name) => {
      if (reactFragment(context, opening)) return
      if (["TopBar", "NavigationFeatureNav"].includes(name)) { bar = true; return false }
      if (OVERLAYS.has(name)) return false
      if (["header", "nav", "main"].includes(name) || isBarControl(context, opening, name)) { unknown = true; return false }
      if (name === null && importBinding(context, opening)) {
        if (proveOwner(importedHeader(context, opening), seen)) bar = true
        else unknown = true
        return false
      }
    }, new Set(), (node) => {
      if (!choices.has(node)) branch.push(node)
      return choices.get(node) ?? "consequent"
    }, [])
    const missing = branch.find((node) => !choices.has(node))
    if (missing) pending.push(new Map([...choices, [missing, "alternate"]]), new Map([...choices, [missing, "consequent"]]))
    else if (!bar || unknown) return false
  }
  return true
}

/** True only for an imported JSX header whose owned implementation reaches a canonical Grammar bar. */
export const provesImportedBar = (context, opening) => {
  if (reactFragment(context, opening)) return null
  if (!importBinding(context, opening)) return null
  return proveOwner(importedHeader(context, opening), new Set())
}
