/**
 * Readers of Grammar JSX shared by the composition laws (gap proximity, field label, surface in surface, page
 * breadcrumbs): which Grammar component an element names, a literal prop, and the children an element renders once
 * fragments, `cond ? <x/> : null`, `cond && <x/>` and `items.map(() => <x/>)` are looked through.
 */
import type { TSESTree } from "@typescript-eslint/types"
import { importOf } from "@starci/eslint-canon-fe/lib/bindings.mjs"
import type { Context, Node } from "./types.ts"

const GRAMMAR_SOURCE = /^@starci\/grammar(?:\/(?:common|core|offset-pop))?$/

/** The element name of a JSX name: `Stack`, or `G.Stack` as `Stack`. */
export const nameOf = (name: TSESTree.JSXTagNameExpression): string | null => {
  if (name.type === "JSXIdentifier") return name.name
  if (name.type === "JSXMemberExpression") return name.property.name
  return null
}

/** The leftmost identifier of a JSX name (`G` of `G.Stack`), or null. */
const rootOf = (name: TSESTree.JSXTagNameExpression): TSESTree.JSXIdentifier | null => {
  if (name.type === "JSXIdentifier") return name
  if (name.type === "JSXMemberExpression") return rootOf(name.object)
  return null
}

/** The Grammar component an opening element names (imported from `@starci/grammar`), or null for another source or a plain element. */
export const grammarName = (context: Context, opening: TSESTree.JSXOpeningElement): string | null => {
  const root = rootOf(opening.name)
  if (root === null || !/^[A-Z]/.test(root.name)) return null
  const imported = importOf(context, root)
  if (imported === null || imported === undefined || !GRAMMAR_SOURCE.test(imported.source)) return null
  return nameOf(opening.name)
}

/** The attribute `name` of an opening element, or undefined. */
export const attributeOf = (opening: TSESTree.JSXOpeningElement, name: string): TSESTree.JSXAttribute | undefined =>
  opening.attributes.find((entry): entry is TSESTree.JSXAttribute => entry.type === "JSXAttribute" && entry.name.type === "JSXIdentifier" && entry.name.name === name)

/** True when the element carries a JSX spread, so a prop may arrive that the source does not show. */
export const hasSpread = (opening: TSESTree.JSXOpeningElement): boolean => opening.attributes.some((entry) => entry.type === "JSXSpreadAttribute")

/** The string a literal attribute value spells (`"x"`, `{"x"}`, `` {`x`} ``), or null. */
export const literalString = (attribute: TSESTree.JSXAttribute | undefined): string | null => {
  const value = attribute?.value
  if (value === undefined || value === null) return null
  if (value.type === "Literal") return typeof value.value === "string" ? value.value : null
  if (value.type !== "JSXExpressionContainer") return null
  const expression = value.expression
  if (expression.type === "Literal") return typeof expression.value === "string" ? expression.value : null
  if (expression.type === "TemplateLiteral" && expression.expressions.length === 0) return expression.quasis[0]?.value.cooked ?? null
  return null
}

/** The literal string prop `name` of an opening element, or null when absent or not a literal. */
export const stringProp = (opening: TSESTree.JSXOpeningElement, name: string): string | null => literalString(attributeOf(opening, name))

/** True for the expressions that render nothing: `null`, `undefined`, booleans. */
const rendersNothing = (node: TSESTree.Node): boolean =>
  (node.type === "Literal" && (node.value === null || typeof node.value === "boolean")) || (node.type === "Identifier" && node.name === "undefined")

/** True for `<Fragment>` and `<React.Fragment>`: a plain fragment with a name. */
export const isFragmentElement = (element: TSESTree.JSXElement): boolean => {
  const name = element.openingElement.name
  return (name.type === "JSXIdentifier" && name.name === "Fragment") || (name.type === "JSXMemberExpression" && name.property.name === "Fragment")
}

/** The nodes an expression renders: elements and text, looked through fragments, conditions, `&&` and `.map`. Other expressions stay as themselves. */
const rendered = (node: TSESTree.Node, into: Node[]): void => {
  switch (node.type) {
    case "JSXEmptyExpression":
      return
    case "JSXElement":
      if (isFragmentElement(node)) {
        for (const child of node.children) renderedChild(child, into)
        return
      }
      into.push(node)
      return
    case "JSXFragment":
      for (const child of node.children) renderedChild(child, into)
      return
    case "JSXExpressionContainer":
      rendered(node.expression, into)
      return
    case "ConditionalExpression":
      rendered(node.consequent, into)
      rendered(node.alternate, into)
      return
    case "LogicalExpression":
      rendered(node.right, into)
      return
    case "ArrayExpression":
      for (const element of node.elements) if (element !== null && element.type !== "SpreadElement") rendered(element, into)
      return
    case "TSAsExpression":
    case "TSNonNullExpression":
      rendered(node.expression, into)
      return
    case "CallExpression": {
      const callee = node.callee
      const mapper = node.arguments[0]
      if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier" && callee.property.name === "map" && mapper !== undefined && (mapper.type === "ArrowFunctionExpression" || mapper.type === "FunctionExpression")) {
        if (mapper.body.type !== "BlockStatement") {
          rendered(mapper.body, into)
          return
        }
        for (const statement of mapper.body.body) if (statement.type === "ReturnStatement" && statement.argument) rendered(statement.argument, into)
        return
      }
      into.push(node)
      return
    }
    default:
      if (!rendersNothing(node)) into.push(node)
  }
}

const renderedChild = (child: TSESTree.JSXChild, into: Node[]): void => {
  if (child.type === "JSXText") {
    if (child.value.trim() !== "") into.push(child)
    return
  }
  rendered(child, into)
}

/** What an element or fragment renders as children: elements, non-blank text, and opaque expressions. */
export const renderedChildren = (children: readonly TSESTree.JSXChild[]): Node[] => {
  const found: Node[] = []
  for (const child of children) renderedChild(child, found)
  return found
}

/** The name a rendered node is drawn by if it is a JSX element (`Stack`, `G.Stack` as `Stack`), else null. */
export const elementNameOf = (node: Node): string | null => (node.type === "JSXElement" ? nameOf(node.openingElement.name) : null)

/** The Grammar form controls a field label belongs to. */
export const FORM_CONTROLS: ReadonlySet<string> = new Set([
  "Input", "Select", "Textarea", "NumberField", "ComboBox", "Autocomplete", "CheckboxGroup", "RadioGroup", "ChoiceChips",
  "Switch", "DatePicker", "DateField", "TimeField", "SearchField", "Slider", "CopyField",
])
