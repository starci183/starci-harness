/** CTA-6: app buttons declare consequences; Grammar owns their visual variants. */
import { attributeValue, stringOf, walk } from "./lib/ast.mjs"
import { functionOf, importOf, isFn, patternPath, unwrap, variableOf } from "./lib/bindings.mjs"
import { typedPropertyStrings } from "./lib/typed-class-values.mjs"
import ts from "typescript"

const GRAMMAR_ENTRY = /^@starci\/grammar(?:\/(?:common|core|offset-pop))?$/
const BUTTONS = new Set(["Button", "IconButton"])
const DIALOGS = new Set(["AlertDialog", "ConfirmDialog"])
const ITEMS = new Set(["CollectionItem", "ItemActions", "ListItem", "ListRow", "ListBox.Item", "GridList.Item", "Table.Row", "TableRow"])

/** The consuming TypeScript program exposes literal intents and spread properties without executing app code. */
const typedInfo = (context, node, key) => {
  const services = context.sourceCode.parserServices
  if (!services?.program || !services.esTreeNodeToTSNodeMap || !node) return null
  const checker = services.program.getTypeChecker()
  const source = services.esTreeNodeToTSNodeMap.get(node)
  const owner = checker.getTypeAtLocation(source)
  const symbol = key === undefined ? null : owner.getProperty(key)
  if (key !== undefined && !symbol) return null
  const type = symbol ? checker.getTypeOfSymbolAtLocation(symbol, source) : owner
  const members = type.isUnion() ? type.types : [type]
  return { values: members.filter((member) => member.isStringLiteral()).map((member) => member.value), optional: Boolean(symbol && (symbol.flags & ts.SymbolFlags.Optional) !== 0) }
}

/** Resolve the imported Grammar role without confusing a shadowed local component with its namesake. */
const roleOf = (context, name) => {
  const parts = []
  let root = name
  while (root.type === "JSXMemberExpression") {
    parts.unshift(root.property.name)
    root = root.object
  }
  if (root.type !== "JSXIdentifier") return null
  const imported = importOf(context, root)
  if (!imported || !GRAMMAR_ENTRY.test(imported.source)) return null
  if (imported.imported) parts.unshift(imported.imported)
  else if (!variableOf(context, root)?.defs.some((definition) => definition.node.type === "ImportNamespaceSpecifier")) return null
  return parts.join(".")
}

/** Static object properties, including aliases and spreads, retain their button obligations. */
const objectProperty = (context, input, key, seen = new Set()) => {
  const node = unwrap(input)
  if (!node || seen.has(node)) return []
  const next = new Set(seen).add(node)
  if (node.type === "ObjectExpression") return node.properties.flatMap((property) => {
    if (property.type === "SpreadElement") return objectProperty(context, property.argument, key, next)
    const name = property.computed ? stringOf(property.key) : property.key.name ?? property.key.value
    return name === key ? [property.value] : []
  })
  if (node.type === "ConditionalExpression") return [node.consequent, node.alternate].flatMap((branch) => objectProperty(context, branch, key, next))
  if (node.type === "MemberExpression") {
    const member = node.computed ? stringOf(node.property) : node.property.name
    return objectProperty(context, node.object, member, next).flatMap((value) => objectProperty(context, value, key, next))
  }
  if (node.type !== "Identifier") return []
  const definition = variableOf(context, node)?.defs.find((entry) => entry.type === "Variable")
  if (!definition) return []
  const path = patternPath(definition.node.id, node.name)
  if (path === null) return []
  const values = path.reduce((entries, name) => entries.flatMap((entry) => objectProperty(context, entry, name, next)), [definition.node.init])
  return values.flatMap((value) => objectProperty(context, value, key, next))
}

/** Possible statically authored values of an intent or step; dynamic values remain TypeScript's responsibility. */
const valuesOf = (context, input, seen = new Set()) => {
  const node = unwrap(input)
  if (!node || seen.has(node)) return []
  const next = new Set(seen).add(node)
  const text = stringOf(node)
  if (text !== null) return [text]
  if (node.type === "ConditionalExpression") return [node.consequent, node.alternate].flatMap((branch) => valuesOf(context, branch, next))
  if (node.type === "LogicalExpression") return valuesOf(context, node.right, next)
  if (node.type === "MemberExpression") {
    const name = node.computed ? stringOf(node.property) : node.property.name
    const values = objectProperty(context, node.object, name, next).flatMap((value) => valuesOf(context, value, next))
    return values.length ? values : typedInfo(context, node)?.values ?? []
  }
  if (node.type !== "Identifier") return typedInfo(context, node)?.values ?? []
  const definition = variableOf(context, node)?.defs.find((entry) => entry.type === "Variable")
  if (!definition) return typedInfo(context, node)?.values ?? []
  const path = patternPath(definition.node.id, node.name)
  if (path === null) return []
  const values = path.reduce((entries, name) => entries.flatMap((entry) => objectProperty(context, entry, name, next)), [definition.node.init])
  return values.flatMap((value) => valuesOf(context, value, next))
}

