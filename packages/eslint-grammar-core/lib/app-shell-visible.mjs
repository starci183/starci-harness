/** Traverse only the visible bar composition and its local React owners. */
import { functionOf, variableOf } from "@starci/eslint-canon-fe/lib/bindings.mjs"
import { grammarName, propOf, resolveLocal } from "./app-shell.mjs"

const BAR_SLOTS = {
  WorkspaceShell: ["header", "compactHeader"],
  TopBar: ["brand", "navigation", "actions"],
  NavigationFeatureNav: ["identity", "navigation", "actions", "compactNavigationTrigger"],
  DropdownMenu: ["trigger"],
  Popover: ["trigger"],
  Drawer: ["trigger"],
}

/** Visible JSX composition only: menu, popover and drawer bodies are outside the navbar band. */
export const visitVisible = (context, expression, visit, seen = new Set(), branch = () => "both", ancestors = []) => {
  const node = resolveLocal(context, expression)
  if (!node || seen.has(node)) return
  const visited = new Set(seen).add(node)
  const next = (child) => visitVisible(context, child, visit, visited, branch, ancestors)
  switch (node.type) {
    case "JSXExpressionContainer": next(node.expression); break
    case "JSXFragment": for (const child of node.children) next(child); break
    case "ConditionalExpression": visitConditional(node, next, branch); break
    case "LogicalExpression": visitLogical(context, node, next, branch); break
    case "ArrayExpression": for (const item of node.elements) next(item); break
    case "JSXElement": visitElement(context, node, visit, visited, branch, ancestors); break
  }
}

const visitConditional = (node, next, branch) => {
  const choice = branch(node)
  if (choice !== "alternate") next(node.consequent)
  if (choice !== "consequent") next(node.alternate)
}

const visitLogical = (context, node, next, branch) => {
  const left = resolveLocal(context, node.left)
  const known = left?.type === "Literal"
  let right = node.operator === "&&" ? Boolean(left?.value) : !left?.value
  if (node.operator === "??") right = left?.value === null
  if (!known) {
    const choice = branch(node)
    if (choice === "both") { next(node.left); next(node.right); return }
    right = choice === "consequent"
  }
  next(right ? node.right : node.left)
}

const visitElement = (context, node, visit, seen, branch, ancestors) => {
  const opening = node.openingElement
  const name = grammarName(context, opening)
  if (visit(opening, name, ancestors) === false) return
  const inside = [...ancestors, opening]
  const next = (child) => visitVisible(context, child, visit, seen, branch, inside)
  if (name === null && opening.name.type === "JSXIdentifier") {
    const fn = functionOf(context, resolveLocal(context, opening.name)) ?? variableOf(context, opening.name)?.defs.find((definition) => definition.type === "FunctionName")?.node
    if (fn) visitFunction(context, fn, visit, seen, branch, inside)
  }
  const slots = BAR_SLOTS[name]
  if (slots) for (const slot of slots) next(propOf(context, opening, slot).value)
  if (["DropdownMenu", "Popover", "Drawer"].includes(name)) return
  for (const child of node.children) next(child)
}

/** Visit a rendered owner's returns with the same branch, overlay and local-binding semantics as inline JSX. */
export const visitFunction = (context, fn, visit, seen, branch, ancestors) => {
  if (fn.body.type !== "BlockStatement") return visitVisible(context, fn.body, visit, seen, branch, ancestors)
  visitStatements(context, fn.body.body, visit, seen, branch, ancestors)
}

const visitStatements = (context, statements, visit, seen, branch, ancestors) => {
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

const visitIf = (context, statement, visit, seen, branch, ancestors) => {
  const condition = resolveLocal(context, statement.test)
  let choice = branch(statement)
  if (condition?.type === "Literal") choice = condition.value ? "consequent" : "alternate"
  const consequent = choice !== "alternate" && visitStatements(context, [statement.consequent], visit, seen, branch, ancestors)
  const alternate = choice !== "consequent" && statement.alternate && visitStatements(context, [statement.alternate], visit, seen, branch, ancestors)
  return choice === "consequent" && consequent || choice === "alternate" && alternate || consequent && alternate
}
