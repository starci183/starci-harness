/** Grammar owns surface nesting and the single content edge of a panel list (ANATOMY-2, PADDING-0). */
import { attributeValue, stringOf } from "./lib/ast.mjs"
import { importOf, isFn, patternPath, unwrap, variableOf } from "./lib/bindings.mjs"
import { typedClassStrings, typedPropertyStrings } from "./lib/typed-class-values.mjs"
import { reactHookOf } from "./lib/react.mjs"

const GRAMMAR_ENTRY = /^@starci\/grammar(?:\/(?:common|core|heritage|offset-pop))?$/
const SURFACES = new Set([
  "SurfaceCard", "SurfaceListCard", "SurfaceAccordionCard", "Rail", "Sidebar",
  "Dialog", "Drawer", "AlertDialog", "Popover",
])
const FIELDS = new Set([
  "Input", "TextField", "Textarea", "TextArea", "SearchField", "NumberField", "DateField", "TimeField",
  "Select", "ComboBox", "DatePicker", "DateRangePicker", "Checkbox", "CheckboxGroup", "RadioGroup", "PressableField", "OtpInput",
])
const CLASS_BUILDERS = new Set(["cn", "clsx", "classNames", "cva", "tv"])

/** Resolve a JSX name to its Grammar export and optional compound parts, preserving lexical import identity. */
const grammarName = (context, name) => {
  if (name.type === "JSXMemberExpression") {
    const owner = grammarName(context, name.object)
    return owner === null ? null : [...owner, name.property.name]
  }
  if (name.type !== "JSXIdentifier") return null
  const imported = importOf(context, name)
  if (!imported || !GRAMMAR_ENTRY.test(imported.source)) return null
  if (imported.imported !== null) return [imported.imported]
  const binding = variableOf(context, name)?.defs.find((definition) => definition.type === "ImportBinding")
  return binding?.node.type === "ImportNamespaceSpecifier" ? [] : null
}

/** Class and variant expressions expose their statically authored strings, including const aliases and cn branches. */
const authoredStrings = (context, input, seen = new Set(), mode = "classes") => {
  const node = unwrap(input?.type === "JSXExpressionContainer" ? input.expression : input)
  if (!node || seen.has(node)) return []
  seen.add(node)
  const text = stringOf(node)
  if (text !== null) return [{ node, text }]
  if (node.type === "TemplateElement") return [{ node, text: node.value.cooked ?? node.value.raw }]
  if (node.type === "Identifier") {
    const values = bindingValues(context, node)
    return values.length ? values.flatMap((value) => authoredStrings(context, value, seen, mode)) : typedClassStrings(context, node, mode)
  }
  if (node.type === "MemberExpression") {
    const propertyName = node.computed ? stringOf(node.property) : node.property.name
    const values = propertyValues(context, node.object, propertyName)
    return values.length ? values.flatMap((value) => authoredStrings(context, value, seen, mode)) : typedClassStrings(context, node, mode)
  }
  const children = stringChildren(node, mode)
  return children.flatMap((child) => authoredStrings(context, child, seen, mode))
}

/** Only value-bearing positions contribute classes; object keys support cn's conditional class dictionary. */
const stringChildren = (node, mode) => {
  if (node.type === "TemplateLiteral") return mode === "classes" ? [...node.quasis, ...node.expressions] : []
  if (node.type === "ArrayExpression") return node.elements
  if (node.type === "CallExpression") return mode === "classes" ? node.arguments : []
  if (node.type === "ConditionalExpression") return [node.consequent, node.alternate]
  if (node.type === "LogicalExpression") return node.operator === "&&" ? [node.right] : [node.left, node.right]
  if (node.type === "ObjectExpression") return node.properties.flatMap((property) => property.type === "Property" ? [property.key, property.value] : [property.argument])
  return []
}

