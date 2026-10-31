import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { walk } from "@starci/eslint-canon-fe/lib/ast.mjs"
import { importOf, variableOf } from "@starci/eslint-canon-fe/lib/bindings.mjs"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { typedClassStrings } from "@starci/eslint-canon-fe/lib/typed-class-values.mjs"
import { defineFamilyRules, defineRule, exemptFreestyle } from "./lib/rule-contract.ts"
import type { Context, Node } from "./lib/types.ts"
/**
 * The pane laws (HFS R345 `FE_PANE_GRID_CHILD_NOT_PANE`, R346 `FE_PANE_CHILD_NOT_SECTION`, R347 `FE_PANE_SECTION_PADDING`, R348
 * `FE_PANE_GRID_FRAME`): a `PaneGrid` holds `Pane`s, a `Pane` holds `PaneSection`s (or one nested `PaneGrid`), a
 * `PaneSection` takes its inset from the pane it stands in, and a `PaneGrid` stands in a `Page chrome="panes"` or in a `Pane`.
 *
 * `PaneGrid` places each child by the `area` of a `Pane` element and drops a child that is not one: a wrapper component
 * renders nothing in its cell. A `Pane` owns its content inset and publishes it to its `PaneSection`s; a raw element or
 * another Grammar component placed straight in a pane skips that inset, and a padding or margin utility on what a section
 * renders adds a second inset beside it. A grid inside a card or a viewport-fill wrapper re-decides the frame and the
 * bottom edge that `Page chrome="panes"` owns.
 *
 * WHAT THEY READ. Element names (`Pane`, or `G.Pane` as `Pane`) and the children of one JSX parent. A child is read through
 * `cond ? <Pane/> : null`, `cond && <Pane/>`, `items.map(() => <Pane/>)` and arrays, down to the elements it can render; null,
 * false and `undefined` render nothing. A project component (an element imported from outside `@starci/grammar`) placed in a
 * `Pane` is judged in its own file, and so is a component whose root a rule cannot follow; `no-pane-section-padding` follows the
 * roots of components declared in the same file and the class strings of imported constants through the type program.
 * Auto and zero values (`mx-auto`, `p-0`) place or reset and inset nothing, so they are not padding.
 *
 * THE EXEMPTION. A raw element inside a `Freestyle` subtree is the app's own (`exemptFreestyle`); a `PaneGrid` inside one is
 * not judged by `pane-grid-page`.
 *
 * WHERE THEY APPLY. Product source (`isProductSource`).
 */

/** The Grammar package entries a component can be imported from. */
const GRAMMAR_SOURCE = /^@starci\/grammar(?:\/(?:common|core|offset-pop))?$/
/** The bounded surfaces a pane grid is not drawn in. */
const SURFACES = new Set(["SurfaceCard", "SurfaceListCard", "SurfaceAccordionCard"])
/** The helpers that join class strings. */
const CLASS_BUILDERS = new Set(["cn", "clsx", "cx", "classNames", "classnames", "twMerge", "twJoin", "cva", "tv"])
/** How many same-file components a section's root follows. */
const FOLLOW_DEPTH = 8

/** The element name of a JSX name: `Pane`, or `G.Pane` as `Pane`. */
const nameOf = (name: TSESTree.JSXTagNameExpression): string | null => {
  if (name.type === "JSXIdentifier") return name.name
  if (name.type === "JSXMemberExpression") return name.property.name
  return null
}

/** The leftmost identifier of a JSX name (`G` of `G.Pane`), or null for a namespaced name. */
const rootOf = (name: TSESTree.JSXTagNameExpression): TSESTree.JSXIdentifier | null => {
  if (name.type === "JSXIdentifier") return name
  if (name.type === "JSXMemberExpression") return rootOf(name.object)
  return null
}

/** True for a plain element (`div`), as opposed to a component. */
const isDomName = (name: TSESTree.JSXTagNameExpression): boolean => name.type === "JSXIdentifier" && /^[a-z]/.test(name.name)

/** The children that render: whitespace-only text and `{/* comments *\/}` are left out. */
const renderedChildren = (children: readonly TSESTree.JSXChild[]): TSESTree.JSXChild[] =>
  children.filter((child) => {
    if (child.type === "JSXText") return child.value.trim() !== ""
    if (child.type === "JSXExpressionContainer") return child.expression.type !== "JSXEmptyExpression"
    return true
  })

