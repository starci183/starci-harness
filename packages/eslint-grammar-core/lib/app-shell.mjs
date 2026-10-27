/** Static readers for the visible Grammar app-bar composition, including local JSX owners. */
import { attributeValue, stringOf } from "@starci/eslint-canon-fe/lib/ast.mjs"
import { functionOf, importOf, unwrap, variableOf } from "@starci/eslint-canon-fe/lib/bindings.mjs"

const GRAMMAR_SOURCE = /^@starci\/grammar(?:\/|$)/
/** Grammar controls whose visible hit target belongs to the navbar band's size contract. */
const BAR_CONTROLS = new Set(["Button", "IconButton", "Switch", "AvatarButton", "PlainPressable", "IdentityLockup", "SearchField", "Input", "TextField", "Select", "TextAction"])
const BAR_WRAPPERS = new Set(["GrammarRoot", "WorkspaceShell", "TopBar", "NavigationFeatureNav", "Region", "PageContainer", "NavLandmark", "Form", "Fieldset", "Field", "ButtonGroup", "DropdownMenu", "Popover", "Drawer", "Tooltip"])
const ACTION_PROPS = ["onPress", "onClick", "onAction", "onValueChange", "onSelectionChange", "onSelectedChange", "onChange", "onInputChange"]
const INTERACTION_PROPS = new Set(["label", "value", "defaultValue", "selectedKey", "selectedKeys", "selectionMode", "href", ...ACTION_PROPS])

/** Bar policy also counts labelled/value/selection/action field owners, so an extra control cannot vanish from the cluster. */
export const isBarControl = (context, opening, name) => {
  if (BAR_CONTROLS.has(name)) return true
  if (!name || !/^[A-Z]/.test(name) || BAR_WRAPPERS.has(name)) return false
  if (opening.attributes.some((entry) => entry.type === "JSXAttribute" && INTERACTION_PROPS.has(entry.name.name))) return true
  return [...INTERACTION_PROPS].some((prop) => propOf(context, opening, prop).value !== null)
}
/** A literal or constant's initializer, without type-only wrappers. */
export const resolveLocal = (context, expression, seen = new Set()) => {
  const node = unwrap(expression)
  if (node?.type === "MemberExpression") return resolveMember(context, node, seen)
  if (node?.type === "CallExpression") return resolveCall(context, node, seen)
  if (!["Identifier", "JSXIdentifier"].includes(node?.type) || seen.has(node)) return node
  const definition = variableOf(context, node)?.defs.find((entry) => entry.type === "Variable")
  if (!definition || definition.parent?.kind !== "const") return node
  seen.add(node)
  return resolveLocal(context, initializerOf(definition.node, node), seen)
}

const resolveCall = (context, node, seen) => {
  if (seen.has(node)) return node
  seen.add(node)
  const fn = functionOf(context, resolveLocal(context, node.callee, seen))
  if (!fn) return node
  if (fn.body.type !== "BlockStatement") return resolveLocal(context, fn.body, seen)
  if (fn.body.body.some((statement) => !["VariableDeclaration", "ReturnStatement"].includes(statement.type))) return node
  const returned = fn.body.body.find((statement) => statement.type === "ReturnStatement")
  return returned ? resolveLocal(context, returned.argument, seen) : node
}

const resolveMember = (context, node, seen) => {
  const key = node.computed ? stringOf(node.property) : node.property.name
  if (!key) return node
  const property = objectValue(context, node.object, key, seen)
  return property.known && property.value !== null ? resolveLocal(context, property.value, seen) : node
}

const initializerOf = (declaration, node) => {
  if (declaration.id.type === "ObjectPattern") {
    const property = declaration.id.properties.find((entry) => entry.type === "Property" && entry.value.name === node.name)
    if (!property) return node
    return { type: "MemberExpression", object: declaration.init, property: property.key, computed: property.computed }
  }
  return declaration.init
}

