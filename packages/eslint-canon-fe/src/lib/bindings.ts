/**
 * Bindings of the front-end canon: what an identifier resolves to through the scope manager, which module an import
 * comes from, which function a name stands for, and a stable KEY for an expression that names a place (a variable, a
 * member path, `this.x`). A rule that must decide "is this the same handle / target / listener" compares keys, never
 * spellings: two `id` variables in different scopes have different keys, `timerRef.current` has one key wherever it is
 * written.
 */
import type { TSESLint, TSESTree } from "@typescript-eslint/utils"
import { stringOf } from "./ast.ts"
import type { AnyContext, Node } from "./rule.ts"

/** A variable of the scope manager. */
export type Variable = TSESLint.Scope.Variable

/** A function node: an expression, an arrow or a declaration. */
export type FunctionNode = TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression | TSESTree.FunctionDeclaration

/** A wrapper that changes a node's type, not its identity. */
type TransparentNode =
  | TSESTree.TSAsExpression
  | TSESTree.TSNonNullExpression
  | TSESTree.TSSatisfiesExpression
  | TSESTree.TSTypeAssertion
  | TSESTree.ChainExpression

/** The globals that all name the browser's global object. */
const GLOBAL_OBJECT = new Set(["window", "globalThis", "self"])

/** Wrappers that change a node's type, not its identity. */
const TRANSPARENT = new Set(["TSAsExpression", "TSNonNullExpression", "TSSatisfiesExpression", "TSTypeAssertion", "ChainExpression", "ParenthesizedExpression"])

/** True for a node that only wraps the type of its `expression`. */
const isTransparent = (node: Node): node is TransparentNode => TRANSPARENT.has(node.type)

/**
 * The node without the wrappers that only change its type (`x as T`, `x!`, `x?.y`).
 *
 * @param node - An ESTree node.
 * @returns The inner node.
 */
export function unwrap(node: Node): Node
export function unwrap(node: Node | null | undefined): Node | null | undefined
export function unwrap(node: Node | null | undefined): Node | null | undefined {
  let current = node
  while (current && isTransparent(current)) current = current.expression
  return current
}

/**
 * The node's parent with the type-only wrappers skipped upward.
 *
 * @param node - An ESTree node.
 * @returns The first parent that is not a type-only wrapper.
 */
export const parentOf = (node: Node): Node | null => {
  let current = node.parent
  while (current && TRANSPARENT.has(current.type)) current = current.parent
  return current ?? null
}

/** True for a function expression, an arrow function or a function declaration. */
export const isFn = (node: Node | null | undefined): node is FunctionNode =>
  Boolean(node) && (node?.type === "FunctionExpression" || node?.type === "ArrowFunctionExpression" || node?.type === "FunctionDeclaration")

/**
 * The scope-manager variable an identifier resolves to, or null for a global.
 *
 * @param context - The ESLint rule context.
 * @param identifier - An ESTree identifier.
 * @returns The variable.
 */
export const variableOf = (context: AnyContext, identifier: TSESTree.Identifier | TSESTree.JSXIdentifier): Variable | null => {
  for (let scope: TSESLint.Scope.Scope | null = context.sourceCode.getScope(identifier); scope; scope = scope.upper) {
    const variable = scope.set.get(identifier.name)
    if (variable) return variable
  }
  return null
}

/** Where an identifier was imported from: the module specifier and the imported name (`null` for a default or namespace import). */
export interface ImportOrigin {
  readonly source: string
  readonly imported: string | null
}

/**
 * Where an identifier was imported from.
 *
 * @param context - The ESLint rule context.
 * @param identifier - An ESTree identifier.
 * @returns The origin, or null when the identifier is not an import.
 */
export const importOf = (context: AnyContext, identifier: TSESTree.Identifier | TSESTree.JSXIdentifier): ImportOrigin | null => {
  const variable = variableOf(context, identifier)
  const definition = variable?.defs.find((entry) => entry.type === "ImportBinding")
  if (!definition || definition.type !== "ImportBinding") return null
  const specifier = definition.node
  const parent = definition.parent
  const source = String(parent.type === "ImportDeclaration" ? parent.source.value : undefined)
  if (specifier.type === "ImportSpecifier") {
    return { source, imported: specifier.imported.type === "Identifier" ? specifier.imported.name : String(specifier.imported.value) }
  }
  return { source, imported: null }
}

