import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
import type { SourceView } from "./lib/types.ts"
import { attributeOf, descendants, elementOf, grammarBindings, literalAttribute } from "./lib/row-context.ts"

/**
 * The button arrow law (`FE_BUTTON_ARROW`): a Button that leads somewhere ends with `endArrow`; a Button that does something
 * starts with a `startGlyph`. The arrow of a destination is the Grammar's own (it slides toward the reading end on hover and is
 * mirrored in RTL); a typed `→` or a passed-in arrow icon does neither.
 *
 * WHAT IT READS. A `Button` bound to `@starci/grammar`:
 *   - a label (children) that states an arrow literally: `→ ← ➜ ➔ ⟶ › »` or ASCII `->`;
 *   - an `endContent` that is an arrow: an element named `Arrow*` or `ChevronRight*`, or any element whose `source` / `glyph` / `name`
 *     is such an identifier or a string that names `arrow`, `chevron-right` or `chevron-end`;
 *   - `endArrow` together with `startGlyph` or `startContent` (the Button type refuses it as well).
 * The button-icon law (`button-icon-primary-only`) lives beside it: only a primary Button (`intent="commit"`) carries `startGlyph` or `startContent`.
 * `Button` takes the label as its children only, so no string label prop exists to read. `IconButton` has no label to type an arrow
 * in and no `endArrow`; `TextAction` takes `endContent` but not `endArrow`, so neither is judged.
 */

/** A label arrow: a character that points, or the ASCII `->`. */
const LABEL_ARROW = /[→←➜➔⟶›»]|->/u

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
        "The Button label types an arrow (`{{text}}`). A Button that leads somewhere takes `endArrow`: the Grammar arrow slides toward the reading end on hover and is mirrored in RTL. Remove the character from the label and add `endArrow`; keep the start side (`startGlyph`) for what the action does and the end side for where it goes.",
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

/** The one intent that is the CTA: the primary Button. */
const PRIMARY_INTENT = "commit"

/**
 * The button-icon law (owner, 2026-11-09): only a PRIMARY Button (`intent="commit"`) carries a leading icon. The Button type already
 * refuses `startGlyph` / `startContent` on a literal non-primary intent; this reads what a type cannot see: a Button with no `intent`
 * (it renders the secondary step) and an `intent` computed from a variable, a conditional or a spread. A start icon is accepted only
 * when `intent` is the literal `"commit"`. The arrow (`endArrow`) is not an icon under this law, and `IconButton` is not judged.
 */
export const buttonIconPrimaryOnly: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "FE_BUTTON_ICON_PRIMARY_ONLY: only a primary Button (`intent=\"commit\"`) carries a leading icon (`startGlyph`, `startContent`)." },
    schema: [],
    messages: {
      icon:
        "The Button sets `{{start}}` but is not primary. Only the primary Button (`intent=\"commit\"`, the CTA) carries a leading icon; a neutral, alternative, dismiss or destructive Button, a suggestion pill and a row action are text only. Remove `{{start}}`, or make this the region's one primary. A Button that leads somewhere keeps `endArrow`.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    let bound: ReadonlyMap<string, string> = new Map()
    return {
      Program(program: TSESTree.Program) {
        bound = grammarBindings(program)
      },
      JSXOpeningElement(opening: TSESTree.JSXOpeningElement) {
        if (elementOf(opening, bound).grammar !== "Button") return
        if (literalAttribute(opening, "intent") === PRIMARY_INTENT) return
        for (const start of ["startGlyph", "startContent"]) {
          const attribute = attributeOf(opening, start)
          if (attribute === null) continue
          const value = attribute.value
          // `startContent={undefined}` / `{null}` states no icon.
          if (value?.type === "JSXExpressionContainer" && (value.expression.type === "JSXEmptyExpression" || (value.expression.type === "Identifier" && value.expression.name === "undefined") || (value.expression.type === "Literal" && value.expression.value === null))) continue
          context.report({ node: attribute, messageId: "icon", data: { start } })
        }
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "button-arrow": buttonArrow,
  "button-icon-primary-only": buttonIconPrimaryOnly,
}

defineFamilyRules(rules, "knowledge/ui/presentation/grammar-laws.yaml#BUTTON-ARROW")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
