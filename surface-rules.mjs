/** Grammar owns surface nesting and the single content edge of a panel list (ANATOMY-2, PADDING-0). */
import { attributeValue, stringOf } from "./lib/ast.mjs"
import { importOf, isFn, patternPath, unwrap, variableOf } from "./lib/bindings.mjs"
import { typedClassStrings, typedPropertyStrings } from "./lib/typed-class-values.mjs"
import { reactHookOf } from "./lib/react.mjs"

const GRAMMAR_ENTRY = /^@starci\/grammar(?:\/(?:common|core|heritage|offset-pop))?$/
const SURFACES = new Set([
  "SurfaceCard", "SurfaceListCard", "SurfaceAccordionCard", "Sidebar",
  "Dialog", "Drawer", "AlertDialog", "Popover",
  "WorkspaceShell", "TopBar", "NavigationFeatureNav",
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
  if (name[0] === "SurfaceAccordionCard") {
    let frame = "painted"
    for (const entry of node.attributes) {
      const value = entry.type === "JSXSpreadAttribute" ? frameEffect(context, entry.argument, frame)
        : entry.name.name === "frame" ? unpaintedFrame(context, attributeValue(entry)) ? "unpainted" : "painted" : "absent"
      if (value !== "absent") frame = value
    }
    return frame !== "unpainted"
  }
  if (name[0] === "WorkspaceShell") {
    for (let current = descendant; current && current !== node.parent; current = current.parent) {
      if (current.type === "JSXAttribute" && current.parent === node && current.name.name === "header") return true
    }
    return false
  }
  return SURFACES.has(name[0])
}
const classTokens = (text) => text.split(/\s+/).map((token) => {
  let depth = 0
  let start = 0
  for (let index = 0; index < token.length; index++) {
    if (token[index] === "[") depth++
    else if (token[index] === "]") depth--
    else if (token[index] === ":" && depth === 0) start = index + 1
  }
  return token.slice(start).replace(/^!|!$/g, "")
})
/** Paint and typography belong to Grammar even when the app uses a token rather than a raw colour. */
const paintProperty = (name) => {
  const property = String(name).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).replace(/^-(?:webkit|moz|ms)-/, "")
  if (/^text-(?:align|overflow|wrap)(?:-|$)/.test(property)) return false
  return /^(?:background|border|outline|font|text|fill|stroke|mask|color|accent-color|caret-color)(?:-|$)/.test(property)
    || /^(?:opacity|box-shadow|filter|backdrop-filter|mix-blend-mode|appearance|letter-spacing|line-height|clip-path)$/.test(property)
}

