import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
import type { SourceView } from "./lib/types.ts"
import { attributeOf, descendants, elementOf, grammarBindings } from "./lib/row-context.ts"

/**
 * The button arrow law (`FE_BUTTON_ARROW`): a Button that leads somewhere ends with `endArrow`; a Button that does something
 * starts with a `startGlyph`. The arrow of a destination is the Grammar's own (it slides toward the reading end on hover and is
 * mirrored in RTL); a typed `→` or a passed-in arrow icon does neither.
 *
 * WHAT IT READS. A `Button` bound to `@starci/grammar`:
 *   - a label (children) that states `›` or `»` (a typed arrow anywhere is `no-typed-arrow`, below);
 *   - an `endContent` that is an arrow: an element named `Arrow*` or `ChevronRight*`, or any element whose `source` / `glyph` / `name`
 *     is such an identifier or a string that names `arrow`, `chevron-right` or `chevron-end`;
 *   - `endArrow` together with `startGlyph` or `startContent` (the Button type refuses it as well).
 * `Button` takes the label as its children only, so no string label prop exists to read. `IconButton` has no label to type an arrow
 * in and no `endArrow`; `TextAction` takes `endContent` but not `endArrow`, so neither is judged.
 */

/** A Button label's pointing quote marks: `›` and `»` (a typed arrow character is `no-typed-arrow`, for every element). */
const LABEL_ARROW = /[›»]/u

/**
 * A typed arrow (owner 2026-11-22: no arrow characters in ANY rendered text; "Không dùng ký tự mũi tên gõ tay; hướng đi là icon của Grammar"):
 * the Unicode Arrows block U+2190-U+21FF, the dingbat arrows U+2794-U+27BF, the long arrows U+27F0-U+27FF, and the ASCII `->`.
 */
export const TYPED_ARROW = /[\u2190-\u21FF\u2794-\u27BF\u27F0-\u27FF]|->/u

/** JSX attributes whose string value is never rendered text: a class, a URL, an id, a key, a role, a data or style hook, a handler. */
const NOT_TEXT_ATTRIBUTE = /^(?:className|class|href|src|srcSet|id|key|htmlFor|role|type|name|value|style|target|rel|data-.*|on[A-Z].*)$/u

/** A glyph or icon name that is an arrow or an end-pointing chevron, whatever its case and separators. */
const isArrowName = (name: string): boolean => {
  const flat = name.toLowerCase().replace(/[^a-z0-9]/gu, "")
  return flat.includes("arrow") || /chevron(?:double)?(?:right|end)/u.test(flat)
}

const nameOfElement = (opening: TSESTree.JSXOpeningElement): string | null => {
  const name = opening.name
  if (name.type === "JSXIdentifier") return name.name
  if (name.type === "JSXMemberExpression") return name.property.name
  return null
}

/** True when the value of a prop names an arrow: an identifier (`ArrowRightIcon`) or a string (`"arrow-right"`). */
const valueNamesArrow = (value: TSESTree.JSXAttribute["value"]): boolean => {
  if (value == null) return false
  if (value.type === "Literal") return typeof value.value === "string" && isArrowName(value.value)
  if (value.type !== "JSXExpressionContainer") return false
  const expression = value.expression
  if (expression.type === "Identifier") return isArrowName(expression.name)
  if (expression.type === "Literal") return typeof expression.value === "string" && isArrowName(expression.value)
  return false
}

/** Whether an `endContent` expression holds an arrow element. */
const endContentIsArrow = (container: TSESTree.JSXExpressionContainer, source: SourceView): boolean => {
  for (const node of descendants(container, source)) {
    if (node.type !== "JSXOpeningElement") continue
    const name = nameOfElement(node)
    if (name !== null && isArrowName(name)) return true
    for (const attribute of node.attributes) {
      if (attribute.type === "JSXAttribute" && attribute.name.type === "JSXIdentifier" && ["source", "glyph", "name"].includes(attribute.name.name) && valueNamesArrow(attribute.value)) return true
    }
  }
  return false
}

/** The literal text a child states: JSX text, a string, a template without expressions, and the branches of a conditional. */
function* literalTexts(node: TSESTree.Node | null | undefined): Generator<{ readonly node: TSESTree.Node; readonly text: string }> {
  if (!node) return
  switch (node.type) {
    case "JSXText":
      yield { node, text: node.value }
      return
    case "JSXExpressionContainer":
      yield* literalTexts(node.expression)
      return
    case "Literal":
      if (typeof node.value === "string") yield { node, text: node.value }
      return
    case "TemplateLiteral":
      for (const quasi of node.quasis) yield { node: quasi, text: quasi.value.cooked ?? "" }
      return
    case "ConditionalExpression":
      yield* literalTexts(node.consequent)
      yield* literalTexts(node.alternate)
      return
    case "LogicalExpression":
      yield* literalTexts(node.right)
      return
    default:
  }
}

