/** Grammar owns surface nesting, the single content edge of a panel list (ANATOMY-2, PADDING-0) and the column seams of a pane frame (PaneGrid). */
import { attributeValue, stringOf, walk } from "./lib/ast.ts"
import { functionOf, importOf, isFn, patternPath, unwrap, variableOf } from "./lib/bindings.ts"
import { typedClassStrings, typedPropertyStrings } from "./lib/typed-class-values.ts"
import { reactHookOf } from "./lib/react.ts"
import type { TSESLint, TSESTree } from "@typescript-eslint/utils"
import type { PathStep } from "./lib/bindings.ts"
import { defineRule, type AnyContext, type Node, type Recommended, type Rules } from "./lib/rule.ts"
import { exemptFreestyle } from "./lib/freestyle.ts"
import type { TypedString } from "./lib/typed-class-values.ts"

/** A same-file variable definition: its declarator holds the binding pattern and the initializer. */
type VariableDefinition = TSESLint.Scope.Definitions.VariableDefinition

/** Whether an accordion frame is painted, unpainted, or not set by an entry. */
type Frame = "painted" | "unpainted" | "absent"

/** True when `text` is a string among `values`; any other value never is. */
const isOneOf = (values: readonly string[], text: unknown): boolean => typeof text === "string" && values.includes(text)

/** The name a member expression reads: its static computed text or its identifier. */
const memberName = (node: TSESTree.MemberExpression): string | null => (node.computed ? stringOf(node.property) : node.property.name)

/** True for a present node, as `.filter(Boolean)` keeps it. */
const present = (value: Node | null | undefined): value is Node => Boolean(value)

const GRAMMAR_ENTRY = /^@starci\/grammar(?:\/(?:common|core|offset-pop))?$/
const SURFACES = new Set<string | undefined>([
  "SurfaceCard", "SurfaceListCard", "SurfaceAccordionCard", "Sidebar",
  "Dialog", "Drawer", "AlertDialog", "Popover",
  "WorkspaceShell", "TopBar", "NavigationFeatureNav", "Pane", "PaneSection",
])
const FIELDS = new Set<string | undefined>([
  "Input", "TextField", "Textarea", "TextArea", "SearchField", "NumberField", "DateField", "TimeField",
  "Select", "ComboBox", "DatePicker", "DateRangePicker", "Checkbox", "CheckboxGroup", "RadioGroup", "PressableField", "OtpInput", "CopyField",
])
const CLASS_BUILDERS = new Set(["cn", "clsx", "classNames", "cva", "tv"])

/** Resolve a JSX name to its Grammar export and optional compound parts, preserving lexical import identity. */
const grammarName = (context: AnyContext, name: TSESTree.JSXTagNameExpression): string[] | null => {
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
const authoredStrings = (context: AnyContext, input: Node | null | undefined, seen = new Set<Node>(), mode = "classes"): TypedString[] => {
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
    const propertyName = memberName(node)
    const values = propertyValues(context, node.object, propertyName)
    return values.length ? values.flatMap((value) => authoredStrings(context, value, seen, mode)) : typedClassStrings(context, node, mode)
  }
  const children = stringChildren(node, mode)
  return children.flatMap((child) => authoredStrings(context, child, seen, mode))
}

/** Only value-bearing positions contribute classes; object keys support cn's conditional class dictionary. */
const stringChildren = (node: Node, mode: string): readonly (Node | null)[] => {
  if (node.type === "TemplateLiteral") return mode === "classes" ? [...node.quasis, ...node.expressions] : []
  if (node.type === "ArrayExpression") return node.elements
  if (node.type === "CallExpression") return mode === "classes" ? node.arguments : []
  if (node.type === "ConditionalExpression") return [node.consequent, node.alternate]
  if (node.type === "LogicalExpression") return node.operator === "&&" ? [node.right] : [node.left, node.right]
  if (node.type === "ObjectExpression") return node.properties.flatMap((property): Node[] => property.type === "Property" ? [property.key, property.value] : [property.argument])
  return []
}

