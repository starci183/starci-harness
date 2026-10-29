/** R263: a receipt transaction records and publishes; a reactor/job processes after commit. */
import ts from "typescript"
import { baseName, ownerNameOf } from "./ports.ts"
import { childNode, originsOfType, resolvedSymbol, typed, type TypeOrigin } from "./types.ts"
import type { Context, Node } from "./rule.ts"
import type { HfsView } from "./hfs.ts"

/** Imported aliases and overload signatures retain the implementation's actual body. */
const bodiesOf = (checker: ts.TypeChecker, call: ts.CallExpression): ts.Node[] => {
    const expression = call.expression
    let name: ts.Node = expression
    if (ts.isPropertyAccessExpression(expression)) name = expression.name
    if (ts.isElementAccessExpression(expression)) name = expression.argumentExpression
    const symbol = checker.getSymbolAtLocation(name)
    const target = resolvedSymbol(checker, symbol)
    const declarations: (ts.Node | undefined)[] = [checker.getResolvedSignature(call)?.declaration, ...(target?.getDeclarations() ?? [])]
    return [...new Set(declarations.map((declaration) => childNode(declaration, "body") ?? childNode(childNode(declaration, "initializer"), "body")).filter((body): body is ts.Node => Boolean(body)))]
}

/** Receiver ownership is established by its declared type, including aliases and inherited ports; `accepts` also sees the type it came from. */
const hasOrigin = (checker: ts.TypeChecker, receiver: ts.Node | undefined, accepts: (origin: TypeOrigin, type: ts.Type) => boolean, seen = new Set<ts.Type>()): boolean => {
    const type = receiver && checker.getTypeAtLocation(receiver)
    const read = (current: ts.Type | undefined): boolean => {
        if (!current || seen.has(current)) return false
        seen.add(current)
        if (originsOfType(checker, current).some((origin) => accepts(origin, current))) return true
        const parts = current.isUnionOrIntersection() ? current.types : []
        const bases = current.isClassOrInterface() ? checker.getBaseTypes(current) ?? [] : []
        return [...parts, ...bases].some(read)
    }
    return read(type)
}

/** Bracket access with a literal key has the same meaning as a dotted method/property. */
const memberName = (expression: ts.Expression): string | null => {
    if (ts.isPropertyAccessExpression(expression)) return expression.name.text
    if (ts.isElementAccessExpression(expression) && ts.isStringLiteralLike(expression.argumentExpression)) return expression.argumentExpression.text
    return null
}

/** A callback named process is the former in-transaction processing contract, including aliases and methods. */
const isProcessCallback = (checker: ts.TypeChecker, node: ts.Node): boolean => {
    if (!(ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node) || ts.isMethodDeclaration(node))) return false
    const name = ts.isComputedPropertyName(node.name) ? node.name.expression : node.name
    if (!(ts.isIdentifier(name) || ts.isStringLiteralLike(name)) || name.text !== "process") return false
    return !!childNode(node, "body") || checker.getTypeAtLocation(childNode(node, "initializer") ?? node.name).getCallSignatures().length > 0
}

/** Persisting receipt data and publishing through platform ports are allowed; domain/CQRS processing is deferred. */
const isBusinessOrigin = (hfs: HfsView, origin: TypeOrigin): boolean => {
    if (origin.module === "@nestjs/cqrs") return ["CommandBus", "QueryBus"].includes(origin.name)
    return origin.module === null && hfs.tierOf(origin.file) === "domain" && baseName(origin.file).endsWith(".service.ts")
}

/**
 * A domain receipt port records a delivery and processes nothing: a class with no base class whose constructor takes only platform
 * ports (and TypeORM), at least one of them the platform `Inbox` (or its `EntityInbox` extension). It cannot reach another domain service or the CQRS buses, so a call
 * on it inside the receipt transaction is the inbox record itself (owner ruling 2026-10-17 "Theo y tro": the owner delegated the decision to main).
 */
const isReceiptPort = (checker: ts.TypeChecker, hfs: HfsView, type: ts.Type): boolean => {
    const declaration = type.getSymbol()?.getDeclarations()?.find(ts.isClassDeclaration)
    const constructor = declaration && !declaration.heritageClauses ? declaration.members.find(ts.isConstructorDeclaration) : undefined
    if (!constructor || constructor.parameters.length === 0) return false
    const dependencies = constructor.parameters.map((parameter) => originsOfType(checker, checker.getTypeAtLocation(parameter)))
    const isPort = (origin: TypeOrigin): boolean => origin.module === "typeorm" || (origin.module === null && hfs.tierOf(origin.file) === "platform")
    const isInbox = (origin: TypeOrigin): boolean => origin.module === null && ["Inbox", "EntityInbox"].includes(origin.name) && hfs.tierOf(origin.file) === "platform" && ownerNameOf(hfs, origin.file) === "inbox"
    return dependencies.every((origins) => origins.length > 0 && origins.every(isPort)) && dependencies.some((origins) => origins.some(isInbox))
}