/** One step of a property path: a property name, a numeric key, or null for a computed key with no static text. */
export type PathStep = string | number | null

/** The property path a destructured binding selects from its initializer; null for an unselected or rest binding. */
export const patternPath = (pattern: Node, name: string): PathStep[] | null => {
  if (pattern.type === "Identifier") return pattern.name === name ? [] : null
  if (pattern.type === "AssignmentPattern") return patternPath(pattern.left, name)
  if (pattern.type !== "ObjectPattern") return null
  for (const property of pattern.properties) {
    if (property.type !== "Property") continue
    const nested = patternPath(property.value, name)
    if (nested !== null) {
      const key = property.key
      const step: PathStep = property.computed ? stringOf(key) : key.type === "Identifier" ? key.name : key.type === "Literal" ? propertyValue(key.value) : null
      return [step, ...nested]
    }
  }
  return null
}

/** The value of a literal property key, as the path step it names. */
const propertyValue = (value: TSESTree.Literal["value"]): PathStep =>
  typeof value === "string" || typeof value === "number" ? value : value === null ? null : String(value)

/**
 * The function an expression stands for: the function itself, or the function a same-file variable or declaration holds.
 *
 * @param context - The ESLint rule context.
 * @param node - An ESTree expression.
 * @returns The function node, or null when it cannot be resolved in this file.
 */
export const functionOf = (context: AnyContext, node: Node | null | undefined): FunctionNode | null => {
  const inner = unwrap(node)
  if (!inner) return null
  if (isFn(inner)) return inner
  if (inner.type !== "Identifier") return null
  const variable = variableOf(context, inner)
  for (const definition of variable?.defs ?? []) {
    if (definition.type === "FunctionName" && definition.node.type === "FunctionDeclaration") return definition.node
    if (definition.type === "Variable" && definition.node.id.type === "Identifier") {
      const init = unwrap(definition.node.init)
      if (isFn(init)) return init
    }
  }
  return null
}

/** A stable numeric id per scope-manager variable, so keys compare by binding and not by spelling. */
const VARIABLE_IDS = new WeakMap<Variable, number>()
let nextVariableId = 1
const idOf = (variable: Variable): number => {
  const known = VARIABLE_IDS.get(variable)
  if (known !== undefined) return known
  const id = nextVariableId++
  VARIABLE_IDS.set(variable, id)
  return id
}

/**
 * The key of an expression that names a place: `v12` for a variable, `v12.current` for a member path, `this.timer` for
 * a member of `this`, `g:window` for the browser's global object under any of its names. Anything else has no key.
 *
 * @param context - The ESLint rule context.
 * @param node - An ESTree expression.
 * @returns The key.
 */
export const keyOf = (context: AnyContext, node: Node | null | undefined): string | null => {
  const inner = unwrap(node)
  if (!inner) return null
  if (inner.type === "Identifier") {
    const variable = variableOf(context, inner)
    if (variable && variable.defs.length > 0) return `v${idOf(variable)}`
    return GLOBAL_OBJECT.has(inner.name) ? "g:window" : `g:${inner.name}`
  }
  if (inner.type === "ThisExpression") return "this"
  if (inner.type === "MemberExpression") {
    const head = keyOf(context, inner.object)
    if (head === null) return null
    if (!inner.computed && inner.property.type === "Identifier") return `${head}.${inner.property.name}`
    if (inner.computed && inner.property.type === "Literal") return `${head}[${String(inner.property.value)}]`
    return null
  }
  return null
}

/** The receiver and the member name of a call written as `receiver.name(...)`, or the bare name of `name(...)`. */
export interface CalleeParts {
  readonly receiver: TSESTree.Expression | null
  readonly name: string
}

/**
 * The receiver and the member name of a call written as `receiver.name(...)`, or the bare name of `name(...)`.
 *
 * @param call - An ESTree call expression.
 * @returns The parts, or null for a computed or exotic callee.
 */
export const calleeParts = (call: TSESTree.CallExpression | TSESTree.NewExpression): CalleeParts | null => {
  const callee = unwrap(call.callee)
  if (callee.type === "Identifier") return { receiver: null, name: callee.name }
  if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier") return { receiver: callee.object, name: callee.property.name }
  return null
}
