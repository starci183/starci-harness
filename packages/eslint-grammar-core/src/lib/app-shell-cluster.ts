/** The static alternatives of the app bar's right cluster, preserving conditional branches. */
import type { TSESTree } from "@typescript-eslint/types"
import { clusterRole, grammarName, isBarControl, propOf, textProp } from "./app-shell.ts"
import { visitVisible } from "./app-shell-visible.ts"
import type { Node, ReaderContext, Resolved } from "./types.ts"

/** The branch of each conditional the alternative under construction follows. */
type Choices = Map<Node, "consequent" | "alternate">

/** The disclosure component each cluster role's trigger must sit in. */
const EXPECTED_DISCLOSURE: Readonly<Record<string, string>> = { language: "DropdownMenu", notifications: "Popover", account: "DropdownMenu" }

const controlsOf = (context: ReaderContext, expression: Resolved | null | undefined, choices: Choices, shellHeader = false): { controls: string[]; branches: Node[]; ownsBar: boolean } => {
  const controls: string[] = []
  const branches: Node[] = []
  let ownsBar = false
  visitVisible(context, expression, (opening, name, ancestors) => {
    if (shellHeader && name !== null && ["TopBar", "NavigationFeatureNav"].includes(name)) { ownsBar = true; return false }
    if (!isBarControl(context, opening, name)) return
    const role = clusterRole(context, opening, name)
    controls.push(controlSignature(context, opening, name, role, ancestors))
    return false
  }, new Set(), (node) => {
    if (!choices.has(node)) branches.push(node)
    return choices.get(node) ?? "consequent"
  })
  return { controls, branches, ownsBar }
}

const controlSignature = (context: ReaderContext, opening: TSESTree.JSXOpeningElement, name: string | null, role: string | null, ancestors: readonly TSESTree.JSXOpeningElement[]): string => {
  const signature = `${role ?? "unknown"}:${name}`
  const expected = role === null ? undefined : EXPECTED_DISCLOSURE[role]
  const disclosure = [...ancestors].reverse().map((ancestor) => grammarName(context, ancestor)).find((parent) => parent === "DropdownMenu" || parent === "Popover")
  if (expected && disclosure !== expected) return `${signature}:wrong-disclosure`
  if (role === "language") {
    const variant = propOf(context, opening, "variant")
    if (!variant.known || variant.value !== null && textProp(context, opening, "variant") !== "tertiary") return `${signature}:wrong-variant`
  }
  return signature
}

const rightGroup = (context: ReaderContext, expression: Resolved | null | undefined, choices: Choices): Resolved | null | undefined => {
  let group: TSESTree.JSXElement | null = null
  let count = Number.POSITIVE_INFINITY
  const roles = controlsOf(context, expression, choices).controls.filter((role) => !role.startsWith("unknown:"))
  visitVisible(context, expression, (opening, name) => {
    if (isBarControl(context, opening, name)) return false
    const result = controlsOf(context, opening.parent, choices)
    const known = result.controls.filter((role) => !role.startsWith("unknown:"))
    if (roles.length > 0 && known.length === roles.length && roles.every((role) => known.includes(role)) && result.controls.length < count) {
      group = opening.parent
      count = result.controls.length
    }
    return undefined
  }, new Set(), (node) => choices.get(node) ?? "consequent")
  return group ?? expression
}

/** Every reachable branch yields its own sequence; shell headers select the narrowest right-hand group. */
export const clusterAlternatives = (context: ReaderContext, expression: Resolved | null | undefined, shellHeader: boolean): { alternatives: string[][]; ownsBar: boolean } => {
  const pending: Choices[] = [new Map()]
  const alternatives: string[][] = []
  for (let choices = pending.pop(); choices; choices = pending.pop()) {
    const initial = controlsOf(context, expression, choices, shellHeader)
    if (initial.ownsBar) return { alternatives: [], ownsBar: true }
    const group = shellHeader ? rightGroup(context, expression, choices) : expression
    const result = controlsOf(context, group, choices)
    const current: Choices = choices
    const unknown = [...initial.branches, ...result.branches].find((node) => !current.has(node))
    if (unknown) {
      pending.push(new Map([...choices, [unknown, "alternate"]]), new Map([...choices, [unknown, "consequent"]]))
    } else alternatives.push(result.controls)
  }
  return { alternatives, ownsBar: false }
}