/** What a child position can render: an element, a fragment, or an expression nothing here can follow. */
type Leaf =
  | { readonly kind: "element"; readonly node: TSESTree.JSXElement }
  | { readonly kind: "fragment"; readonly node: TSESTree.JSXFragment }
  | { readonly kind: "opaque"; readonly node: Node }

/** The expressions a function returns: its expression body, or the arguments of its own `return` statements. */
const returnedExpressions = (context: Context, fn: TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression | TSESTree.FunctionDeclaration): Node[] => {
  if (fn.body.type !== "BlockStatement") return [fn.body]
  const found: Node[] = []
  walk(context.sourceCode, fn.body, (node) => {
    if (node !== fn.body && (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression" || node.type === "FunctionDeclaration")) return false
    if (node.type === "ReturnStatement" && node.argument !== null) found.push(node.argument)
    return undefined
  })
  return found
}

/** True for a function-shaped node. */
const isFunction = (node: Node | undefined): node is TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression =>
  node !== undefined && (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression")

/** The leaves an expression can render. */
const leavesOfExpression = (context: Context, expression: Node): Leaf[] => {
  switch (expression.type) {
    case "JSXEmptyExpression":
      return []
    case "JSXElement":
      return [{ kind: "element", node: expression }]
    case "JSXFragment":
      return [{ kind: "fragment", node: expression }]
    case "Literal":
      if (expression.value === null || typeof expression.value === "boolean") return []
      if (typeof expression.value === "string" && expression.value.trim() === "") return []
      return [{ kind: "opaque", node: expression }]
    case "Identifier":
      return expression.name === "undefined" ? [] : [{ kind: "opaque", node: expression }]
    case "TSAsExpression":
    case "TSNonNullExpression":
    case "TSSatisfiesExpression":
      return leavesOfExpression(context, expression.expression)
    case "ConditionalExpression":
      return [...leavesOfExpression(context, expression.consequent), ...leavesOfExpression(context, expression.alternate)]
    case "LogicalExpression":
      return expression.operator === "&&"
        ? leavesOfExpression(context, expression.right)
        : [...leavesOfExpression(context, expression.left), ...leavesOfExpression(context, expression.right)]
    case "ArrayExpression":
      return expression.elements.flatMap((element) => (element === null ? [] : leavesOfExpression(context, element)))
    case "CallExpression": {
      const callee = expression.callee
      const method = callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier" ? callee.property.name : null
      const callback = expression.arguments[0]
      if ((method === "map" || method === "flatMap") && isFunction(callback)) return returnedExpressions(context, callback).flatMap((returned) => leavesOfExpression(context, returned))
      return [{ kind: "opaque", node: expression }]
    }
    default:
      return [{ kind: "opaque", node: expression }]
  }
}

/** The leaves a child of a JSX parent can render. */
const leavesOfChild = (context: Context, child: TSESTree.JSXChild): Leaf[] => {
  if (child.type === "JSXElement") return [{ kind: "element", node: child }]
  if (child.type === "JSXFragment") return [{ kind: "fragment", node: child }]
  if (child.type === "JSXExpressionContainer") return leavesOfExpression(context, child.expression)
  if (child.type === "JSXSpreadChild") return [{ kind: "opaque", node: child }]
  return [{ kind: "opaque", node: child }]
}

/** The leaves of every rendered child of an element. */
const leavesOf = (context: Context, parent: TSESTree.JSXElement | TSESTree.JSXFragment): Leaf[] =>
  renderedChildren(parent.children).flatMap((child) => (child.type === "JSXText" ? [] : leavesOfChild(context, child)))

/** A `PaneGrid` holds `Pane` elements and nothing else. */
export const paneGridChildren: Rule.RuleModule = exemptFreestyle(defineRule({
  meta: {
    type: "problem",
    docs: { description: "R345: a PaneGrid child is a Pane element (directly, in a conditional or in a map), never a wrapper component, a fragment or a variable.", url: "knowledge/hfs/rules.yaml#R345" },
    schema: [],
    messages: {
      notPane:
        "{{what}} is a child of `PaneGrid`, which places only `Pane` elements by their `area` and drops the rest: this cell renders blank. Write the `<Pane area=\"...\">` here (inline it, or return a `Pane` element from a `cond ? <Pane/> : null`, `cond && <Pane/>` or `.map` expression), and move the wrapper's content into that Pane's PaneSections.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return {
      JSXElement(node) {
        if (nameOf(node.openingElement.name) !== "PaneGrid") return
        for (const leaf of leavesOf(context, node)) {
          if (leaf.kind === "element" && nameOf(leaf.node.openingElement.name) === "Pane") continue
          const what = leaf.kind === "element" ? `\`<${context.sourceCode.getText(leaf.node.openingElement.name)}>\`` : leaf.kind === "fragment" ? "A fragment" : "An expression"
          context.report({ node: leaf.node, messageId: "notPane", data: { what } })
        }
      },
    }
  },
}))

/** What a `Pane` child is, for the message. */
const describePaneChild = (context: Context, element: TSESTree.JSXElement): string | null => {
  const name = element.openingElement.name
  const element_ = nameOf(name)
  if (element_ === "PaneSection" || element_ === "PaneGrid" || element_ === "Freestyle") return null
  if (isDomName(name)) return `The raw \`<${element_ ?? "element"}>\``
  const root = rootOf(name)
  if (root === null) return null
  const origin = importOf(context, root)
  if (origin === null || !GRAMMAR_SOURCE.test(origin.source)) return null
  return `The Grammar component \`<${context.sourceCode.getText(name)}>\``
}

/** The elements a pane holds directly, following fragments. */
const paneElements = (context: Context, parent: TSESTree.JSXElement | TSESTree.JSXFragment): TSESTree.JSXElement[] =>
  leavesOf(context, parent).flatMap((leaf) => {
    if (leaf.kind === "element") return [leaf.node]
    if (leaf.kind === "fragment") return paneElements(context, leaf.node)
    return []
  })

/** A `Pane` holds `PaneSection`s or one nested `PaneGrid`. */
export const paneChildren: Rule.RuleModule = exemptFreestyle(defineRule({
  meta: {
    type: "problem",
    docs: { description: "R346: a Pane holds PaneSection elements (or one PaneGrid), never a raw element or another Grammar component.", url: "knowledge/hfs/rules.yaml#R346" },
    schema: [],
    messages: {
      notSection:
        "{{what}} is placed straight in a `Pane`, so it skips the inset the pane publishes to its bands. Wrap it in a `<PaneSection>` (with `grow`, `scroll`, `align` or `bleed` as the band needs), or make the pane's one child a nested `<PaneGrid>`.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return {
      JSXElement(node) {
        if (nameOf(node.openingElement.name) !== "Pane") return
        for (const element of paneElements(context, node)) {
          const what = describePaneChild(context, element)
          if (what !== null) context.report({ node: element, messageId: "notSection", data: { what } })
        }
      },
    }
  },
}))

/** A padding or margin utility that insets: zero and auto values place or reset and are not one. */
const INSET_UTILITY = /^-?(?:p|px|py|ps|pe|pt|pb|pl|pr|m|mx|my|ms|me|mt|mb|ml|mr)-(?!0$|auto$)\S+$/
/** An arbitrary padding or margin property, `[padding-inline:1rem]`. */
const ARBITRARY_INSET = /^\[(?:padding|margin)(?:-(?:inline|block)(?:-(?:start|end))?|-(?:top|right|bottom|left))?:(?!0(?:px|rem)?\]$|auto\]$).+\]$/

/** A class token without its variants (`sm:`, `[&>*]:`) and its important marker. */
const bareToken = (token: string): string => {
  let depth = 0
  let start = 0
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index]
    if (char === "[") depth += 1
    else if (char === "]") depth -= 1
    else if (char === ":" && depth === 0) start = index + 1
  }
  return token.slice(start).replace(/^!|!$/g, "")
}

