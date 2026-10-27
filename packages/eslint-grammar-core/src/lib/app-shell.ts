/** Static readers for the visible Grammar app-bar composition, including local JSX owners. */
import type { TSESTree } from "@typescript-eslint/types"
import { attributeValue, stringOf } from "@starci/eslint-canon-fe/lib/ast.mjs"
import { functionOf, importOf, unwrap, variableOf } from "@starci/eslint-canon-fe/lib/bindings.mjs"
import type { Node, ReaderContext, Resolved, SyntheticMember } from "./types.ts"
import { isNode } from "./types.ts"

const GRAMMAR_SOURCE = /^@starci\/grammar(?:\/|$)/
/** Grammar controls whose visible hit target belongs to the navbar band's size contract. */
const BAR_CONTROLS = new Set(["Button", "IconButton", "Switch", "AvatarButton", "PlainPressable", "IdentityLockup", "SearchField", "Input", "TextField", "Select", "TextAction"])
const BAR_WRAPPERS = new Set(["GrammarRoot", "WorkspaceShell", "TopBar", "NavigationFeatureNav", "Region", "PageContainer", "NavLandmark", "Form", "Fieldset", "Field", "ButtonGroup", "DropdownMenu", "Popover", "Drawer", "Tooltip"])
const ACTION_PROPS = ["onPress", "onClick", "onAction", "onValueChange", "onSelectionChange", "onSelectedChange", "onChange", "onInputChange"]
const INTERACTION_PROPS = new Set(["label", "value", "defaultValue", "selectedKey", "selectedKeys", "selectionMode", "href", ...ACTION_PROPS])

/** The effective value of a prop: `known` is false when an unresolvable spread could still supply it. */
export interface PropValue {
  readonly known: boolean
  readonly value: Node | null
  readonly present?: true
}

/** The name of a plain (non-namespaced) JSX attribute; null for a namespaced one. */
const attributeName = (entry: TSESTree.JSXAttribute): string | null => (entry.name.type === "JSXIdentifier" ? entry.name.name : null)

/** Bar policy also counts labelled/value/selection/action field owners, so an extra control cannot vanish from the cluster. */
export const isBarControl = (context: ReaderContext, opening: TSESTree.JSXOpeningElement, name: string | null): boolean => {
  if (name !== null && BAR_CONTROLS.has(name)) return true
  if (!name || !/^[A-Z]/.test(name) || BAR_WRAPPERS.has(name)) return false
  if (opening.attributes.some((entry) => {
    if (entry.type !== "JSXAttribute") return false
    const attribute = attributeName(entry)
    return attribute !== null && INTERACTION_PROPS.has(attribute)
  })) return true
  return [...INTERACTION_PROPS].some((prop) => propOf(context, opening, prop).value !== null)
}

/** The identifier name of a member property, or undefined for any other kind of key. */
const memberPropertyName = (property: Node): string | undefined => ("name" in property && typeof property.name === "string" ? property.name : undefined)

/** A literal or constant's initializer, without type-only wrappers. */
export const resolveLocal = (context: ReaderContext, expression: Resolved | null | undefined, seen: Set<Resolved> = new Set()): Resolved | null | undefined => {
  const node = expression && isNode(expression) ? unwrap(expression) : expression
  if (node?.type === "MemberExpression") return resolveMember(context, node, seen)
  if (node?.type === "CallExpression") return resolveCall(context, node, seen)
  if (node?.type !== "Identifier" && node?.type !== "JSXIdentifier" || seen.has(node)) return node
  const definition = variableOf(context, node)?.defs.find((entry) => entry.type === "Variable")
  if (!definition || definition.parent?.kind !== "const") return node
  seen.add(node)
  return resolveLocal(context, initializerOf(definition.node, node), seen)
}

const resolveCall = (context: ReaderContext, node: TSESTree.CallExpression, seen: Set<Resolved>): Resolved | null | undefined => {
  if (seen.has(node)) return node
  seen.add(node)
  const fn = functionOf(context, realNode(resolveLocal(context, node.callee, seen)))
  if (!fn) return node
  if (fn.body.type !== "BlockStatement") return resolveLocal(context, fn.body, seen)
  if (fn.body.body.some((statement) => !["VariableDeclaration", "ReturnStatement"].includes(statement.type))) return node
  const returned = fn.body.body.find((statement) => statement.type === "ReturnStatement")
  return returned ? resolveLocal(context, returned.argument, seen) : node
}

/** A resolved value as a parsed node; a synthesized member stands for no function or value of the tree. */
export const realNode = (value: Resolved | null | undefined): Node | null | undefined => (value && isNode(value) ? value : null)

const resolveMember = (context: ReaderContext, node: TSESTree.MemberExpression | SyntheticMember, seen: Set<Resolved>): Resolved | null | undefined => {
  const key = node.computed ? stringOf(node.property) : memberPropertyName(node.property)
  if (!key) return node
  const property = objectValue(context, node.object, key, seen)
  return property.known && property.value !== null ? resolveLocal(context, property.value, seen) : node
}