/** A declared React component is a separate render tree; inline collection/render callbacks keep the surrounding context. */
const componentBoundary = (context: AnyContext, node: Node): boolean => {
  if (!isFn(node)) return false
  if (node.parent?.type === "CallExpression" && isOneOf(["memo", "forwardRef"], reactHookOf(context, node.parent))) return true
  if (node.parent?.type === "JSXExpressionContainer" || node.parent?.type === "CallExpression" && node.parent.arguments.some((argument) => argument === node)) return false
  const name = node.id?.name ?? (node.parent?.type === "VariableDeclarator" ? (node.parent.id.type === "Identifier" ? node.parent.id.name : undefined) : null)
  return name !== null && /^[A-Z]/.test(String(name))
}

/** The Grammar ancestors whose rendered content contains this node, excluding an overlay's trigger. */
function* surfaceAncestors(context: AnyContext, node: Node | undefined): Generator<TSESTree.JSXOpeningElement, void> {
  const triggers = new Set<Node>()
  for (let current: Node | undefined = node?.parent; current; current = current.parent) {
    if (componentBoundary(context, current)) return
    if (current.type === "JSXAttribute" && current.name.name === "trigger") triggers.add(current.parent)
    if (current.type === "JSXElement" && !triggers.has(current.openingElement)) yield current.openingElement
  }
}

