/**
 * The types every law module shares: the rule a law publishes, the context ESLint hands its `create`, the AST node it walks
 * and the recommended levels it asks for. They are typescript-eslint's own (`@typescript-eslint/utils`), since every file the
 * canon lints is parsed by `@typescript-eslint/parser` and carries its TypeScript nodes (decorators, parameter properties,
 * type annotations) beside the ESTree ones.
 */
import type { TSESLint, TSESTree } from "@typescript-eslint/utils"

/** Any node of the typescript-eslint AST. */
export type Node = TSESTree.Node

/** The options a canon rule receives: every rule reads its options as data and checks them itself. */
export type RuleOptions = unknown[]

/** The context of one rule run. */
export type Context = Readonly<TSESLint.RuleContext<string, RuleOptions>>

/** The visitor a rule's `create` returns. */
export type RuleListener = TSESLint.RuleListener

/** One rule a law publishes. */
export type RuleModule = TSESLint.RuleModule<string, RuleOptions>

/** The rules of a law (or of the plugin), by published name. */
export type Rules = Readonly<Record<string, RuleModule>>

/** A level ESLint understands. */
export type Level = "error" | "warn" | "off"

/** A recommended entry: a level, or a level with the rule's options (ESLint's own shape). */
export type RuleEntry = TSESLint.SharedConfig.RuleEntry

/** The recommended levels of a law, by `starci-be/<name>` (or a stock rule's own name). */
export type Recommended = Readonly<Record<string, RuleEntry>>

/** A single report a rule makes. */
export type Report = TSESLint.ReportDescriptor<string>

/** A comment of the linted source. */
export type Comment = TSESTree.Comment

/** Whether a value is a node of the typescript-eslint AST (any object with a string `type`). */
export const isNode = (value: unknown): value is Node =>
    value !== null && typeof value === "object" && "type" in value && typeof value.type === "string"
