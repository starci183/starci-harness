/** Traverse only the visible bar composition and its local React owners. */
import type { TSESTree } from "@typescript-eslint/types"
import { functionOf, variableOf } from "@starci/eslint-canon-fe/lib/bindings.mjs"
import { grammarName, propOf, realNode, resolveLocal } from "./app-shell.ts"
import type { FunctionNode, Node, ReaderContext, Resolved } from "./types.ts"

const BAR_SLOTS: Readonly<Record<string, readonly string[]>> = {
  WorkspaceShell: ["header", "compactHeader"],
  TopBar: ["brand", "navigation", "actions"],
  NavigationFeatureNav: ["identity", "navigation", "actions", "compactNavigationTrigger"],
  DropdownMenu: ["trigger"],
  Popover: ["trigger"],
  Drawer: ["trigger"],
}

/** Which side of a conditional the traversal follows: one branch, or `both`. */
export type Choice = "consequent" | "alternate" | "both"

/** Called for every visible opening element; returning `false` skips its slots and children. */
export type Visit = (opening: TSESTree.JSXOpeningElement, name: string | null, ancestors: readonly TSESTree.JSXOpeningElement[]) => boolean | void

/** Decides, per conditional node, which branch to follow. */
export type Branch = (node: Node) => Choice

type Next = (child: Resolved | null | undefined) => void

/** Visible JSX composition only: menu, popover and drawer bodies are outside the navbar band. */
export const visitVisible = (context: ReaderContext, expression: Resolved | null | undefined, visit: Visit, seen: Set<Resolved> = new Set(), branch: Branch = () => "both", ancestors: readonly TSESTree.JSXOpeningElement[] = []): void => {
  const node = resolveLocal(context, expression)
  if (!node || seen.has(node)) return
  const visited = new Set(seen).add(node)
  const next: Next = (child) => visitVisible(context, child, visit, visited, branch, ancestors)
  switch (node.type) {
    case "JSXExpressionContainer": next(node.expression); break
    case "JSXFragment": for (const child of node.children) next(child); break
    case "ConditionalExpression": visitConditional(node, next, branch); break
    case "LogicalExpression": visitLogical(context, node, next, branch); break
    case "ArrayExpression": for (const item of node.elements) next(item); break
    case "JSXElement": visitElement(context, node, visit, visited, branch, ancestors); break
    default:
  }
}

const visitConditional = (node: TSESTree.ConditionalExpression, next: Next, branch: Branch): void => {
  const choice = branch(node)
  if (choice !== "alternate") next(node.consequent)
  if (choice !== "consequent") next(node.alternate)
}

const visitLogical = (context: ReaderContext, node: TSESTree.LogicalExpression, next: Next, branch: Branch): void => {
  const left = resolveLocal(context, node.left)
  const known = left?.type === "Literal"
  const leftValue = left?.type === "Literal" ? left.value : undefined
  let right = node.operator === "&&" ? Boolean(leftValue) : !leftValue
  if (node.operator === "??") right = leftValue === null
  if (!known) {
    const choice = branch(node)
    if (choice === "both") { next(node.left); next(node.right); return }
    right = choice === "consequent"
  }
  next(right ? node.right : node.left)
}

const visitElement = (context: ReaderContext, node: TSESTree.JSXElement, visit: Visit, seen: Set<Resolved>, branch: Branch, ancestors: readonly TSESTree.JSXOpeningElement[]): void => {
  const opening = node.openingElement
  const name = grammarName(context, opening)
  if (visit(opening, name, ancestors) === false) return
  const inside = [...ancestors, opening]
  const next: Next = (child) => visitVisible(context, child, visit, seen, branch, inside)
  if (name === null && opening.name.type === "JSXIdentifier") {
    const fn = functionOf(context, realNode(resolveLocal(context, opening.name))) ?? variableOf(context, opening.name)?.defs.find((definition) => definition.type === "FunctionName")?.node
    if (fn) visitFunction(context, fn, visit, seen, branch, inside)
  }
  const slots = name === null ? undefined : BAR_SLOTS[name]
  if (slots) for (const slot of slots) next(propOf(context, opening, slot).value)
  if (name !== null && ["DropdownMenu", "Popover", "Drawer"].includes(name)) return
  for (const child of node.children) next(child)
}

/** Visit a rendered owner's returns with the same branch, overlay and local-binding semantics as inline JSX. */
export const visitFunction = (context: ReaderContext, fn: FunctionNode, visit: Visit, seen: Set<Resolved>, branch: Branch, ancestors: readonly TSESTree.JSXOpeningElement[]): void => {
  if (fn.body.type !== "BlockStatement") return visitVisible(context, fn.body, visit, seen, branch, ancestors)
  visitStatements(context, fn.body.body, visit, seen, branch, ancestors)
}

const visitStatements = (context: ReaderContext, statements: readonly TSESTree.Statement[], visit: Visit, seen: Set<Resolved>, branch: Branch, ancestors: readonly TSESTree.JSXOpeningElement[]): boolean => {
  for (const statement of statements) {
    if (statement.type === "ReturnStatement") {
      visitVisible(context, statement.argument, visit, seen, branch, ancestors)
      return true
    }
    if (statement.type === "BlockStatement" && visitStatements(context, statement.body, visit, seen, branch, ancestors)) return true
    if (statement.type === "IfStatement") {
      if (visitIf(context, statement, visit, seen, branch, ancestors)) return true
    }
  }
  return false
}

const visitIf = (context: ReaderContext, statement: TSESTree.IfStatement, visit: Visit, seen: Set<Resolved>, branch: Branch, ancestors: readonly TSESTree.JSXOpeningElement[]): boolean | null => {
  const condition = resolveLocal(context, statement.test)
  let choice = branch(statement)
  if (condition?.type === "Literal") choice = condition.value ? "consequent" : "alternate"
  const consequent = choice !== "alternate" && visitStatements(context, [statement.consequent], visit, seen, branch, ancestors)
  const alternate = choice !== "consequent" && statement.alternate && visitStatements(context, [statement.alternate], visit, seen, branch, ancestors)
  return choice === "consequent" && consequent || choice === "alternate" && alternate || consequent && alternate
}
