/**
 * The lite persistence law (catalog R334 `BE_PERSISTENCE_NO_RAW_SQL`; contexts/code/be/persistence.md BE-PERSISTENCE-1 and -2):
 * domain and feature code reads and writes through TypeORM entities on the injected EntityManager (`find`, `save`, `update`,
 * `delete`, `upsert`, `createQueryBuilder(Entity, "alias")` with named parameters), never through raw SQL.
 *
 *   - `no-raw-sql` refuses, outside `platform/database`, every `.query(` call and every `sql` tagged template. A database function
 *     TypeORM cannot express is called through the typed helpers of `platform/database` (`callDbFunction(manager, name, args)`,
 *     `advisoryXactLock(manager, key)`, `notify(manager, channel, payload)`), and a literal function name handed to
 *     `callDbFunction` must be one `ruleParams.be.dbFunctions` lists (the canon's pg built-ins, bare, plus every other function
 *     schema-qualified, `public.job_claim`, including hfs.json `sides.be.dbFunctions`).
 *     The allow-list governs WHICH functions may be called, the helper WHERE the SQL is built. A query builder names its entity
 *     (`createQueryBuilder(Entity, "alias")`): a builder over a table-name string, a builder with no entity, and a
 *     `getRepository(...)` are refused, because they bypass the entity mapping. The rule runs in lite only (the
 *     catalog's `editions`); full keeps R36.
 *
 * Schema authority stays `db/migrations/*.sql`; whether the entities match it is `BE_ENTITY_SCHEMA_DRIFT` of `starci app db drift`.
 */
import { staticText } from "./lib/ast.ts"
import { hfsOf } from "./lib/hfs.ts"
import type { RuleModule, Recommended, Rules } from "./lib/rule.ts"

/** The owner id (`<tier>/<capability>`) that keeps the migration runner and the database-function helpers. */
const DATABASE_OWNER = "platform/database"
/** The helper of platform/database whose second argument names the function it calls. */
const CALL_HELPER = "callDbFunction"

/** True when a builder's first argument can be an entity class: neither absent nor a string. */
const namesEntity = (argument: unknown): boolean => {
    if (argument === undefined || argument === null || typeof argument !== "object") return false
    const node = argument as { type?: string, value?: unknown }
    return !((node.type === "Literal" && typeof node.value === "string") || node.type === "TemplateLiteral")
}

/** No raw SQL in lite domain or feature code: entities on the EntityManager carry every read and write. */
export const noRawSql: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "Lite domain and feature code uses TypeORM entities on the EntityManager; `.query(` and `sql` templates stay in platform/database, and callDbFunction names only listed functions." },
        schema: [],
        messages: {
            query: "`.query(` runs raw SQL outside `platform/database`. Read and write through the entity on the EntityManager (`find`, `save`, `update`, `upsert`, `createQueryBuilder(Entity, \"alias\")` with named parameters); call a database function TypeORM cannot express through `callDbFunction(manager, name, args)` (or `advisoryXactLock`, `notify`) of `platform/database`.",
            template: "A `sql` template outside `platform/database`. Lite persistence maps tables with TypeORM entities; build the query with the EntityManager or `createQueryBuilder`, or call a database function through `callDbFunction`.",
            builder: "A query builder must name its entity: `manager.createQueryBuilder(Entity, \"alias\")` on the injected EntityManager. A table-name string, a builder with no entity and a Repository bypass the entity mapping.",
            unlisted: "`{{name}}` is not a listed database function. Name a function of a migration schema-qualified (`public.job_claim`) and add it to hfs.json `sides.be.dbFunctions` with the reason TypeORM cannot express it; a pg built-in is named bare only when the canon lists it; or map the work with an entity.",
        },
    },
    create(context) {
        const hfs = hfsOf(context)
        const root = hfs.ownerOf(context.filename)
        const inDatabase = root !== null && root.split("/").slice(-2).join("/") === DATABASE_OWNER
        const listed = new Set((hfs.ruleParams.dbFunctions ?? []).map((entry) => entry.name))
        return {
            CallExpression(node) {
                const callee = node.callee
                if (callee.type === "Identifier" && callee.name === CALL_HELPER) {
                    const name = node.arguments[1] === undefined ? null : staticText(node.arguments[1])
                    if (name !== null && !listed.has(name)) context.report({ node, messageId: "unlisted", data: { name } })
                    return
                }
                if (inDatabase || callee.type !== "MemberExpression" || callee.computed || callee.property.type !== "Identifier") return
                const method = callee.property.name
                if (method === "query") context.report({ node, messageId: "query" })
                else if (method === "getRepository") context.report({ node, messageId: "builder" })
                else if (method === "createQueryBuilder" && !namesEntity(node.arguments[0])) context.report({ node, messageId: "builder" })
            },
            TaggedTemplateExpression(node) {
                if (inDatabase || node.tag.type !== "Identifier" || node.tag.name !== "sql") return
                context.report({ node, messageId: "template" })
            },
        }
    },
}

/** The rule of the lite persistence law, by name. */
export const rules = { "no-raw-sql": noRawSql } satisfies Rules
/** On at error; the catalog limits it to lite. */
export const recommended: Recommended = { "starci-be/no-raw-sql": "error" }
