/**
 * The types every law of the canon is written in: the typescript-eslint AST (JSX and TypeScript nodes included, which
 * ESLint's own ESTree types lack), its rule module, context and listener, and the shape a law module exports.
 */
import type { TSESLint, TSESTree } from "@typescript-eslint/utils"

/** Any node the parser produces. */
export type Node = TSESTree.Node

/** A rule module with message ids `M` and options `O`. */
export type Rule<M extends string = string, O extends readonly unknown[] = readonly unknown[]> = TSESLint.RuleModule<M, O>

/** The context a rule's `create` receives. */
export type Context<M extends string = string, O extends readonly unknown[] = readonly unknown[]> = Readonly<
  TSESLint.RuleContext<M, O>
>

/** The context of any rule, whatever its messages: what the shared readers take. */
export type AnyContext = Readonly<TSESLint.RuleContext<string, readonly unknown[]>>

/** The source code a context reads. */
export type SourceCode = Readonly<TSESLint.SourceCode>

/** The visitor a rule returns. */
export type Listener = TSESLint.RuleListener

/** A comment of the source. */
export type Comment = TSESTree.Comment

/** The rules a law publishes, by name. */
export type Rules = Readonly<Record<string, Rule<string, readonly unknown[]>>>

/** The level a law asks for each of its rules, by `starci-fe/<name>`. */
export type Recommended = Readonly<Record<string, "error">>

/**
 * A rule with its message ids and options inferred from the literal: `defineRule({ meta: { messages: { a: "..." } }, ... })`
 * types `context.report({ messageId })` against `a`. It returns the object it is given.
 */
export const defineRule = <M extends string, O extends readonly unknown[] = []>(rule: Rule<M, O>): Rule<M, O> => rule
