/**
 * Small AST helpers the HFS laws share, so each rule states its question instead of its traversal.
 *
 * Nothing here touches disk or the type checker: a rule reads one file's syntax and its path.
 */
import type { TSESTree } from "@typescript-eslint/utils"
import { isNode, type Node } from "./rule.ts"

const SKIP_KEYS = new Set(["parent", "loc", "range", "tokens", "comments"])

const FUNCTION_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"])

/** How far a walk goes: `intoFunctions: false` stops at nested function boundaries. */
export interface WalkOptions {
    readonly intoFunctions?: boolean
}

/**
 * Visits `node` and every descendant, depth first.
 *
 * @param node - The subtree root.
 * @param visit - Called with each node.
 * @param options - `intoFunctions: false` stops at nested function boundaries.
 */
export const walk = (node: Node | null | undefined, visit: (child: Node) => void, { intoFunctions = true }: WalkOptions = {}): void => {
    if (!isNode(node)) return
    visit(node)
    const entries: [string, unknown][] = Object.entries(node)
    for (const [key, value] of entries) {
        if (SKIP_KEYS.has(key)) continue
        if (Array.isArray(value)) {
            for (const child of value) {
                if (!isNode(child)) continue
                if (!intoFunctions && FUNCTION_TYPES.has(child.type)) continue
                walk(child, visit, { intoFunctions })
            }
        } else if (isNode(value)) {
            if (!intoFunctions && FUNCTION_TYPES.has(value.type)) continue
            walk(value, visit, { intoFunctions })
        }
    }
}

/** True when any node of the subtree satisfies `predicate`. */
export const some = (node: Node | null | undefined, predicate: (child: Node) => boolean, options?: WalkOptions): boolean => {
    let found = false
    walk(node, (child) => {
        if (!found && predicate(child)) found = true
    }, options)
    return found
}

/** The name a property key, identifier or string literal spells, else null. */
export const keyName = (node: Node | null | undefined): string | null => {
    if (!node) return null
    if (node.type === "Identifier") return node.name
    if (node.type === "Literal" && typeof node.value === "string") return node.value
    if (node.type === "PrivateIdentifier") return node.name
    return null
}

/** The parameter a constructor or function declares, with its wrapper and default unwrapped, and every decorator on any layer. */
export interface ParamParts {
    readonly target: TSESTree.BindingName | TSESTree.RestElement
    readonly decorators: TSESTree.Decorator[]
}

/** The decorators of a constructor parameter: on the parameter, its wrapper (`private readonly x`) or its inner identifier. */
export const paramParts = (param: TSESTree.Parameter): ParamParts => {
    const inner = param.type === "TSParameterProperty" ? param.parameter : param
    const target = inner.type === "AssignmentPattern" ? inner.left : inner
    return { target, decorators: [...new Set([...(param.decorators ?? []), ...(inner.decorators ?? []), ...(target.decorators ?? [])])] }
}

/** The name of a decorator (`@Foo` or `@Foo(...)`), else null. */
export const decoratorName = (decorator: TSESTree.Decorator | null | undefined): string | null => {
    const expression = decorator?.expression
    if (!expression) return null
    if (expression.type === "Identifier") return expression.name
    if (expression.type === "CallExpression" && expression.callee.type === "Identifier") return expression.callee.name
    return null
}

/** True for a string literal or a template without substitutions, giving its text via `staticText`. */
export const staticText = (node: Node | null | undefined): string | null => {
    if (!node) return null
    if (node.type === "Literal" && typeof node.value === "string") return node.value
    if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis.map((q) => q.value.cooked ?? "").join("")
    return null
}

/** `node.name ?? node.value` of any node: an identifier's name, else a literal's value (undefined when it has neither). */
export const nameOrValue = (node: Node | null | undefined): unknown => {
    if (!node) return undefined
    const name: unknown = "name" in node ? node.name : undefined
    if (name !== undefined && name !== null) return name
    return "value" in node ? node.value : undefined
}

/** The key a member expression reads: `a.b` gives "b", `a["b"]` gives the literal's value (undefined for a computed non-literal). */
export const memberKeyValue = (member: TSESTree.MemberExpression): unknown =>
    (member.computed ? ("value" in member.property ? member.property.value : undefined) : member.property.name)

/** Splits `webhookSecret`, `WEBHOOK_SECRET` and `webhook-secret` into lower-case words. */
export const wordsOf = (name: unknown): string[] =>
    String(name)
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map((word) => word.toLowerCase())
