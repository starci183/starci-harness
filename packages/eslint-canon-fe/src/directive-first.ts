/**
 * A module directive is the first statement of its module (HFS R369, `FE_DIRECTIVE_FIRST`).
 *
 * `"use client"` and `"use server"` are directives only in the prologue, before any import or other statement. Below an import the string is an
 * expression statement that does nothing, Prettier wraps it as `("use client")`, and `next build` stops with "The 'use client' directive must be placed
 * before other expressions". ESLint's parser marks a real directive with `directive`, so a string statement of that text without one is misplaced.
 */
import { defineRule, type Recommended, type Rules } from "./lib/rule.ts"

/** The directives Next.js reads from the prologue of a module. */
const DIRECTIVES: ReadonlySet<string> = new Set(["use client", "use server"])

/** A module directive stays in the prologue. */
export const directiveFirst = defineRule({
  meta: {
    type: "problem",
    docs: { description: "R369: a 'use client' or 'use server' directive is the first statement of its module." },
    schema: [],
    messages: {
      misplaced:
        'FE_DIRECTIVE_FIRST: "{{directive}}" is not at the top of the module, so it is an expression that does nothing and `next build` refuses the file. Move it above every import and other statement.',
    },
  },
  create(context) {
    return {
      ExpressionStatement(node) {
        if (node.parent.type !== "Program" || "directive" in node && typeof node.directive === "string") return
        const expression = node.expression
        if (expression.type !== "Literal" || typeof expression.value !== "string" || !DIRECTIVES.has(expression.value)) return
        context.report({ node, messageId: "misplaced", data: { directive: expression.value } })
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules = { "directive-first": directiveFirst } satisfies Rules

/** Every misplaced directive is a build error. */
export const recommended: Recommended = { "starci-fe/directive-first": "error" }