const isSurface = (context: AnyContext, node: TSESTree.JSXOpeningElement, descendant: Node): boolean => {
  const name = grammarName(context, node.name)
  if (name?.length !== 1) return false
  if (name[0] === "SurfaceAccordionCard") {
    let frame: Frame = "painted"
    for (const entry of node.attributes) {
      const value: Frame = entry.type === "JSXSpreadAttribute" ? frameEffect(context, entry.argument, frame)
        : entry.name.name === "frame" ? unpaintedFrame(context, attributeValue(entry)) ? "unpainted" : "painted" : "absent"
      if (value !== "absent") frame = value
    }
    return frame !== "unpainted"
  }
  if (name[0] === "WorkspaceShell") {
    for (let current: Node | undefined = descendant; current && current !== node.parent; current = current.parent) {
      if (current.type === "JSXAttribute" && current.parent === node && current.name.name === "header") return true
    }
    return false
  }
  return SURFACES.has(name[0])
}
const classTokens = (text: string): string[] => text.split(/\s+/).map((token) => {
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
const paintProperty = (name: unknown): boolean => {
  const property = String(name).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).replace(/^-(?:webkit|moz|ms)-/, "")
  if (/^text-(?:align|overflow|wrap)(?:-|$)/.test(property)) return false
  return /^(?:background|border|outline|font|text|fill|stroke|mask|color|accent-color|caret-color)(?:-|$)/.test(property)
    || /^(?:opacity|box-shadow|filter|backdrop-filter|mix-blend-mode|appearance|letter-spacing|line-height|clip-path)$/.test(property)
}

const rawSurface = (token: string): boolean => {
  const arbitrary = /^\[([^:]+):/.exec(token)
  if (arbitrary) return paintProperty(arbitrary[1])
  if (/^text-(?:left|right|center|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)$/.test(token)) return false
  return /^-?(?:bg|from|via|to|shadow|inset-shadow|text-shadow|ring|inset-ring|outline|border|divide|rounded|text|font|leading|tracking|fill|stroke|mask|accent|caret|decoration|opacity|mix-blend|bg-blend|blur|brightness|contrast|drop-shadow|grayscale|hue-rotate|invert|saturate|sepia|backdrop|filter|appearance)(?:-|$)/.test(token)
    || /^(?:underline|overline|line-through|no-underline|italic|not-italic|antialiased|subpixel-antialiased)$/.test(token)
}
const horizontalPadding = (token: string): boolean => /^(?:p|px|ps|pe|pl|pr)-.+$/.test(token) || /^\[padding-inline(?:-start|-end)?:.+\]$/.test(token)

/** Computed keys select their evaluated static name, rather than the identifier's spelling. */
const propertyName = (context: AnyContext, property: TSESTree.Property): PathStep => {
  if (!property.computed) return property.key.type === "Identifier" ? property.key.name : property.key.value
  const values = authoredStrings(context, property.key, new Set(), "variant")
  const [only] = values
  return values.length === 1 && only ? only.text : null
}

/** A binding selects its own object property; sibling declarations do not become its value. */
const bindingValues = (context: AnyContext, node: TSESTree.Identifier, seen = new Set<Node>()): Node[] => {
  const definition = variableOf(context, node)?.defs.find((entry): entry is VariableDefinition => entry.type === "Variable")
  if (!definition) return []
  const path = patternPath(definition.node.id, node.name)
  if (path === null) return []
  return path.reduce<(Node | null)[]>((values, key) => values.flatMap((value) => propertyValues(context, value, key, seen)), [definition.node.init]).filter(present)
}

/** Static object spreads retain the same published-prop obligations as ordinary JSX attributes. */
const propertyValues = (context: AnyContext, input: Node | null | undefined, key: PathStep, seen = new Set<Node>()): Node[] => {
  const node = unwrap(input)
  if (!node || seen.has(node)) return []
  seen.add(node)
  if (node.type === "Identifier") {
    return bindingValues(context, node, seen).flatMap((value) => propertyValues(context, value, key, seen))
  }
  if (node.type === "MemberExpression") {
    const member = memberName(node)
    return propertyValues(context, node.object, member, seen).flatMap((value) => propertyValues(context, value, key, seen))
  }
  if (node.type === "ConditionalExpression") return [node.consequent, node.alternate].flatMap((branch) => propertyValues(context, branch, key, seen))
  if (node.type !== "ObjectExpression") return []
  return node.properties.flatMap((property): Node[] => {
    if (property.type === "SpreadElement") return propertyValues(context, property.argument, key, seen)
    return propertyName(context, property) === key ? [property.value] : []
  })
}

const propStrings = (context: AnyContext, entry: TSESTree.JSXAttribute | TSESTree.JSXSpreadAttribute, name: string, mode = "classes"): TypedString[] => {
  if (entry.type === "JSXSpreadAttribute") {
    const values = propertyValues(context, entry.argument, name)
    return values.length ? values.flatMap((value) => authoredStrings(context, value, new Set(), mode)) : typedPropertyStrings(context, entry.argument, name, mode)
  }
  return entry.name.name === name ? authoredStrings(context, attributeValue(entry), new Set(), mode) : []
}

/** Only a fully known unpainted frame removes the accordion's bounded surface context. */
const unpaintedFrame = (context: AnyContext, input: Node | null | undefined, seen = new Set<Node>()): boolean => {
  const node = unwrap(input)
  if (!node || seen.has(node)) return false
  seen.add(node)
  const text = stringOf(node)
  if (text !== null) return text === "unpainted"
  if (node.type === "ConditionalExpression") return [node.consequent, node.alternate].every((branch) => unpaintedFrame(context, branch, new Set(seen)))
  const values = node.type === "Identifier" ? bindingValues(context, node)
    : node.type === "MemberExpression" ? propertyValues(context, node.object, memberName(node)) : []
  return values.length > 0 && values.every((value) => unpaintedFrame(context, value, new Set(seen)))
}

/** A spread overrides preceding frame props; an unresolved spread may install a bounded frame. */
const frameEffect = (context: AnyContext, input: Node | null | undefined, prior: Frame, seen = new Set<Node>()): Frame => {
  const node = unwrap(input)
  if (!node || seen.has(node)) return "painted"
  seen.add(node)
  if (node.type === "ObjectExpression") {
    let effect = prior
    for (const property of node.properties) {
      const key = property.type === "Property" ? propertyName(context, property) : null
      const value: Frame = property.type === "SpreadElement" ? frameEffect(context, property.argument, effect, new Set(seen))
        : key === "frame" ? unpaintedFrame(context, property.value) ? "unpainted" : "painted" : key === null ? "painted" : "absent"
      if (value !== "absent") effect = value
    }
    return effect
  }
  const values: Node[] = node.type === "Identifier" ? bindingValues(context, node)
    : node.type === "MemberExpression" ? propertyValues(context, node.object, memberName(node))
      : node.type === "ConditionalExpression" ? [node.consequent, node.alternate] : []
  const effects = values.map((value) => frameEffect(context, value, prior, new Set(seen)))
  const [first] = effects
  return first !== undefined && effects.every((effect) => effect === first) ? first : "painted"
}

/** Resolve authored style objects without treating unrelated object siblings or conditions as CSS. */
const stylePaint = (context: AnyContext, input: Node | null | undefined, seen = new Set<Node>()): Node[] => {
  const node = unwrap(input?.type === "JSXExpressionContainer" ? input.expression : input)
  if (!node || seen.has(node)) return []
  seen.add(node)
  if (node.type === "Identifier") {
    const values = bindingValues(context, node)
    return values.length ? values.flatMap((value) => stylePaint(context, value, seen))
      : typedClassStrings(context, node, "style-keys").filter((entry) => paintProperty(entry.text)).map((entry) => entry.node)
  }
  if (node.type === "MemberExpression") {
    const member = memberName(node)
    const values = propertyValues(context, node.object, member)
    return values.length ? values.flatMap((value) => stylePaint(context, value, seen))
      : typedClassStrings(context, node, "style-keys").filter((entry) => paintProperty(entry.text)).map((entry) => entry.node)
  }
  if (node.type === "ConditionalExpression") return [node.consequent, node.alternate].flatMap((branch) => stylePaint(context, branch, seen))
  if (node.type === "LogicalExpression") return (node.operator === "&&" ? [node.right] : [node.left, node.right]).flatMap((branch) => stylePaint(context, branch, seen))
  if (node.type !== "ObjectExpression") return []
  return node.properties.flatMap((property): Node[] => {
    if (property.type === "SpreadElement") return stylePaint(context, property.argument, seen)
    return paintProperty(propertyName(context, property)) ? [property] : []
  })
}

/** An explicit section caption excludes the row's own content subtree. */
const inSectionCaption = (context: AnyContext, node: TSESTree.JSXOpeningElement): boolean => {
  for (const ancestor of surfaceAncestors(context, node.parent)) {
    if (isSurface(context, ancestor, node)) return false
    const owner = grammarName(context, ancestor.name)
    if (owner?.[0] !== "ListBox") continue
    if (owner[1] === "Item") return false
    if (isOneOf(["Section", "Header", "SectionHeader"], owner[1])) return true
  }
  return false
}

/** ANATOMY-2: field variants belong to Grammar's context, including across app component boundaries. */
export const nestedControlVariant = defineRule({
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
      JSXOpeningElement(node: TSESTree.JSXOpeningElement) {
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
})

/** App classes carry layout; Grammar owns surface paint. */
export const noAppSurfacePaint = exemptFreestyle(defineRule({
  meta: {
    type: "problem",
    docs: { description: "App composition CSS is layout-only; Grammar paints surfaces." },
    schema: [],
    messages: { surface: "FE_GRAMMAR_LAYOUT_ONLY: app CSS paints or styles Grammar content. Keep composition CSS layout-only and use Grammar's published surfaces, typography and tone props." },
  },
  create(context) {
    const reported = new Set<Node>()
    const checkClassEntries = (entries: readonly TypedString[]): void => {
      for (const entry of entries) {
        if (!classTokens(entry.text).some(rawSurface) || reported.has(entry.node)) continue
        reported.add(entry.node)
        context.report({ node: entry.node, messageId: "surface" })
      }
    }
    const checkClasses = (value: Node | null | undefined): void => checkClassEntries(authoredStrings(context, value))
    const reportStyle = (nodes: readonly Node[]): void => {
      for (const node of nodes) {
        if (reported.has(node)) continue
        reported.add(node)
        context.report({ node, messageId: "surface" })
      }
    }
    const checkStyle = (value: Node | null | undefined): void => {
      reportStyle(stylePaint(context, value))
    }
    return {
      JSXAttribute(node: TSESTree.JSXAttribute) {
        if (isOneOf(["className", "class", "classNames"], node.name.name)) checkClasses(node.value)
        if (node.name.name === "style") checkStyle(node.value)
      },
      JSXSpreadAttribute(node: TSESTree.JSXSpreadAttribute) {
        for (const name of ["className", "class", "classNames"]) checkClassEntries(propStrings(context, node, name))
        const values = propertyValues(context, node.argument, "style")
        if (values.length) values.forEach((value) => checkStyle(value))
        else reportStyle(typedPropertyStrings(context, node.argument, "style", "style-keys").filter((entry) => paintProperty(entry.text)).map((entry) => entry.node))
      },
      CallExpression(node: TSESTree.CallExpression) {
        if (node.callee.type === "Identifier" && CLASS_BUILDERS.has(node.callee.name)) checkClasses(node)
      },
      VariableDeclarator(node: TSESTree.VariableDeclarator) {
        if (/[Cc]lass/.test(node.id.type === "Identifier" ? node.id.name : "") || /(?:^|[/\\])classNames\.[cm]?[jt]sx?$/.test(context.filename)) checkClasses(node.init)
      },
      Property(node: TSESTree.Property) {
        if (isOneOf(["className", "class", "classNames"], propertyName(context, node))) checkClasses(node.value)
        if (propertyName(context, node) === "style") checkStyle(node.value)
      },
    }
  },
}))

/** PADDING-0: app padding wrappers cannot add a second horizontal inset to Grammar's list or section caption. */
export const noListPanelPadding = exemptFreestyle(defineRule({
  meta: {
    type: "problem",
    docs: { description: "PADDING-0: panel lists and section captions share the Grammar surface's content edge." },
    schema: [],
    messages: { padding: "FE_LIST_PANEL_PADDING: horizontal padding stacks with the Grammar list inset. Remove this wrapper padding and use ListBox inset=\"panel\" so rows and section captions share the panel content edge." },
  },
  create(context) {
    const reported = new Set<Node>()
    const check = (opening: TSESTree.JSXOpeningElement): void => {
      const className = opening.attributes.find((entry) => ["className", "class"].some((name) => propStrings(context, entry, name).some((value) => classTokens(value.text).some(horizontalPadding))))
      if (!className || reported.has(className)) return
      reported.add(className)
      context.report({ node: className, messageId: "padding" })
    }
    return {
      JSXOpeningElement(node: TSESTree.JSXOpeningElement) {
        const ancestors = [...surfaceAncestors(context, node.parent)]
        const surfaceIndex = ancestors.findIndex((ancestor) => isSurface(context, ancestor, node))
        if (surfaceIndex < 0) return
        const name = grammarName(context, node.name)
        if (name?.[0] === "ListBox" && (name.length === 1 || isOneOf(["Section", "Header", "SectionHeader"], name[1]))) {
          check(node)
          for (const ancestor of ancestors.slice(0, surfaceIndex + 1)) check(ancestor)
        } else if (inSectionCaption(context, node)) check(node)
      },
    }
  },
}))

/** BOUNDARY-1 case-5: only content bands carry inset; horizontal separators reach the surface edges. */
export const dividerFullBleed = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "BOUNDARY-1 case-5: horizontal Grammar dividers are full-bleed.",
    },
    schema: [],
    messages: {
      padding:
        "FE_DIVIDER_FULL_BLEED: horizontal padding on this wrapper insets a Grammar Divider/Separator. Move padding to the sibling content bands so the divider reaches both surface edges.",
    },
  },
  create(context) {
    // Follow rendered same-file components, helper calls and JSX constants, with cycle protection.
    const containsDivider = (root: Node | null | undefined, seen = new Set<Node>()): boolean => {
      if (!root || seen.has(root)) return false
      seen.add(root)
      let found = false
      const follow = (node: Node | null | undefined): void => {
        found = containsDivider(node, seen) || found
      }
      walk(context.sourceCode, root, (node) => {
        if (found) return false
        if (isFn(node)) return false
        if (node.type === "JSXOpeningElement") {
          const name = grammarName(context, node.name)
          if (
            name?.length === 1 &&
            isOneOf(["Divider", "Separator"], name[0])
          ) {
            const orientations = node.attributes.flatMap((entry) =>
              propStrings(context, entry, "orientation", "variant"),
            )
            if (
              !orientations.length ||
              orientations.some((entry) => entry.text !== "vertical")
            )
              found = true
          } else if (node.name.type === "JSXIdentifier") {
            for (const definition of variableOf(context, node.name)?.defs ??
              []) {
              if (definition.type === "FunctionName")
                follow(definition.node.body)
              if (definition.type === "Variable")
                follow(functionOf(context, definition.node.init)?.body)
            }
          }
        }
        if (node.type === "CallExpression") {
          follow(functionOf(context, node.callee)?.body)
          for (const argument of node.arguments)
            if (isFn(argument)) follow(argument.body)
        }
        if (
          node.type === "Identifier" &&
          node.parent?.type === "JSXExpressionContainer"
        ) {
          for (const value of bindingValues(context, node)) follow(value)
        }
        return undefined
      })
      return found
    }
    return {
      JSXOpeningElement(node: TSESTree.JSXOpeningElement) {
        const padding = node.attributes.find((entry) =>
          propStrings(context, entry, "className").some((value) =>
            classTokens(value.text).some(horizontalPadding),
          ),
        )
        if (!padding) return
        if (node.parent.children.some((child) => containsDivider(child)))
          context.report({ node: padding, messageId: "padding" })
      },
    }
  },
})