/** A declared React component is a separate render tree; inline collection/render callbacks keep the surrounding context. */
const componentBoundary = (context, node) => {
  if (!isFn(node)) return false
  if (node.parent?.type === "CallExpression" && ["memo", "forwardRef"].includes(reactHookOf(context, node.parent))) return true
  if (node.parent?.type === "JSXExpressionContainer" || node.parent?.type === "CallExpression" && node.parent.arguments.includes(node)) return false
  const name = node.id?.name ?? (node.parent?.type === "VariableDeclarator" ? node.parent.id.name : null)
  return name !== null && /^[A-Z]/.test(name)
}

/** The Grammar ancestors whose rendered content contains this node, excluding an overlay's trigger. */
function* surfaceAncestors(context, node) {
  const triggers = new Set()
  for (let current = node.parent; current; current = current.parent) {
    if (componentBoundary(context, current)) return
    if (current.type === "JSXAttribute" && current.name.name === "trigger") triggers.add(current.parent)
    if (current.type === "JSXElement" && !triggers.has(current.openingElement)) yield current.openingElement
  }
}

const isSurface = (context, node, descendant) => {
  const name = grammarName(context, node.name)
  if (name?.length !== 1) return false
  if (SURFACES.has(name[0])) return true
  if (name[0] !== "ChatWorkspace") return false
  for (let current = descendant; current && current !== node.parent; current = current.parent) {
    if (current.type === "JSXAttribute" && current.parent === node && current.name.name === "rail") return true
  }
  return false
}
const classTokens = (text) => text.split(/\s+/).map((token) => token.split(":").at(-1).replace(/^!|!$/g, ""))
const rawSurface = (token) => /^bg-surface(?:-[a-z0-9-]+)?(?:\/[^\s]+)?$/.test(token)
const horizontalPadding = (token) => /^(?:px|ps|pe)-.+$/.test(token)

/** Computed keys select their evaluated static name, rather than the identifier's spelling. */
const propertyName = (context, property) => {
  if (!property.computed) return property.key.name ?? property.key.value
  const values = authoredStrings(context, property.key, new Set(), "variant")
  return values.length === 1 ? values[0].text : null
}

/** A binding selects its own object property; sibling declarations do not become its value. */
const bindingValues = (context, node, seen = new Set()) => {
  const definition = variableOf(context, node)?.defs.find((entry) => entry.type === "Variable")
  if (!definition) return []
  const path = patternPath(definition.node.id, node.name)
  if (path === null) return []
  return path.reduce((values, key) => values.flatMap((value) => propertyValues(context, value, key, seen)), [definition.node.init]).filter(Boolean)
}

/** Static object spreads retain the same published-prop obligations as ordinary JSX attributes. */
const propertyValues = (context, input, key, seen = new Set()) => {
  const node = unwrap(input)
  if (!node || seen.has(node)) return []
  seen.add(node)
  if (node.type === "Identifier") {
    return bindingValues(context, node, seen).flatMap((value) => propertyValues(context, value, key, seen))
  }
  if (node.type === "MemberExpression") {
    const member = node.computed ? stringOf(node.property) : node.property.name
    return propertyValues(context, node.object, member, seen).flatMap((value) => propertyValues(context, value, key, seen))
  }
  if (node.type === "ConditionalExpression") return [node.consequent, node.alternate].flatMap((branch) => propertyValues(context, branch, key, seen))
  if (node.type !== "ObjectExpression") return []
  return node.properties.flatMap((property) => {
    if (property.type === "SpreadElement") return propertyValues(context, property.argument, key, seen)
    return propertyName(context, property) === key ? [property.value] : []
  })
}

const propStrings = (context, entry, name, mode = "classes") => {
  if (entry.type === "JSXSpreadAttribute") {
    const values = propertyValues(context, entry.argument, name)
    return values.length ? values.flatMap((value) => authoredStrings(context, value, new Set(), mode)) : typedPropertyStrings(context, entry.argument, name, mode)
  }
  return entry.name.name === name ? authoredStrings(context, attributeValue(entry), new Set(), mode) : []
}

