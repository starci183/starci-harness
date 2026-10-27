/**
 * Questions a rule asks about database transactions: the callback of a `.transaction(...)` call and the variable an identifier
 * resolves to. The receiver of `.transaction` is judged by its TYPE (typeorm's `EntityManager` or `DataSource`), never by its name.
 */
import { infraTypeOf } from "./persistence.ts"
import type { TSESLint, TSESTree } from "@typescript-eslint/utils"
import type { Context } from "./rule.ts"

/**
 * The callback of a `.transaction(...)` call on a manager or data source, or null.
 *
 * @param {object} context - The ESLint rule context.
 * @param {object} node - A CallExpression.
 * @returns {object | null} The arrow or function expression that receives the transactional manager.
 */
export const transactionCallback = (context: Context, node: TSESTree.CallExpression): TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression | null => {
    const callee = node.callee
    if (callee.type !== "MemberExpression" || callee.computed) return null
    if (callee.property.type !== "Identifier" || callee.property.name !== "transaction") return null
    const receiver = infraTypeOf(context, callee.object)
    if (receiver !== "EntityManager" && receiver !== "DataSource") return null
    const callback = node.arguments[node.arguments.length - 1]
    return callback && (callback.type === "ArrowFunctionExpression" || callback.type === "FunctionExpression") ? callback : null
}

/**
 * The variable an identifier resolves to, looking outward from the identifier's own scope.
 *
 * @param {object} sourceCode - The ESLint source code.
 * @param {object} node - An Identifier.
 * @returns {object | null} The scope variable.
 */
export const resolveVariable = (sourceCode: Readonly<TSESLint.SourceCode>, node: TSESTree.Identifier): TSESLint.Scope.Variable | null => {
    for (let scope: TSESLint.Scope.Scope | null = sourceCode.getScope(node); scope; scope = scope.upper) {
        const variable = scope.set.get(node.name)
        if (variable) return variable
    }
    return null
}