/** True for a plain element (`div`), as opposed to a component. */
const rawElement = (opening: TSESTree.JSXOpeningElement): boolean => opening.name.type === "JSXIdentifier" && /^[a-z]/.test(opening.name.name)

/** The elements one JSX child can render, through fragments, conditionals and `&&`; anything else renders none this rule can name. */
const elementsOfChild = (child: Node | null | undefined): TSESTree.JSXElement[] => {
  if (!child) return []
  if (child.type === "JSXElement") return [child]
  if (child.type === "JSXFragment") return child.children.flatMap((entry) => elementsOfChild(entry))
  if (child.type === "JSXExpressionContainer") return elementsOfChild(child.expression)
  if (child.type === "ConditionalExpression") return [...elementsOfChild(child.consequent), ...elementsOfChild(child.alternate)]
  if (child.type === "LogicalExpression") return child.operator === "&&" ? elementsOfChild(child.right) : [...elementsOfChild(child.left), ...elementsOfChild(child.right)]
  return []
}

/** The children that render: whitespace-only text and empty expressions are left out. */
const renderedChildren = (element: TSESTree.JSXElement): TSESTree.JSXChild[] =>
  element.children.filter((child) => child.type === "JSXText" ? child.value.trim() !== "" : child.type !== "JSXExpressionContainer" || child.expression.type !== "JSXEmptyExpression")

