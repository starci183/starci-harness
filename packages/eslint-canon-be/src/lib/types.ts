/**
 * Type-aware helpers: a rule asks what a node IS (its TypeScript type and where that type is declared), never what it
 * is called. `starciBeConfig` turns typed linting on for every file (`parserOptions.projectService`), so these
 * helpers refuse to run without the program instead of falling back to a name match: a rule that silently degrades to
 * a heuristic is the loophole the owner closed.
 */
import ts from "typescript"
import type { ParserServicesWithTypeInformation } from "@typescript-eslint/utils"
import type { Context, Node } from "./rule.ts"

/** The TypeScript services of the linted file: the program, its checker and the ESTree to TS node map. */
export interface Typed {
    readonly program: ts.Program
    readonly checker: ts.TypeChecker
    readonly toTs: ParserServicesWithTypeInformation["esTreeNodeToTSNodeMap"]["get"]
}

/** Where a type is declared: the symbol name, the forward-slash file and the package (null for the repository's own source). */
export interface TypeOrigin {
    readonly name: string
    readonly file: string
    readonly module: string | null
}

/**
 * The TypeScript services of the file being linted.
 *
 * @param context - The ESLint rule context.
 * @returns The program, its checker and the ESTree to TS node map.
 */
export const typed = (context: Context): Typed => {
    const services = context.sourceCode?.parserServices ?? context.parserServices
    const program = services?.program
    const map = services?.esTreeNodeToTSNodeMap
    if (!program || !map) {
        throw new Error(`${context.id ?? "a starci-be rule"} needs typed linting (parserOptions.projectService); lint through starciBeConfig, which turns it on`)
    }
    return { program, checker: program.getTypeChecker(), toTs: (node) => map.get(node) }
}

/**
 * The declarations of a type: those of its alias (a written `type Repo = Repository<T>`) and those of its own symbol, each
 * after alias resolution (an imported type alias resolves to its target). Both are origins, so a rename by alias hides nothing.
 */
const declarationsOf = (checker: ts.TypeChecker, type: ts.Type | undefined): ts.Declaration[] => {
    if (!type) return []
    return [type.aliasSymbol, type.getSymbol?.()].flatMap((symbol) => {
        if (!symbol) return []
        const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
        return target.getDeclarations?.() ?? []
    })
}

/**
 * Where the type of an ESTree node (or of a type annotation node) is declared.
 *
 * @param context - The ESLint rule context.
 * @param node - An expression, identifier, parameter or type node.
 * @returns Each declaration's symbol name, forward-slash file path and package; `[]` for a primitive or an anonymous type.
 */
export const typeOrigins = (context: Context, node: Node): TypeOrigin[] => {
    const { checker, toTs } = typed(context)
    const tsNode = toTs(node)
    if (!tsNode) return []
    return originsOfType(checker, ts.isTypeNode(tsNode) ? checker.getTypeFromTypeNode(tsNode) : checker.getTypeAtLocation(tsNode))
}

/**
 * Where a TypeScript type is declared, for a rule that already holds a type from the checker (an alias argument, a call signature return).
 *
 * @param checker - The program's type checker.
 * @param type - A TypeScript type.
 * @returns The declaration origins, as `typeOrigins` returns them.
 */
export const originsOfType = (checker: ts.TypeChecker, type: ts.Type | undefined): TypeOrigin[] => {
    const parts: (ts.Type | undefined)[] = type?.isUnion?.() ? type.types : [type]
    return parts.flatMap((part) => declarationsOf(checker, part).map((declaration) => {
        const file = String(declaration.getSourceFile().fileName).replace(/\\/g, "/")
        return { name: identifierNameOf(declaration), file, module: moduleOf(declaration, file) }
    }))
}

/** Whether a value is a TypeScript node (it carries a numeric `kind`). */
export const isTsNode = (value: unknown): value is ts.Node =>
    typeof value === "object" && value !== null && "kind" in value && typeof value.kind === "number"

