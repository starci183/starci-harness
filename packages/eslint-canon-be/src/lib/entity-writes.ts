/**
 * Which entities a database write call targets, found by TYPE: a write method called on a typeorm database receiver (`EntityManager`,
 * `DataSource`, `QueryRunner`) or on a typeorm query builder, whose arguments (or, for a query builder, the arguments of any call
 * of the same chain) are the entity class or an instance of it. No variable, class or table name is read.
 */
import { isDatabaseReceiver } from "./db-writes.ts"
import { typeOrigins } from "./types.ts"
import type { TSESTree } from "@typescript-eslint/utils"
import type { Context, Node } from "./rule.ts"
import type { TypeOrigin } from "./types.ts"

/** The methods of a manager or query builder that change rows. */
export const WRITE_METHODS = Object.freeze(["update", "save", "insert", "upsert", "delete", "remove", "increment", "decrement", "softDelete", "softRemove", "recover", "restore", "clear"])

/** True when the node's type is a query builder of `typeorm` (`SelectQueryBuilder`, `UpdateQueryBuilder` ...). */
const isQueryBuilder = (context: Context, node: Node): boolean => typeOrigins(context, node).some((origin) => origin.module === "typeorm" && origin.name.endsWith("QueryBuilder"))

/** The declarations (class origins) of the entities a database write call targets, or `[]` when the node is not such a call. */
export const writtenEntityOrigins = (context: Context, node: TSESTree.CallExpression): TypeOrigin[] => {
    const callee = node.callee
    if (callee.type !== "MemberExpression" || callee.computed || callee.property.type !== "Identifier" || !WRITE_METHODS.includes(callee.property.name)) return []
    if (!isDatabaseReceiver(context, callee.object) && !isQueryBuilder(context, callee.object)) return []
    const candidates: Node[] = [...node.arguments]
    for (let link: Node | null = callee.object; link; ) {
        if (link.type === "CallExpression") {
            candidates.push(...link.arguments)
            link = link.callee.type === "MemberExpression" ? link.callee.object : null
        } else if (link.type === "MemberExpression") link = link.object
        else if (link.type === "TSNonNullExpression") link = link.expression
        else if (link.type === "AwaitExpression") link = link.argument
        else link = null
    }
    // The entity of a builder write may come later in the same chain (`.delete().from(Entity)`, `.insert().into(Entity)`).
    for (let outer: TSESTree.CallExpression | null = node; outer; ) {
        const member: Node | undefined = outer.parent
        const call: Node | undefined = member?.parent
        if (member?.type !== "MemberExpression" || member.object !== outer || call?.type !== "CallExpression" || call.callee !== member) break
        outer = call
        candidates.push(...outer.arguments)
    }
    return candidates.flatMap((candidate) => typeOrigins(context, candidate)).filter((origin) => origin.module === null)
}