const rawSurface = (token) => {
  const arbitrary = /^\[([^:]+):/.exec(token)
  if (arbitrary) return paintProperty(arbitrary[1])
  if (/^text-(?:left|right|center|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)$/.test(token)) return false
  return /^-?(?:bg|from|via|to|shadow|inset-shadow|text-shadow|ring|inset-ring|outline|border|divide|rounded|text|font|leading|tracking|fill|stroke|mask|accent|caret|decoration|opacity|mix-blend|bg-blend|blur|brightness|contrast|drop-shadow|grayscale|hue-rotate|invert|saturate|sepia|backdrop|filter|appearance)(?:-|$)/.test(token)
    || /^(?:underline|overline|line-through|no-underline|italic|not-italic|antialiased|subpixel-antialiased)$/.test(token)
}
const horizontalPadding = (token) => /^(?:p|px|ps|pe|pl|pr)-.+$/.test(token) || /^\[padding-inline(?:-start|-end)?:.+\]$/.test(token)

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

/** Only a fully known unpainted frame removes the accordion's bounded surface context. */
const unpaintedFrame = (context, input, seen = new Set()) => {
  const node = unwrap(input)
  if (!node || seen.has(node)) return false
  seen.add(node)
  const text = stringOf(node)
  if (text !== null) return text === "unpainted"
  if (node.type === "ConditionalExpression") return [node.consequent, node.alternate].every((branch) => unpaintedFrame(context, branch, new Set(seen)))
  const values = node.type === "Identifier" ? bindingValues(context, node)
    : node.type === "MemberExpression" ? propertyValues(context, node.object, node.computed ? stringOf(node.property) : node.property.name) : []
  return values.length > 0 && values.every((value) => unpaintedFrame(context, value, new Set(seen)))
}

/** A spread overrides preceding frame props; an unresolved spread may install a bounded frame. */
const frameEffect = (context, input, prior, seen = new Set()) => {
  const node = unwrap(input)
  if (!node || seen.has(node)) return "painted"
  seen.add(node)
  if (node.type === "ObjectExpression") {
    let effect = prior
    for (const property of node.properties) {
      const key = property.type === "Property" ? propertyName(context, property) : null
      const value = property.type === "SpreadElement" ? frameEffect(context, property.argument, effect, new Set(seen))
        : key === "frame" ? unpaintedFrame(context, property.value) ? "unpainted" : "painted" : key === null ? "painted" : "absent"
      if (value !== "absent") effect = value
    }
    return effect
  }
  const values = node.type === "Identifier" ? bindingValues(context, node)
    : node.type === "MemberExpression" ? propertyValues(context, node.object, node.computed ? stringOf(node.property) : node.property.name)
      : node.type === "ConditionalExpression" ? [node.consequent, node.alternate] : []
  const effects = values.map((value) => frameEffect(context, value, prior, new Set(seen)))
  return effects.length > 0 && effects.every((effect) => effect === effects[0]) ? effects[0] : "painted"
}

/** Resolve authored style objects without treating unrelated object siblings or conditions as CSS. */
const stylePaint = (context, input, seen = new Set()) => {
  const node = unwrap(input?.type === "JSXExpressionContainer" ? input.expression : input)
  if (!node || seen.has(node)) return []
  seen.add(node)
  if (node.type === "Identifier") {
    const values = bindingValues(context, node)
    return values.length ? values.flatMap((value) => stylePaint(context, value, seen))
      : typedClassStrings(context, node, "style-keys").filter((entry) => paintProperty(entry.text)).map((entry) => entry.node)
  }
  if (node.type === "MemberExpression") {
    const member = node.computed ? stringOf(node.property) : node.property.name
    const values = propertyValues(context, node.object, member)
    return values.length ? values.flatMap((value) => stylePaint(context, value, seen))
      : typedClassStrings(context, node, "style-keys").filter((entry) => paintProperty(entry.text)).map((entry) => entry.node)
  }
  if (node.type === "ConditionalExpression") return [node.consequent, node.alternate].flatMap((branch) => stylePaint(context, branch, seen))
  if (node.type === "LogicalExpression") return (node.operator === "&&" ? [node.right] : [node.left, node.right]).flatMap((branch) => stylePaint(context, branch, seen))
  if (node.type !== "ObjectExpression") return []
  return node.properties.flatMap((property) => {
    if (property.type === "SpreadElement") return stylePaint(context, property.argument, seen)
    return paintProperty(propertyName(context, property)) ? [property] : []
  })
}

/** An explicit section caption excludes the row's own content subtree. */
const inSectionCaption = (context, node) => {
  for (const ancestor of surfaceAncestors(context, node.parent)) {
    if (isSurface(context, ancestor, node)) return false
    const owner = grammarName(context, ancestor.name)
    if (owner?.[0] !== "ListBox") continue
    if (owner[1] === "Item") return false
    if (["Section", "Header", "SectionHeader"].includes(owner[1])) return true
  }
  return false
}

/** ANATOMY-2: field variants belong to Grammar's context, including across app component boundaries. */
export const nestedControlVariant = {
  meta: {
    type: "problem",
    docs: { description: "ANATOMY-2: Grammar context supplies field variants; nested Tabs cannot force primary." },
    schema: [],
    messages: {
      variant: "FE_NESTED_VARIANT: app fields cannot set a static variant. Omit variant so Grammar's surface context supplies the appropriate default.",
      tabs: "FE_NESTED_VARIANT: Tabs inside a Grammar surface cannot force variant=\"primary\". Omit variant so Grammar supplies secondary.",
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const name = grammarName(context, node.name)
        if (name?.length !== 1) return
        if (FIELDS.has(name[0])) {
          const variant = node.attributes.find((entry) => propStrings(context, entry, "variant", "variant").length > 0)
          if (variant) context.report({ node: variant, messageId: "variant" })
        } else if (name[0] === "Tabs") {
          const primary = node.attributes.find((entry) => propStrings(context, entry, "variant", "variant").some((value) => value.text === "primary"))
          if (primary && [...surfaceAncestors(context, node.parent)].some((ancestor) => isSurface(context, ancestor, node))) context.report({ node: primary, messageId: "tabs" })
        }
      },
    }
  },
}

