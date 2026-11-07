/**
 * Resolve a `use*` import that comes from the app's own hooks folders (`hooks/swr`, `hooks/<domain>`, `hooks/zustand/<store>`...) by
 * TypeScript symbol resolution, never by the spelling of the name (R56 `FE_HOOKS_ARE_HOOKS`).
 *
 * A composite product hook is built from the hooks beneath it: `hooks/<domain>/use<Name>.ts` composes the `use{Query,Mutate}<X>Swr`
 * wrappers of `hooks/swr`. The import is followed through barrels and re-exports to the declaration, and counts only when that declaration
 * is a `use*` value that lives in a `hooks/` folder of the app (never in `node_modules`). The hook's own file is judged by this same
 * rule when it is linted, so a fake one is refused where it is written.
 */
import type { TSESLint } from "@typescript-eslint/utils"
import ts from "typescript"
import { programFor } from "./program-for.ts"
import { hfsOf } from "./hfs.ts"
import { builtinHook, namedOrigin } from "./hook-library-origin.ts"
import type { AnyContext } from "./rule.ts"

/** The definition of an import binding. */
export type ImportBindingDefinition = TSESLint.Scope.Definitions.ImportBindingDefinition

const HOOKS_FOLDER = /(^|\/)hooks\//
const isHookName = (name: string): boolean => /^use[A-Z0-9]/.test(name)

/** The program that holds the import target: the project program has it; a program rooted at the linted file alone (its disk text may differ from the linted text) is widened with it. */
const widened = new WeakMap<ts.Program, Map<string, ts.Program>>()
export function reaching(program: ts.Program, filename: string, targetFile: string): ts.Program {
  if (program.getSourceFile(targetFile)) return program
  const key = `${filename}\0${targetFile}`
  const cache = widened.get(program) ?? new Map<string, ts.Program>()
  widened.set(program, cache)
  const known = cache.get(key)
  if (known !== undefined) return known
  const created = ts.createProgram([filename, targetFile], program.getCompilerOptions())
  cache.set(key, created)
  return created
}

/** A declaration of a hook value: a function or a variable, not a type, interface, class or enum. */
const hookValue = (declaration: ts.Declaration): boolean => ts.isFunctionDeclaration(declaration) || ts.isVariableDeclaration(declaration)

const inAppHooksFolder = (file: ts.SourceFile): boolean => {
  const fileName = file.fileName.replaceAll("\\", "/")
  return !fileName.includes("/node_modules/") && !file.isDeclarationFile && HOOKS_FOLDER.test(fileName)
}

/** A type-only alias never supplies a runtime hook. */
const runtimeAlias = (declaration: ts.Declaration): boolean => {
  if (ts.isImportSpecifier(declaration)) return !declaration.isTypeOnly && !declaration.parent.parent.isTypeOnly
  if (ts.isImportClause(declaration)) return !declaration.isTypeOnly
  if (ts.isExportSpecifier(declaration)) return !declaration.isTypeOnly && !declaration.parent.parent.isTypeOnly
  if (ts.isNamespaceExport(declaration)) return !declaration.parent.isTypeOnly
  return false
}

/** Follow every alias separately, so a type-only link or cycle never becomes a runtime binding. */
function runtimeSymbol(checker: ts.TypeChecker, start: ts.Symbol): ts.Symbol | null {
  let symbol = start
  const seen = new Set<ts.Symbol>()
  while ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    if (seen.has(symbol)) return null
    seen.add(symbol)
    const declarations = symbol.declarations ?? []
    if (declarations.length !== 1 || !declarations.every(runtimeAlias)) return null
    const next = checker.getImmediateAliasedSymbol(symbol)
    if (!next) return null
    symbol = next
  }
  return symbol
}

/** The module hook role is slot-defined and belongs to the same app as the caller. */
function moduleHookRole(context: AnyContext, file: ts.SourceFile): boolean {
  const hfs = hfsOf(context)
  const found = hfs.classify(file.fileName)
  const caller = hfs.classify(context.filename)
  return !file.isDeclarationFile && !file.fileName.replaceAll("\\", "/").includes("/node_modules/") &&
    found.status === "owned" && found.slot?.startsWith("fe.modules.") === true && found.role === "hooks" &&
    found.bindings?.app !== undefined && found.bindings.app === caller.bindings?.app && hfs.allows(file.fileName)?.allowed === true
}

/** A known library import is proven by its own runtime import declaration and canonical exported name. */
function libraryImport(declaration: ts.Declaration): boolean {
  if (!runtimeAlias(declaration)) return false
  if (ts.isImportSpecifier(declaration)) {
    const module = declaration.parent.parent.parent.moduleSpecifier
    return ts.isStringLiteral(module) && builtinHook(namedOrigin(module.text, (declaration.propertyName ?? declaration.name).text))
  }
  if (ts.isExportSpecifier(declaration)) {
    const module = declaration.parent.parent.moduleSpecifier
    return module !== undefined && ts.isStringLiteral(module) && builtinHook(namedOrigin(module.text, (declaration.propertyName ?? declaration.name).text))
  }
  return false
}