const initializerOf = (declaration: TSESTree.VariableDeclarator, node: TSESTree.Identifier | TSESTree.JSXIdentifier): Resolved | null => {
  if (declaration.id.type === "ObjectPattern") {
    const property = declaration.id.properties.find((entry) => entry.type === "Property" && entry.value.type === "Identifier" && entry.value.name === node.name)
    if (!property || property.type !== "Property") return node
    return { type: "MemberExpression", object: declaration.init, property: property.key, computed: property.computed }
  }
  return declaration.init
}

/** The imported Grammar component's name; aliases and namespace imports keep their identity. */
export const grammarName = (context: ReaderContext, opening: TSESTree.JSXOpeningElement): string | null => {
  const name = opening.name
  if (name.type === "JSXIdentifier") {
    const canonical = expressionName(context, name)
    if (canonical) return canonical
    return variableOf(context, name)?.defs.length ? null : name.name
  }
  if (name.type !== "JSXMemberExpression" || name.object.type !== "JSXIdentifier") return null
  return expressionName(context, { type: "MemberExpression", object: name.object, property: name.property, computed: false }) ?? null
}

const expressionName = (context: ReaderContext, expression: Resolved): string | null | undefined => {
  const resolved = resolveLocal(context, expression)
  if (resolved?.type === "MemberExpression") {
    return namespaceName(context, resolved.object, resolved.computed ? stringOf(resolved.property) : memberPropertyName(resolved.property))
  }
  if (resolved?.type !== "Identifier" && resolved?.type !== "JSXIdentifier") return null
  const imported = importOf(context, resolved)
  return imported && GRAMMAR_SOURCE.test(imported.source) ? imported.imported : null
}

const namespaceName = (context: ReaderContext, expression: Node | null, property: string | null | undefined): string | null | undefined => {
  const object = resolveLocal(context, expression)
  if (object?.type !== "Identifier" && object?.type !== "JSXIdentifier") return null
  const imported = importOf(context, object)
  return imported && GRAMMAR_SOURCE.test(imported.source) ? property : null
}

/** The value of a named property of an object expression: `known` is false when a spread or condition hides it. */
const objectValue = (context: ReaderContext, expression: Resolved | null | undefined, name: string, seen: Set<Resolved> = new Set()): PropValue => {
  const node = resolveLocal(context, expression)
  if (node?.type === "ConditionalExpression") return conditionalObjectValue(context, node, name, seen)
  if (node?.type !== "ObjectExpression" || seen.has(node)) return { known: false, value: null }
  seen.add(node)
  let result: PropValue = { known: true, value: null }
  for (const property of node.properties) {
    if (property.type === "SpreadElement") {
      const spread = objectValue(context, property.argument, name, seen)
      if (!spread.known || spread.value !== null) result = spread
    } else if (!property.computed && propertyKeyText(property.key) === name) {
      result = { known: true, value: property.value }
    }
  }
  return result
}

/** The text a property key spells: an identifier's name or a string literal's value; null for any other key. */
export const propertyKeyText = (key: Node): string | null => {
  if (key.type === "Identifier") return key.name
  if (key.type === "Literal" && typeof key.value === "string") return key.value
  return null
}

const conditionalObjectValue = (context: ReaderContext, node: TSESTree.ConditionalExpression, name: string, seen: Set<Resolved>): PropValue => {
  if (seen.has(node)) return { known: false, value: null }
  const visited = new Set(seen).add(node)
  const values = [node.consequent, node.alternate].map((branch) => objectValue(context, branch, name, new Set(visited)))
  return { known: values.every((value) => value.known && value.value === null), value: null }
}

/** The effective prop, respecting JSX spread order; unknown later spreads cannot prove a value. */
export const propOf = (context: ReaderContext, opening: TSESTree.JSXOpeningElement, name: string): PropValue => {
  let result: PropValue = { known: true, value: null }
  for (const entry of opening.attributes) {
    if (entry.type === "JSXSpreadAttribute") {
      const spread = objectValue(context, entry.argument, name)
      if (!spread.known || spread.value !== null) result = spread
    } else if (entry.name.name === name) result = { known: true, value: attributeValue(entry), present: true }
  }
  return result
}

/** A statically proven string prop, or null for missing/unknown values. */
export const textProp = (context: ReaderContext, opening: TSESTree.JSXOpeningElement, name: string): string | null => {
  const prop = propOf(context, opening, name)
  return prop.known ? stringOf(realNode(resolveLocal(context, prop.value))) : null
}

/** The source spelling is semantic evidence for an icon or action whose translated label is dynamic. */
export const semanticText = (context: ReaderContext, opening: TSESTree.JSXOpeningElement): string => {
  const values = ["source", "icon", "label", "aria-label", "id", ...ACTION_PROPS].map((name) => {
    const prop = propOf(context, opening, name)
    return prop.value ? context.sourceCode.getText(prop.value) : ""
  })
  return values.join(" ")
}

/** The right-cluster role and the Grammar kind that must draw it. */
export const clusterRole = (context: ReaderContext, opening: TSESTree.JSXOpeningElement, name: string | null): string | null => {
  if (name === "Switch") return "theme"
  if (name === "AvatarButton") return "account"
  const text = semanticText(context, opening)
  if (/language|locale|translate/i.test(text)) return "language"
  if (/notification|bell/i.test(text)) return "notifications"
  if (/account|avatar|profile/i.test(text)) return "account"
  if (/theme|darkmode|color.?mode/i.test(text)) return "theme"
  return null
}