/**
 * The TypeScript node a node holds under `key` (`body`, `initializer`, `expression`), or undefined when it holds none: the typed
 * form of reading `declaration?.body` off a declaration whose kind is not known.
 */
export const childNode = (node: ts.Node | null | undefined, key: string): ts.Node | undefined => {
    if (!node) return undefined
    const value: unknown = Reflect.get(node, key)
    return isTsNode(value) ? value : undefined
}

/** A symbol after alias resolution (`import { X as Y }` gives X), or the symbol itself. */
export const resolvedSymbol = (checker: ts.TypeChecker, symbol: ts.Symbol | undefined): ts.Symbol | undefined =>
    (symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol)

/** The text of a declaration's own `name` when that name is an identifier, else "". */
const identifierNameOf = (declaration: ts.Declaration): string => {
    const name: unknown = "name" in declaration ? declaration.name : undefined
    return isTsNode(name) && ts.isIdentifier(name) ? name.text : ""
}

/**
 * The package a declaration belongs to: the name of an enclosing `declare module "<pkg>"`, else the package directory
 * of a `node_modules/<pkg>/` (or `node_modules/@scope/<pkg>/`) file, else null for the repository's own source.
 */
export const moduleOf = (declaration: ts.Node, file: string): string | null => {
    for (let node: ts.Node | undefined = declaration.parent; node; node = node.parent) {
        if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) return node.name.text
    }
    const match = /\/node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(file)
    return match?.[1] ?? null
}

/**
 * True when the node's type is the named type declared in a file whose path satisfies `fromFile`.
 *
 * @param context - The ESLint rule context.
 * @param node - The node to type.
 * @param name - The declared symbol name (`EntityManager`).
 * @param fromFile - Filter on the declaring file (a package path, a slot).
 * @returns Whether one of the node's type origins matches.
 */
export const isTypeNamed = (context: Context, node: Node, name: string, fromFile: (file: string) => boolean = () => true): boolean =>
    typeOrigins(context, node).some((origin) => origin.name === name && fromFile(origin.file))

/**
 * True when the node's type is `name` declared by the package `pkg` (`typeorm`, `@nestjs/cqrs`).
 *
 * @param context - The ESLint rule context.
 * @param node - The node to type.
 * @param name - The declared symbol name.
 * @param pkg - The package that declares it.
 * @returns Whether the node's type is that package's `name`.
 */
export const isPackageType = (context: Context, node: Node, name: string, pkg: string): boolean =>
    typeOrigins(context, node).some((origin) => origin.name === name && origin.module === pkg)

/**
 * The package that declares the value an expression names (`APP_GUARD` and `Injectable` of `@nestjs/*`), after alias resolution, or
 * null for the repository's own declaration, an unresolved name or an expression that names no symbol.
 *
 * @param context - The ESLint rule context.
 * @param node - An identifier, member expression or call (its callee is read).
 * @returns The package name.
 */
export const packageOfExport = (context: Context, node: Node): string | null => {
    const { checker, toTs } = typed(context)
    let tsNode: ts.Node = toTs(node)
    if (!tsNode) return null
    if (ts.isCallExpression(tsNode)) tsNode = tsNode.expression
    const symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(tsNode) ? tsNode.name : tsNode)
    if (!symbol) return null
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
    for (const declaration of target.getDeclarations?.() ?? []) {
        const module = moduleOf(declaration, String(declaration.getSourceFile().fileName).replace(/\\/g, "/"))
        if (module !== null) return module
    }
    return null
}

/**
 * True when the node is a reference to a value the package `pkg` exports (`APP_GUARD` of `@nestjs/core`). A local constant of the same name is not.
 *
 * @param context - The ESLint rule context.
 * @param node - An identifier or member expression.
 * @param pkg - The package that must declare the referenced value.
 * @returns Whether the node references an export of that package.
 */
export const isPackageExport = (context: Context, node: Node, pkg: string): boolean => packageOfExport(context, node) === pkg