/** App classes carry layout; Grammar owns surface paint. */
export const noAppSurfacePaint = {
  meta: {
    type: "problem",
    docs: { description: "App composition CSS is layout-only; Grammar paints surfaces." },
    schema: [],
    messages: { surface: "FE_GRAMMAR_LAYOUT_ONLY: app CSS paints or styles Grammar content. Keep composition CSS layout-only and use Grammar's published surfaces, typography and tone props." },
  },
  create(context) {
    const reported = new Set()
    const checkClassEntries = (entries) => {
      for (const entry of entries) {
        if (!classTokens(entry.text).some(rawSurface) || reported.has(entry.node)) continue
        reported.add(entry.node)
        context.report({ node: entry.node, messageId: "surface" })
      }
    }
    const checkClasses = (value) => checkClassEntries(authoredStrings(context, value))
    const reportStyle = (nodes) => {
      for (const node of nodes) {
        if (reported.has(node)) continue
        reported.add(node)
        context.report({ node, messageId: "surface" })
      }
    }
    const checkStyle = (value) => {
      reportStyle(stylePaint(context, value))
    }
    return {
      JSXAttribute(node) {
        if (["className", "class", "classNames"].includes(node.name.name)) checkClasses(node.value)
        if (node.name.name === "style") checkStyle(node.value)
      },
      JSXSpreadAttribute(node) {
        for (const name of ["className", "class", "classNames"]) checkClassEntries(propStrings(context, node, name))
        const values = propertyValues(context, node.argument, "style")
        if (values.length) values.forEach(checkStyle)
        else reportStyle(typedPropertyStrings(context, node.argument, "style", "style-keys").filter((entry) => paintProperty(entry.text)).map((entry) => entry.node))
      },
      CallExpression(node) {
        if (node.callee.type === "Identifier" && CLASS_BUILDERS.has(node.callee.name)) checkClasses(node)
      },
      VariableDeclarator(node) {
        if (/[Cc]lass/.test(node.id.name ?? "") || /(?:^|[/\\])classNames\.[cm]?[jt]sx?$/.test(context.filename)) checkClasses(node.init)
      },
      Property(node) {
        if (["className", "class", "classNames"].includes(propertyName(context, node))) checkClasses(node.value)
        if (propertyName(context, node) === "style") checkStyle(node.value)
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
        const ancestors = [...surfaceAncestors(context, node.parent)]
        const surfaceIndex = ancestors.findIndex((ancestor) => isSurface(context, ancestor, node))
        if (surfaceIndex < 0) return
        const name = grammarName(context, node.name)
        if (name?.[0] === "ListBox" && (name.length === 1 || ["Section", "Header", "SectionHeader"].includes(name[1]))) {
          check(node)
          for (const ancestor of ancestors.slice(0, surfaceIndex + 1)) check(ancestor)
        } else if (inSectionCaption(context, node)) check(node)
      },
    }
  },
}

/** The surface laws ship at error in every composing source tree. */
export const rules = { "nested-control-variant": nestedControlVariant, "no-list-panel-padding": noListPanelPadding, "no-app-surface-paint": noAppSurfacePaint }

/** No app can lower or omit a surface law. */
export const recommended = Object.fromEntries(Object.keys(rules).map((name) => [`starci-fe/${name}`, "error"]))
