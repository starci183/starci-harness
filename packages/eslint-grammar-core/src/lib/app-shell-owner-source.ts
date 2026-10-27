/** Resolve only an imported header's owned source and selected public export. */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import parser from "@typescript-eslint/parser"
import { SourceCode } from "eslint"
import type { AST, Scope } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { importOf, variableOf } from "@starci/eslint-canon-fe/lib/bindings.mjs"
import { resolveImport } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { hfsOf } from "@starci/eslint-canon-fe/lib/hfs.mjs"
import { walk } from "@starci/eslint-canon-fe/lib/ast.mjs"
import { loadArchitectureConfig } from "../../runtime/scripts/hfs/architecture/config.mjs"
import { workspaceSourceEntry } from "../../runtime/scripts/hfs/architecture/typescript.mjs"
import type { Workspace } from "../../runtime/scripts/hfs/architecture/typescript.mjs"
import { openHfs } from "../../runtime/scripts/hfs/slots.mjs"
import type { Node, ParsedContext, ReaderContext, SourceView } from "./types.ts"

/** An exported value together with the parsed file that holds it. */
export interface Owner {
  readonly context: ParsedContext
  readonly value: Node
}

/** What is known about one repository during a lint run: its parsed header files, proofs and workspace packages. */
interface RepositoryState {
  readonly root: string
  readonly files: Map<string, ParsedContext>
  readonly proofs: Map<string, boolean>
  workspaces: Workspace[] | null
}

const RUNTIME = fileURLToPath(new URL("../../runtime/", import.meta.url))
const roots = new WeakMap<SourceView, RepositoryState>()
const origins = new WeakMap<SourceView, SourceView>()

const stateOf = (context: ReaderContext): RepositoryState => {
  const root = hfsOf(context).repoRoot
  const snapshot = origins.get(context.sourceCode) ?? context.sourceCode
  let state = roots.get(snapshot)
  if (state === undefined) {
    state = { root, files: new Map(), proofs: new Map(), workspaces: null }
    roots.set(snapshot, state)
  }
  return state
}

/** A workspace package from the text of its `package.json`. */
const workspaceOf = (root: string, text: string): Workspace => {
  const manifest: unknown = JSON.parse(text)
  const record = typeof manifest === "object" && manifest !== null ? manifest : {}
  return {
    root,
    workspace: true,
    name: "name" in record && typeof record.name === "string" ? record.name : null,
    manifest,
    exports: "exports" in record ? record.exports : undefined,
  }
}

const workspaceFile = (context: ReaderContext, source: string): string | null => {
  const state = stateOf(context)
  if (!state.workspaces) {
    const hfs = openHfs({ root: RUNTIME, repoRoot: state.root })
    const config = loadArchitectureConfig(state.root, { hfs })
    state.workspaces = config.workspaces.map((relative) => {
      const root = path.join(state.root, relative)
      return workspaceOf(root, fs.readFileSync(path.join(root, "package.json"), "utf8"))
    })
  }
  const workspace = state.workspaces.find((entry) => entry.name && (source === entry.name || source.startsWith(`${entry.name}/`)))
  return workspace ? workspaceSourceEntry(ts, workspace, source) : null
}

const sourceFile = (context: ReaderContext, source: string): string | null => {
  const target = resolveImport(context, source) ?? workspaceFile(context, source)
  if (!target) return null
  const hfs = hfsOf(context)
  return [target, `${target}.tsx`, `${target}.ts`, `${target}/index.tsx`, `${target}/index.ts`]
    .find((file) => /\.[cm]?[jt]sx?$/i.test(file) && !/\.d\.[cm]?ts$/i.test(file) && ts.sys.fileExists(file) && hfs.classify(file).status === "owned") ?? null
}

/** Record the parent of a child node: the parser leaves it to ESLint's traversal, which this independent parse bypasses. */
const adopt = (child: unknown, parent: Node): void => {
  if (typeof child === "object" && child !== null && "type" in child && child.type) Reflect.set(child, "parent", parent)
}