/** A column of a hand-built split: a plain block element (`div`, `aside`) or a Grammar `Region`. */
const isColumn = (context: AnyContext, element: TSESTree.JSXElement): boolean =>
  rawElement(element.openingElement) || grammarName(context, element.openingElement.name)?.[0] === "Region"

/** How a plain element lays out its children, read from its authored classes: `row`, `stack` (a column), `none` (not flex or grid), or `unknown` (no static class). */
const flowOf = (context: AnyContext, opening: TSESTree.JSXOpeningElement): "row" | "stack" | "none" | "unknown" => {
  const texts = opening.attributes.flatMap((entry) => ["className", "class"].flatMap((name) => propStrings(context, entry, name).map((value) => value.text)))
  if (texts.length === 0) return "unknown"
  const tokens = texts.flatMap((text) => text.split(/\s+/)).filter((token) => token !== "")
  if (!tokens.some((token) => /^(?:flex|inline-flex|grid|inline-grid)$/.test(token.slice(token.lastIndexOf(":") + 1)))) return "none"
  const column = tokens.some((token) => token === "flex-col" || token === "flex-col-reverse")
  const row = tokens.some((token) => /(?:^|:)flex-row(?:-reverse)?$/.test(token))
  return column && !row ? "stack" : "row"
}

/** True when the opening element is a vertical Grammar Divider or Separator. */
const verticalDivider = (context: AnyContext, opening: TSESTree.JSXOpeningElement): boolean => {
  const name = grammarName(context, opening.name)
  if (name?.length !== 1 || !isOneOf(["Divider", "Separator"], name[0])) return false
  return opening.attributes.some((entry) => propStrings(context, entry, "orientation", "variant").some((value) => value.text === "vertical"))
}

