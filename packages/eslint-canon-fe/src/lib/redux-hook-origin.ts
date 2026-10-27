/** Resolve typed Redux hook factories by their import provenance, never by a local use* name. */
import ts from "typescript"
import type { ImportBindingDefinition } from "./own-hook-origin.ts"
import { programFor } from "./program-for.ts"
import type { AnyContext } from "./rule.ts"

const REDUX_HOOKS = new Set(["useSelector", "useDispatch", "useStore"])

function reduxImport(declaration: ts.Declaration): boolean {
  if (!ts.isImportSpecifier(declaration) || declaration.isTypeOnly) return false
  const clause = declaration.parent.parent
  const specifier = clause.parent.moduleSpecifier
  return !clause.isTypeOnly && ts.isStringLiteral(specifier) && specifier.text === "react-redux"
    && REDUX_HOOKS.has((declaration.propertyName ?? declaration.name).text)
}

function typedFactory(checker: ts.TypeChecker, declaration: ts.Declaration): boolean {
  if (!ts.isVariableDeclaration(declaration) || (declaration.parent.flags & ts.NodeFlags.Const) === 0) return false
  const call = declaration.initializer
  if (!call || !ts.isCallExpression(call) || call.arguments.length !== 0) return false
  const member = call.expression
  return ts.isPropertyAccessExpression(member) && member.name.text === "withTypes"
    && reduxBinding(checker, member.expression)
}

function reduxBinding(checker: ts.TypeChecker, node: ts.Node): boolean {
  const symbol = checker.getSymbolAtLocation(node)
  return (symbol?.declarations ?? []).some(reduxImport)
}

/** A relative/barrel import must resolve to a const initialized by a real Redux hook's withTypes(). */
export function importedReduxHook(context: AnyContext, definition: ImportBindingDefinition): boolean {
  const specifier = definition.node
  const parent = definition.parent
  if (specifier.type !== "ImportSpecifier" || parent.importKind === "type" || specifier.importKind === "type") return false
  // an import specifier always sits in an import declaration
  if (parent.type !== "ImportDeclaration") return false
  const source = String(parent.source.value)
  const name = specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value
  if (source === "react-redux") return REDUX_HOOKS.has(name)
  const program = programFor(context)
  const target = ts.resolveModuleName(source, context.filename, program.getCompilerOptions(), ts.sys).resolvedModule
  const file = target && program.getSourceFile(target.resolvedFileName)
  const checker = program.getTypeChecker()
  const moduleSymbol = file && checker.getSymbolAtLocation(file)
  const exported = moduleSymbol ? checker.getExportsOfModule(moduleSymbol).find(symbol => symbol.name === name) : undefined
  if (!exported) return false
  const symbol = (exported.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(exported) : exported
  return (symbol.declarations ?? []).some(declaration => typedFactory(checker, declaration))
}
