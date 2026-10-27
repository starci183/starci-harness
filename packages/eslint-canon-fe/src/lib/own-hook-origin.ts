/**
 * Resolve a `use*` import that comes from the app's own hooks folders (`hooks/swr`, `hooks/<domain>`, `hooks/zustand/<store>`...) by
 * TypeScript symbol resolution, never by the spelling of the name (R56 `FE_HOOKS_ARE_HOOKS`, owner ruling 2026-10-16 "Theo y tro").
 *
 * A composite product hook is built from the hooks beneath it: `hooks/<domain>/use<Name>.ts` composes the `use{Query,Mutate}<X>Swr`
 * wrappers of `hooks/swr`. The import is followed through barrels and re-exports to the declaration, and counts only when that declaration
 * is a `use*` value that lives in a `hooks/` folder of the app (never in `node_modules`). The hook's own file is judged by this same
 * rule when it is linted, so a fake one is refused where it is written.
 */
import type { TSESLint } from "@typescript-eslint/utils"
import ts from "typescript"
import { programFor } from "./program-for.ts"
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
  const symbol = (exported.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(exported) : exported
  return (symbol.declarations ?? []).some((declaration) => hookValue(declaration) && inAppHooksFolder(declaration.getSourceFile()))
}
