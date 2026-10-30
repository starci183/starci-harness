/**
 * Types for the untyped JavaScript this package imports: the front-end canon's `lib/*.mjs` (installed as a copy of
 * `@starci/eslint-canon-fe`), this package's bundled `runtime/` scripts, and the sibling canon fixtures its specs read.
 * Each block declares exactly what is imported, read from the JavaScript implementation.
 */

declare module "@starci/eslint-canon-fe/lib/ast.mjs" {
  type Node = import("@typescript-eslint/types").TSESTree.Node
  type JSXOpeningElement = import("@typescript-eslint/types").TSESTree.JSXOpeningElement
  type JSXAttribute = import("@typescript-eslint/types").TSESTree.JSXAttribute
  type SourceView = import("./lib/types.ts").SourceView

  /** The JSX attribute called `name` on an opening element, or null. */
  export function attribute(opening: JSXOpeningElement, name: string): JSXAttribute | null
  /** The expression an attribute carries: a literal, or the inside of `{...}`; null for a bare attribute. */
  export function attributeValue(entry: JSXAttribute | null | undefined): Node | null
  /** The text of a string literal or of a template with no substitution; null for anything else. */
  export function stringOf(node: Node | null | undefined): string | null
  /** The name of a JSX element for a plain tag or a component; null for a member or namespaced name. */
  export function tagName(opening: JSXOpeningElement): string | null
  /** True for a `className` / `class` JSX attribute. */
  export function isClassAttribute(node: Node): boolean
  /** Static string carried by a JSX attribute or by a module constant holding a class string. */
  export function staticText(value: Node | null | undefined): string | null
  /** Every node under `root`, depth first; `enter` may return `false` to skip a node's children. */
  export function walk(sourceCode: SourceView, root: Node | import("eslint").AST.Program, enter: (node: Node) => boolean | void): void
}

declare module "@starci/eslint-canon-fe/lib/bindings.mjs" {
  type Node = import("@typescript-eslint/types").TSESTree.Node
  type ReaderContext = import("./lib/types.ts").ReaderContext
  type NameNode = import("./lib/types.ts").NameNode
  type FunctionNode = import("./lib/types.ts").FunctionNode
  type ScopeVariable = import("./lib/types.ts").ScopeVariable

  /** The node without the wrappers that only change its type (`x as T`, `x!`, `x?.y`). */
  export function unwrap(node: Node): Node
  export function unwrap(node: Node | null | undefined): Node | null | undefined
  /** The scope-manager variable an identifier resolves to, or null for a global. */
  export function variableOf(context: ReaderContext, identifier: NameNode): ScopeVariable | null
  /** Where an identifier was imported from; `imported` is null for a default or namespace import. */
  export function importOf(context: ReaderContext, identifier: NameNode): { readonly source: string; readonly imported: string | null } | null
  /** The function an expression stands for: the function itself, or the function a same-file variable or declaration holds. */
  export function functionOf(context: ReaderContext, node: Node | null | undefined): FunctionNode | null
}

declare module "@starci/eslint-canon-fe/lib/hfs.mjs" {
  type ReaderContext = import("./lib/types.ts").ReaderContext

  /** What a slot's manifest entry says about it (only the fields the rules read). */
  export interface HfsSlot {
    readonly id: string
    readonly path: string
    readonly outcomeHome?: boolean
  }

  /** The classification of a file by the slot manifest: owned, no slot, ambiguous or forbidden. */
  export interface HfsClassification {
    readonly path: string
    readonly status: string
    readonly slot?: string
    readonly root?: string
    readonly bindings?: Readonly<Record<string, string>>
    readonly kind?: string
    readonly role?: string
  }

  /** The frozen view of one side of an app that the lint factories hand to the rules (`settings.starci.hfs`). */
  export interface HfsView {
    readonly repoRoot: string
    readonly profile: string
    readonly side: string | null
    readonly edition: string
    readonly grammar?: string
    readonly relative: (file: string) => string
    readonly classify: (file: string) => HfsClassification
    readonly slotOf: (file: string) => string | null
    readonly tierOf: (file: string) => string | null
    readonly slot: (id: string) => HfsSlot | null
  }

  /** An app `hfs.json` object. */
  export type AppDeclaration = { readonly [key: string]: unknown }

  /** The HFS view of the side whose `eslint.config.mjs` (in fe/) calls this. */
  export function loadHfs(configUrl: string): HfsView
  /** The HFS view of the fe side of an in-memory app declaration, for rule tests. */
  export function hfsFromDeclaration(declaration: AppDeclaration, repoRoot: string): HfsView
  /** The HFS view a rule runs under; a rule that needs it and gets none refuses to guess. */
  export function hfsOf(context: ReaderContext): HfsView
}

