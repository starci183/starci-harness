import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
import type { Node } from "./lib/types.ts"
/**
 * The rule that holds the chip label law (HFS R322, `FE_CHIP_LABEL_CASE`): a chip label starts with an uppercase
 * letter. A status chip (`StatusDot` with text, a `Badge`, dot or not) is a label read at a glance beside the thing it
 * qualifies; "running" beside "Failed" in one table reads as two vocabularies.
 *
 * WHAT IT READS. The children of a `StatusDot` or `Badge` element that the source states literally: JSX text, a string
 * literal or a template literal with no expression in a `{...}`, and every branch of a conditional or logical expression
 * made of them. The first character of the trimmed text is judged: a lowercase letter is a finding, and the fix
 * uppercases it in place.
 *
 * WHAT IT LEAVES ALONE: text the source cannot show (a translation call, a variable, a template with an expression), a
 * label that starts with a digit or a symbol, and an uncased script.
 */

/** The components whose children are a chip label. */
const CHIP_COMPONENTS = new Set(["StatusDot", "Badge"])

/** The first character of a trimmed label, and its offset in the raw source text, or null when the label is empty. */
export const firstCharacter = (text: string): { char: string; offset: number } | null => {
  const offset = text.search(/\S/u)
  if (offset < 0) return null
  const char = String.fromCodePoint(text.codePointAt(offset) ?? 0)
  return { char, offset }
}

/** True when a label's first character is a lowercase letter. */
export const startsLowercase = (text: string): boolean => {
  const first = firstCharacter(text)
  return first !== null && /^\p{Ll}$/u.test(first.char)
}

/** The literal text nodes a JSX child carries: `{ node, text, quoteOffset }`, the offset of the text inside the node's source. */
function* literalTexts(node: Node | null | undefined): Generator<{ node: Node; text: string; quoteOffset: number }> {
  if (!node || typeof node.type !== "string") return
  switch (node.type) {
    case "JSXText":
      yield { node, text: node.value, quoteOffset: 0 }
      return
    case "JSXExpressionContainer":
      yield* literalTexts(node.expression)
      return
    case "Literal":
      if (typeof node.value === "string") yield { node, text: node.value, quoteOffset: 1 }
      return
    case "TemplateLiteral":
      if (node.expressions.length === 0) yield { node, text: node.quasis[0]?.value.cooked ?? "", quoteOffset: 1 }
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

/** The element name of a JSX opening element (`Badge`, or `Grammar.Badge` as `Badge`). */
const elementName = (opening: TSESTree.JSXOpeningElement): string | null => {
  const name = opening.name
  if (name.type === "JSXIdentifier") return name.name
  if (name.type === "JSXMemberExpression") return name.property.name
  return null
}

/** The first non-blank child of an element: the one that starts the visible label. */
const leadingChild = (children: readonly TSESTree.JSXChild[]): TSESTree.JSXChild | null =>
  children.find((child) => child.type !== "JSXText" || child.value.trim() !== "") ?? null

/** A chip label (`StatusDot` text, `Badge`) starts with an uppercase letter. */
export const chipLabelStartsUppercase: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    fixable: "code",
    docs: { description: "R322: the label of a StatusDot or Badge chip starts with an uppercase letter." },
    schema: [],
    messages: {
      lowercase:
        "The {{component}} label `{{text}}` starts with a lowercase letter. A chip label is read at a glance beside the thing it qualifies, and every chip of the app starts uppercase, so one table never mixes `running` with `Failed`. Write `{{fixed}}`.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    const source = context.sourceCode
    return {
      JSXElement(element) {
        const component = elementName(element.openingElement)
        if (component === null || !CHIP_COMPONENTS.has(component)) return
        const child = leadingChild(element.children)
        for (const { node, text, quoteOffset } of literalTexts(child)) {
          const first = firstCharacter(text)
          if (!startsLowercase(text) || first === null) continue
          const trimmed = text.trim()
          const fixed = first.char.toLocaleUpperCase() + trimmed.slice(first.char.length)
          const raw = source.getText(node)
          const at = node.range[0] + quoteOffset + raw.slice(quoteOffset).indexOf(first.char)
          context.report({
            node,
            messageId: "lowercase",
            data: { component, text: trimmed, fixed },
            fix: (fixer) => fixer.replaceTextRange([at, at + first.char.length], first.char.toLocaleUpperCase()),
          })
        }
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "chip-label-starts-uppercase": chipLabelStartsUppercase,
}

defineFamilyRules(rules, "knowledge/hfs/rules.yaml#R322")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
