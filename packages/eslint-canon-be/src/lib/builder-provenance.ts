import ts from "typescript"
import { moduleOf, resolvedSymbol } from "./types.ts"

const unwrapped = (input: ts.Expression): ts.Expression => {
    let node = input
    while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)
        || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) node = node.expression
    return node
}

/** Follows actual constant values; a matching callable annotation never supplies value provenance. */
const valueOrigins = (checker: ts.TypeChecker, input: ts.Expression, seen: Set<ts.Symbol>): ts.Node[] => {
    const node = unwrapped(input)
    if (ts.isCallExpression(node)) return [node]
    const symbol = resolvedSymbol(checker, checker.getSymbolAtLocation(node))
    if (!symbol || seen.has(symbol)) return []
    seen.add(symbol)
    return (symbol.getDeclarations() ?? []).flatMap<ts.Node>((declaration) => {
        if (!ts.isVariableDeclaration(declaration)) return [declaration]
        if (!ts.isVariableDeclarationList(declaration.parent) || !(declaration.parent.flags & ts.NodeFlags.Const)
            || !ts.isIdentifier(declaration.name) || !declaration.initializer) return []
        return valueOrigins(checker, declaration.initializer, seen)
    })
}

const isKitFactory = (checker: ts.TypeChecker, expression: ts.Expression): boolean =>
    valueOrigins(checker, expression, new Set()).some((declaration) => {
        if (!ts.isFunctionDeclaration(declaration) || declaration.name?.text !== "builder") return false
        const owner = moduleOf(declaration, declaration.getSourceFile().fileName.replaceAll("\\", "/"))
        return owner === "@starci/jest-preset" || owner === "@starci/jest-preset/builders"
    })

/** A direct override reaches a value actually produced by the canonical builder factory, including immutable aliases. */
export const isKitBuilderOverride = (checker: ts.TypeChecker, literal: ts.Node): boolean => {
    let argument = literal
    while (ts.isParenthesizedExpression(argument.parent) || ts.isAsExpression(argument.parent)
        || ts.isTypeAssertionExpression(argument.parent) || ts.isSatisfiesExpression(argument.parent)
        || ts.isNonNullExpression(argument.parent)) argument = argument.parent
    const call = argument.parent
    if (!ts.isCallExpression(call) || call.arguments[0] !== argument) return false
    return valueOrigins(checker, call.expression, new Set()).some(origin =>
        ts.isCallExpression(origin) && isKitFactory(checker, origin.expression))
}
