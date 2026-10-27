/** Typed webhook handoff checks: the HTTP door records a delivery; only a later consumer dispatches commands. */
import ts from "typescript"
import { walk } from "./ast.ts"
import { injectedMembers } from "./doors.ts"
import type { TSESTree } from "@typescript-eslint/utils"
import { moduleReferences, visitModuleReference, type ModuleReference } from "./import-source.ts"
import { baseName } from "./ports.ts"
import { childNode, moduleOf, originsOfType, resolvedSymbol, typed, type Typed, type TypeOrigin } from "./types.ts"
import type { Context, Node } from "./rule.ts"
import type { HfsView } from "./hfs.ts"

const CQRS = "@nestjs/cqrs"
const BUSES = new Set(["CommandBus", "QueryBus"])

/** A feature handler has a feature owner and the closed handler role, regardless of its imported alias. */
const isFeatureHandler = (hfs: HfsView, file: string) => hfs.tierOf(file) === "feature" && baseName(file).endsWith(".handler.ts")

/** The bus's package and declared name, or the feature handler's declaring file, establish the forbidden origin. */
const forbiddenOrigin = (hfs: HfsView, origin: TypeOrigin, buses: ReadonlySet<string>): boolean =>
    (origin.module === CQRS && buses.has(origin.name)) || isFeatureHandler(hfs, origin.file)

/** Include unions, intersections and class inheritance, so an alias or a subclass cannot conceal the bus. */
const hasForbiddenType = (checker: ts.TypeChecker, hfs: HfsView, type: ts.Type | undefined, buses: ReadonlySet<string> = BUSES, seen = new Set<ts.Type>()): boolean => {
    if (!type || seen.has(type)) return false
    seen.add(type)
    if (originsOfType(checker, type).some((origin) => forbiddenOrigin(hfs, origin, buses))) return true
    const parts = type.isUnionOrIntersection() ? type.types : []
    const bases = type.isClassOrInterface() ? checker.getBaseTypes(type) ?? [] : []
    return [...parts, ...bases].some((part) => hasForbiddenType(checker, hfs, part, buses, seen))
}

/** A bus or feature handler receiver is never a webhook's delegating call. */
export const isWebhookForbiddenReceiver = (context: Context, hfs: HfsView, node: Node): boolean => {
    const { checker, toTs } = typed(context)
    const reference: ts.Node = toTs(node)
    return reference ? hasForbiddenType(checker, hfs, checker.getTypeAtLocation(reference)) : false
}

/** Resolve an imported/exported alias once before inspecting the actual declaration. */
const targetOf = (checker: ts.TypeChecker, symbol: ts.Symbol | undefined): ts.Symbol | undefined => resolvedSymbol(checker, symbol)

/** A module export's origin, including a bus subclass or an alias of its type. */
const forbiddenExport = (checker: ts.TypeChecker, hfs: HfsView, original: ts.Symbol): boolean => {
    const symbol = targetOf(checker, original)
    if (!symbol) return false
    const declarations = symbol.getDeclarations() ?? []
    if (declarations.some((declaration) => {
        const file = declaration.getSourceFile().fileName.replace(/\\/g, "/")
        return isFeatureHandler(hfs, file) || (moduleOf(declaration, file) === CQRS && BUSES.has(symbol.getName()))
    })) return true
    const [first] = declarations
    if (first === undefined) return false
    const type = checker.getTypeOfSymbolAtLocation(symbol, first)
    if (hasForbiddenType(checker, hfs, type)) return true
    return !!(symbol.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias))
        && hasForbiddenType(checker, hfs, checker.getDeclaredTypeOfSymbol(symbol))
}

/** Inspect selected exports of the referenced module, so barrels and renamed imports keep their real owner. */
const forbiddenModuleReference = (checker: ts.TypeChecker, toTs: Typed["toTs"], hfs: HfsView, reference: ModuleReference): boolean => {
    const { source, value, names } = reference
    if (value === CQRS && names.some((name) => BUSES.has(name ?? "") || name === "*" || name === "default")) return true
    const sourceNode: ts.Node = toTs(source)
    const module = sourceNode ? targetOf(checker, checker.getSymbolAtLocation(sourceNode)) : null
    if (!module) return false
    const exports = checker.getExportsOfModule(module)
    const wholeModule = names.includes("*") || (names.includes("default") && !exports.some((symbol) => symbol.getName() === "default"))
    return exports.some((symbol) => (wholeModule || names.includes(symbol.getName())) && forbiddenExport(checker, hfs, symbol))
}

