/**
 * R291 HFS_FUNCTION_BUDGET: every function body stays within the common line budget.
 *
 * Count the physical span of the body, including braces, comments, blank lines and nested functions.
 * Signatures and parameters are outside the body. An expression arrow has an expression body and
 * counts the expression and its wrapping parentheses, including comments and blanks inside them.
 */
import type { TSESTree } from "@typescript-eslint/utils"
import { hfsOf } from "./lib/hfs.ts"
import type { Recommended, RuleModule, Rules } from "./lib/rule.ts"

/** A function of any of the three forms. */
type FunctionNode = TSESTree.FunctionDeclaration | TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression

/** Functions, methods, constructors, accessors and callbacks all receive the same body budget. */
export const functionLineBudget: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "A function body stays within ruleParams.functionLines, counting comments and blank lines." },
        schema: [],
        messages: {
            lines: "HFS_FUNCTION_BUDGET: this function body has {{lines}} lines; the budget is {{max}}. Split the work into functions with one responsibility each.",
        },
    },
    create(context) {
        // C08 adds this common parameter to the shipped manifest; keep the owner-decided cap while it lands.
        const max = hfsOf(context).ruleParams.functionLines ?? 80
        if (!Number.isInteger(max) || max < 1) throw new RangeError("ruleParams.functionLines must be a positive integer")
        const source = context.sourceCode || context.getSourceCode()
        const check = (node: FunctionNode): void => {
            if (!node.body) return
            let start = node.body.loc.start.line
            let end = node.body.loc.end.line
            if (node.type === "ArrowFunctionExpression" && node.body.type !== "BlockStatement") {
                const arrow = source.getTokenBefore(node.body, { filter: (token) => token.value === "=>" })
                // An expression arrow always holds its `=>` and a token after it; the guard only proves that to the types.
                const after = arrow === null ? null : source.getTokenAfter(arrow, { includeComments: true })
                if (after === null) return
                start = after.loc.start.line
                end = node.loc.end.line
            }
            const lines = end - start + 1
            if (lines > max) context.report({ node: node.body, messageId: "lines", data: { lines, max } })
        }
        return {
            FunctionDeclaration: check,
            FunctionExpression: check,
            ArrowFunctionExpression: check,
        }
    },
}

/** The rule this law contributes to the plugin. */
export const rules: Rules = { "function-line-budget": functionLineBudget }

/** The function budget is an error in both editions. */
export const recommended: Recommended = { "starci-be/function-line-budget": "error" }
