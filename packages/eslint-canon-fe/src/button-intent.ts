/** CTA-6: app buttons declare consequences; Grammar owns their visual variants. */
import { attributeValue, stringOf, walk } from "./lib/ast.ts"
import { functionOf, importOf, isFn, patternPath, unwrap, variableOf } from "./lib/bindings.ts"
import { typedPropertyStrings } from "./lib/typed-class-values.ts"
import type { TSESLint, TSESTree } from "@typescript-eslint/utils"
import ts from "typescript"
import type { PathStep } from "./lib/bindings.ts"
import { defineRule, type AnyContext, type Node, type Recommended, type Rules } from "./lib/rule.ts"

/** A same-file variable definition: its declarator holds the binding pattern and the initializer. */
type VariableDefinition = TSESLint.Scope.Definitions.VariableDefinition

/** The nodes a recursive read has already visited. */
type Seen = ReadonlySet<Node>

/** The string literal values a node's type allows, and whether the asked property is optional. */
interface TypedInfo {
  readonly values: string[]
  readonly optional: boolean
}

/** One place a prop is given: an attribute value, a spread property value, or the strings typed for it. */
interface Prop {
  readonly node: TSESTree.JSXAttribute | TSESTree.JSXSpreadAttribute
  readonly value?: Node | null
  readonly text?: string
  readonly texts?: readonly string[]
}

/** The conditions a render path stands under: guard text to its truth, selector to its chosen literal. */
interface Path {
  readonly guards: Map<string, boolean>
  readonly choices: Map<string, string>
}

/** A render path with the return statement it renders through, when one does. */
interface RenderPath extends Path {
  readonly returned: TSESTree.ReturnStatement | null
}

/** A condition read from a test: its key and truth, and for a comparison with a literal the selector and the literal. */
type Guard =
  | { readonly key: string; readonly value: boolean; readonly selector?: undefined; readonly choice?: undefined }
  | { readonly key: string; readonly value: boolean; readonly selector: string; readonly choice: string }

/** The same-file variable definition of an identifier, or undefined. */
const variableDefinition = (context: AnyContext, node: TSESTree.Identifier): VariableDefinition | undefined =>
  variableOf(context, node)?.defs.find((entry): entry is VariableDefinition => entry.type === "Variable")

/** The name a member expression reads: its static computed text or its identifier. */
const memberName = (node: TSESTree.MemberExpression): string | null => (node.computed ? stringOf(node.property) : node.property.name)

const GRAMMAR_ENTRY = /^@starci\/grammar(?:\/(?:common|core|offset-pop))?$/
const BUTTONS = new Set<string | null>(["Button", "IconButton"])
const DIALOGS = new Set<string | null>(["AlertDialog", "ConfirmDialog"])
const ITEMS = new Set<string | null>(["CollectionItem", "ItemActions", "ListItem", "ListRow", "ListBox.Item", "GridList.Item", "Table.Row", "TableRow"])

/** The consuming TypeScript program exposes literal intents and spread properties without executing app code. */
const typedInfo = (context: AnyContext, node: Node | null | undefined, key?: string): TypedInfo | null => {
  const services = context.sourceCode.parserServices
  if (!services?.program || !services.esTreeNodeToTSNodeMap || !node) return null
  const checker = services.program.getTypeChecker()
  const source = services.esTreeNodeToTSNodeMap.get(node)
  const owner = checker.getTypeAtLocation(source)
  const symbol = key === undefined ? null : owner.getProperty(key)
  if (key !== undefined && !symbol) return null
  const type = symbol ? checker.getTypeOfSymbolAtLocation(symbol, source) : owner
  const members = type.isUnion() ? type.types : [type]
  return { values: members.filter((member): member is ts.StringLiteralType => member.isStringLiteral()).map((member) => member.value), optional: Boolean(symbol && (symbol.flags & ts.SymbolFlags.Optional) !== 0) }
}

