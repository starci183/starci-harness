/** Shared static class-string readers for token discipline and Grammar scale checks. */
import { isClassAttribute, staticText } from "./ast.ts"
import { isProductSource } from "./scope.ts"

/** Static strings in JSX, constants and arrays, preserving the authored class order. */
const classText = (value) => {
  if (value?.type === "JSXExpressionContainer") return classText(value.expression)
  if (value?.type === "ArrayExpression") {
    const members = value.elements.map((element) => classText(element)).filter(Boolean)
    return members.length > 0 ? members.join(" ") : null
  }
  return staticText(value)
}

/** Visit class strings in product JSX, declarations and named class arrays. */
export const classTextVisitors = (context, report) => {
  if (!isProductSource(context)) return {}
  return {
    JSXAttribute(node) {
      if (isClassAttribute(node)) report(node, classText(node.value))
    },
    VariableDeclarator(node) {
      report(node, classText(node.init))
    },
    Property(node) {
      if (!node.computed && node.key.type === "Identifier" && node.key.name === "classes") report(node, classText(node.value))
    },
  }
}