/** Follow runtime re-exports until a known library import itself proves the binding. */
function librarySymbol(checker: ts.TypeChecker, start: ts.Symbol): boolean {
  let symbol = start
  const visited = new Set<ts.Symbol>()
  while (!visited.has(symbol)) {
    visited.add(symbol)
    const declarations = symbol.declarations ?? []
    if (declarations.length !== 1) return false
    const declaration = declarations[0]
    if (!declaration) return false
    if (libraryImport(declaration)) return true
    if ((symbol.flags & ts.SymbolFlags.Alias) === 0 || !runtimeAlias(declaration)) return false
    const next = checker.getImmediateAliasedSymbol(symbol)
    if (!next) return false
    symbol = next
  }
  return false
}

/** Resolve calls through lexical symbols, constant aliases and runtime import/re-export chains. */
function moduleHookBody(context: AnyContext, checker: ts.TypeChecker, declaration: ts.Declaration, seen: Set<ts.Symbol>): boolean {
  if (!moduleHookRole(context, declaration.getSourceFile())) return false
  if (ts.isVariableDeclaration(declaration) && (declaration.parent.flags & ts.NodeFlags.Const) === 0) return false
  const body = ts.isFunctionDeclaration(declaration) ? declaration.body : ts.isVariableDeclaration(declaration) && declaration.initializer &&
    (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) ? declaration.initializer.body : undefined
  if (!body) return false
  const proves = (expression: ts.Expression, visited: Set<ts.Symbol>): boolean => {
    if (!ts.isIdentifier(expression)) return false
    const symbol = checker.getSymbolAtLocation(expression)
    if (!symbol || visited.has(symbol)) return false
    const nextSeen = new Set([...visited, symbol])
    if (librarySymbol(checker, symbol)) return true
    const resolved = runtimeSymbol(checker, symbol)
    if (!resolved || nextSeen.has(resolved) && resolved !== symbol) return false
    const actual = resolved.declarations ?? []
    if (actual.length !== 1) return false
    const target = actual[0]
    if (!target) return false
    if (hookValue(target) && inAppHooksFolder(target.getSourceFile()) && isHookName(resolved.name)) {
      const hfs = hfsOf(context)
      const app = hfs.classify(context.filename).bindings?.app
      const found = hfs.classify(target.getSourceFile().fileName)
      return app !== undefined && found.status === "owned" && found.slot?.startsWith("fe.hooks") === true && found.bindings?.app === app
    }
    if (ts.isVariableDeclaration(target) && (target.parent.flags & ts.NodeFlags.Const) !== 0 && target.initializer && ts.isIdentifier(target.initializer)) return proves(target.initializer, nextSeen)
    return moduleHookBody(context, checker, target, nextSeen)
  }
  let found = false
  const visit = (node: ts.Node): void => {
    if (found || node !== body && ts.isFunctionLike(node)) return
    if (ts.isCallExpression(node) && proves(node.expression, seen)) { found = true; return }
    ts.forEachChild(node, visit)
  }
  visit(body)
  return found
}

/** True when the import binding is a runtime `use*` import that resolves to a hook declared in a `hooks/` folder of the app. */
export function importedOwnHook(context: AnyContext, definition: ImportBindingDefinition): boolean {
  const specifier = definition.node
  const parent = definition.parent
  if (specifier.type !== "ImportSpecifier" || parent.importKind === "type" || specifier.importKind === "type") return false
  // an import specifier always sits in an import declaration
  if (parent.type !== "ImportDeclaration") return false
  const name = specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value
  if (!isHookName(name)) return false
  const source = String(parent.source.value)
  const base = programFor(context)
  const target = ts.resolveModuleName(source, context.filename, base.getCompilerOptions(), ts.sys).resolvedModule
  if (!target || target.isExternalLibraryImport) return false
  const program = reaching(base, context.filename, target.resolvedFileName)
  const file = program.getSourceFile(target.resolvedFileName)
  const checker = program.getTypeChecker()
  const moduleSymbol = file && checker.getSymbolAtLocation(file)
  const exported = moduleSymbol ? checker.getExportsOfModule(moduleSymbol).find((symbol) => symbol.name === name) : undefined
  if (!exported) return false
  const original = (exported.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(exported) : exported
  if ((original.declarations ?? []).some((declaration) => hookValue(declaration) && inAppHooksFolder(declaration.getSourceFile()))) return true
  const symbol = runtimeSymbol(checker, exported)
  if (!symbol) return false
  return (symbol.declarations ?? []).some((declaration) => hookValue(declaration) && moduleHookBody(context, checker, declaration, new Set([symbol])))
}