/** True when the opening element is a Grammar SurfaceCard composed `joined`. */
const joinedCard = (context: AnyContext, opening: TSESTree.JSXOpeningElement): boolean => {
  const name = grammarName(context, opening.name)
  return name?.length === 1 && name[0] === "SurfaceCard" && opening.attributes.some((entry) => propStrings(context, entry, "composition", "variant").some((value) => value.text === "joined"))
}

/** The columns a plain flex row holds side by side, or none when the element is not a row of two or more. */
const rowColumns = (context: AnyContext, element: TSESTree.JSXElement): TSESTree.JSXElement[] => {
  if (!rawElement(element.openingElement) || flowOf(context, element.openingElement) !== "row") return []
  const columns = renderedChildren(element).flatMap((child) => elementsOfChild(child)).filter((child) => isColumn(context, child))
  return columns.length >= 2 ? columns : []
}

/** The joined card element a node stands in, in this file, or null. */
const enclosingJoinedCard = (context: AnyContext, node: Node): TSESTree.JSXElement | null => {
  for (let current: Node | undefined = node.parent; current; current = current.parent) {
    if (current.type === "JSXElement" && joinedCard(context, current.openingElement)) return current
  }
  return null
}

/** True when a joined card holds a plain row of columns as one of its own children: a pane frame drawn by hand. */
const holdsColumnRow = (context: AnyContext, card: TSESTree.JSXElement): boolean =>
  renderedChildren(card).flatMap((child) => elementsOfChild(child)).some((child) => rowColumns(context, child).length > 0)