/** Resolve the imported Grammar role without confusing a shadowed local component with its namesake. */
const roleOf = (context: AnyContext, name: TSESTree.JSXTagNameExpression): string | null => {
  const parts: string[] = []
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
const objectProperty = (context: AnyContext, input: Node | null | undefined, key: PathStep, seen: Seen = new Set()): Node[] => {
  const node = unwrap(input)
  if (!node || seen.has(node)) return []
  const next = new Set(seen).add(node)
  if (node.type === "ObjectExpression") return node.properties.flatMap((property): Node[] => {
    if (property.type === "SpreadElement") return objectProperty(context, property.argument, key, next)
    const name = property.computed ? stringOf(property.key) : property.key.type === "Identifier" ? property.key.name : property.key.value
    return name === key ? [property.value] : []
  })
  if (node.type === "ConditionalExpression") return [node.consequent, node.alternate].flatMap((branch) => objectProperty(context, branch, key, next))
  if (node.type === "MemberExpression") {
    const member = memberName(node)
    return objectProperty(context, node.object, member, next).flatMap((value) => objectProperty(context, value, key, next))
  }
  if (node.type !== "Identifier") return []
  const definition = variableDefinition(context, node)
  if (!definition) return []
  const path = patternPath(definition.node.id, node.name)
  if (path === null) return []
  const values = path.reduce<(Node | null)[]>((entries, name) => entries.flatMap((entry) => objectProperty(context, entry, name, next)), [definition.node.init])
  return values.flatMap((value) => objectProperty(context, value, key, next))
}

/** Possible statically authored values of an intent or step; dynamic values remain TypeScript's responsibility. */
const valuesOf = (context: AnyContext, input: Node | null | undefined, seen: Seen = new Set()): string[] => {
  const node = unwrap(input)
  if (!node || seen.has(node)) return []
  const next = new Set(seen).add(node)
  const text = stringOf(node)
  if (text !== null) return [text]
  if (node.type === "ConditionalExpression") return [node.consequent, node.alternate].flatMap((branch) => valuesOf(context, branch, next))
  if (node.type === "LogicalExpression") return valuesOf(context, node.right, next)
  if (node.type === "MemberExpression") {
    const name = memberName(node)
    const values = objectProperty(context, node.object, name, next).flatMap((value) => valuesOf(context, value, next))
    return values.length ? values : typedInfo(context, node)?.values ?? []
  }
  if (node.type !== "Identifier") return typedInfo(context, node)?.values ?? []
  const definition = variableDefinition(context, node)
  if (!definition) return typedInfo(context, node)?.values ?? []
  const path = patternPath(definition.node.id, node.name)
  if (path === null) return []
  const values = path.reduce<(Node | null)[]>((entries, name) => entries.flatMap((entry) => objectProperty(context, entry, name, next)), [definition.node.init])
  return values.flatMap((value) => valuesOf(context, value, next))
}

/** An explicit attribute or statically resolved spread exposing a prop. */
const propsOf = (context: AnyContext, opening: TSESTree.JSXOpeningElement, key: string): Prop[] => opening.attributes.flatMap((entry): Prop[] => {
  if (entry.type === "JSXAttribute") return entry.name.name === key ? [{ node: entry, value: attributeValue(entry) }] : []
  const values = objectProperty(context, entry.argument, key)
  if (values.length) return values.map((value) => ({ node: entry, value }))
  const authored = typedPropertyStrings(context, entry.argument, key, "variant")
  if (authored.length) return authored.map((value) => ({ node: entry, text: value.text }))
  const typed = typedInfo(context, entry.argument, key)
  return typed ? [{ node: entry, texts: typed.values }] : []
})

const hasValue = (context: AnyContext, opening: TSESTree.JSXOpeningElement, key: string, value: string): boolean => propsOf(context, opening, key).some((prop) => prop.text === value || prop.texts?.includes(value) || valuesOf(context, prop.value).includes(value))
const isButton = (context: AnyContext, opening: TSESTree.JSXOpeningElement): boolean => BUTTONS.has(roleOf(context, opening.name))

/** A conditional props spread supplies intent only when every branch supplies it. */
const suppliesIntent = (context: AnyContext, input: Node | null | undefined, seen: Seen = new Set()): boolean => {
  const node = unwrap(input)
  if (!node || seen.has(node)) return false
  const next = new Set(seen).add(node)
  if (node.type === "ConditionalExpression") return [node.consequent, node.alternate].every((branch) => suppliesIntent(context, branch, next))
  if (node.type === "Identifier") {
    const definition = variableDefinition(context, node)
    if (definition?.node.id.type === "Identifier") return suppliesIntent(context, definition.node.init, next)
    const typed = typedInfo(context, node, "intent")
    return Boolean(typed && !typed.optional)
  }
  return objectProperty(context, node, "intent").length > 0 || typedPropertyStrings(context, node, "intent", "variant").length > 0
}

const hasIntent = (context: AnyContext, opening: TSESTree.JSXOpeningElement): boolean => opening.attributes.some((entry) => {
  if (entry.type === "JSXSpreadAttribute") return suppliesIntent(context, entry.argument)
  if (entry.name.name !== "intent") return false
  const value = unwrap(attributeValue(entry))
  return value !== null && value !== undefined && !(value.type === "Literal" && value.value === null) && !(value.type === "Identifier" && value.name === "undefined")
})

/** JSX child render callbacks contribute content to their enclosing component render. */
const inlineRenderCallback = (node: Node): boolean => node.parent?.type === "JSXExpressionContainer" && node.parent.parent?.type !== "JSXAttribute"

const lexicalFunction = (node: Node): Node | null => {
  for (let current: Node | undefined = node.parent; current; current = current.parent) if (isFn(current)) return current
  return null
}

/** The nearest function owns a render; a component defined in a dialog is still its own subtree. */
const functionOwner = (node: Node): Node | null => {
  for (let current: Node | undefined = node.parent; current; current = current.parent) if (isFn(current) && !inlineRenderCallback(current)) return current
  return null
}

/** A trigger opens a dialog and is outside its confirmation subtree. */
const insideDialog = (context: AnyContext, opening: TSESTree.JSXOpeningElement): boolean => {
  const triggers = new Set<Node>()
  for (let current: Node | undefined = opening.parent; current; current = current.parent) {
    if (isFn(current) && !inlineRenderCallback(current)) return false
    if (current.type === "JSXAttribute" && current.name.name === "trigger") triggers.add(current.parent)
    if (current.type === "JSXElement" && !triggers.has(current.openingElement) && DIALOGS.has(roleOf(context, current.openingElement.name))) return true
  }
  return false
}

/** Normalize a condition so `ready` and `!ready` select opposite render paths. */
const guardOf = (context: AnyContext, input: Node, positive: boolean): Guard => {
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

const constrainPath = <P extends Path>(context: AnyContext, path: P, test: Node, positive: boolean): P => {
  const guard = guardOf(context, test, positive)
  path.guards.set(guard.key, guard.value)
  if (guard.selector && guard.value) path.choices.set(guard.selector, guard.choice)
  return path
}

/** Conditional intent values retain the guards selecting commit instead of flattening both alternatives. */
const valuePaths = (context: AnyContext, input: Node | null | undefined, seen: Seen = new Set()): Path[] => {
  const node = unwrap(input)
  if (!node || seen.has(node)) return []
  const next = new Set(seen).add(node)
  if (node.type === "ConditionalExpression") return [node.consequent, node.alternate].flatMap((branch, index) => valuePaths(context, branch, next).map((path) => constrainPath(context, path, node.test, index === 0)))
  if (node.type === "Identifier") {
    const definition = variableDefinition(context, node)
    if (definition?.node.id.type === "Identifier") return valuePaths(context, definition.node.init, next)
  }
  return valuesOf(context, node).includes("commit") ? [{ guards: new Map(), choices: new Map() }] : []
}

/** Branch guards and return ownership identify mutually exclusive render paths. */
const renderPath = (context: AnyContext, opening: TSESTree.JSXOpeningElement, owner: Node): RenderPath => {
  const guards = new Map<string, boolean>()
  const choices = new Map<string, string>()
  const path: Path = { guards, choices }
  let returned: TSESTree.ReturnStatement | null = null
  let child: Node = opening
  for (let current: Node | undefined = opening.parent; current && current !== owner; current = current.parent) {
    if (current.type === "ReturnStatement" && lexicalFunction(current) === owner) returned = current
    if (current.type === "ConditionalExpression" && child !== current.test) constrainPath(context, path, current.test, child === current.consequent)
    if (current.type === "IfStatement" && child !== current.test) constrainPath(context, path, current.test, child === current.consequent)
    if (current.type === "LogicalExpression" && child === current.right && current.operator !== "??") constrainPath(context, path, current.left, current.operator === "&&")
    child = current
  }
  return { guards, choices, returned }
}

const canCoexist = (left: RenderPath, right: RenderPath): boolean => {
  if (left.returned && right.returned && left.returned !== right.returned) return false
  if ([...left.choices].some(([selector, choice]) => right.choices.has(selector) && right.choices.get(selector) !== choice)) return false
  return [...left.guards].every(([condition, value]) => !right.guards.has(condition) || right.guards.get(condition) === value)
}

/** No explicit visual prop: any authored variant, including a known props spread, is an app bypass. */
const buttonNoVariant = defineRule({
  meta: { type: "problem", docs: { description: "CTA-6: app buttons never choose a variant." }, schema: [], messages: {
    FE_BUTTON_NO_VARIANT: "FE_BUTTON_NO_VARIANT: declare Button intent instead of variant; Grammar resolves the variant from intent and placement.",
  } },
  create(context) {
    return { JSXOpeningElement(opening: TSESTree.JSXOpeningElement) {
      if (!isButton(context, opening)) return
      for (const node of new Set(propsOf(context, opening, "variant").map((prop) => prop.node))) context.report({ node, messageId: "FE_BUTTON_NO_VARIANT" })
    } }
  },
})

/** Every app button states its command's intent explicitly. */
const buttonIntentRequired = defineRule({
  meta: { type: "problem", docs: { description: "CTA-6: every app Button and IconButton declares intent." }, schema: [], messages: {
    FE_BUTTON_INTENT_REQUIRED: "FE_BUTTON_INTENT_REQUIRED: Button and IconButton require intent (commit, alternative, dismiss, neutral or destructive). Choose it from the command's consequence and rank.",
  } },
  create(context) {
    return { JSXOpeningElement(opening: TSESTree.JSXOpeningElement) {
      if (isButton(context, opening) && !hasIntent(context, opening)) context.report({ node: opening, messageId: "FE_BUTTON_INTENT_REQUIRED" })
    } }
  },
})

/** A destructive final press is contained by its same-file confirmation dialog. */
const destructiveConfirmInDialog = defineRule({
  meta: { type: "problem", docs: { description: "CTA-6: destructive confirm buttons stay inside AlertDialog or ConfirmDialog." }, schema: [], messages: {
    FE_DESTRUCTIVE_CONFIRM_IN_DIALOG: "FE_DESTRUCTIVE_CONFIRM_IN_DIALOG: a destructive confirm belongs inside the same-file AlertDialog or ConfirmDialog subtree. The trigger uses step=\"entry\".",
  } },
  create(context) {
    return { JSXOpeningElement(opening: TSESTree.JSXOpeningElement) {
      if (!isButton(context, opening) || !hasValue(context, opening, "intent", "destructive") || !hasValue(context, opening, "step", "confirm")) return
      if (!insideDialog(context, opening)) context.report({ node: opening, messageId: "FE_DESTRUCTIVE_CONFIRM_IN_DIALOG" })
    } }
  },
})

/** A component render exposes one next action, with exclusive branches counted separately. */
const singleCommitPerRender = defineRule({
  meta: { type: "problem", docs: { description: "CTA-6: at most one commit is visible in a component render." }, schema: [], messages: {
    FE_SINGLE_COMMIT_PER_RENDER: "FE_SINGLE_COMMIT_PER_RENDER: this render contains another commit action. Keep the one next action as commit and classify its alternatives by consequence.",
  } },
  create(context) {
    const owners = new Map<Node, RenderPath[]>()
    return { JSXOpeningElement(opening: TSESTree.JSXOpeningElement) {
      if (!isButton(context, opening) || !hasValue(context, opening, "intent", "commit")) return
      const owner = functionOwner(opening) ?? context.sourceCode.ast
      const base = renderPath(context, opening, owner)
      const paths = propsOf(context, opening, "intent").flatMap((prop): Path[] => prop.value ? valuePaths(context, prop.value) : prop.text === "commit" || prop.texts?.includes("commit") ? [{ guards: new Map(), choices: new Map() }] : [])
        .map((path): RenderPath => ({ returned: base.returned, guards: new Map([...base.guards, ...path.guards]), choices: new Map([...base.choices, ...path.choices]) }))
      const prior = owners.get(owner) ?? []
      if (paths.some((path) => prior.some((entry) => canCoexist(entry, path)))) context.report({ node: opening, messageId: "FE_SINGLE_COMMIT_PER_RENDER" })
      prior.push(...paths)
      owners.set(owner, prior)
    } }
  },
})

/** A repeated row's next action is alternative; the enclosing view keeps the commit. */
const noCommitInCollectionItem = defineRule({
  meta: { type: "problem", docs: { description: "CTA-6: collection item renders cannot expose commit actions." }, schema: [], messages: {
    FE_NO_COMMIT_IN_COLLECTION_ITEM: "FE_NO_COMMIT_IN_COLLECTION_ITEM: collection items cannot use commit. Use alternative for an item's next action and reserve commit for the view's decision.",
  } },
  create(context) {
    const reported = new Set<Node>()
    const report = (opening: TSESTree.JSXOpeningElement): void => {
      if (!reported.has(opening) && isButton(context, opening) && hasValue(context, opening, "intent", "commit")) {
        reported.add(opening)
        context.report({ node: opening, messageId: "FE_NO_COMMIT_IN_COLLECTION_ITEM" })
      }
    }
    const scanCallback = (callback: { readonly body: Node } | null): void => {
      if (!callback) return
      walk(context.sourceCode, callback.body, (node) => {
        if (isFn(node) && !inlineRenderCallback(node)) return false
        if (node.type === "JSXOpeningElement") report(node)
        return undefined
      })
    }
    return {
      JSXAttribute(attribute: TSESTree.JSXAttribute) {
        if (attribute.name.name === "renderCell" && roleOf(context, attribute.parent.name) === "DataTable") scanCallback(functionOf(context, attributeValue(attribute)))
      },
      JSXOpeningElement(opening: TSESTree.JSXOpeningElement) {
        for (let current: Node | undefined = opening.parent; current; current = current.parent) {
          if (isFn(current) && !inlineRenderCallback(current)) return
          if (current.type === "JSXElement" && ITEMS.has(roleOf(context, current.openingElement.name))) return report(opening)
        }
      },
      CallExpression(call: TSESTree.CallExpression) {
        const callee = unwrap(call.callee)
        if (callee.type !== "MemberExpression") return
        const name = memberName(callee)
        if (name !== "map") return
        scanCallback(functionOf(context, call.arguments[0]))
      },
    }
  },
})

/** Every intent law is universal across Grammar families and app editions. */
export const rules = {
  "button-intent-required": buttonIntentRequired,
  "button-no-variant": buttonNoVariant,
  "destructive-confirm-in-dialog": destructiveConfirmInDialog,
  "single-commit-per-render": singleCommitPerRender,
  "no-commit-in-collection-item": noCommitInCollectionItem,
} satisfies Rules

/** All five laws reach consumers at error. */
export const recommended: Recommended = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-fe/${name}`, "error"]))