/** The transaction port's package establishes when the callback runs before commit. */
const isTransactionCall = (checker: ts.TypeChecker, call: ts.CallExpression, receiver: ts.Node): boolean => memberName(call.expression) === "transaction"
    && hasOrigin(checker, receiver, (origin) => origin.module === "typeorm" && ["EntityManager", "DataSource"].includes(origin.name))

/** Extracting, binding or destructuring a method preserves its domain/bus receiver. */
const isBusinessCall = (checker: ts.TypeChecker, hfs: HfsView, expression: ts.Node | undefined, seen = new Set<ts.Node>()): boolean => {
    if (!expression || seen.has(expression)) return false
    seen.add(expression)
    const accepts = (origin: TypeOrigin, type: ts.Type): boolean => isBusinessOrigin(hfs, origin) && !isReceiptPort(checker, hfs, type)
    if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) return isBusinessCall(checker, hfs, expression.expression, seen)
    if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
        if (hasOrigin(checker, expression.expression, accepts)) return true
        if (["bind", "call", "apply"].includes(memberName(expression) ?? "")) return isBusinessCall(checker, hfs, expression.expression, seen)
    }
    if (ts.isCallExpression(expression)) return isBusinessCall(checker, hfs, expression.expression, seen)
    const name = ts.isPropertyAccessExpression(expression) ? expression.name
        : ts.isElementAccessExpression(expression) ? expression.argumentExpression : expression
    const symbol = checker.getSymbolAtLocation(name)
    const target = resolvedSymbol(checker, symbol)
    return target?.getDeclarations()?.some((declaration) => {
        if (ts.isBindingElement(declaration)) return hasOrigin(checker, childNode(declaration.parent.parent, "initializer"), accepts)
        return isBusinessCall(checker, hfs, childNode(declaration, "initializer"), seen)
    }) ?? false
}

/** Passing a const callback into transaction does not move its work past commit. */
const callbackBodies = (checker: ts.TypeChecker, expression: ts.Node | undefined, seen = new Set<ts.Node>()): ts.Node[] => {
    if (!expression || seen.has(expression)) return []
    seen.add(expression)
    const body = childNode(expression, "body")
    if (body) return [body]
    if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isParenthesizedExpression(expression)) return callbackBodies(checker, expression.expression, seen)
    if (ts.isCallExpression(expression) && memberName(expression.expression) === "bind") return callbackBodies(checker, childNode(expression.expression, "expression"), seen)
    const reference = ts.isPropertyAccessExpression(expression) ? expression.name : expression
    const symbol = checker.getSymbolAtLocation(reference)
    return symbol?.getDeclarations()?.flatMap((declaration) => {
        const declared = childNode(declaration, "body")
        return declared ? [declared] : callbackBodies(checker, childNode(declaration, "initializer"), seen)
    }) ?? []
}

/** Old inline process callbacks and business dispatch inside the receipt transaction violate handoff. */
const processesDelivery = (checker: ts.TypeChecker, hfs: HfsView, body: ts.Node): boolean => {
    let found = false
    const outside = new Set<ts.Node>()
    const inside = new Set<ts.Node>()
    const visit = (node: ts.Node, inTransaction = false): void => {
        const nodes = inTransaction ? inside : outside
        if (found || nodes.has(node)) return
        nodes.add(node)
        if (isProcessCallback(checker, node)) found = true
        if (ts.isCallExpression(node)) {
            if (inTransaction && isBusinessCall(checker, hfs, node.expression)) found = true
            const callee = node.expression
            if ((ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) && isTransactionCall(checker, node, callee.expression)) {
                for (const argument of node.arguments) {
                    visit(argument, true)
                    for (const callback of callbackBodies(checker, argument)) visit(callback, true)
                }
                return
            }
            if (inTransaction) for (const callback of callbackBodies(checker, node.expression)) visit(callback, true)
        }
        ts.forEachChild(node, (child) => visit(child, inTransaction))
    }
    visit(body)
    return found
}

/** Inspect the linted intake method or the implementation resolved at a webhook door's domain call. */
export const webhookIntakeProcessesDelivery = (context: Context, hfs: HfsView, node: Node): boolean => {
    const { checker, toTs } = typed(context)
    const reference: ts.Node = toTs(node)
    if (!reference) return false
    const own = childNode(reference, "body")
    let bodies: ts.Node[] = own ? [own] : []
    if (ts.isCallExpression(reference)) bodies = [reference, ...bodiesOf(checker, reference)]
    return bodies.some((body) => processesDelivery(checker, hfs, body))
}
