/**
 * The lite persistence law (catalog R334 `BE_PERSISTENCE_NO_RAW_SQL`; contexts/code/be/persistence.md BE-PERSISTENCE-4):
 * domain, feature and test code reads and writes through TypeORM entities on an EntityManager (`find`, `save`, `update`,
 * `delete`, `upsert`, `createQueryBuilder(Entity, "alias")` with named parameters), never through raw SQL.
 *
 *   - `no-raw-sql` refuses every `.query(` call and every `sql` tagged template outside the two owners of raw SQL
 *     (`RAW_SQL_OWNERS`): `platform/database`, which keeps the migration runner and the database-function helpers, and the test
 *     world `src/tests/world`, the owner of test infrastructure, which wraps what entities cannot express (a trigger, a database
 *     function, a row-level-security probe, a pgmq queue inspection) in a named, typed helper on the world that specs call.
 *     Specs, builders and fixtures outside the world seed and assert through entities on `world.db.<connection>`.
 *     A database function TypeORM cannot express is called through the typed helpers of `platform/database`
 *     (`callDbFunction(manager, name, args)`, `advisoryXactLock(manager, key)`, `notify(manager, channel, payload)`), in
 *     domain and test code alike, and a literal function name handed to `callDbFunction` must be one `ruleParams.be.dbFunctions`
 *     lists (the canon's pg built-ins, bare, plus every other function schema-qualified, `public.job_claim`, including hfs.json
 *     `sides.be.dbFunctions`). The allow-list governs WHICH functions may be called, the helper WHERE the SQL is built. A query
 *     builder names its entity (`createQueryBuilder(Entity, "alias")`): a builder over a table-name string, a builder with no
 *     entity, and a `getRepository(...)` are refused outside the owners, because they bypass the entity mapping. The rule runs
 *     in lite only (the catalog's `editions`); full keeps R36.
 *
 * Schema authority stays `db/migrations/*.sql`; whether the entities match it is `BE_ENTITY_SCHEMA_DRIFT` of `starci app db drift`.
 */
import { staticText } from "./lib/ast.ts"
import { hfsOf } from "./lib/hfs.ts"
import type { RuleModule, Recommended, Rules } from "./lib/rule.ts"

/**
 * The owners that may hold raw SQL, by side-relative folder: the database capability (the migration runner and the
 * database-function helpers) and the test world (the test infrastructure, whose named helpers wrap what entities cannot express).
 */
const RAW_SQL_OWNERS = ["src/modules/platform/database/", "src/tests/world/"]
/** The helper of platform/database whose second argument names the function it calls. */
const CALL_HELPER = "callDbFunction"

/** True when a builder's first argument can be an entity class: neither absent nor a string. */
const namesEntity = (argument: unknown): boolean => {
    if (argument === undefined || argument === null || typeof argument !== "object") return false
    const node = argument as { type?: string, value?: unknown }
    return !((node.type === "Literal" && typeof node.value === "string") || node.type === "TemplateLiteral")
}

/** No raw SQL in lite domain, feature or test code: entities on an EntityManager carry every read and write. */
export const noRawSql: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "Lite domain, feature and test code uses TypeORM entities on an EntityManager; `.query(` and `sql` templates stay in platform/database and the test world, and callDbFunction names only listed functions." },
        schema: [],
        messages: {
            query: "`.query(` runs raw SQL outside `platform/database` and the test world. Read and write through the entity on the EntityManager (`find`, `save`, `update`, `upsert`, `createQueryBuilder(Entity, \"alias\")` with named parameters); a spec, builder or fixture seeds and asserts through entities on `world.db.<connection>`. Call a database function TypeORM cannot express through `callDbFunction(manager, name, args)` (or `advisoryXactLock`, `notify`) of `platform/database`; a test that must reach what entities cannot express (a trigger, a row-level-security probe, a pgmq queue) calls a named helper of `src/tests/world`.",
            template: "A `sql` template outside `platform/database` and the test world. Lite persistence maps tables with TypeORM entities: build the query with the EntityManager or `createQueryBuilder` (in a test, on `world.db.<connection>`), call a database function through `callDbFunction`, or, in a test, call a named helper of `src/tests/world`.",
            builder: "A query builder must name its entity: `manager.createQueryBuilder(Entity, \"alias\")` on the injected EntityManager. A table-name string, a builder with no entity and a Repository bypass the entity mapping.",
            unlisted: "`{{name}}` is not a listed database function. Name a function of a migration schema-qualified (`public.job_claim`) and add it to hfs.json `sides.be.dbFunctions` with the reason TypeORM cannot express it; a pg built-in is named bare only when the canon lists it; or map the work with an entity.",
        },
    },
    create(context) {
        const hfs = hfsOf(context)
        const relative = hfs.relative(context.filename)
        const inOwner = RAW_SQL_OWNERS.some((owner) => relative.startsWith(owner))
        const listed = new Set((hfs.ruleParams.dbFunctions ?? []).map((entry) => entry.name))
        return {
            CallExpression(node) {
                const callee = node.callee
                if (callee.type === "Identifier" && callee.name === CALL_HELPER) {
                    const name = node.arguments[1] === undefined ? null : staticText(node.arguments[1])
                    if (name !== null && !listed.has(name)) context.report({ node, messageId: "unlisted", data: { name } })
                    return
                }
                if (inOwner || callee.type !== "MemberExpression" || callee.computed || callee.property.type !== "Identifier") return
                const method = callee.property.name
                if (method === "query") context.report({ node, messageId: "query" })
                else if (method === "getRepository") context.report({ node, messageId: "builder" })
                else if (method === "createQueryBuilder" && !namesEntity(node.arguments[0])) context.report({ node, messageId: "builder" })
            },
            TaggedTemplateExpression(node) {
                if (inOwner || node.tag.type !== "Identifier" || node.tag.name !== "sql") return
                context.report({ node, messageId: "template" })
            },
        }
    },
}

/** The rule of the lite persistence law, by name. */
export const rules = { "no-raw-sql": noRawSql } satisfies Rules
/** On at error; the catalog limits it to lite. */
export const recommended: Recommended = { "starci-be/no-raw-sql": "error" }
