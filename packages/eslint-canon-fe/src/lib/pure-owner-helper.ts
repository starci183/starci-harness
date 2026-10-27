/**
 * The owner exports an auth callback may use besides the exchange (R287 `FE_CALLBACK_SHAPE`, owner ruling `auth-callback-pure-helpers`,
 * 2026-10-17 "Theo y tro"): a PURE helper of the app's `modules/routes` or `modules/auth` that computes the redirect target or validates
 * `next`, and a static route table. Both are found by TypeScript symbol resolution to the declaration, never by the spelling of the name.
 *
 * A pure helper is a synchronous function that returns text (or null), holds no `await` or `yield`, reaches no I/O global (network, storage,
 * DOM, `process`, `require`, `console`) and calls only locals, language built-ins and other pure helpers of `modules/routes` or
 * `modules/auth` (followed through barrels). `modules/config` is the environment owner: a call to its readers is a configuration read, not I/O.
 * Anything else it imports, a library value included, makes it impure.
 */
import ts from "typescript"
import { reaching } from "./own-hook-origin.ts"
import { programFor } from "./program-for.ts"
import type { AnyContext } from "./rule.ts"
import { resolveImport } from "./scope.ts"

/** The checker a purity walk resolves through, and the declarations it has entered. */
interface PurityWalk {
  readonly checker: ts.TypeChecker
  readonly seen: Set<ts.Declaration>
}

/** A function-like node a helper is written as. */
type HelperFunction = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression

/** Globals that reach the network, storage, the page, the process or the console. */
const IO_GLOBALS = new Set(["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "Request", "navigator", "localStorage", "sessionStorage", "indexedDB", "document", "window", "self", "globalThis", "process", "require", "console", "setTimeout", "setInterval", "queueMicrotask", "Worker", "BroadcastChannel"])

const OWNER_FILE = /\/modules\/(?:routes|auth)(?:\/|\.tsx?$)/
const CONFIG_FILE = /\/modules\/config(?:\/|\.tsx?$)/
const EXTENSIONS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]

const normal = (file: ts.SourceFile): string => file.fileName.replaceAll("\\", "/")

/** The module file an import specifier names, or null when none exists on disk. */
const moduleFile = (context: AnyContext, source: string): string | null => {
  const target = resolveImport(context, source)
  if (target === null) return null
  return EXTENSIONS.map((extension) => `${target}${extension}`).find((candidate) => ts.sys.fileExists(candidate)) ?? null
}

/** The declaration an export of the module resolves to, after barrels and re-exports. */
const exportedDeclaration = (context: AnyContext, source: string, name: string): { checker: ts.TypeChecker; declaration: ts.Declaration | null } | null => {
  const file = moduleFile(context, source)
  if (file === null) return null
  const program = reaching(programFor(context), context.filename, file)
  const checker = program.getTypeChecker()
  const sourceFile = program.getSourceFile(file)
  const moduleSymbol = sourceFile ? checker.getSymbolAtLocation(sourceFile) : undefined
  const exported = moduleSymbol ? checker.getExportsOfModule(moduleSymbol).find((symbol) => symbol.name === name) : undefined
  if (!exported) return null
  const symbol = (exported.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(exported) : exported
  return { checker, declaration: symbol.declarations?.[0] ?? null }
}

/** Strip `as`, `satisfies` and parentheses. */
const bare = (node: ts.Expression | undefined): ts.Expression | undefined => {
  let current = node
  while (current && (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isParenthesizedExpression(current))) current = current.expression
  return current
}

/** The function-like node of a function declaration or of a variable initialised with an arrow or function expression. */
const functionOf = (declaration: ts.Declaration): HelperFunction | null => {
  if (ts.isFunctionDeclaration(declaration)) return declaration
  const init = ts.isVariableDeclaration(declaration) ? bare(declaration.initializer) : undefined
  return init !== undefined && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? init : null
}

const isInside = (node: ts.Node, root: ts.Node): boolean => node.getSourceFile() === root.getSourceFile() && node.pos >= root.pos && node.end <= root.end

/** Whether an identifier names a declaration, a property or a member rather than referring to a binding. */
const isNameOnly = (node: ts.Identifier): boolean => {
  const parent = node.parent
  if (ts.isPropertyAccessExpression(parent)) return parent.name === node
  if (ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertySignature(parent)) return parent.name === node
  return (ts.isParameter(parent) || ts.isVariableDeclaration(parent) || ts.isFunctionDeclaration(parent) || ts.isBindingElement(parent)) && parent.name === node
}

/** A declaration of another file: an owner helper is followed, the environment owner is a leaf, everything else is impure. */
const foreignPure = (env: PurityWalk, declaration: ts.Declaration, root: ts.Node): boolean => {
  const file = normal(declaration.getSourceFile())
  if (CONFIG_FILE.test(file)) return true
  if (!OWNER_FILE.test(file) || declaration.getSourceFile().isDeclarationFile) return false
  return declarationPure(env, declaration, root)
}

/** A global of the language or of the lib files is pure unless it reaches I/O. */
const globalPure = (symbol: ts.Symbol): boolean => !IO_GLOBALS.has(symbol.getName())

/** Whether one identifier reference stays inside the pure surface. */
const referencePure = (env: PurityWalk, node: ts.Identifier, root: ts.Node): boolean => {
  const symbol = env.checker.getSymbolAtLocation(node)
  if (!symbol) return node.text === "undefined"
  const target = (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? env.checker.getAliasedSymbol(symbol) : symbol
  const declarations = target.declarations ?? []
  if (declarations.length === 0) return node.text === "undefined"
  return declarations.every((declaration) => {
    const file = declaration.getSourceFile()
    if (isInside(declaration, root)) return true
    if (!ts.isExternalModule(file)) return globalPure(target)
    return foreignPure(env, declaration, root)
  })
}

/** Walk a node: no await or yield, no impure reference; type positions are not behaviour. */
const nodePure = (env: PurityWalk, node: ts.Node, root: ts.Node): boolean => {
  if (ts.isAwaitExpression(node) || ts.isYieldExpression(node)) return false
  if (ts.isTypeNode(node) && !ts.isExpressionWithTypeArguments(node)) return true
  if (ts.isIdentifier(node) && !isNameOnly(node) && !referencePure(env, node, root)) return false
  return ts.forEachChild(node, (child) => (nodePure(env, child, root) ? undefined : true)) !== true
}

/** A declaration is pure when its function (or its constant initialiser) is. */
function declarationPure(env: PurityWalk, declaration: ts.Declaration, _root: ts.Node): boolean {
  if (env.seen.has(declaration)) return true
  env.seen.add(declaration)
  const fn = functionOf(declaration)
  if (fn) return !("asteriskToken" in fn && fn.asteriskToken) && !fn.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) && (fn.body ? nodePure(env, fn.body, fn) : false)
  if (ts.isVariableDeclaration(declaration) && declaration.initializer) return nodePure(env, declaration.initializer, declaration.initializer)
  return false
}

/** Whether a function's declared or inferred return type is text, null or undefined. */
const returnsText = (checker: ts.TypeChecker, declaration: ts.Node): boolean => {
  const signature = checker.getSignaturesOfType(checker.getTypeAtLocation(declaration), ts.SignatureKind.Call)[0]
  if (!signature) return false
  const type = checker.getReturnTypeOfSignature(signature)
  const parts = type.isUnion() ? type.types : [type]
  return parts.every((part) => (part.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.Null | ts.TypeFlags.Undefined)) !== 0)
}

/** A static table: a constant object whose leaves are string literals or plain templates. */
const isStaticTable = (node: ts.Expression | undefined): boolean => {
  const value = bare(node)
  if (!value) return false
  if (ts.isStringLiteralLike(value)) return true
  if (ts.isObjectLiteralExpression(value)) return value.properties.every((property) => ts.isPropertyAssignment(property) && isStaticTable(property.initializer))
  return false
}

/**
 * What an import of the callback's owner modules is: `"pure"` (a pure text-returning helper), `"routes"` (a static route table) or null.
 *
 * @param context - The ESLint rule context.
 * @param source - The import specifier.
 * @param name - The imported name.
 * @returns The kind.
 */
export function ownerExportKind(context: AnyContext, source: string, name: string): "pure" | "routes" | null {
  const found = exportedDeclaration(context, source, name)
  if (!found?.declaration) return null
  const { checker, declaration } = found
  if (ts.isVariableDeclaration(declaration) && !functionOf(declaration)) return (declaration.parent.flags & ts.NodeFlags.Const) !== 0 && isStaticTable(declaration.initializer) ? "routes" : null
  const fn = functionOf(declaration)
  const env: PurityWalk = { checker, seen: new Set<ts.Declaration>() }
  return fn !== null && returnsText(checker, fn) && declarationPure(env, declaration, fn) ? "pure" : null
}
