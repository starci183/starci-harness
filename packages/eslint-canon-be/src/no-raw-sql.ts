/**
 * The lite persistence law (catalog R334 `BE_PERSISTENCE_NO_RAW_SQL`; contexts/code/be/persistence.md BE-PERSISTENCE-4):
 * lite TypeScript holds no SQL text outside the test world. A table is read and written through its TypeORM entity on an
 * EntityManager (`find`, `save`, `update`, `delete`, `upsert`, a pessimistic `lock` option, `createQueryBuilder(Entity, "alias")`
 * with named parameters); anything else is a database function called through `callDbFunction` of `platform/database`.
 *
 *   - `query`: a `.query(` call is refused everywhere except (1) the test world `src/tests/world`; (2) `platform/database/database.client.ts`,
 *     the one composer, whose statements are the templates R68 checks; (3) a file `ruleParams.be.sqlPassThrough` or hfs.json
 *     `sides.be.sqlPassThrough` lists with a reason, while its first argument is not a template literal or a `+` expression;
 *     (4) the `*.spec.ts` beside such a file. `platform/database` has no blanket exemption.
 *   - `template`: a `sql` tagged template outside the world. `sqlFile`: a `*.sql.ts` file outside the world. `sqlTagImport`: an import
 *     of `sql`, `ident`, `SqlText` or `SqlIdent` outside the world. The tag's own module (`platform/database/database.sql.ts`) is exempt.
 *   - `worldCallHelper`, `worldTableWrite`: a `sql` template inside the world that only calls a listed function (it is
 *     `callDbFunction`), or writes an application table (`public.` or `be_access.`: it goes through the entity or a builder).
 *     The world keeps raw SQL for probes: privileges, row-level security, catalogs, cron, pgmq queue tables, locks, failures.
 *   - `unlisted`: a literal function name handed to `callDbFunction` must be one `ruleParams.be.dbFunctions` lists (the canon's
 *     pg built-ins, bare, plus every other function schema-qualified, including hfs.json `sides.be.dbFunctions`).
 *   - `builder`: a query builder names its entity (`createQueryBuilder(Entity, "alias")`); a builder over a table-name string, a
 *     builder with no entity, and a `getRepository(...)` are refused (the world excepted).
 * The rule runs in lite only (the catalog's `editions`); full keeps R36.
 *
 * Schema authority stays `db/migrations/*.sql`; whether the entities match it is `BE_ENTITY_SCHEMA_DRIFT` of `starci app db drift`.
 */
import { staticText } from "./lib/ast.ts"
import { hfsOf } from "./lib/hfs.ts"
import { baseNameOf, inDatabaseCapability } from "./lib/persistence.ts"
import type { TSESTree } from "@typescript-eslint/utils"
import type { RuleModule, Recommended, Rules } from "./lib/rule.ts"

/** The test world, the only place that may hold raw SQL text, by side-relative folder. */
const WORLD = "src/tests/world/"
/** The helper of platform/database whose second argument names the function it calls. */
const CALL_HELPER = "callDbFunction"
/** The one composer of SQL text in platform/database. */
const COMPOSER_FILE = "database.client.ts"
/** The module of platform/database that defines the `sql` tag. */
const TAG_FILE = "database.sql.ts"
/** The names that carry SQL text: the tag, its identifier check and their brands. */
const SQL_TEXT_NAMES = new Set(["sql", "ident", "SqlText", "SqlIdent"])
/** The suffix of a spec file. */
const SPEC_SUFFIX = ".spec.ts"

/** A statement that writes an application table: it goes through the entity or the area's builder. */
const TABLE_WRITE = /^\s*(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:public|be_access)\./i

/** True when a builder's first argument can be an entity class: neither absent nor a string. */
const namesEntity = (argument: TSESTree.CallExpressionArgument | undefined): boolean =>
    argument !== undefined && argument.type !== "TemplateLiteral" && !(argument.type === "Literal" && typeof argument.value === "string")

/** The text of a template literal, each substitution standing as `?`. */
const templateText = (template: TSESTree.TemplateLiteral): string =>
    template.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join("?")

/** The pattern of a statement that is only a call of one listed function: `SELECT [* FROM] <fn>(...) [AS x]`. */
const callPattern = (names: readonly string[]): RegExp | null => {
    if (names.length === 0) return null
    const alternatives = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")
    return new RegExp(`^\\s*SELECT\\s+(?:\\*\\s+FROM\\s+)?(?:${alternatives})\\s*\\([\\s\\S]*\\)\\s*(?:AS\\s+\\w+)?\\s*;?\\s*$`, "i")
}

