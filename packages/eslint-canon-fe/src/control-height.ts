/** CONTROL-HEIGHT-1: one control height; the app never picks a larger step or mixes steps in one row. */
import { attributeValue, stringOf } from "./lib/ast.ts"
import type { TSESTree } from "@typescript-eslint/utils"
import { importOf } from "./lib/bindings.ts"
import { defineRule, type AnyContext, type Node, type Recommended, type Rules } from "./lib/rule.ts"

const GRAMMAR_ENTRY = /^@starci\/grammar(?:\/(?:common|core|offset-pop))?$/
const CONTROLS = new Set(["Button", "IconButton", "Switch", "Input", "SearchField", "Select", "Tabs", "SegmentedControl", "Textarea", "NumberField", "ComboBox"])
/** A marketing hero call to action on a landing page is the one place the 48px step is allowed. */
const LANDING_PATH = /[\\/](?:landing|hero|marketing)[\\/]|(?:Landing|Hero)[^\\/]*[\\/]/
/** The default size and its two spellings: the vendor `md` and Grammar's `control` are the same 40px height. */
const DEFAULT_SIZE = new Set(["md", "control"])

/** The Grammar control a JSX name resolves to; a shadowed or foreign component of the same name is not one. */
const controlOf = (context: AnyContext, name: TSESTree.JSXTagNameExpression): string | null => {
  let root = name
  const parts: string[] = []
  while (root.type === "JSXMemberExpression") {
    parts.unshift(root.property.name)
    root = root.object
  }
  if (root.type !== "JSXIdentifier") return null
  const imported = importOf(context, root)
  if (!imported || !GRAMMAR_ENTRY.test(imported.source)) return null
  const role = imported.imported ?? parts.shift()
  return role !== undefined && parts.length === 0 && CONTROLS.has(role) ? role : null
}

/** The statically authored size of a control: `control` when absent, null when it is dynamic. */
const sizeOf = (opening: TSESTree.JSXOpeningElement): string | null => {
  const attribute = opening.attributes.find((entry): entry is TSESTree.JSXAttribute => entry.type === "JSXAttribute" && entry.name.name === "size")
  if (!attribute) return "control"
  const text = stringOf(attributeValue(attribute))
  if (text === null) return null
  return DEFAULT_SIZE.has(text) ? "control" : text
}

/** The Grammar controls a row holds directly, looking through fragments. */
const rowControls = (context: AnyContext, element: TSESTree.JSXElement | TSESTree.JSXFragment): TSESTree.JSXOpeningElement[] => element.children.flatMap((child): TSESTree.JSXOpeningElement[] => {
  if (child.type === "JSXFragment") return rowControls(context, child)
  if (child.type !== "JSXElement") return []
  return controlOf(context, child.openingElement.name) === null ? [] : [child.openingElement]
})

const controlHeight = defineRule({
  meta: { type: "problem", docs: { description: "CONTROL-HEIGHT-1: one 40px control height, no larger step outside a landing hero, no mixed sizes in one row." }, schema: [], messages: {
    FE_CONTROL_HEIGHT: "FE_CONTROL_HEIGHT: {{detail}} Grammar draws every standalone control at one 40px height; omit size (sm is for a control nested in an item or a dense toolbar, lg only for a landing hero call to action).",
  } },
  create(context) {
    const landing = LANDING_PATH.test(context.filename)
    const reported = new Set<Node>()
    const report = (node: Node, detail: string): void => {
      if (reported.has(node)) return
      reported.add(node)
      context.report({ node, messageId: "FE_CONTROL_HEIGHT", data: { detail } })
    }
    return {
      JSXOpeningElement(opening: TSESTree.JSXOpeningElement) {
        const role = controlOf(context, opening.name)
        if (role === null) return
        const size = sizeOf(opening)
        if (size === "xl" || (size === "lg" && !landing)) report(opening, `${role} size="${size}" is a larger control step than the app chrome allows.`)
      },
      "JSXElement, JSXFragment"(element: TSESTree.JSXElement | TSESTree.JSXFragment) {
        const controls = rowControls(context, element)
        const sizes = controls.map(sizeOf)
        if (sizes.includes(null) || new Set(sizes).size < 2) return
        const index = sizes.findIndex((size) => size !== sizes[0])
        const odd = controls[index]
        if (odd) report(odd, "this control sits in a row with controls of another size.")
      },
    }
  },
})

/** The one rule of the law. */
export const rules = { "control-height": controlHeight } satisfies Rules

/** The rule reaches consumers at error. */
export const recommended: Recommended = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-fe/${name}`, "error"]))
