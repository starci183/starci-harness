import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
import { attributeOf, elementOf, grammarBindings, keyName, propertyOf } from "./lib/row-context.ts"

/**
 * The chat surfaces law (`FE_MESSAGE_SURFACES`, Grammar 0.37.31, DNA-COMMON-CHAT-SURFACES): every chat draws the same three faces, and they are Grammar's
 * alone. The thread is the page tone (`--background`), a message of someone else (`MessageBubble` incoming, `MessageCard`) is the flat surface (no border,
 * no shadow), the reader's own message is `--accent` with `--accent-foreground`. An app never restyles them. The law flags, in cheap static shapes only:
 *   - a `className`, `class`, `style` or `UNSAFE_className` attribute on a Grammar `MessageBubble` or `MessageCard` (their props carry none; a cast or a
 *     spread that smuggles one past the type is still a restyle);
 *   - a static class string or a style key in product source that names a Grammar message part (`starci-core-message-bubble…`, `starci-core-message-card…`):
 *     an arbitrary-variant utility (`[&_.starci-core-message-bubble-body]:bg-white`) or a selector reaching into the bubble;
 *   - a `PaneSection` whose `scroll` object literal states `role: "log"` with `tone: "surface"`: a thread is always the page tone (the Grammar ignores the
 *     tone), so the word misleads the reader of the code.
 * A spread, a computed class or a tone held in a variable is not read.
 */

const MESSAGE_PARTS = /starci-core-message-(?:bubble|card)/
const STYLE_ATTRIBUTES: ReadonlySet<string> = new Set(["className", "class", "style", "UNSAFE_className", "UNSAFE_style"])
const FACES: ReadonlySet<string> = new Set(["MessageBubble", "MessageCard"])

/** The static string a literal or a template without expressions holds, or null. */
const staticString = (node: TSESTree.Node): string | null => {
  if (node.type === "Literal" && typeof node.value === "string") return node.value
  if (node.type === "TemplateLiteral") return node.quasis.map((quasi) => quasi.value.cooked ?? "").join(" ")
  return null
}

export const messageSurfaces: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "FE_MESSAGE_SURFACES: chat bubbles, message cards and the thread ground are Grammar's faces; an app never restyles them." },
    schema: [],
    messages: {
      attribute: "`{{component}}` takes no `{{attribute}}`: every chat draws the same faces (the thread on `--background`, others' messages flat `--surface`, your own `--accent`). Remove it.",
      part: "This class or style reaches into a Grammar message part (`{{part}}`). Chat faces are Grammar's (DNA-COMMON-CHAT-SURFACES); remove the override.",
      tone: "A chat thread (`scroll.role: \"log\"`) is always the page tone; `tone: \"surface\"` is ignored. Remove `tone`.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    let bound: ReadonlyMap<string, string> = new Map()
    const reportPart = (node: TSESTree.Node, text: string): void => {
      const part = MESSAGE_PARTS.exec(text)?.[0]
      if (part !== undefined) context.report({ node, messageId: "part", data: { part } })
    }
    return {
      Program(program: TSESTree.Program) {
        bound = grammarBindings(program)
      },
      JSXOpeningElement(opening: TSESTree.JSXOpeningElement) {
        const { grammar } = elementOf(opening, bound)
        if (grammar !== null && FACES.has(grammar)) {
          for (const entry of opening.attributes) {
            if (entry.type !== "JSXAttribute" || entry.name.type !== "JSXIdentifier" || !STYLE_ATTRIBUTES.has(entry.name.name)) continue
            context.report({ node: entry, messageId: "attribute", data: { component: grammar, attribute: entry.name.name } })
          }
        }
        if (grammar === "PaneSection") {
          const value = attributeOf(opening, "scroll")?.value
          if (value?.type !== "JSXExpressionContainer" || value.expression.type !== "ObjectExpression") return
          const role = propertyOf(value.expression, "role")?.value
          const tone = propertyOf(value.expression, "tone")
          if (role?.type === "Literal" && role.value === "log" && tone?.value.type === "Literal" && tone.value.value === "surface") {
            context.report({ node: tone, messageId: "tone" })
          }
        }
      },
      JSXAttribute(attribute: TSESTree.JSXAttribute) {
        if (attribute.name.type !== "JSXIdentifier" || !STYLE_ATTRIBUTES.has(attribute.name.name) || attribute.value == null) return
        if (attribute.value.type === "Literal") {
          if (typeof attribute.value.value === "string") reportPart(attribute.value, attribute.value.value)
          return
        }
        if (attribute.value.type !== "JSXExpressionContainer") return
        const expression = attribute.value.expression
        const text = staticString(expression)
        if (text !== null) {
          reportPart(expression, text)
          return
        }
        if (expression.type === "ObjectExpression") {
          for (const property of expression.properties) {
            if (property.type !== "Property") continue
            const key = keyName(property)
            if (key !== null) reportPart(property, key)
          }
        }
      },
      CallExpression(call: TSESTree.CallExpression) {
        // a class builder (`cn(...)`, `clsx(...)`): its static string arguments are class strings
        if (call.callee.type !== "Identifier" || !/^(cn|clsx|cx|classNames|classnames|twMerge|twJoin)$/.test(call.callee.name)) return
        for (const argument of call.arguments) {
          const text = staticString(argument)
          if (text !== null) reportPart(argument, text)
        }
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "message-surfaces": messageSurfaces,
}

defineFamilyRules(rules, "knowledge/ui/presentation/grammar-laws.yaml#MESSAGE-SURFACES")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