/**
 * Forbidden import sites in a door or its declaring HTTP module. Named, type-only, namespace, dynamic and re-exported
 * imports all resolve to the actual export; an inline import type is judged by its resolved type.
 */
export const webhookForbiddenReferences = (context: Context, hfs: HfsView, program: TSESTree.Program): Node[] => {
    const { checker, toTs } = typed(context)
    const nodes = new Set<Node>()
    const visitors = moduleReferences((reference) => {
        if (forbiddenModuleReference(checker, toTs, hfs, reference)) nodes.add(reference.node)
    })
    walk(program, (node) => {
        visitModuleReference(visitors, node)
        if (node.type !== "TSImportType") return
        const typeNode: ts.Node = toTs(node)
        if (typeNode && hasForbiddenType(checker, hfs, checker.getTypeAtLocation(typeNode))) nodes.add(node)
    })
    // An ambiently supplied type still cannot be injected; an import finding already refuses the same dependency.
    if (nodes.size === 0) walk(program, (node) => {
        if (node.type !== "ClassDeclaration") return
        for (const member of injectedMembers(context, node)) {
            if (member.annotation && isWebhookForbiddenReceiver(context, hfs, member.annotation)) nodes.add(member.node)
        }
    })
    return [...nodes]
}

/** The symbol of a called member, including a statically resolved bracket access. */
const calledSymbol = (checker: ts.TypeChecker, expression: ts.Expression): ts.Symbol | undefined => {
    if (ts.isPropertyAccessExpression(expression)) return targetOf(checker, checker.getSymbolAtLocation(expression.name))
    if (ts.isElementAccessExpression(expression)) return targetOf(checker, checker.getSymbolAtLocation(expression.argumentExpression))
    return targetOf(checker, checker.getSymbolAtLocation(expression))
}

/** Overload declarations point back to their implementation; arrow-valued service members also carry a body. */
const bodyOf = (declaration: ts.Node | undefined): ts.Node | null => {
    const body = childNode(declaration, "body")
    if (body) return body
    const initializer = childNode(declaration, "initializer")
    return initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) ? initializer.body : null
}

/** Bodies the checker actually resolves at the intake call, never every other method of the service. */
const calledBodies = (checker: ts.TypeChecker, call: ts.CallExpression): ts.Node[] => {
    const signature = checker.getResolvedSignature(call)?.declaration
    const declarations = calledSymbol(checker, call.expression)?.getDeclarations() ?? []
    return [...new Set([signature, ...declarations].map((declaration) => bodyOf(declaration)).filter((body): body is ts.Node => Boolean(body)))]
}

/** A method body dispatches on a CQRS bus or feature handler when the receiver's genuine declared type proves it. */
const dispatchesCommand = (checker: ts.TypeChecker, hfs: HfsView, body: ts.Node): boolean => {
    let found = false
    const visit = (node: ts.Node): void => {
        if (found) return
        if (ts.isCallExpression(node) && (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression))) {
            const type = checker.getTypeAtLocation(node.expression.expression)
            if (hasForbiddenType(checker, hfs, type)) found = true
        }
        ts.forEachChild(node, visit)
    }
    visit(body)
    return found
}

/**
 * Inspect a resolved domain intake's own body, closures included. Dynamic receivers, erased types, external signatures and
 * calls through further helpers remain semantic review: this check does not prove the full inbox/outbox transaction.
 */
export const webhookIntakeDispatchesCommand = (context: Context, hfs: HfsView, call: Node): boolean => {
    const { checker, toTs } = typed(context)
    const reference: ts.Node = toTs(call)
    if (!reference || !ts.isCallExpression(reference)) return false
    return calledBodies(checker, reference).some((body) => dispatchesCommand(checker, hfs, body))
}