/** An explicit attribute or statically resolved spread exposing a prop. */
const propsOf = (context, opening, key) => opening.attributes.flatMap((entry) => {
  if (entry.type === "JSXAttribute") return entry.name.name === key ? [{ node: entry, value: attributeValue(entry) }] : []
  const values = objectProperty(context, entry.argument, key)
  if (values.length) return values.map((value) => ({ node: entry, value }))
  const authored = typedPropertyStrings(context, entry.argument, key, "variant")
  if (authored.length) return authored.map((value) => ({ node: entry, text: value.text }))
  const typed = typedInfo(context, entry.argument, key)
  return typed ? [{ node: entry, texts: typed.values }] : []
})

const hasValue = (context, opening, key, value) => propsOf(context, opening, key).some((prop) => prop.text === value || prop.texts?.includes(value) || valuesOf(context, prop.value).includes(value))
const isButton = (context, opening) => BUTTONS.has(roleOf(context, opening.name))

/** A conditional props spread supplies intent only when every branch supplies it. */
const suppliesIntent = (context, input, seen = new Set()) => {
  const node = unwrap(input)
  if (!node || seen.has(node)) return false
  const next = new Set(seen).add(node)
  if (node.type === "ConditionalExpression") return [node.consequent, node.alternate].every((branch) => suppliesIntent(context, branch, next))
  if (node.type === "Identifier") {
    const definition = variableOf(context, node)?.defs.find((entry) => entry.type === "Variable")
    if (definition?.node.id.type === "Identifier") return suppliesIntent(context, definition.node.init, next)
    const typed = typedInfo(context, node, "intent")
    return Boolean(typed && !typed.optional)
  }
  return objectProperty(context, node, "intent").length > 0 || typedPropertyStrings(context, node, "intent", "variant").length > 0
}

const hasIntent = (context, opening) => opening.attributes.some((entry) => {
  if (entry.type === "JSXSpreadAttribute") return suppliesIntent(context, entry.argument)
  if (entry.name.name !== "intent") return false
  const value = unwrap(attributeValue(entry))
  return Boolean(value) && !(value.type === "Literal" && value.value === null) && !(value.type === "Identifier" && value.name === "undefined")
})

/** JSX child render callbacks contribute content to their enclosing component render. */
const inlineRenderCallback = (node) => node.parent?.type === "JSXExpressionContainer" && node.parent.parent?.type !== "JSXAttribute"

const lexicalFunction = (node) => {
  for (let current = node.parent; current; current = current.parent) if (isFn(current)) return current
  return null
}

/** The nearest function owns a render; a component defined in a dialog is still its own subtree. */
const functionOwner = (node) => {
  for (let current = node.parent; current; current = current.parent) if (isFn(current) && !inlineRenderCallback(current)) return current
  return null
}

/** A trigger opens a dialog and is outside its confirmation subtree. */
const insideDialog = (context, opening) => {
  const triggers = new Set()
  for (let current = opening.parent; current; current = current.parent) {
    if (isFn(current) && !inlineRenderCallback(current)) return false
    if (current.type === "JSXAttribute" && current.name.name === "trigger") triggers.add(current.parent)
    if (current.type === "JSXElement" && !triggers.has(current.openingElement) && DIALOGS.has(roleOf(context, current.openingElement.name))) return true
  }
  return false
}

/** Normalize a condition so `ready` and `!ready` select opposite render paths. */
const guardOf = (context, input, positive) => {
  const node = unwrap(input)
  if (node.type === "UnaryExpression" && node.operator === "!") return guardOf(context, node.argument, !positive)
  if (node.type === "BinaryExpression" && ["===", "==", "!==", "!="].includes(node.operator)) {
    const literal = node.right.type === "Literal" ? node.right : node.left.type === "Literal" ? node.left : null
    if (literal) {
      const selector = context.sourceCode.getText(literal === node.right ? node.left : node.right).replace(/\s+/g, "")
      const choice = JSON.stringify(literal.value)
      const value = node.operator.startsWith("!") ? !positive : positive
      return { key: `${selector}===${choice}`, value, selector, choice }
    }
  }
  return { key: context.sourceCode.getText(node).replace(/\s+/g, ""), value: positive }
}