/** Lite TypeScript holds no SQL text outside the test world: entities, or a function through `callDbFunction`. */
export const noRawSql: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "Lite TypeScript holds no SQL text outside the test world: tables go through entities on an EntityManager, functions through callDbFunction of a listed name." },
        schema: [],
        messages: {
            query: "`.query(` runs SQL text outside the test world. Read and write through the entity on the EntityManager (`find`, `save`, `update`, `upsert`, a `lock` option, `createQueryBuilder(Entity, \"alias\")` with named parameters; a spec, builder or fixture on `world.db.<connection>`), and call a database function through `callDbFunction(manager, name, args)` (`advisoryXactLock` and `notify` do). Only `platform/database/database.client.ts` composes SQL text; a file whose text is not the app's own (the tracked seed, a customer data source, an outside session) is listed in hfs.json `sides.be.sqlPassThrough` with a reason and passes a plain string, never a template or a `+`.",
            template: "A `sql` template outside the test world. Lite TypeScript holds no SQL text: build the query with the EntityManager or `createQueryBuilder(Entity, \"alias\")`, or call a database function through `callDbFunction`. Raw SQL for a privilege, row-level-security, catalog, cron or pgmq probe lives in `src/tests/world`.",
            sqlFile: "A `*.sql.ts` file outside the test world. Only `src/tests/world` holds SQL text files; a query fragment or a function wrapper is named for what it is (`<name>.columns.ts`, `auth-doors.ts`).",
            sqlTagImport: "`sql`, `ident`, `SqlText` and `SqlIdent` are imported outside the test world. Lite TypeScript holds no SQL text: use an entity on the EntityManager or `callDbFunction`.",
            worldCallHelper: "This world statement only calls a listed database function. Call it through `callDbFunction(world.db.<connection>, name, args)`; the world keeps raw SQL for what neither an entity nor a listed function expresses.",
            worldTableWrite: "This world statement writes an application table. Write it through the entity on `world.db.<connection>` (`save`, `update`, `delete`, `upsert`), or seed it with the area's builder (R98); the world keeps raw SQL for probes.",
            builder: "A query builder must name its entity: `manager.createQueryBuilder(Entity, \"alias\")` on the injected EntityManager. A table-name string, a builder with no entity and a Repository bypass the entity mapping.",
            unlisted: "`{{name}}` is not a listed database function. Name a function of a migration schema-qualified (`public.job_claim`) and add it to hfs.json `sides.be.dbFunctions` with the reason TypeORM cannot express it; a pg built-in is named bare only when the canon lists it; or map the work with an entity.",
        },
    },
    create(context) {
        const hfs = hfsOf(context)
        const relative = hfs.relative(context.filename)
        const inWorld = relative.startsWith(WORLD)
        const base = baseNameOf(relative)
        const inDatabase = inDatabaseCapability(hfs, context.filename)
        const isComposer = base === COMPOSER_FILE && inDatabase
        const isTagModule = base === TAG_FILE && inDatabase
        const listed = new Set((hfs.ruleParams.dbFunctions ?? []).map((entry) => entry.name))
        const passThrough = new Set((hfs.ruleParams.sqlPassThrough ?? []).map((entry) => entry.file))
        const passThroughSpec = relative.endsWith(SPEC_SUFFIX) && passThrough.has(`${relative.slice(0, -SPEC_SUFFIX.length)}.ts`)
        const callOnly = callPattern([...listed])
        return {
            Program(node) {
                if (!inWorld && !isTagModule && relative.endsWith(".sql.ts")) context.report({ node, messageId: "sqlFile" })
            },
            ImportDeclaration(node) {
                if (inWorld || isTagModule) return
                for (const specifier of node.specifiers) {
                    if (specifier.type !== "ImportSpecifier") continue
                    const imported = specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value
                    if (SQL_TEXT_NAMES.has(imported)) context.report({ node: specifier, messageId: "sqlTagImport" })
                }
            },
            CallExpression(node) {
                const callee = node.callee
                if (callee.type === "Identifier" && callee.name === CALL_HELPER) {
                    const name = node.arguments[1] === undefined ? null : staticText(node.arguments[1])
                    if (name !== null && !listed.has(name)) context.report({ node, messageId: "unlisted", data: { name } })
                    return
                }
                if (callee.type !== "MemberExpression" || callee.computed || callee.property.type !== "Identifier") return
                const method = callee.property.name
                if (method === "query") {
                    if (inWorld || passThroughSpec) return
                    const first = node.arguments[0]
                    if (isComposer && first?.type === "TemplateLiteral") return
                    const built = first?.type === "TemplateLiteral" || (first?.type === "BinaryExpression" && first.operator === "+")
                    if (passThrough.has(relative) && !built) return
                    context.report({ node, messageId: "query" })
                    return
                }
                if (inWorld) return
                if (method === "getRepository") context.report({ node, messageId: "builder" })
                else if (method === "createQueryBuilder" && !namesEntity(node.arguments[0])) context.report({ node, messageId: "builder" })
            },
            TaggedTemplateExpression(node) {
                if (node.tag.type !== "Identifier" || node.tag.name !== "sql") return
                if (!inWorld) {
                    context.report({ node, messageId: "template" })
                    return
                }
                const text = templateText(node.quasi)
                if (callOnly?.test(text) === true) context.report({ node, messageId: "worldCallHelper" })
                else if (TABLE_WRITE.test(text)) context.report({ node, messageId: "worldTableWrite" })
            },
        }
    },
}

/** The rule of the lite persistence law, by name. */
export const rules = { "no-raw-sql": noRawSql } satisfies Rules
/** On at error; the catalog limits it to lite. */
export const recommended: Recommended = { "starci-be/no-raw-sql": "error" }
