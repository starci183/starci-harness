import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
import { renderedChildren } from "./lib/grammar-jsx.ts"
import { attributeOf, elementOf, grammarBindings, literalAttribute } from "./lib/row-context.ts"

/**
 * The suggestion buttons law (`FE_SUGGESTION_BUTTONS`): suggestions, quick replies and empty-state shortcuts have ONE pattern,
 * a `Cluster gap="inline"` of neutral `Button size="sm"` (every Button size draws a pill). The law flags the ALTERNATIVES
 * drawn as suggestions, in cheap static shapes only:
 *   - a row (two or more siblings, or one drawn by a `.map`) of Grammar `Link`s whose `onFollow` or `onPress` is an inline arrow
 *     that passes the Link's own label (`{q}` and `send(q)`, `{item.label}` and `ask(item.label)`, or an equal string literal)
 *     and whose `href` is absent or `"#"`;
 *   - a Grammar `ChoiceChips` whose `onValueChange` is an inline arrow that calls something that is not a state setter with the
 *     value, or is a bare send-like function (`send`, `ask`, `submit`, `reply`, `post`, `dispatch`): it sends the choice instead
 *     of keeping it selected;
 *   - a HeroUI `Chip` (imported from `@heroui/react`) with an `onPress` or `onClick` that passes its own label. Grammar `Badge`
 *     takes no action prop and Grammar `TagGroup` only `onRemove(ids)`/`onReorder(ids)`, so neither can send its own label.
 * A spread, a computed prop, a handler that is not readable, a callee named `set*`, `on*`, `handle*` or `update*` is not flagged.
 */

const PARENTS: ReadonlySet<string> = new Set(["Cluster", "Stack"])
const SENDERS = /^(send|ask|submit|reply|post|dispatch)/
const NOT_SENDING = /^(set[A-Z]|on[A-Z]|handle|update)/

type Source = { getText(node: TSESTree.Node): string }

/** The single expression or text an element states as its label: `{q}` as the node `q`, text as its string. */
const labelOf = (element: TSESTree.JSXElement): { readonly node: TSESTree.Node } | { readonly text: string } | null => {
  const children = element.children.filter((child) => !(child.type === "JSXText" && child.value.trim() === ""))
  if (children.length !== 1) return null
  const child = children[0]!
  if (child.type === "JSXText") return { text: child.value.trim() }
  if (child.type !== "JSXExpressionContainer" || child.expression.type === "JSXEmptyExpression") return null
  if (child.expression.type === "Literal" && typeof child.expression.value === "string") return { text: child.expression.value }
  return { node: child.expression }
}

/** The one call an inline arrow makes, or null. */
const callOf = (handler: TSESTree.ArrowFunctionExpression): TSESTree.CallExpression | null => {
  let body: TSESTree.Node | null = handler.body
  if (body.type === "BlockStatement") {
    const only: TSESTree.Statement | undefined = body.body.length === 1 ? body.body[0] : undefined
    body = only?.type === "ExpressionStatement" ? only.expression : null
  }
  return body !== null && body.type === "CallExpression" ? body : null
}

/** The last name of a callee (`send`, `chat.send` as `send`), or null. */
const calleeName = (callee: TSESTree.Node): string | null => {
  if (callee.type === "Identifier") return callee.name
  if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier") return callee.property.name
  return null
}

/** The inline arrow an attribute holds, or null. */
const arrowOf = (opening: TSESTree.JSXOpeningElement, name: string): TSESTree.ArrowFunctionExpression | null => {
  const value = attributeOf(opening, name)?.value
  if (value == null || value.type !== "JSXExpressionContainer" || value.expression.type !== "ArrowFunctionExpression") return null
  return value.expression
}

/** True when an inline handler arrow of the element passes the element's own label. */
const sendsOwnLabel = (element: TSESTree.JSXElement, names: readonly string[], source: Source): boolean => {
  const label = labelOf(element)
  if (label === null) return false
  return names.some((name) => {
    const handler = arrowOf(element.openingElement, name)
    const call = handler === null ? null : callOf(handler)
    if (call === null) return false
    return call.arguments.some((arg) => ("text" in label ? arg.type === "Literal" && arg.value === label.text : arg.type !== "Literal" && source.getText(arg) === source.getText(label.node)))
  })
}

