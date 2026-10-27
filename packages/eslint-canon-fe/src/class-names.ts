/**
 * The classNames law: component markup consumes named styling declarations, while colocated
 * classNames files own the utility-token composition.
 */

import type { TSESTree } from "@typescript-eslint/utils"
import { defineRule, type AnyContext, type Node, type Recommended, type Rules } from "./lib/rule.ts"
import { isComponentFile, roleOfFile } from "./lib/scope.ts"

/** The owner a cn call may sit in, and the exports that publish one. */
const FUNCTION_OWNERS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"])
const EXPORTS = new Set<string | undefined>(["ExportNamedDeclaration", "ExportDefaultDeclaration"])

/** The styling declarations of a component owner: the file its slot gives the role `styles`. */
const isClassNamesFile = (context: AnyContext): boolean => isComponentFile(context) && roleOfFile(context) === "styles"
const isClassAttribute = (node: TSESTree.JSXAttribute): boolean => {
  const name = node.name.name
  return typeof name === "string" && ["className", "class"].includes(name)
}
const isCn = (node: Node | null | undefined): boolean => node?.type === "Identifier" && node.name === "cn"

const importedClassNames = (context: AnyContext): Set<string> => {
  const imports = new Set<string>()
  const sourceCode = context.sourceCode || context.getSourceCode()
  for (const statement of sourceCode.ast.body) {
    if (statement.type !== "ImportDeclaration" || statement.source.value !== "./classNames") continue
    for (const specifier of statement.specifiers) imports.add(specifier.local.name)
  }
  return imports
}

const isExportedOwner = (node: Node): boolean => {
  let current: Node | undefined = node
  while (current) {
    if (FUNCTION_OWNERS.has(current.type)) {
      current = current.parent
      if (current?.type === "VariableDeclarator") current = current.parent
      if (current?.type === "VariableDeclaration") current = current.parent
      return EXPORTS.has(current?.type)
    }
    if (current.type === "VariableDeclarator") {
      current = current.parent?.parent
      return EXPORTS.has(current?.type)
    }
    current = current.parent
  }
  return false
}

const visitTokenLeaves = (node: Node | null | undefined, report: (node: Node, messageId: "array" | "token") => void): void => {
  if (!node) return
  if (node.type === "ArrayExpression") {
    report(node, "array")
    return
  }
  if (node.type === "Literal" && typeof node.value === "string") {
    if (/\s/.test(node.value) || /\d+,\d+/.test(node.value)) report(node, "token")
    return
  }
  if (node.type === "ConditionalExpression") {
    visitTokenLeaves(node.consequent, report)
    visitTokenLeaves(node.alternate, report)
  } else if (node.type === "LogicalExpression") {
    visitTokenLeaves(node.left, report)
    visitTokenLeaves(node.right, report)
  }
}

const isEmptyClassName = (node: Node | null | undefined): boolean => node?.type === "Literal" && node.value === null || node?.type === "Identifier" && node.name === "undefined"

const usesImportedClassName = (node: Node | null | undefined, imported: ReadonlySet<string>): boolean => {
  if (!node) return false
  if (node.type === "Identifier") return imported.has(node.name) || node.name === "undefined"
  if (isEmptyClassName(node)) return true
  if (node.type === "CallExpression") {
    if (node.callee.type === "Identifier") return imported.has(node.callee.name)
    return node.callee.type === "MemberExpression" && node.callee.object.type === "Identifier" && imported.has(node.callee.object.name)
  }
  if (node.type === "MemberExpression") return node.object.type === "Identifier" && imported.has(node.object.name)
  if (node.type === "ConditionalExpression") return usesImportedClassName(node.consequent, imported) && usesImportedClassName(node.alternate, imported)
  if (node.type === "LogicalExpression") {
    if (node.operator === "&&") return usesImportedClassName(node.right, imported)
    return usesImportedClassName(node.left, imported) && usesImportedClassName(node.right, imported)
  }
  return false
}

/** Report className values written directly in component JSX. */
export const noInlineClassName = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Component JSX must import a named className declaration." },
    schema: [],
    messages: { inline: "Move this className value to an imported colocated classNames.ts export." },
  },
  create(context) {
    if (!isComponentFile(context)) return {}
    const imported = importedClassNames(context)
    return {
      JSXAttribute(node: TSESTree.JSXAttribute) {
        if (!isClassAttribute(node) || !node.value) return
        const expression = node.value.type === "JSXExpressionContainer" ? node.value.expression : node.value
        if (!usesImportedClassName(expression, imported)) context.report({ node, messageId: "inline" })
      },
    }
  },
})

/** Require every classNames declaration to use the colocated classNames.ts convention. */
export const classNamesInColocatedFile = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Reusable className declarations belong in colocated classNames.ts files." },
    schema: [],
    messages: { misplaced: "Put reusable className declarations in a colocated classNames.ts file." },
  },
  create(context) {
    if (!isComponentFile(context)) return {}
    const styles = isClassNamesFile(context)
    return {
      CallExpression(node: TSESTree.CallExpression) {
        if (!isCn(node.callee) || styles) return
        context.report({ node, messageId: "misplaced" })
      },
    }
  },
})

/** Require variadic cn utility tokens: no arrays, whitespace-packed values, or fractional commas. */
export const cnArgumentsAreSingleTokens = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Each cn argument is one valid utility token." },
    schema: [],
    messages: {
      array: "Pass utility tokens to cn as variadic arguments, not an array.",
      token: "Each cn argument must be one utility token without whitespace or malformed fractional commas.",
      unexported: "Export every className declaration or function that produces a cn value.",
    },
  },
  create(context) {
    if (!isClassNamesFile(context)) return {}
    return {
      CallExpression(node: TSESTree.CallExpression) {
        if (!isCn(node.callee)) return
        if (!isExportedOwner(node)) context.report({ node, messageId: "unexported" })
        for (const argument of node.arguments) visitTokenLeaves(argument, (reportedNode, messageId) => context.report({ node: reportedNode, messageId }))
      },
    }
  },
})

/** Every rule this law publishes. */
export const rules = {
  "no-inline-class-name": noInlineClassName,
  "class-names-in-colocated-file": classNamesInColocatedFile,
  "cn-arguments-are-single-tokens": cnArgumentsAreSingleTokens,
} satisfies Rules

/** Recommended severity for the classNames law. */
export const recommended: Recommended = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-fe/${name}`, "error"]))