declare module "@starci/eslint-canon-fe/lib/scope.mjs" {
  type ReaderContext = import("./lib/types.ts").ReaderContext
  type HfsClassification = import("@starci/eslint-canon-fe/lib/hfs.mjs").HfsClassification

  /** The filename a rule is linting. */
  export function fileOf(context: ReaderContext): string
  /** True when the file being linted sits in one of the given slots. */
  export function inSlot(context: ReaderContext, ...ids: readonly string[]): boolean
  /** The classification of the linted file from the slot view. */
  export function classOf(context: ReaderContext): HfsClassification
  /** The folder kind the slot reports for the linted file (a component layer, a feature kind), or null. */
  export function kindOfFile(context: ReaderContext): string | null
  /** The role the slot reports for the linted file (`entry`, `drawing`, `styles`, `shared`, `page`, `layout`, ...), or null. */
  export function roleOfFile(context: ReaderContext): string | null
  /** Product source: a file of a product tier. */
  export function isProductSource(context: ReaderContext): boolean
  /** A file of a component tier: slot `fe.components` or `fe.package.ui`, inside one of its layer folders. */
  export function isComponentFile(context: ReaderContext): boolean
  /** Where an import specifier of the linted file points, as an absolute path without an extension; null for a package or a file no app owns. */
  export function resolveImport(context: ReaderContext, specifier: string): string | null
}

declare module "@starci/eslint-canon-fe/lib/class-text.mjs" {
  type ReaderContext = import("./lib/types.ts").ReaderContext
  type Node = import("@typescript-eslint/types").TSESTree.Node

  /** Visit class strings in product JSX, declarations and named class arrays; `{}` outside product source. */
  export function classTextVisitors(context: ReaderContext, report: (node: Node, text: string | null) => void): {
    readonly JSXAttribute?: (node: import("@typescript-eslint/types").TSESTree.JSXAttribute) => void
    readonly VariableDeclarator?: (node: import("@typescript-eslint/types").TSESTree.VariableDeclarator) => void
    readonly Property?: (node: import("@typescript-eslint/types").TSESTree.Property) => void
  }
}

declare module "@starci/eslint-canon-fe/lib/drawing-scope.mjs" {
  type ReaderContext = import("./lib/types.ts").ReaderContext

  /** The paired presentation file's component kind, or null outside that scope. */
  export function pureHalf(context: ReaderContext): string | null
}

declare module "@starci/eslint-canon-fe/lib/fe-stack.mjs" {
  /** The canonical packages of a concern; empty for an unknown concern. */
  export function canonicalPackages(id: string): ReadonlyArray<string>
}

declare module "@starci/eslint-canon-fe/lib/config.mjs" {
  /** The product source of a front end: every app's `src/` and every workspace package's `src/`. */
  export const SOURCE_FILES: readonly string[]
  /** A disable directive is a weakening of lint, and one that suppresses nothing is dead weight. */
  export const linterOptions: Readonly<import("eslint").Linter.LinterOptions>
}

declare module "*/runtime/scripts/lib/source-phrases.mjs" {
  /** The phrase list `dotKey` (`<group>.<list>`) of `root`, [] when absent. */
  export function phrasesOf(dotKey: string, root?: string): string[]
}

declare module "*/runtime/scripts/lib/regex.mjs" {
  /** `text` with every regular-expression metacharacter escaped, so it matches itself literally. */
  export function escapeRegExp(text: string): string
}

declare module "*/runtime/scripts/hfs/slots.mjs" {
  /** The opened manifest and resolver for the app or side folder at `repoRoot`. */
  export function openHfs(input?: { readonly root?: string; readonly repoRoot?: string }): import("./lib/types.ts").OpenedHfs
}

declare module "*/runtime/scripts/hfs/architecture/config.mjs" {
  type OpenedHfs = import("./lib/types.ts").OpenedHfs
  /** The layout contract of the repository at `repositoryRoot`: its workspace directories are relative to it. */
  export function loadArchitectureConfig(repositoryRoot: string, options?: { readonly hfs?: OpenedHfs }): { readonly workspaces: readonly string[] }
}

declare module "*/runtime/scripts/hfs/architecture/typescript.mjs" {
  /** A workspace package: its root folder, name, parsed manifest and `exports` map. */
  export interface Workspace {
    readonly root: string
    readonly workspace: boolean
    readonly name: string | null
    readonly manifest: unknown
    readonly exports: unknown
  }
  /** The source entry a workspace import resolves to without a build; null when none exists. */
  export function workspaceSourceEntry(ts: typeof import("typescript"), workspace: Workspace, specifier: string): string | null
}

declare module "*/runtime/engine/yaml.mjs" {
  /** Parse one YAML document (core schema, strict). */
  export function parseYaml(source: string): unknown
}

declare module "*/runtime/scripts/hfs/project-graph.mjs" {
  /** Forget every cached project graph, so the next rule run reads the disk again. */
  export function resetProjectGraphs(): void
}