/** True when a class string carries a padding or margin utility. */
const hasInsetUtility = (text: string): boolean =>
  text.split(/\s+/).some((token) => {
    const bare = bareToken(token)
    return INSET_UTILITY.test(bare) || ARBITRARY_INSET.test(bare)
  })

/** The class strings an expression statically holds: literals, templates, joins, conditionals, constants and typed imports. */
const classStrings = (context: Context, input: Node | null, seen: Set<Node> = new Set<Node>()): string[] => {
  if (input === null || seen.has(input)) return []
  seen.add(input)
  switch (input.type) {
    case "JSXExpressionContainer":
      return classStrings(context, input.expression, seen)
    case "Literal":
      return typeof input.value === "string" ? [input.value] : []
    case "TemplateLiteral":
      return [...input.quasis.map((quasi) => quasi.value.cooked ?? ""), ...input.expressions.flatMap((expression) => classStrings(context, expression, seen))]
    case "TSAsExpression":
    case "TSNonNullExpression":
    case "TSSatisfiesExpression":
      return classStrings(context, input.expression, seen)
    case "ConditionalExpression":
      return [...classStrings(context, input.consequent, seen), ...classStrings(context, input.alternate, seen)]
    case "LogicalExpression":
      return input.operator === "&&" ? classStrings(context, input.right, seen) : [...classStrings(context, input.left, seen), ...classStrings(context, input.right, seen)]
    case "ArrayExpression":
      return input.elements.flatMap((element) => (element === null ? [] : classStrings(context, element, seen)))
    case "ObjectExpression":
      return input.properties.flatMap((property) =>
        property.type === "Property" ? [...(property.key.type === "Literal" && typeof property.key.value === "string" ? [property.key.value] : []), ...classStrings(context, property.value, seen)] : [])
    case "CallExpression":
      return input.callee.type === "Identifier" && CLASS_BUILDERS.has(input.callee.name) ? input.arguments.flatMap((argument) => classStrings(context, argument, seen)) : []
    case "Identifier":
    case "MemberExpression": {
      const local = input.type === "Identifier" ? variableOf(context, input)?.defs.find((definition) => definition.type === "Variable") : undefined
      const init = local?.type === "Variable" ? local.node.init : null
      const resolved = init === null || init === undefined ? [] : classStrings(context, init, seen)
      return resolved.length > 0 ? resolved : typedClassStrings(context, input, "classes").map((entry) => entry.text)
    }
    default:
      return []
  }
}