const sourceContext = (context: ReaderContext, filename: string): ParsedContext => {
  const state = stateOf(context)
  const known = state.files.get(filename)
  if (known) return known
  const text = fs.readFileSync(filename, "utf8")
  const parsed = parser.parseForESLint(text, { filePath: filename, sourceType: "module", ecmaFeatures: { jsx: true }, range: true, loc: true, tokens: true, comment: true })
  const sourceCode = new SourceCode({
    text,
    ast: parsed.ast as AST.Program,
    scopeManager: parsed.scopeManager as Scope.ScopeManager | null,
    visitorKeys: parsed.visitorKeys as SourceCode.VisitorKeys,
    parserServices: parsed.services,
  })
  const view = sourceCode as SourceView
  walk(view, parsed.ast, (node) => {
    for (const key of view.visitorKeys[node.type] ?? []) {
      const value: unknown = Reflect.get(node, key)
      const values: readonly unknown[] = Array.isArray(value) ? value : [value]
      for (const child of values) adopt(child, node)
    }
  })
  const owned: ParsedContext = { filename, sourceCode: view, settings: context.settings, program: parsed.ast }
  origins.set(view, origins.get(context.sourceCode) ?? context.sourceCode)
  state.files.set(filename, owned)
  return owned
}

const moduleContext = (context: ReaderContext, source: string): ParsedContext | null => {
  const filename = sourceFile(context, source)
  return filename ? sourceContext(context, filename) : null
}

const namedDeclaration = (declaration: TSESTree.ExportNamedDeclaration["declaration"], name: string): Node | null => {
  if (declaration?.type === "FunctionDeclaration") return declaration.id?.name === name ? declaration : null
  if (declaration?.type !== "VariableDeclaration") return null
  return declaration.declarations.find((entry) => entry.id.type === "Identifier" && entry.id.name === name)?.init ?? null
}

/** The name an export specifier spells: an identifier's name or a string literal's value. */
const specifierName = (name: TSESTree.Identifier | TSESTree.StringLiteral): string => (name.type === "Identifier" ? name.name : name.value)

const namedExport = (context: ParsedContext, statement: TSESTree.ExportNamedDeclaration, name: string, visited: Set<string>): { readonly matched: false } | { readonly matched: true; readonly owner: Owner | null } => {
  const value = namedDeclaration(statement.declaration, name)
  if (value) return { matched: true, owner: { context, value } }
  const specifier = statement.specifiers.find((entry) => specifierName(entry.exported) === name)
  if (!specifier) return { matched: false }
  if (!statement.source) return { matched: true, owner: { context, value: specifier.local } }
  const target = moduleContext(context, String(statement.source.value))
  return { matched: true, owner: target ? headerExport(target, specifierName(specifier.local), visited) : null }
}

/** The selected exported value, following public barrels without scanning unrelated imported implementations. */
const headerExport = (context: ParsedContext, name: string, seen: Set<string> = new Set()): Owner | null => {
  const key = `${context.filename}:${name}`
  if (seen.has(key)) return null
  const visited = new Set(seen).add(key)
  for (const statement of context.program.body) {
    if (statement.type === "ExportDefaultDeclaration" && name === "default") return { context, value: statement.declaration }
    if (statement.type === "ExportNamedDeclaration") {
      const found = namedExport(context, statement, name, visited)
      if (found.matched) return found.owner
    }
    if (statement.type === "ExportAllDeclaration") {
      const target = moduleContext(context, String(statement.source.value))
      const found = target && headerExport(target, name, visited)
      if (found) return found
    }
  }
  return null
}

/** An imported JSX owner, or null when its implementation cannot be proved from owned source. */
export const importedHeader = (context: ReaderContext, opening: TSESTree.JSXOpeningElement): Owner | null => {
  const name = opening.name
  const identifier = name.type === "JSXIdentifier" ? name : name.type === "JSXMemberExpression" ? name.object : null
  if (identifier?.type !== "JSXIdentifier") return null
  const imported = importOf(context, identifier)
  if (!imported) return null
  const definition = variableOf(context, identifier)?.defs.find((entry) => entry.type === "ImportBinding")
  if (name.type === "JSXMemberExpression" && definition?.node.type !== "ImportNamespaceSpecifier") return null
  const target = moduleContext(context, imported.source)
  const exported = name.type === "JSXMemberExpression" ? name.property.name : imported.imported ?? "default"
  return target ? headerExport(target, exported) : null
}

/** The per-repository proof cache shares the same lifetime as parsed header source. */
export const headerProofs = (context: ReaderContext): Map<string, boolean> => stateOf(context).proofs