/** A Button leads somewhere with `endArrow` and does something with `startGlyph`; no typed arrow, no arrow icon, never both. */
export const buttonArrow: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "FE_BUTTON_ARROW: a Button that leads somewhere ends with `endArrow`; one that does something starts with `startGlyph`." },
    schema: [],
    messages: {
      label:
        "The Button label types a pointing mark (`{{text}}`). A Button that leads somewhere takes `endArrow`: the Grammar arrow slides toward the reading end on hover and is mirrored in RTL. Remove the character from the label and add `endArrow`; keep the start side (`startGlyph`) for what the action does and the end side for where it goes.",
      endContent:
        "The Button passes an arrow icon as `endContent`. A Button that leads somewhere takes `endArrow` (the Grammar arrow that slides on hover and is mirrored in RTL). Replace the `endContent` arrow with `endArrow`.",
      both:
        "The Button sets `endArrow` and `{{start}}`. A Button either leads somewhere (`endArrow`) or does something (`startGlyph`), never both. Keep the one that says what the Button is.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    let bound: ReadonlyMap<string, string> = new Map()
    return {
      Program(program: TSESTree.Program) {
        bound = grammarBindings(program)
      },
      JSXElement(element: TSESTree.JSXElement) {
        const opening = element.openingElement
        if (elementOf(opening, bound).grammar !== "Button") return
        for (const child of element.children) {
          for (const { node, text } of literalTexts(child)) {
            const found = LABEL_ARROW.exec(text)
            if (found) context.report({ node, messageId: "label", data: { text: found[0] } })
          }
        }
        const endContent = attributeOf(opening, "endContent")
        if (endContent?.value?.type === "JSXExpressionContainer" && endContentIsArrow(endContent.value, context.sourceCode)) {
          context.report({ node: endContent, messageId: "endContent" })
        }
        const endArrow = attributeOf(opening, "endArrow")
        if (endArrow === null) return
        const isOff = endArrow.value?.type === "JSXExpressionContainer" && endArrow.value.expression.type === "Literal" && endArrow.value.expression.value === false
        if (isOff) return
        for (const start of ["startGlyph", "startContent"]) {
          if (attributeOf(opening, start) !== null) context.report({ node: opening, messageId: "both", data: { start } })
        }
      },
    }
  },
})

/**
 * No typed arrow in ANY rendered text (`FE_NO_TYPED_ARROW`, owner 2026-11-22). In product source, JSX text, a string or template literal
 * rendered as a child (and the branches of a conditional), and a string attribute that is rendered text (`label`, `title`, `aria-label`,
 * `description`, ...) holding an arrow character is an error: direction is the Grammar's arrow or link icon, `Link`'s own arrow or
 * `Button endArrow`. i18n message values are JSON the lint does not read; the content concept (contexts/ui/content.md) holds them.
 */
export const noTypedArrow: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "FE_NO_TYPED_ARROW: no typed arrow character in rendered text; direction is a Grammar icon, Link's arrow or Button endArrow." },
    schema: [],
    messages: {
      typed:
        "Rendered text types an arrow (`{{text}}`). Direction is shown by the Grammar: `Button endArrow`, `Link`'s own arrow, or the Grammar arrow or chevron icon; they slide on hover and mirror in RTL. Remove the character.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    const report = (node: TSESTree.Node, text: string): void => {
      const found = TYPED_ARROW.exec(text)
      if (found) context.report({ node, messageId: "typed", data: { text: found[0] } })
    }
    return {
      JSXElement(element: TSESTree.JSXElement) {
        for (const child of element.children) for (const { node, text } of literalTexts(child)) report(node, text)
      },
      JSXFragment(fragment: TSESTree.JSXFragment) {
        for (const child of fragment.children) for (const { node, text } of literalTexts(child)) report(node, text)
      },
      JSXAttribute(attribute: TSESTree.JSXAttribute) {
        if (attribute.name.type !== "JSXIdentifier" || NOT_TEXT_ATTRIBUTE.test(attribute.name.name)) return
        for (const { node, text } of literalTexts(attribute.value)) report(node, text)
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "button-arrow": buttonArrow,
  "no-typed-arrow": noTypedArrow,
}

defineFamilyRules(rules, "knowledge/ui/presentation/grammar-laws.yaml#BUTTON-ARROW")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