/** The element of a same-file component declaration a JSX name resolves to: its returned roots, or null. */
const componentRoots = (context: Context, name: TSESTree.JSXTagNameExpression): Node[] | null => {
  if (name.type !== "JSXIdentifier") return null
  const definition = variableOf(context, name)?.defs.find((entry) => entry.type === "FunctionName" || entry.type === "Variable")
  if (definition === undefined) return null
  const fn = definition.type === "FunctionName" ? definition.node : definition.type === "Variable" ? definition.node.init : null
  if (fn === null || fn === undefined) return null
  if (fn.type !== "FunctionDeclaration" && fn.type !== "FunctionExpression" && fn.type !== "ArrowFunctionExpression") return null
  return returnedExpressions(context, fn)
}

/** The class attribute of an element, or null. */
const classAttribute = (element: TSESTree.JSXElement): TSESTree.JSXAttribute | null => {
  const found = element.openingElement.attributes.find(
    (entry): entry is TSESTree.JSXAttribute => entry.type === "JSXAttribute" && entry.name.type === "JSXIdentifier" && (entry.name.name === "className" || entry.name.name === "class"),
  )
  return found ?? null
}

/** The elements a section renders outermost, following fragments and the roots of same-file components. */
const outermost = (context: Context, leaves: readonly Leaf[], depth: number, seen: Set<Node>): TSESTree.JSXElement[] =>
  leaves.flatMap((leaf): TSESTree.JSXElement[] => {
    if (seen.has(leaf.node)) return []
    seen.add(leaf.node)
    if (leaf.kind === "fragment") return outermost(context, leavesOf(context, leaf.node), depth, seen)
    if (leaf.kind !== "element") return []
    const own = [leaf.node]
    const name = leaf.node.openingElement.name
    if (isDomName(name) || depth >= FOLLOW_DEPTH) return own
    const roots = componentRoots(context, name)
    if (roots === null) return own
    return [...own, ...outermost(context, roots.flatMap((root) => leavesOfExpression(context, root)), depth + 1, seen)]
  })