const constrainPath = (context, path, test, positive) => {
  const guard = guardOf(context, test, positive)
  path.guards.set(guard.key, guard.value)
  if (guard.selector && guard.value) path.choices.set(guard.selector, guard.choice)
  return path
}

/** Conditional intent values retain the guards selecting commit instead of flattening both alternatives. */
const valuePaths = (context, input, seen = new Set()) => {
  const node = unwrap(input)
  if (!node || seen.has(node)) return []
  const next = new Set(seen).add(node)
  if (node.type === "ConditionalExpression") return [node.consequent, node.alternate].flatMap((branch, index) => valuePaths(context, branch, next).map((path) => constrainPath(context, path, node.test, index === 0)))
  if (node.type === "Identifier") {
    const definition = variableOf(context, node)?.defs.find((entry) => entry.type === "Variable")
    if (definition?.node.id.type === "Identifier") return valuePaths(context, definition.node.init, next)
  }
  return valuesOf(context, node).includes("commit") ? [{ guards: new Map(), choices: new Map() }] : []
}

/** Branch guards and return ownership identify mutually exclusive render paths. */
const renderPath = (context, opening, owner) => {
  const guards = new Map()
  const choices = new Map()
  const path = { guards, choices }
  let returned = null
  let child = opening
  for (let current = opening.parent; current && current !== owner; current = current.parent) {
    if (current.type === "ReturnStatement" && lexicalFunction(current) === owner) returned = current
    if (current.type === "ConditionalExpression" && child !== current.test) constrainPath(context, path, current.test, child === current.consequent)
    if (current.type === "IfStatement" && child !== current.test) constrainPath(context, path, current.test, child === current.consequent)
    if (current.type === "LogicalExpression" && child === current.right && current.operator !== "??") constrainPath(context, path, current.left, current.operator === "&&")
    child = current
  }
  return { guards, choices, returned }
}

const canCoexist = (left, right) => {
  if (left.returned && right.returned && left.returned !== right.returned) return false
  if ([...left.choices].some(([selector, choice]) => right.choices.has(selector) && right.choices.get(selector) !== choice)) return false
  return [...left.guards].every(([condition, value]) => !right.guards.has(condition) || right.guards.get(condition) === value)
}

/** No explicit visual prop: any authored variant, including a known props spread, is an app bypass. */
const buttonNoVariant = {
  meta: { type: "problem", docs: { description: "CTA-6: app buttons never choose a variant." }, schema: [], messages: {
    FE_BUTTON_NO_VARIANT: "FE_BUTTON_NO_VARIANT: declare Button intent instead of variant; Grammar resolves the variant from intent and placement.",
  } },
  create(context) {
    return { JSXOpeningElement(opening) {
      if (!isButton(context, opening)) return
      for (const node of new Set(propsOf(context, opening, "variant").map((prop) => prop.node))) context.report({ node, messageId: "FE_BUTTON_NO_VARIANT" })
    } }
  },
}

/** Every app button states its command's intent explicitly. */
const buttonIntentRequired = {
  meta: { type: "problem", docs: { description: "CTA-6: every app Button and IconButton declares intent." }, schema: [], messages: {
    FE_BUTTON_INTENT_REQUIRED: "FE_BUTTON_INTENT_REQUIRED: Button and IconButton require intent (commit, alternative, dismiss, neutral or destructive). Choose it from the command's consequence and rank.",
  } },
  create(context) {
    return { JSXOpeningElement(opening) {
      if (isButton(context, opening) && !hasIntent(context, opening)) context.report({ node: opening, messageId: "FE_BUTTON_INTENT_REQUIRED" })
    } }
  },
}

