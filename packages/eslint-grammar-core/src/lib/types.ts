/**
 * The AST and rule-context types this package's rules are written against.
 *
 * Every rule runs under `@typescript-eslint/parser` (`coreGrammarConfig` sets it), so the nodes it receives are the
 * typescript-eslint tree (`TSESTree`: ESTree plus JSX and TypeScript nodes, each with its `parent`). ESLint's own
 * declarations describe plain ESTree, so the rule context is restated here with the node type the parser produces.
 */
import type { AST, Rule, Scope } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"

/** Any node of the typescript-eslint tree. */
export type Node = TSESTree.Node

/** The function-shaped nodes the readers follow. */
export type FunctionNode = TSESTree.FunctionDeclaration | TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression

/** An identifier-like name a scope lookup accepts. */
export type NameNode = TSESTree.Identifier | TSESTree.JSXIdentifier

/** What the scope manager records for a declaration: only the definition kinds the readers inspect are named. */
export type ScopeDefinition =
  | { readonly type: "Variable"; readonly node: TSESTree.VariableDeclarator; readonly parent: TSESTree.VariableDeclaration }
  | {
    readonly type: "ImportBinding"
    readonly node: TSESTree.ImportSpecifier | TSESTree.ImportDefaultSpecifier | TSESTree.ImportNamespaceSpecifier
    readonly parent: TSESTree.ImportDeclaration
  }
  | { readonly type: "FunctionName"; readonly node: TSESTree.FunctionDeclaration | TSESTree.FunctionExpression; readonly parent: null }
  | { readonly type: "Parameter" | "ClassName" | "CatchClause" | "TSEnumName" | "TSModuleName" | "Type" | "ImportEqualsBinding" | "ImplicitGlobalVariable"; readonly node: Node; readonly parent: Node | null }

/** A scope-manager variable: its name and where it is declared. */
export interface ScopeVariable {
  readonly name: string
  readonly defs: readonly ScopeDefinition[]
}

/** The source-code object of a linted (or independently parsed) file, with the parser's node type. */
export interface SourceView {
  readonly ast: AST.Program
  readonly text: string
  readonly visitorKeys: Readonly<Record<string, readonly string[] | undefined>>
  getText(node?: Node): string
  getScope(node: Node): Scope.Scope
  getCommentsBefore(node: Node): readonly SourceComment[]
}

/** A comment of the linted file: `Block` for `/* *\/`, `Line` for `//`. */
export interface SourceComment {
  readonly type: "Block" | "Line"
  readonly value: string
  readonly range: readonly [number, number]
}

/** The parts of a rule context a reader needs; an independently parsed file offers exactly these. */
export interface ReaderContext {
  readonly filename: string
  readonly id?: string
  readonly settings: Rule.RuleContext["settings"]
  readonly sourceCode: SourceView
  getFilename?(): string
}

/** An independently parsed file: the reader context plus the typescript-eslint tree its parse produced. */
export interface ParsedContext extends ReaderContext {
  readonly program: TSESTree.Program
}

/** A finding a rule reports. */
export interface ReportDescriptor {
  readonly node: Node
  readonly messageId: string
  readonly data?: Readonly<Record<string, unknown>>
  readonly fix?: (fixer: Rule.RuleFixer) => Rule.Fix | null
}

/** The rule context of a rule that reports. */
export interface Context extends ReaderContext {
  getFilename(): string
  report(descriptor: ReportDescriptor): void
}

/** The visitor of a rule: a handler per node type, each receiving that node type. */
export type Listener = { [K in Node["type"]]?: (node: Extract<Node, { type: K }>) => void }

/** A rule whose `create` is written against the parser's node type. */
export interface RuleDefinition {
  readonly meta: Rule.RuleMetaData
  create(context: Context): Listener
}

/**
 * A member access the readers synthesize for a destructured binding (`const { A: B } = ns` reads as `ns.A`) or a JSX member
 * name (`<ns.A />`): it has no source position and no parent, so it is not a node of the parsed tree.
 */
export interface SyntheticMember {
  readonly type: "MemberExpression"
  readonly object: Node | null
  readonly property: Node
  readonly computed: boolean
}

/** What resolving a local expression yields: a real node, or a synthesized member access. */
export type Resolved = Node | SyntheticMember

/** True for a node of the parsed tree; a synthesized member has no source range. */
export const isNode = (value: Resolved): value is Node => "range" in value

/** The opened slot manifest and resolver of an app or side folder (the runtime's `openHfs` result): what the layout loader reads. */
export interface OpenedHfs {
  readonly repo: {
    readonly profile: string
    readonly side?: string | null
    readonly apps: readonly { readonly name: string; readonly kind: string }[]
  }
}