/** What a `PaneSection` renders carries no padding or margin utility on its outermost elements. */
export const noPaneSectionPadding: Rule.RuleModule = exemptFreestyle(defineRule({
  meta: {
    type: "problem",
    docs: { description: "R347: the outermost elements a PaneSection renders carry no padding or margin utility; the section applies the pane inset.", url: "knowledge/hfs/rules.yaml#R347" },
    schema: [],
    messages: {
      padding:
        "A padding or margin utility on the outermost element of a `PaneSection` stacks a second inset beside the one the pane publishes, so this band no longer lines up with its neighbours. Remove it: `PaneSection` pads inline by the pane inset and spaces its own children by `gap` (`inline`, `row` or `section`); use `bleed=\"inline\"` for a scroller that reaches the pane edges.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    const reported = new Set<Node>()
    return {
      JSXElement(node) {
        if (nameOf(node.openingElement.name) !== "PaneSection") return
        for (const element of outermost(context, leavesOf(context, node), 0, new Set<Node>())) {
          const attribute = classAttribute(element)
          if (attribute === null || reported.has(attribute)) continue
          if (!classStrings(context, attribute.value).some(hasInsetUtility)) continue
          reported.add(attribute)
          context.report({ node: attribute, messageId: "padding" })
        }
      },
    }
  },
}))

/** The literal text of a `chrome` attribute, or null when it is computed or absent. */
const chromeOf = (element: TSESTree.JSXElement): { readonly known: boolean; readonly text: string | null } => {
  const attributes = element.openingElement.attributes
  if (attributes.some((entry) => entry.type === "JSXSpreadAttribute")) return { known: false, text: null }
  const attribute = attributes.find((entry): entry is TSESTree.JSXAttribute => entry.type === "JSXAttribute" && entry.name.type === "JSXIdentifier" && entry.name.name === "chrome")
  if (attribute === undefined) return { known: true, text: null }
  const value = attribute.value
  const node = value?.type === "JSXExpressionContainer" ? value.expression : value
  if (node?.type === "Literal" && typeof node.value === "string") return { known: true, text: node.value }
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0 && node.quasis.length === 1) return { known: true, text: node.quasis[0]?.value.cooked ?? "" }
  return { known: false, text: null }
}

/** Where a `PaneGrid` stands wrongly, or null when it stands in a pane, in the panes page, or where this file cannot tell. */
const wrongFrame = (grid: TSESTree.JSXElement): string | null => {
  const frames: TSESTree.JSXElement[] = []
  let wrapped = false
  for (let current: Node | null | undefined = grid.parent; current !== undefined && current !== null; current = current.parent) {
    if (current.type !== "JSXElement") continue
    const name = nameOf(current.openingElement.name)
    if (name === "Freestyle") return null
    if (name === "Pane" || name === "Page" || name === "FillViewport" || (name !== null && SURFACES.has(name))) frames.push(current)
    else if (frames.length === 0) wrapped = true
  }
  const frame = frames[0]
  if (frame === undefined) return null
  const name = nameOf(frame.openingElement.name)
  if (name === "Pane") return null
  if (name === "Page") {
    const chrome = chromeOf(frame)
    if (!chrome.known) return null
    if (chrome.text !== "panes") return chrome.text === null ? "a `Page` without `chrome=\"panes\"`" : `a \`Page chrome="${chrome.text}"\``
    return wrapped ? "an element inside `Page chrome=\"panes\"` (the grid is the page's one child)" : null
  }
  return `a \`${name ?? "frame"}\``
}

/** A `PaneGrid` stands in `Page chrome="panes"` or in a `Pane`. */
export const paneGridPage: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "R348: a PaneGrid is the one child of Page chrome=\"panes\" or stands inside a Pane, never in a FillViewport, a card or another page chrome.", url: "knowledge/hfs/rules.yaml#R348" },
    schema: [],
    messages: {
      frame:
        "This `PaneGrid` is drawn in {{where}}. A grid is the whole body of a page that is panes, so `<Page chrome=\"panes\">` attaches it flush under the header, full width and to the viewport bottom, with no card, radius or gap; inside a pane it nests as the pane's one child. Make it the child of `Page chrome=\"panes\"` (or of a `Pane`) and drop the wrapper.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return {
      JSXElement(node) {
        if (nameOf(node.openingElement.name) !== "PaneGrid") return
        const where = wrongFrame(node)
        if (where !== null) context.report({ node: node.openingElement, messageId: "frame", data: { where } })
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "pane-grid-children": paneGridChildren,
  "pane-children": paneChildren,
  "no-pane-section-padding": noPaneSectionPadding,
  "pane-grid-page": paneGridPage,
}

defineFamilyRules(rules, "knowledge/hfs/rules.yaml#R345")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
