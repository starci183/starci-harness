/** Static class declarations in imported colocated modules, resolved by the consuming TypeScript program. */
import ts from "typescript"
import type { AnyContext, Node } from "./rule.ts"

/** One text found for a node of the linted file. */
export interface TypedString {
  readonly node: Node
  readonly text: string
}

/** True for a TypeScript node (a declaration's `initializer`, when it has one). */
const isTsNode = (value: unknown): value is ts.Node => typeof value === "object" && value !== null && "kind" in value && typeof value.kind === "number"

/** The expression's literal fragments, following imported const/property declarations without executing code. */
const fragments = (checker: ts.TypeChecker, node: ts.Node | undefined, seen: Set<ts.Node>, mode: string): string[] => {
  if (!node || seen.has(node)) return []
  seen.add(node)
  if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) return mode === "style-keys" ? [] : [node.text]
  if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) return fragments(checker, node.expression, seen, mode)
  if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const symbol = ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)
      ? checker.getTypeAtLocation(node.expression).getProperty(node.argumentExpression.text)
      : checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node) ? node.name : node)
    return symbolFragments(checker, symbol, seen, mode)
  }
  if (mode === "style-keys" && ts.isObjectLiteralExpression(node)) {
    return node.properties.flatMap((property) => {
      if (ts.isSpreadAssignment(property)) return fragments(checker, property.expression, seen, mode)
      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) return []
      return ts.isComputedPropertyName(property.name)
        ? fragments(checker, property.name.expression, seen, "variant")
        : [property.name.text]
    })
  }
  return fragmentChildren(node, mode).flatMap((child) => fragments(checker, child, seen, mode))
}

/** An object binding reads only its selected property's symbol, including aliases and nested patterns. */
const bindingProperty = (checker: ts.TypeChecker, declaration: ts.BindingElement): ts.Symbol | null | undefined => {
  const source = declaration.parent.parent
  const owner = ts.isBindingElement(source) ? bindingProperty(checker, source) : null
  const initializer = "initializer" in source ? source.initializer : undefined
  const type = owner ? checker.getTypeOfSymbolAtLocation(owner, source) : initializer ? checker.getTypeAtLocation(initializer) : null
  const name = declaration.propertyName ?? declaration.name
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? type?.getProperty(name.text) : null
}

/** Alias and destructuring symbols retain their declaration values without reading sibling properties. */
const symbolFragments = (checker: ts.TypeChecker, input: ts.Symbol | null | undefined, seen: Set<ts.Node>, mode: string): string[] => {
  let symbol = input
  if (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol)
  return (symbol?.declarations ?? []).flatMap((declaration) => {
    const selected = ts.isBindingElement(declaration) ? bindingProperty(checker, declaration) : null
    return selected ? symbolFragments(checker, selected, seen, mode) : fragments(checker, "initializer" in declaration && isTsNode(declaration.initializer) ? declaration.initializer : undefined, seen, mode)
  })
}

/** Class-producing positions inside a declaration, including cn dictionaries and conditional recipes. */
const fragmentChildren = (node: ts.Node, mode: string): readonly ts.Node[] => {
  if (ts.isCallExpression(node)) return mode === "classes" ? node.arguments : []
  if (ts.isArrayLiteralExpression(node)) return node.elements
  if (ts.isConditionalExpression(node)) return [node.whenTrue, node.whenFalse]
  if (ts.isBinaryExpression(node)) {
    if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return [node.right]
    return [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].some((kind) => kind === node.operatorToken.kind) ? [node.left, node.right] : []
  }
  if (ts.isObjectLiteralExpression(node)) return node.properties.flatMap((property) => ts.isPropertyAssignment(property) ? [property.name, property.initializer] : [])
  if (ts.isTemplateExpression(node) && mode === "classes") return [node.head, ...node.templateSpans.flatMap((span) => [span.expression, span.literal])]
  return []
}

/**
 * Imported class values are reported at their use in the linted file, while their text comes from the typed declaration.
 * Syntax-only rule consumers have no imported-file program and retain same-file inspection.
 */
export const typedClassStrings = (context: AnyContext, node: Node, mode: string): TypedString[] => {
  const services = context.sourceCode.parserServices
  if (!services?.program || !services.esTreeNodeToTSNodeMap) return []
  const source = services.esTreeNodeToTSNodeMap.get(node)
  const checker = services.program.getTypeChecker()
  return fragments(checker, source, new Set<ts.Node>(), mode).map((text) => ({ node, text }))
}

/** Known imported props spreads expose the same static property values as named JSX attributes. */
export const typedPropertyStrings = (context: AnyContext, node: Node, key: string, mode: string): TypedString[] => {
  const services = context.sourceCode.parserServices
  if (!services?.program || !services.esTreeNodeToTSNodeMap) return []
  const source = services.esTreeNodeToTSNodeMap.get(node)
  const checker = services.program.getTypeChecker()
  const symbol = checker.getTypeAtLocation(source).getProperty(key)
  return symbolFragments(checker, symbol, new Set<ts.Node>(), mode).map((text) => ({ node, text }))
}