/** An explicit section caption excludes the row's own content subtree. */
const inSectionCaption = (context, node) => {
  for (const ancestor of surfaceAncestors(context, node.parent)) {
    const owner = grammarName(context, ancestor.name)
    if (owner?.[0] !== "ListBox") continue
    if (owner[1] === "Item") return false
    if (["Section", "Header", "SectionHeader"].includes(owner[1])) return true
  }
  return false
}

/** ANATOMY-2: Grammar provides the secondary default; apps cannot force primary or paint a raw surface. */
export const nestedControlVariant = {
  meta: {
    type: "problem",
    docs: { description: "ANATOMY-2: nested fields use Grammar's secondary default and surfaces belong to Grammar." },
    schema: [],
    messages: {
      primary: "FE_NESTED_VARIANT: a field inside a Grammar surface cannot force variant=\"primary\". Omit variant so Grammar supplies secondary through its nesting context.",
      surface: "FE_NESTED_VARIANT: bg-surface paints a surface in app CSS. Compose SurfaceCard, Rail, Sidebar or another Grammar surface instead.",
    },
  },
  create(context) {
    const reported = new Set()
    const checkClasses = (value) => {
      for (const entry of authoredStrings(context, value)) {
        if (!classTokens(entry.text).some(rawSurface) || reported.has(entry.node)) continue
        reported.add(entry.node)
        context.report({ node: entry.node, messageId: "surface" })
      }
    }
    return {
      JSXOpeningElement(node) {
        const name = grammarName(context, node.name)
        const variant = node.attributes.find((entry) => propStrings(context, entry, "variant", "variant").some((value) => value.text === "primary"))
        if (name?.length !== 1 || !FIELDS.has(name[0]) || !variant) return
        if ([...surfaceAncestors(context, node.parent)].some((ancestor) => isSurface(context, ancestor, node))) context.report({ node: variant, messageId: "primary" })
      },
      JSXAttribute(node) {
        if (["className", "class", "classNames"].includes(node.name.name)) checkClasses(node.value)
      },
      CallExpression(node) {
        if (node.callee.type === "Identifier" && CLASS_BUILDERS.has(node.callee.name)) checkClasses(node)
      },
      VariableDeclarator(node) {
        if (/[Cc]lass/.test(node.id.name ?? "") || /(?:^|[/\\])classNames\.[cm]?[jt]sx?$/.test(context.filename)) checkClasses(node.init)
      },
      Property(node) {
        if (["className", "class", "classNames"].includes(propertyName(context, node))) checkClasses(node.value)
      },
    }
  },
}

/** PADDING-0: app padding wrappers cannot add a second horizontal inset to Grammar's list or section caption. */
export const noListPanelPadding = {
  meta: {
    type: "problem",
    docs: { description: "PADDING-0: panel lists and section captions share the Grammar surface's content edge." },
    schema: [],
    messages: { padding: "FE_LIST_PANEL_PADDING: horizontal padding stacks with the Grammar list inset. Remove this wrapper padding and use ListBox inset=\"panel\" so rows and section captions share the panel content edge." },
  },
  create(context) {
    const reported = new Set()
    const check = (opening) => {
      const className = opening.attributes.find((entry) => ["className", "class"].some((name) => propStrings(context, entry, name).some((value) => classTokens(value.text).some(horizontalPadding))))
      if (!className || reported.has(className)) return
      reported.add(className)
      context.report({ node: className, messageId: "padding" })
    }
    return {
      JSXOpeningElement(node) {
        const name = grammarName(context, node.name)
        if (name?.[0] === "ListBox" && (name.length === 1 || ["Section", "Header", "SectionHeader"].includes(name[1]))) {
          check(node)
          for (const ancestor of surfaceAncestors(context, node.parent)) {
            check(ancestor)
            if (isSurface(context, ancestor, node)) break
          }
        } else if (inSectionCaption(context, node)) check(node)
      },
    }
  },
}

/** The surface laws ship at error in every composing source tree. */
export const rules = { "nested-control-variant": nestedControlVariant, "no-list-panel-padding": noListPanelPadding }

/** No app can lower or omit a surface law. */
export const recommended = Object.fromEntries(Object.keys(rules).map((name) => [`starci-fe/${name}`, "error"]))
