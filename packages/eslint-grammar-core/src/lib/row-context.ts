import type { SourceView } from "./types.ts"
import type { TSESTree } from "@typescript-eslint/types"

/** A module that is the Grammar package or one of its entries. */
const GRAMMAR_SOURCE = /^@starci\/grammar(?:\/|$)/

/** The Grammar export each local name of a file's `@starci/grammar` imports is bound to (an alias maps to the real name). */
export const grammarBindings = (program: TSESTree.Program): Map<string, string> => {
  const bound = new Map<string, string>()
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration" || !GRAMMAR_SOURCE.test(String(statement.source.value))) continue
    for (const specifier of statement.specifiers) {
      if (specifier.type === "ImportSpecifier") bound.set(specifier.local.name, specifier.imported.type === "Identifier" ? specifier.imported.name : String(specifier.imported.value))
    }
  }
  return bound
}

/** The Grammar component a JSX element is, or its lowercase tag; a local component of the same name is neither. */
export const elementOf = (opening: TSESTree.JSXOpeningElement, bound: ReadonlyMap<string, string>): { readonly grammar: string | null; readonly tag: string | null } => {
  const name = opening.name
  if (name.type === "JSXIdentifier") {
    const grammar = bound.get(name.name)
    if (grammar !== undefined) return { grammar, tag: null }
    return { grammar: null, tag: name.name === name.name.toLowerCase() ? name.name : null }
  }
  if (name.type === "JSXMemberExpression" && name.object.type === "JSXIdentifier" && bound.has(name.object.name)) return { grammar: name.property.name, tag: null }
  return { grammar: null, tag: null }
}

/** The attribute of an opening element by name (a spread is not read). */
export const attributeOf = (opening: TSESTree.JSXOpeningElement, name: string): TSESTree.JSXAttribute | null => {
  for (const entry of opening.attributes) {
    if (entry.type === "JSXAttribute" && entry.name.type === "JSXIdentifier" && entry.name.name === name) return entry
  }
  return null
}

/** The string an attribute states literally (`size="figure"`, `size={"figure"}`), or null when absent or computed. */
export const literalAttribute = (opening: TSESTree.JSXOpeningElement, name: string): string | null => {
  const value = attributeOf(opening, name)?.value
  if (value == null) return null
  if (value.type === "Literal") return typeof value.value === "string" ? value.value : null
  if (value.type === "JSXExpressionContainer") {
    const expression = value.expression
    if (expression.type === "Literal" && typeof expression.value === "string") return expression.value
    if (expression.type === "TemplateLiteral" && expression.expressions.length === 0) return expression.quasis[0]?.value.cooked ?? null
  }
  return null
}

/** The name of an object property key (`title`, `"title"`), or null when computed. */
export const keyName = (property: TSESTree.Property): string | null => {
  if (property.computed) return null
  if (property.key.type === "Identifier") return property.key.name
  if (property.key.type === "Literal") return String(property.key.value)
  return null
}

/** The value of an object literal's property by name. */
export const propertyOf = (object: TSESTree.ObjectExpression, name: string): TSESTree.Property | null => {
  for (const property of object.properties) {
    if (property.type === "Property" && keyName(property) === name) return property
  }
  return null
}

const isListKind = (object: TSESTree.ObjectExpression): boolean => {
  const kind = propertyOf(object, "kind")?.value
  return kind?.type === "Literal" && kind.value === "list"
}

/**
 * True when an object literal is a ListRow data object in the source: it stands in the `items` of a list collection
 * (`{ kind: "list", items }`, or `items` of a `Section` / `SurfaceCard` written `kind="list"`), through any `.map` callback, array,
 * conditional or `as` wrapper, or it is the `row` of a `<ListRow>`. A row list declared elsewhere and passed by name is not followed.
 */
export const isListRow = (object: TSESTree.ObjectExpression, bound: ReadonlyMap<string, string>): boolean => {
  let node: TSESTree.Node = object
  for (let parent = node.parent; parent != null; node = parent, parent = parent.parent) {
    switch (parent.type) {
      case "ArrayExpression":
      case "SpreadElement":
      case "ConditionalExpression":
      case "LogicalExpression":
      case "ReturnStatement":
      case "BlockStatement":
      case "TSAsExpression":
      case "TSSatisfiesExpression":
        continue
      case "ArrowFunctionExpression":
        if (parent.body !== node) return false
        continue
      case "CallExpression":
        if (parent.callee === node || parent.callee.type !== "MemberExpression") return false
        continue
      case "Property":
        if (parent.value !== node || keyName(parent) !== "items") return false
        return parent.parent.type === "ObjectExpression" && isListKind(parent.parent)
      case "JSXExpressionContainer": {
        const attribute = parent.parent
        if (attribute.type !== "JSXAttribute" || attribute.name.type !== "JSXIdentifier") return false
        const opening = attribute.parent
        const { grammar } = elementOf(opening, bound)
        if (attribute.name.name === "row") return grammar === "ListRow"
        if (attribute.name.name !== "items") return false
        return literalAttribute(opening, "kind") === "list" && (grammar === "Section" || grammar === "SurfaceCard")
      }
      default:
        return false
    }
  }
  return false
}

/** Every node under (and including) a node, in source order; JSX and TypeScript keys come from the parser's visitor keys. */
export function* descendants(node: TSESTree.Node, source: SourceView): Generator<TSESTree.Node> {
  yield node
  const keys = source.visitorKeys[node.type] ?? []
  for (const key of keys) {
    const child = (node as unknown as Record<string, unknown>)[key]
    for (const item of Array.isArray(child) ? child : [child]) {
      if (item !== null && typeof item === "object" && typeof (item as { type?: unknown }).type === "string") yield* descendants(item as TSESTree.Node, source)
    }
  }
}
