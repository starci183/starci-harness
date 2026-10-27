/** R260 BE_JWT_ALG_PINNED: remote JWT verification pins algorithms, configuration and principal role. */
import ts from "typescript"
import { typed } from "./lib/types.ts"
import { isDeclarationFile } from "./lib/path.ts"
import { jwtPolicyProblems } from "../runtime/scripts/hfs/architecture/supabase-ast.mjs"
import type { Recommended, RuleModule, Rules } from "./lib/rule.ts"

/** The text of a module specifier (a string literal), or undefined for any other expression. */
const specifierText = (specifier: ts.Expression) => ("text" in specifier ? specifier.text : undefined)

/** Recognize jose imports and aliases through their declarations, including namespace imports. */
const joseVerifier = (checker: ts.TypeChecker, expression: ts.Node | undefined, seen = new Set<ts.Node>()): boolean => {
    if (!expression || seen.has(expression)) return false
    seen.add(expression)
    if (ts.isPropertyAccessExpression(expression)) {
        if (expression.name.text !== "jwtVerify") return false
        return checker.getSymbolAtLocation(expression.expression)?.declarations?.some(declaration =>
            ts.isNamespaceImport(declaration) && specifierText(declaration.parent.parent.moduleSpecifier) === "jose") ?? false
    }
    return checker.getSymbolAtLocation(expression)?.declarations?.some(declaration => {
        if (ts.isImportSpecifier(declaration)) return (declaration.propertyName ?? declaration.name).text === "jwtVerify"
            && specifierText(declaration.parent.parent.parent.moduleSpecifier) === "jose"
        return ts.isVariableDeclaration(declaration) && declaration.initializer && joseVerifier(checker, declaration.initializer, seen)
    }) ?? false
}

export const jwtAlgPinned: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "R260 BE_JWT_ALG_PINNED: literal secure algorithms, config issuer and authenticated principal role." },
        schema: [],
        messages: { pinned: "{{detail}}" },
    },
    create(context) {
        if (isDeclarationFile(context.filename || context.getFilename())) return {}
        const { checker, toTs } = typed(context)
        return {
            CallExpression(node) {
                const call = toTs(node)
                if (!call || !joseVerifier(checker, call.expression)) return
                const problems = jwtPolicyProblems(ts, checker, call)
                if (problems.length) context.report({ node, messageId: "pinned", data: { detail: problems.join(" ") } })
            },
        }
    },
}

export const rules = { "jwt-alg-pinned": jwtAlgPinned } satisfies Rules
export const recommended: Recommended = { "starci-be/jwt-alg-pinned": "error" }
