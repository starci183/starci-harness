/**
 * The Custom region: the one sanctioned place where anything goes.
 *
 * `<Custom reason="...">` (from `@starci/grammar`) is a region where the app writes any markup, any class name and uses any
 * library (a graph editor, an animation library, a chart toolkit) because no Grammar component fits. The rest of the page still
 * follows the Grammar. No Grammar law and no canon front-end law that judges markup, look or libraries reports anything about
 * code inside a Custom subtree of the same file; code outside it is judged exactly as before.
 *
 * WHAT COUNTS AS INSIDE.
 * - A node of the `<Custom>` element: its attributes (`className`, `style`, `as`) and everything it renders as children.
 * - An import (`import { ReactFlow } from "@xyflow/react"`) whose every use sits inside Custom: the import line is at the top of the
 *   file, but the library is used only there, so it is not judged either. A binding with no use, a side-effect import or a use
 *   outside Custom keeps the import judged.
 * - A same-file helper that only Custom reaches: a top-level function or component that is not exported and whose every use is
 *   inside Custom (or inside another such helper). Its body is Custom code, so a graph canvas written as a small component and
 *   rendered as `<Custom reason="..."><Canvas /></Custom>` may call the library's hooks.
 *
 * WHICH `Custom`. The element is recognised only when its name is imported from `@starci/grammar` (`Custom` or `<ns>.Custom`):
 * an app's own component called `Custom` opens no exemption.
 *
 * WHAT STAYS JUDGED. The lint-escape-hatch, hygiene, comment, type-safety, translation, transport and project-graph laws are not
 * wrapped: no region switches the repository's own integrity rules off. The audit inventory (`custom-inventory`) and the reason
 * law (`custom-has-reason`) judge the `<Custom>` element itself and are never wrapped.
 */
import type { TSESLint, TSESTree } from "@typescript-eslint/utils"
import { isNode } from "./ast.ts"
import { importOf } from "./bindings.ts"
import type { AnyContext, Node, Rule } from "./rule.ts"

/** The Grammar package entries a component can be imported from. */
const GRAMMAR_SOURCE = /^@starci\/grammar(?:\/(?:common|core|offset-pop))?$/

/** The element name of a JSX name: `Custom`, or `G.Custom` as `Custom`. */
const nameOf = (name: TSESTree.JSXTagNameExpression): string | null => {
  if (name.type === "JSXIdentifier") return name.name
  if (name.type === "JSXMemberExpression") return name.property.name
  return null
}

/** The leftmost identifier of a JSX name (`G` of `G.Custom`), or null for a namespaced name. */
const rootOf = (name: TSESTree.JSXTagNameExpression): TSESTree.JSXIdentifier | null => {
  if (name.type === "JSXIdentifier") return name
  if (name.type === "JSXMemberExpression") return rootOf(name.object)
  return null
}

/** True for a `Custom` element of the Grammar. */
export const isCustomElement = (context: AnyContext, element: TSESTree.JSXElement): boolean => {
  const name = element.openingElement.name
  if (nameOf(name) !== "Custom") return false
  const root = rootOf(name)
  if (root === null) return false
  const origin = importOf(context, root)
  return origin !== null && origin !== undefined && GRAMMAR_SOURCE.test(origin.source)
}

/** The `<Custom>` elements of a file: where its regions are. */
const customElements = (context: AnyContext): readonly TSESTree.JSXElement[] => {
  const found: TSESTree.JSXElement[] = []
  const keys = context.sourceCode.visitorKeys
  const visit = (node: Node): void => {
    if (node.type === "JSXElement" && isCustomElement(context, node)) found.push(node)
    for (const key of keys[node.type] ?? []) {
      const value: unknown = Reflect.get(node, key)
      if (Array.isArray(value)) for (const item of value) { if (isNode(item)) visit(item) }
      else if (isNode(value)) visit(value)
    }
  }
  visit(context.sourceCode.ast)
  return found
}

/** What a file's Custom analysis found: its regions and the same-file helpers only they reach. */
interface Analysis {
  readonly regions: readonly (readonly [number, number])[]
  readonly helpers: readonly (readonly [number, number])[]
}

const analyses = new WeakMap<object, Analysis>()

/** True when `range` lies inside one of `ranges`. */
const within = (range: readonly [number, number], ranges: readonly (readonly [number, number])[]): boolean =>
  ranges.some(([start, end]) => range[0] >= start && range[1] <= end)

