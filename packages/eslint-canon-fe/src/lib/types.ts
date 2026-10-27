/**
 * Type-aware helpers of the front-end canon: a rule asks what a node IS (its TypeScript type, the symbol an identifier
 * resolves to, the module a declaration comes from), never what it is called. `starciFeConfig` turns typed linting on for
 * the source tree (`parserOptions.projectService`), so these helpers refuse to run without the program instead of falling
 * back to a name match.
 */
import ts from "typescript"
import type { AnyContext, Node } from "./rule.ts"

/** The TypeScript services of a linted file: its program, the checker and the ESTree to TS node map. */
export interface Typed {
  readonly program: ts.Program
  readonly checker: ts.TypeChecker
  readonly toTs: (node: Node) => ts.Node | undefined
}

/**
 * The TypeScript services of the file being linted.
 *
 * @param context - The ESLint rule context.
 * @returns The program, its checker and the ESTree to TS node map.
 */
export const typed = (context: AnyContext): Typed => {
  const services = context.sourceCode?.parserServices ?? context.parserServices
  if (!services?.program || !services.esTreeNodeToTSNodeMap) {
    throw new Error(`${context.id ?? "a starci-fe rule"} needs typed linting (parserOptions.projectService); lint through starciFeConfig, which turns it on`)
  }
  const program = services.program
  const map = services.esTreeNodeToTSNodeMap
  return { program, checker: program.getTypeChecker(), toTs: (node) => map.get(node) }
}

/**
 * True when the type of an expression is a promise (a thenable carrying a `then` method), after union members are read.
 *
 * @param context - The ESLint rule context.
 * @param node - An ESTree expression.
 * @returns Whether evaluating the node yields a promise.
 */
export const isPromiseValued = (context: AnyContext, node: Node): boolean => {
  const { checker, toTs } = typed(context)
  const tsNode = toTs(node)
  if (!tsNode) return false
  const type = checker.getTypeAtLocation(tsNode)
  const parts = type.isUnion() ? type.types : [type]
  return parts.some((part) => Boolean(part.getProperty("then")))
}

/**
 * The declarations the symbol of an identifier resolves to, after import aliases are followed.
 *
 * @param context - The ESLint rule context.
 * @param identifier - An ESTree identifier (or any node with a symbol).
 * @returns The TypeScript declarations (empty when the checker has no symbol).
 */
export const declarationsOf = (context: AnyContext, identifier: Node): ts.Declaration[] => {
  const { checker, toTs } = typed(context)
  const tsNode = toTs(identifier)
  if (!tsNode) return []
  let symbol = checker.getSymbolAtLocation(tsNode)
  if (!symbol) return []
  if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol)
  return symbol.getDeclarations() ?? []
}

/**
 * The forward-slash file name a declaration lives in.
 *
 * @param declaration - A TypeScript declaration.
 * @returns Its source file name.
 */
export const fileOf = (declaration: ts.Node): string => String(declaration.getSourceFile().fileName).split("\\").join("/")
