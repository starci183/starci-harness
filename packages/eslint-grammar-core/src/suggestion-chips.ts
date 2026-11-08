import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
import { renderedChildren } from "./lib/grammar-jsx.ts"
import { attributeOf, elementOf, grammarBindings, literalAttribute } from "./lib/row-context.ts"

/**
 * The suggestion chips law (`FE_SUGGESTION_CHIPS`): a row of small neutral Buttons that each send their own label is a set of
 * quick replies or suggested questions, and that is `SuggestionChips` (pill chips in a labelled toolbar), not a Button row.
 *
 * WHAT IT READS. The rendered children of a Grammar `Cluster` or `Stack`, or a `div` (looked through fragments, `cond && x`,
 * ternaries and `.map`). A child is a suggestion Button when it is a Grammar `Button` that:
 *   - states `size="sm"` literally;
 *   - has no `intent`, or a literal `intent` of `neutral` or `alternative`;
 *   - has an `onPress` arrow function whose one call passes the same expression as the Button's single child
 *     (`{q}` and `send(q)`, `{item.label}` and `ask(item.label)`), or the same string literal as the literal child text.
 * The parent is a finding when two or more such Buttons are its siblings, or one of them is drawn by a `.map`.
 * Anything not readable this cheaply (a spread, a computed size or intent, a handler that is not an inline arrow, a label with
 * several children) is not flagged.
 */

const PARENTS: ReadonlySet<string> = new Set(["Cluster", "Stack"])
const NEUTRAL: ReadonlySet<string> = new Set(["neutral", "alternative"])

type Source = { getText(node: TSESTree.Node): string }

/** The single expression or text a Button states as its label: `{q}` as the node `q`, text as its string. */
const labelOf = (element: TSESTree.JSXElement): { readonly node: TSESTree.Node } | { readonly text: string } | null => {
  const children = element.children.filter((child) => !(child.type === "JSXText" && child.value.trim() === ""))
  if (children.length !== 1) return null
  const child = children[0]!
  if (child.type === "JSXText") return { text: child.value.trim() }
  if (child.type !== "JSXExpressionContainer" || child.expression.type === "JSXEmptyExpression") return null
  if (child.expression.type === "Literal" && typeof child.expression.value === "string") return { text: child.expression.value }
  return { node: child.expression }
}

/** The argument expressions of the one call an inline `onPress` arrow makes, or null. */
const callArguments = (handler: TSESTree.ArrowFunctionExpression): readonly TSESTree.Node[] | null => {
  let body: TSESTree.Node | null = handler.body
  if (body.type === "BlockStatement") {
    const only: TSESTree.Statement | undefined = body.body.length === 1 ? body.body[0] : undefined
    body = only?.type === "ExpressionStatement" ? only.expression : null
  }
  return body !== null && body.type === "CallExpression" ? body.arguments : null
}

/** True when the handler of a Button passes its own label. */
const sendsOwnLabel = (element: TSESTree.JSXElement, source: Source): boolean => {
  const label = labelOf(element)
  const press = attributeOf(element.openingElement, "onPress")?.value
  if (label === null || press == null || press.type !== "JSXExpressionContainer" || press.expression.type !== "ArrowFunctionExpression") return false
  const args = callArguments(press.expression)
  if (args === null) return false
  return args.some((arg) => {
    if ("text" in label) return arg.type === "Literal" && arg.value === label.text
    return arg.type !== "Literal" && source.getText(arg) === source.getText(label.node)
  })
}

/** True when an element sits inside a `.map` callback below its parent. */
const inMap = (element: TSESTree.JSXElement, parent: TSESTree.JSXElement): boolean => {
  for (let node: TSESTree.Node | undefined = element.parent; node !== undefined && node !== parent; node = node.parent) {
    if (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") return true
  }
  return false
}

export const suggestionChips: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "FE_SUGGESTION_CHIPS: a row of neutral sm Buttons that send their own label is SuggestionChips." },
    schema: [],
    messages: {
      chips:
        "This is a suggestion, drawn as a Button in a row. Use `SuggestionChips` (pill chips, a labelled toolbar) for quick replies and suggested questions: `<SuggestionChips label=\"...\" items={[{ id, label }]} onSelect={(id) => ...} />`.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    let bound: ReadonlyMap<string, string> = new Map()
    const source = context.sourceCode as unknown as Source

    /** A Grammar Button that is small, neutral and sends its own label. */
    const isSuggestion = (node: TSESTree.Node): node is TSESTree.JSXElement => {
      if (node.type !== "JSXElement") return false
      const opening = node.openingElement
      if (elementOf(opening, bound).grammar !== "Button") return false
      if (opening.attributes.some((entry) => entry.type === "JSXSpreadAttribute")) return false
      if (literalAttribute(opening, "size") !== "sm") return false
      if (attributeOf(opening, "intent") !== null) {
        const intent = literalAttribute(opening, "intent")
        if (intent === null || !NEUTRAL.has(intent)) return false
      }
      return sendsOwnLabel(node, source)
    }

    return {
      Program(program: TSESTree.Program) {
        bound = grammarBindings(program)
      },
      JSXElement(element: TSESTree.JSXElement) {
        const { grammar, tag } = elementOf(element.openingElement, bound)
        if (!(grammar !== null && PARENTS.has(grammar)) && tag !== "div") return
        const found = renderedChildren(element.children).filter(isSuggestion)
        if (found.length < 2 && !found.some((entry) => inMap(entry, element))) return
        for (const entry of found) context.report({ node: entry.openingElement, messageId: "chips" })
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "suggestion-chips": suggestionChips,
}

defineFamilyRules(rules, "knowledge/ui/presentation/grammar-laws.yaml#SUGGESTION-CHIPS")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