/** The top-level function-like declarations of a file that no other file can reach: `function F`, `const F = () =>`, not exported. */
const privateCandidates = (program: TSESTree.Program): { readonly name: string; readonly node: Node }[] => {
  const found: { readonly name: string; readonly node: Node }[] = []
  for (const statement of program.body) {
    if (statement.type === "FunctionDeclaration" && statement.id !== null) found.push({ name: statement.id.name, node: statement })
    if (statement.type !== "VariableDeclaration") continue
    for (const declarator of statement.declarations) {
      const init = declarator.init
      if (declarator.id.type !== "Identifier" || init === null || init === undefined) continue
      if (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression") found.push({ name: declarator.id.name, node: statement })
    }
  }
  return found
}

/** The identifier nodes that refer to a variable. */
const referenceRanges = (variable: TSESLint.Scope.Variable): (readonly [number, number])[] =>
  variable.references.map((reference) => reference.identifier.range)

/** The analysis of the file the context lints. */
const analyse = (context: AnyContext): Analysis => {
  const ast = context.sourceCode.ast
  const cached = analyses.get(ast)
  if (cached !== undefined) return cached
  const regions = customElements(context).map((element): readonly [number, number] => element.range)
  const candidates = privateCandidates(ast)
  const variables = new Map<string, TSESLint.Scope.Variable>()
  const globalScope = context.sourceCode.scopeManager?.globalScope
  const moduleScope = globalScope?.childScopes.find((scope) => scope.type === "module") ?? globalScope
  for (const candidate of candidates) {
    const variable = moduleScope?.set.get(candidate.name)
    if (variable !== undefined) variables.set(candidate.name, variable)
  }
  // The greatest set of helpers each of whose uses is in a region or in another helper of the set.
  let helpers = candidates.filter((candidate) => variables.has(candidate.name))
  for (let changed = true; changed;) {
    changed = false
    const ranges = [...regions, ...helpers.map((helper): readonly [number, number] => helper.node.range)]
    const kept = helpers.filter((candidate) => {
      const variable = variables.get(candidate.name)
      if (variable === undefined) return false
      const own = candidate.node.range
      const uses = referenceRanges(variable).filter((range) => !within(range, [own]))
      return uses.length > 0 && uses.every((range) => within(range, ranges))
    })
    if (kept.length !== helpers.length) {
      helpers = kept
      changed = true
    }
  }
  const analysis: Analysis = { regions, helpers: helpers.map((helper): readonly [number, number] => helper.node.range) }
  analyses.set(ast, analysis)
  return analysis
}

/** True when a node lies inside a Custom region, or inside a same-file helper that only Custom reaches. */
export const inCustom = (context: AnyContext, node: Node): boolean => {
  const analysis = analyse(context)
  if (analysis.regions.length === 0) return false
  return within(node.range, analysis.regions) || within(node.range, analysis.helpers)
}

/** The import declaration a node belongs to, or null. */
const importOwner = (node: Node): TSESTree.ImportDeclaration | null => {
  for (let current: Node | null | undefined = node; current !== undefined && current !== null; current = current.parent) {
    if (current.type === "ImportDeclaration") return current
    if (current.type === "Program") return null
  }
  return null
}

/** True for an import whose every binding is used, and used only inside Custom. */
export const importUsedOnlyInCustom = (context: AnyContext, declaration: TSESTree.ImportDeclaration): boolean => {
  if (declaration.specifiers.length === 0) return false
  const analysis = analyse(context)
  if (analysis.regions.length === 0) return false
  const ranges = [...analysis.regions, ...analysis.helpers]
  for (const variable of context.sourceCode.getDeclaredVariables(declaration)) {
    const uses = variable.references.map((reference) => reference.identifier.range)
    if (uses.length === 0 || !uses.every((range) => within(range, ranges))) return false
  }
  return true
}

/** The node a report descriptor is about: its `node`, or the node at its `loc` start. */
const reportedNode = (context: AnyContext, descriptor: unknown): Node | null => {
  if (typeof descriptor !== "object" || descriptor === null) return null
  const node: unknown = Reflect.get(descriptor, "node")
  if (isNode(node)) return node
  const loc: unknown = Reflect.get(descriptor, "loc")
  const start: unknown = typeof loc === "object" && loc !== null ? Reflect.get(loc, "start") ?? loc : undefined
  if (typeof start !== "object" || start === null) return null
  const line: unknown = Reflect.get(start, "line")
  const column: unknown = Reflect.get(start, "column")
  if (typeof line !== "number" || typeof column !== "number") return null
  const found: unknown = context.sourceCode.getNodeByRangeIndex(context.sourceCode.getIndexFromLoc({ line, column }))
  return isNode(found) ? found : null
}

/** True for a rule context that can read the source (it carries the source code). */
const readsSource = (context: object): context is AnyContext => "sourceCode" in context

/**
 * The context a rule is given: the same context, whose `report` drops a finding about code inside Custom, and a finding about an import
 * whose every use is inside Custom. Every other property, and every other finding, is the original's.
 */
export const customContext = <C extends object>(context: C): C => {
  const report: unknown = Reflect.get(context, "report")
  if (typeof report !== "function") return context
  const judged = (descriptor: unknown, ...rest: unknown[]): unknown => {
    if (readsSource(context)) {
      const node = reportedNode(context, descriptor)
      if (node !== null) {
        if (inCustom(context, node)) return undefined
        const owner = importOwner(node)
        if (owner !== null && importUsedOnlyInCustom(context, owner)) return undefined
      }
    }
    return Reflect.apply(report, context, [descriptor, ...rest])
  }
  return Object.create(context, { report: { value: judged, enumerable: true } })
}

/** The rules already wrapped by `exemptCustom`: a rule is wrapped once, whichever law gathers it. */
const wrapped = new WeakSet<object>()

/**
 * A canon rule that leaves the code of a Custom region alone. The wrapping is done on the rule itself (its `create`), so the rule a law
 * module exports, the rule a plugin publishes and the rule a spec runs are one object and all of them leave the region alone.
 */
export const exemptCustom = <M extends string, O extends readonly unknown[]>(rule: Rule<M, O>): Rule<M, O> => {
  if (wrapped.has(rule)) return rule
  wrapped.add(rule)
  const create = rule.create
  rule.create = (context: Readonly<TSESLint.RuleContext<M, O>>) => create.call(rule, customContext(context))
  return rule
}

/** The rules of a law, each leaving the code of a Custom region alone. */
export const exemptCustomRules = <R extends Readonly<Record<string, Rule<string, readonly unknown[]>>>>(rules: R): R => {
  for (const rule of Object.values(rules)) exemptCustom(rule)
  return rules
}