/** True when an element sits inside a `.map` callback below its parent. */
const inMap = (element: TSESTree.JSXElement, parent: TSESTree.JSXElement): boolean => {
  for (let node: TSESTree.Node | undefined = element.parent; node !== undefined && node !== parent; node = node.parent) {
    if (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") return true
  }
  return false
}

/** The HeroUI `Chip` local names a file imports from `@heroui/react`. */
const heroChips = (program: TSESTree.Program): ReadonlySet<string> => {
  const names = new Set<string>()
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration" || statement.source.value !== "@heroui/react") continue
    for (const specifier of statement.specifiers) {
      if (specifier.type === "ImportSpecifier" && specifier.imported.type === "Identifier" && specifier.imported.name === "Chip") names.add(specifier.local.name)
    }
  }
  return names
}

export const suggestionButtons: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "FE_SUGGESTION_BUTTONS: suggestions and quick replies are a Cluster of neutral sm Buttons, not Links, ChoiceChips or Chips." },
    schema: [],
    messages: {
      element:
        "Suggestions and quick replies have one pattern: a `Cluster gap=\"inline\"` of neutral `Button size=\"sm\"` (a pill). {{element}} here runs an action or sends its own label; draw it as a Button.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    let bound: ReadonlyMap<string, string> = new Map()
    let chips: ReadonlySet<string> = new Set()
    const source = context.sourceCode as unknown as Source

    /** A Grammar Link that passes its own label and goes nowhere. */
    const isLinkSuggestion = (node: TSESTree.Node): node is TSESTree.JSXElement => {
      if (node.type !== "JSXElement") return false
      const opening = node.openingElement
      if (elementOf(opening, bound).grammar !== "Link") return false
      if (opening.attributes.some((entry) => entry.type === "JSXSpreadAttribute")) return false
      if (attributeOf(opening, "href") !== null && literalAttribute(opening, "href") !== "#") return false
      return sendsOwnLabel(node, ["onFollow", "onPress"], source)
    }

    return {
      Program(program: TSESTree.Program) {
        bound = grammarBindings(program)
        chips = heroChips(program)
      },
      JSXElement(element: TSESTree.JSXElement) {
        const opening = element.openingElement
        const { grammar, tag } = elementOf(opening, bound)
        const report = (name: string): void => context.report({ node: opening, messageId: "element", data: { element: name } })

        if (grammar === "ChoiceChips") {
          if (opening.attributes.some((entry) => entry.type === "JSXSpreadAttribute")) return
          const value = attributeOf(opening, "onValueChange")?.value
          if (value == null || value.type !== "JSXExpressionContainer") return
          const handler = value.expression
          if (handler.type === "Identifier" || handler.type === "MemberExpression") {
            const name = calleeName(handler)
            if (name !== null && SENDERS.test(name) && !NOT_SENDING.test(name)) report("`ChoiceChips`")
            return
          }
          if (handler.type !== "ArrowFunctionExpression") return
          const param = handler.params[0]
          const call = callOf(handler)
          if (param?.type !== "Identifier" || call === null) return
          const name = calleeName(call.callee)
          if (name === null || NOT_SENDING.test(name)) return
          if (call.arguments.some((arg) => arg.type === "Identifier" && arg.name === param.name)) report("`ChoiceChips`")
          return
        }

        if (grammar === null && tag === null && opening.name.type === "JSXIdentifier" && chips.has(opening.name.name)) {
          if (opening.attributes.some((entry) => entry.type === "JSXSpreadAttribute")) return
          if (sendsOwnLabel(element, ["onPress", "onClick"], source)) report("`Chip`")
          return
        }

        if (!(grammar !== null && PARENTS.has(grammar)) && tag !== "div") return
        const found = renderedChildren(element.children).filter(isLinkSuggestion)
        if (found.length < 2 && !found.some((entry) => inMap(entry, element))) return
        for (const entry of found) context.report({ node: entry.openingElement, messageId: "element", data: { element: "`Link`" } })
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "suggestion-buttons": suggestionButtons,
}

defineFamilyRules(rules, "knowledge/ui/presentation/grammar-laws.yaml#SUGGESTION-BUTTONS")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