/** A destructive final press is contained by its same-file confirmation dialog. */
const destructiveConfirmInDialog = {
  meta: { type: "problem", docs: { description: "CTA-6: destructive confirm buttons stay inside AlertDialog or ConfirmDialog." }, schema: [], messages: {
    FE_DESTRUCTIVE_CONFIRM_IN_DIALOG: "FE_DESTRUCTIVE_CONFIRM_IN_DIALOG: a destructive confirm belongs inside the same-file AlertDialog or ConfirmDialog subtree. The trigger uses step=\"entry\".",
  } },
  create(context) {
    return { JSXOpeningElement(opening) {
      if (!isButton(context, opening) || !hasValue(context, opening, "intent", "destructive") || !hasValue(context, opening, "step", "confirm")) return
      if (!insideDialog(context, opening)) context.report({ node: opening, messageId: "FE_DESTRUCTIVE_CONFIRM_IN_DIALOG" })
    } }
  },
}

/** A component render exposes one next action, with exclusive branches counted separately. */
const singleCommitPerRender = {
  meta: { type: "problem", docs: { description: "CTA-6: at most one commit is visible in a component render." }, schema: [], messages: {
    FE_SINGLE_COMMIT_PER_RENDER: "FE_SINGLE_COMMIT_PER_RENDER: this render contains another commit action. Keep the one next action as commit and classify its alternatives by consequence.",
  } },
  create(context) {
    const owners = new Map()
    return { JSXOpeningElement(opening) {
      if (!isButton(context, opening) || !hasValue(context, opening, "intent", "commit")) return
      const owner = functionOwner(opening) ?? context.sourceCode.ast
      const base = renderPath(context, opening, owner)
      const paths = propsOf(context, opening, "intent").flatMap((prop) => prop.value ? valuePaths(context, prop.value) : prop.text === "commit" || prop.texts?.includes("commit") ? [{ guards: new Map(), choices: new Map() }] : [])
        .map((path) => ({ returned: base.returned, guards: new Map([...base.guards, ...path.guards]), choices: new Map([...base.choices, ...path.choices]) }))
      const prior = owners.get(owner) ?? []
      if (paths.some((path) => prior.some((entry) => canCoexist(entry, path)))) context.report({ node: opening, messageId: "FE_SINGLE_COMMIT_PER_RENDER" })
      prior.push(...paths)
      owners.set(owner, prior)
    } }
  },
}

/** A repeated row's next action is alternative; the enclosing view keeps the commit. */
const noCommitInCollectionItem = {
  meta: { type: "problem", docs: { description: "CTA-6: collection item renders cannot expose commit actions." }, schema: [], messages: {
    FE_NO_COMMIT_IN_COLLECTION_ITEM: "FE_NO_COMMIT_IN_COLLECTION_ITEM: collection items cannot use commit. Use alternative for an item's next action and reserve commit for the view's decision.",
  } },
  create(context) {
    const reported = new Set()
    const report = (opening) => {
      if (!reported.has(opening) && isButton(context, opening) && hasValue(context, opening, "intent", "commit")) {
        reported.add(opening)
        context.report({ node: opening, messageId: "FE_NO_COMMIT_IN_COLLECTION_ITEM" })
      }
    }
    const scanCallback = (callback) => {
      if (!callback) return
      walk(context.sourceCode, callback.body, (node) => {
        if (isFn(node) && !inlineRenderCallback(node)) return false
        if (node.type === "JSXOpeningElement") report(node)
        return undefined
      })
    }
    return {
      JSXAttribute(attribute) {
        if (attribute.name.name === "renderCell" && roleOf(context, attribute.parent.name) === "DataTable") scanCallback(functionOf(context, attributeValue(attribute)))
      },
      JSXOpeningElement(opening) {
        for (let current = opening.parent; current; current = current.parent) {
          if (isFn(current) && !inlineRenderCallback(current)) return
          if (current.type === "JSXElement" && ITEMS.has(roleOf(context, current.openingElement.name))) return report(opening)
        }
      },
      CallExpression(call) {
        const callee = unwrap(call.callee)
        if (callee.type !== "MemberExpression") return
        const name = callee.computed ? stringOf(callee.property) : callee.property.name
        if (name !== "map") return
        scanCallback(functionOf(context, call.arguments[0]))
      },
    }
  },
}

/** Every intent law is universal across Grammar families and app editions. */
export const rules = {
  "button-intent-required": buttonIntentRequired,
  "button-no-variant": buttonNoVariant,
  "destructive-confirm-in-dialog": destructiveConfirmInDialog,
  "single-commit-per-render": singleCommitPerRender,
  "no-commit-in-collection-item": noCommitInCollectionItem,
}

/** All five laws reach consumers at error. */
export const recommended = Object.fromEntries(Object.keys(rules).map((name) => [`starci-fe/${name}`, "error"]))
