/**
 * The Freestyle region (owner ruling `grammar-freestyle-region`): the one sanctioned escape hatch of the Grammar.
 *
 * `<Freestyle reason="...">` is a region where the app writes its own plain elements and app CSS (layout, paint, radius,
 * arbitrary values, absolutely positioned art) because no Grammar component fits. The rest of the page still follows the
 * Grammar. A rule that judges hand-written elements, class strings, inline styles or generated art does not report the
 * RAW elements inside a Freestyle subtree of the same file; a Grammar component used inside it is still judged normally.
 *
 * THE EXEMPTION IS NARROW. A report is dropped only when the element it is about (the element carrying the attribute, or
 * the element itself) is `Freestyle` or is not imported from `@starci/grammar`, and that element sits in a Freestyle subtree.
 * A Grammar component inside Freestyle, and anything outside it, is judged as before. `Freestyle` is recognised by name
 * (`Freestyle` or `<ns>.Freestyle`), like the other Grammar element names the laws read.
 */
import type { TSESLint, TSESTree } from "@typescript-eslint/utils"
import { isNode } from "./ast.ts"
import { importOf } from "./bindings.ts"
import type { AnyContext, Node, Rule } from "./rule.ts"

/** The Grammar package entries a component can be imported from. */
const GRAMMAR_SOURCE = /^@starci\/grammar(?:\/(?:common|core|offset-pop))?$/

/** The element name of a JSX name: `Freestyle`, or `G.Freestyle` as `Freestyle`. */
const nameOf = (name: TSESTree.JSXTagNameExpression): string | null => {
  if (name.type === "JSXIdentifier") return name.name
  if (name.type === "JSXMemberExpression") return name.property.name
  return null
}

/** True for a `Freestyle` element name. */
const isFreestyleName = (name: TSESTree.JSXTagNameExpression): boolean => nameOf(name) === "Freestyle"

/** The opening element a node is about: the node itself, its attribute's element, or the nearest enclosing element. */
const owningOpening = (node: Node): TSESTree.JSXOpeningElement | null => {
  for (let current: Node | null | undefined = node; current !== undefined && current !== null; current = current.parent) {
    if (current.type === "JSXOpeningElement") return current
    if (current.type === "JSXElement") return current.openingElement
  }
  return null
}

/** The leftmost identifier of a JSX name (`G` of `G.Item`), or null for a namespaced name. */
const rootOf = (name: TSESTree.JSXTagNameExpression): TSESTree.JSXIdentifier | null => {
  if (name.type === "JSXIdentifier") return name
  if (name.type === "JSXMemberExpression") return rootOf(name.object)
  return null
}

/** True when the element is a Grammar component other than Freestyle: judged normally. */
const isGrammarComponent = (context: AnyContext, opening: TSESTree.JSXOpeningElement): boolean => {
  if (isFreestyleName(opening.name)) return false
  const root = rootOf(opening.name)
  if (root === null || !/^[A-Z]/.test(root.name)) return false
  const origin = importOf(context, root)
  return origin !== null && GRAMMAR_SOURCE.test(origin.source)
}

/** True when the opening element is a Freestyle element or sits inside one. */
const inFreestyle = (opening: TSESTree.JSXOpeningElement): boolean => {
  if (isFreestyleName(opening.name)) return true
  for (let current: Node | null | undefined = opening.parent?.parent; current !== undefined && current !== null; current = current.parent) {
    if (current.type === "JSXElement" && isFreestyleName(current.openingElement.name)) return true
  }
  return false
}

/** True when a reported node is a raw element (or its attribute) inside a Freestyle subtree. */
export const isFreestyleRaw = (context: AnyContext, node: Node): boolean => {
  const opening = owningOpening(node)
  return opening !== null && inFreestyle(opening) && !isGrammarComponent(context, opening)
}

/** The node a report descriptor is about, or null when it names only a location. */
const reportedNode = (descriptor: unknown): Node | null => {
  if (typeof descriptor !== "object" || descriptor === null) return null
  const node: unknown = Reflect.get(descriptor, "node")
  return isNode(node) ? node : null
}

/** True for a rule context that can resolve an import (it carries the source code). */
const readsImports = (context: object): context is AnyContext => "sourceCode" in context

/**
 * The context a rule is given inside the exemption: the same context, whose `report` drops a finding about a raw element in a
 * Freestyle subtree. Every other property, and every other finding, is the original's.
 */
export const freestyleContext = <C extends object>(context: C): C => {
  const report: unknown = Reflect.get(context, "report")
  if (typeof report !== "function") return context
  const judged = (descriptor: unknown, ...rest: unknown[]): unknown => {
    const node = reportedNode(descriptor)
    if (node !== null && readsImports(context) && isFreestyleRaw(context, node)) return undefined
    return Reflect.apply(report, context, [descriptor, ...rest])
  }
  return Object.create(context, { report: { value: judged, enumerable: true } })
}

/** A canon rule that leaves the raw elements of a Freestyle subtree alone. */
export const exemptFreestyle = <M extends string, O extends readonly unknown[]>(rule: Rule<M, O>): Rule<M, O> => ({
  ...rule,
  create: (context: Readonly<TSESLint.RuleContext<M, O>>) => rule.create(freestyleContext(context)),
})