/** The imported Grammar component's name; aliases and namespace imports keep their identity. */
export const grammarName = (context, opening) => {
  const name = opening.name
  if (name.type === "JSXIdentifier") {
    const canonical = expressionName(context, name)
    if (canonical) return canonical
    return variableOf(context, name)?.defs.length ? null : name.name
  }
  if (name.type !== "JSXMemberExpression" || name.object.type !== "JSXIdentifier") return null
  return expressionName(context, { type: "MemberExpression", object: name.object, property: name.property, computed: false })
}

const expressionName = (context, expression) => {
  const resolved = resolveLocal(context, expression)
  if (resolved?.type === "MemberExpression") {
    return namespaceName(context, resolved.object, resolved.computed ? stringOf(resolved.property) : resolved.property.name)
  }
  if (!["Identifier", "JSXIdentifier"].includes(resolved?.type)) return null
  const imported = importOf(context, resolved)
  return imported && GRAMMAR_SOURCE.test(imported.source) ? imported.imported : null
}

const namespaceName = (context, expression, property) => {
  const object = resolveLocal(context, expression)
  if (!["Identifier", "JSXIdentifier"].includes(object?.type)) return null
  const imported = importOf(context, object)
  return imported && GRAMMAR_SOURCE.test(imported.source) ? property : null
}

const objectValue = (context, expression, name, seen = new Set()) => {
  const node = resolveLocal(context, expression)
  if (node?.type === "ConditionalExpression") return conditionalObjectValue(context, node, name, seen)
  if (node?.type !== "ObjectExpression" || seen.has(node)) return { known: false, value: null }
  seen.add(node)
  let result = { known: true, value: null }
  for (const property of node.properties) {
    if (property.type === "SpreadElement") {
      const spread = objectValue(context, property.argument, name, seen)
      if (!spread.known || spread.value !== null) result = spread
    } else if (!property.computed && (property.key.name ?? property.key.value) === name) {
      result = { known: true, value: property.value }
    }
  }
  return result
}

const conditionalObjectValue = (context, node, name, seen) => {
  if (seen.has(node)) return { known: false, value: null }
  const visited = new Set(seen).add(node)
  const values = [node.consequent, node.alternate].map((branch) => objectValue(context, branch, name, new Set(visited)))
  return { known: values.every((value) => value.known && value.value === null), value: null }
}

/** The effective prop, respecting JSX spread order; unknown later spreads cannot prove a value. */
export const propOf = (context, opening, name) => {
  let result = { known: true, value: null }
  for (const entry of opening.attributes) {
    if (entry.type === "JSXSpreadAttribute") {
      const spread = objectValue(context, entry.argument, name)
      if (!spread.known || spread.value !== null) result = spread
    } else if (entry.name.name === name) result = { known: true, value: attributeValue(entry), present: true }
  }
  return result
}

/** A statically proven string prop, or null for missing/unknown values. */
export const textProp = (context, opening, name) => {
  const prop = propOf(context, opening, name)
  return prop.known ? stringOf(resolveLocal(context, prop.value)) : null
}

/** The source spelling is semantic evidence for an icon or action whose translated label is dynamic. */
export const semanticText = (context, opening) => {
  const values = ["source", "icon", "label", "aria-label", "id", ...ACTION_PROPS].map((name) => {
    const prop = propOf(context, opening, name)
    return prop.value ? context.sourceCode.getText(prop.value) : ""
  })
  return values.join(" ")
}

/** The right-cluster role and the Grammar kind that must draw it. */
export const clusterRole = (context, opening, name) => {
  if (name === "Switch") return "theme"
  if (name === "AvatarButton") return "account"
  const text = semanticText(context, opening)
  if (/language|locale|translate/i.test(text)) return "language"
  if (/notification|bell/i.test(text)) return "notifications"
  if (/account|avatar|profile/i.test(text)) return "account"
  if (/theme|darkmode|color.?mode/i.test(text)) return "theme"
  return null
}
