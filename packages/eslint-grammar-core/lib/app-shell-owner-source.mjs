/** Resolve only an imported header's owned source and selected public export. */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import parser from "@typescript-eslint/parser"
import { SourceCode } from "eslint"
import { importOf, variableOf } from "@starci/eslint-canon-fe/lib/bindings.mjs"
import { resolveImport } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { hfsOf } from "@starci/eslint-canon-fe/lib/hfs.mjs"
import { walk } from "@starci/eslint-canon-fe/lib/ast.mjs"
import { loadArchitectureConfig } from "../runtime/scripts/hfs/architecture/config.mjs"
import { workspaceSourceEntry } from "../runtime/scripts/hfs/architecture/typescript.mjs"
import { openHfs } from "../runtime/scripts/hfs/slots.mjs"

const RUNTIME = fileURLToPath(new URL("../runtime/", import.meta.url))
const roots = new WeakMap()
const origins = new WeakMap()

const stateOf = (context) => {
  const root = hfsOf(context).repoRoot
  const snapshot = origins.get(context.sourceCode) ?? context.sourceCode
  if (!roots.has(snapshot)) roots.set(snapshot, { root, files: new Map(), proofs: new Map(), workspaces: null })
  return roots.get(snapshot)
}

const workspaceFile = (context, source) => {
  const state = stateOf(context)
  if (!state.workspaces) {
    const hfs = openHfs({ root: RUNTIME, repoRoot: state.root })
    const config = loadArchitectureConfig(state.root, { hfs })
    state.workspaces = config.workspaces.map((relative) => {
      const root = path.join(state.root, relative)
      const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
      return { root, workspace: true, name: manifest.name, manifest, exports: manifest.exports }
    })
  }
  const workspace = state.workspaces.find((entry) => entry.name && (source === entry.name || source.startsWith(`${entry.name}/`)))
  return workspace ? workspaceSourceEntry(ts, workspace, source) : null
}

const sourceFile = (context, source) => {
  const target = resolveImport(context, source) ?? workspaceFile(context, source)
  if (!target) return null
  const hfs = hfsOf(context)
  return [target, `${target}.tsx`, `${target}.ts`, `${target}/index.tsx`, `${target}/index.ts`]
    .find((file) => /\.[cm]?[jt]sx?$/i.test(file) && !/\.d\.[cm]?ts$/i.test(file) && ts.sys.fileExists(file) && hfs.classify(file).status === "owned") ?? null
}

const sourceContext = (context, filename) => {
  const state = stateOf(context)
  if (state.files.has(filename)) return state.files.get(filename)
  const text = fs.readFileSync(filename, "utf8")
  const parsed = parser.parseForESLint(text, { filePath: filename, sourceType: "module", ecmaFeatures: { jsx: true }, range: true, loc: true, tokens: true, comment: true })
  const sourceCode = new SourceCode({ text, ast: parsed.ast, scopeManager: parsed.scopeManager, visitorKeys: parsed.visitorKeys, parserServices: parsed.services })
  walk(sourceCode, parsed.ast, (node) => {
    for (const key of sourceCode.visitorKeys[node.type] ?? []) {
      const values = Array.isArray(node[key]) ? node[key] : [node[key]]
      for (const child of values) if (child?.type) child.parent = node
    }
  })
  const owned = { filename, sourceCode, settings: context.settings }
  origins.set(sourceCode, origins.get(context.sourceCode) ?? context.sourceCode)
  state.files.set(filename, owned)
  return owned
}

const moduleContext = (context, source) => {
  const filename = sourceFile(context, source)
  return filename ? sourceContext(context, filename) : null
}

const namedDeclaration = (declaration, name) => {
  if (declaration?.type === "FunctionDeclaration") return declaration.id?.name === name ? declaration : null
  if (declaration?.type !== "VariableDeclaration") return null
  return declaration.declarations.find((entry) => entry.id.type === "Identifier" && entry.id.name === name)?.init ?? null
}

const namedExport = (context, statement, name, visited) => {
  const value = namedDeclaration(statement.declaration, name)
  if (value) return { matched: true, owner: { context, value } }
  const specifier = statement.specifiers.find((entry) => (entry.exported.name ?? entry.exported.value) === name)
  if (!specifier) return { matched: false }
  if (!statement.source) return { matched: true, owner: { context, value: specifier.local } }
  const target = moduleContext(context, String(statement.source.value))
  return { matched: true, owner: target ? headerExport(target, specifier.local.name ?? specifier.local.value, visited) : null }
}

/** The selected exported value, following public barrels without scanning unrelated imported implementations. */
const headerExport = (context, name, seen = new Set()) => {
  const key = `${context.filename}:${name}`
  if (seen.has(key)) return null
  const visited = new Set(seen).add(key)
  for (const statement of context.sourceCode.ast.body) {
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
export const importedHeader = (context, opening) => {
  const name = opening.name
  const identifier = name.type === "JSXIdentifier" ? name : name.object
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
export const headerProofs = (context) => stateOf(context).proofs