/** True when a vertical divider stands between plain columns of one flex row: directly, or inside a wrapper element that holds only it. */
const isColumnSeam = (context: AnyContext, divider: TSESTree.JSXElement): boolean => {
  let unit: TSESTree.JSXElement = divider
  const wrapper = divider.parent
  if (wrapper.type === "JSXElement" && rawElement(wrapper.openingElement) && renderedChildren(wrapper).length === 1) unit = wrapper
  const container = unit.parent
  if (container.type !== "JSXElement" || !rawElement(container.openingElement)) return false
  if (!["row", "unknown"].includes(flowOf(context, container.openingElement))) return false
  return renderedChildren(container).flatMap((child) => elementsOfChild(child)).some((sibling) => sibling !== unit && isColumn(context, sibling))
}

/** A multi-pane frame is a PaneGrid: a vertical divider between columns, or columns inside a joined card, is a pane frame drawn by hand. */
export const noHandBuiltPanes = defineRule({
  meta: {
    type: "problem",
    docs: { description: "PaneGrid owns the columns of a multi-pane frame and the dividers between them." },
    schema: [],
    messages: {
      seam: "FE_HAND_BUILT_PANES: a vertical Divider between columns draws a pane seam by hand, so the divider, the column widths and the collapse below medium are this file's to keep in step. Compose the columns as `Pane`s of a `PaneGrid` (areas per breakpoint, `collapse=\"drawer\"` for a side pane), which draws the dividers itself.",
      joined: "FE_HAND_BUILT_PANES: this joined SurfaceCard holds a flex row of columns, a pane frame drawn by hand inside a card. `joined` stacks bands divided by horizontal separators; side-by-side panes are a `PaneGrid` of `Pane`s, which a tabbed app page mounts as `Page chrome=\"panes\"`.",
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node: TSESTree.JSXOpeningElement) {
        const element = node.parent
        if (element.type !== "JSXElement") return
        if (joinedCard(context, node)) {
          if (holdsColumnRow(context, element)) context.report({ node, messageId: "joined" })
          return
        }
        if (!verticalDivider(context, node)) return
        const card = enclosingJoinedCard(context, node)
        if (card !== null && holdsColumnRow(context, card)) return
        if (card !== null || isColumnSeam(context, element)) context.report({ node, messageId: "seam" })
      },
    }
  },
})

/** The surface laws ship at error in every composing source tree. */
export const rules = { "divider-full-bleed": dividerFullBleed, "nested-control-variant": nestedControlVariant, "no-hand-built-panes": noHandBuiltPanes, "no-list-panel-padding": noListPanelPadding, "no-app-surface-paint": noAppSurfacePaint } satisfies Rules

/** No app can lower or omit a surface law. */
export const recommended: Recommended = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-fe/${name}`, "error"]))
