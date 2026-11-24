/**
 * The rules that hold the transport half of HFS default-deny (catalog R41 `BE_DEFAULT_DENY`).
 *
 * Every route needs a signed-in principal unless it says otherwise, and every body has a type:
 *
 *   - `no-untyped-body` refuses a `@Body()` (or `@Args()`) parameter with no type, `unknown`, `any`, `object`,
 *     `{}` or `Record<string, unknown>`; it refuses `GraphQLJSON` as a tunnel around the schema; and it refuses
 *     a `switch (input.operation)` in a transport file, because each operation is its own typed operation.
 *   - `public-needs-reason` refuses `@Public()` without `{ reason: PublicReason.X }`, where `PublicReason` is the enum
 *     `domain/identity` exports (judged by the enum's declaring owner, type-aware). An open door states why it is open
 *     from a closed list, so the open doors can be read and reviewed; a string or another enum is refused.
 *
 * The `APP_GUARD` registration and the app-level guard live in the composition check, not here: a rule reading
 * one file cannot see which module the app registered.
 */
import { isTransportSlot } from "./lib/transport-slots.ts"
import { decoratorName, keyName } from "./lib/ast.ts"
import { isOwnedEnumMember } from "./lib/declared.ts"
import { hfsOf } from "./lib/hfs.ts"
import { isDeclarationFile, normalizePath } from "./lib/path.ts"
import type { TSESTree } from "@typescript-eslint/utils"
import type { Recommended, RuleModule, Rules } from "./lib/rule.ts"

const BODY_DECORATORS = new Set(["Body", "Args"])

/** The reason expression supplied to a public decorator, or null when it supplies none. */
const publicReasonOf = (node: TSESTree.Decorator) => {
    const expression = node.expression
    const argument = expression.type === "CallExpression" ? expression.arguments[0] : undefined
    if (argument?.type !== "ObjectExpression") return null
    const property = argument.properties.find((item): item is TSESTree.Property => item.type === "Property" && !item.computed && keyName(item.key) === "reason")
    return property ? property.value : null
}

const isUntyped = (annotation: TSESTree.TSTypeAnnotation | undefined) => {
    if (!annotation) return true
    const type = annotation.typeAnnotation
    if (!type) return true
    if (["TSUnknownKeyword", "TSAnyKeyword", "TSObjectKeyword"].includes(type.type)) return true
    if (type.type === "TSTypeLiteral" && type.members.length === 0) return true
    if (type.type === "TSTypeReference" && type.typeName.type === "Identifier" && type.typeName.name === "Record") {
        const value = type.typeArguments?.params?.[1]
        return value?.type === "TSUnknownKeyword" || value?.type === "TSAnyKeyword"
    }
    return false
}

/** A body or argument carries a declared type, never `unknown`, `any` or GraphQLJSON. */
export const noUntypedBody: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "`@Body()` and `@Args()` parameters are typed; no GraphQLJSON tunnel; no `switch (input.operation)`." },
        schema: [],
        messages: {
            untyped: "This `@{{decorator}}()` parameter has no useful type. Declare a DTO class or contract type so the framework validates the input.",
            json: "`GraphQLJSON` tunnels untyped data through the schema. Declare an input type with the fields the operation needs.",
            operationSwitch: "`switch` on an `operation` field dispatches several operations through one untyped door. Make each operation its own typed resolver or controller method.",
        },
    },
    create(context) {
        const filename = normalizePath(context.filename || context.getFilename())
        if (isDeclarationFile(filename)) return {}
        const slot = hfsOf(context).slotOf(filename) ?? ""
        const inTransport = isTransportSlot(slot) || slot.startsWith("be.feature.transport.")
        return {
            Identifier(node) {
                if (node.name === "GraphQLJSON" && !/^Import.*Specifier$/.test(node.parent?.type ?? "")) {
                    context.report({ node, messageId: "json" })
                }
            },
            SwitchStatement(node) {
                const discriminant = node.discriminant
                if (inTransport && discriminant.type === "MemberExpression" && keyName(discriminant.property) === "operation") {
                    context.report({ node, messageId: "operationSwitch" })
                }
            },
            Decorator(node) {
                const name = decoratorName(node)
                if (name === null || !BODY_DECORATORS.has(name)) return
                const parameter = node.parent
                if (!parameter) return
                const bound = parameter.type === "TSParameterProperty" ? parameter.parameter : parameter
                if (bound.type !== "Identifier" && bound.type !== "ObjectPattern" && bound.type !== "AssignmentPattern") return
                const annotated = bound.type === "AssignmentPattern" ? bound.left : bound
                if (isUntyped(annotated.typeAnnotation)) {
                    context.report({ node, messageId: "untyped", data: { decorator: name } })
                }
            },
        }
    },
}

/** An open door states why it is open, from the closed `PublicReason` list of `domain/identity`. */
export const publicNeedsReason: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "`@Public()` carries `{ reason: PublicReason.X }` with `PublicReason` from `domain/identity`." },
        schema: [],
        messages: {
            reason: "`@Public()` needs `{ reason: PublicReason.X }` with a member of the `PublicReason` enum exported by `domain/identity`; a string, another enum or a missing reason is refused. A new reason is a change to the canon, not to this file.",
        },
    },
    create(context) {
        const filename = normalizePath(context.filename || context.getFilename())
        if (isDeclarationFile(filename)) return {}
        return {
            Decorator(node) {
                if (decoratorName(node) !== "Public") return
                const reason = publicReasonOf(node)
                if (reason === null || !isOwnedEnumMember(context, reason, "PublicReason", "domain", "identity")) context.report({ node, messageId: "reason" })
            },
        }
    },
}

/** The rules this law contributes to the plugin. */
export const rules = {
    "no-untyped-body": noUntypedBody,
    "public-needs-reason": publicNeedsReason,
} satisfies Rules

/** Every rule starts at error: public doors and typed inputs hold the default-deny boundary. */
export const recommended: Recommended = {
    "starci-be/no-untyped-body": "error",
    "starci-be/public-needs-reason": "error",
}
