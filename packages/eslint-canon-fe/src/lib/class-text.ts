/** Shared static class-string readers for token discipline and Grammar scale checks. */
import type { TSESTree } from "@typescript-eslint/utils"
import { isClassAttribute, staticText } from "./ast.ts"
import type { AnyContext, Listener, Node } from "./rule.ts"
import { isProductSource } from "./scope.ts"

/** Static strings in JSX, constants and arrays, preserving the authored class order. */
const classText = (value: Node | null | undefined): string | null => {
  if (value?.type === "JSXExpressionContainer") return classText(value.expression)
  if (value?.type === "ArrayExpression") {
    const members = value.elements.map((element) => classText(element)).filter((text): text is string => Boolean(text))
    return members.length > 0 ? members.join(" ") : null
  }
  return staticText(value)
}

/** Visit class strings in product JSX, declarations and named class arrays. */
export const classTextVisitors = (context: AnyContext, report: (node: Node, text: string | null) => void): Listener => {
  if (!isProductSource(context)) return {}
  return {
    JSXAttribute(node: TSESTree.JSXAttribute) {
      if (isClassAttribute(node)) report(node, classText(node.value))
    },
    VariableDeclarator(node: TSESTree.VariableDeclarator) {
      report(node, classText(node.init))
    },
    Property(node: TSESTree.Property) {
      if (!node.computed && node.key.type === "Identifier" && node.key.name === "classes") report(node, classText(node.value))
    },
  }
}
