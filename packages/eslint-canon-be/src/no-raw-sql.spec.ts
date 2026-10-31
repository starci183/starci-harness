/**
 * Twin tests for the lite persistence law (R334 `BE_PERSISTENCE_NO_RAW_SQL`).
 *
 *   node --test src/no-raw-sql.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import tsParser from "@typescript-eslint/parser"
import { canonRuleTester } from "../fixtures/rule-tester.ts"
import { BE_DECLARATION, at, fixtureHfs } from "../fixtures/typed/tester.ts"
import { noRawSql, rules } from "./no-raw-sql.ts"

const PASS_THROUGH_FILE = "src/modules/domain/reports/customer-source.client.ts"

const tester = canonRuleTester({
    languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module" },
    settings: { starci: { hfs: fixtureHfs() } },
})

const passThroughTester = canonRuleTester({
    languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module" },
    settings: { starci: { hfs: fixtureHfs({ ...BE_DECLARATION, sqlPassThrough: [{ file: PASS_THROUGH_FILE, reason: "a customer's own data source: its text is the customer's" }] }) } },
})

const DOMAIN = at("src/modules/domain/order/order.service.ts")
const FEATURE = at("src/features/api/orders/application/list-orders.handler.ts")
const DATABASE = at("src/modules/platform/database/migration-runner.service.ts")
const COMPOSER = at("src/modules/platform/database/database.client.ts")
const TAG_MODULE = at("src/modules/platform/database/database.sql.ts")
const SEED_RUNNER = at("src/modules/platform/database/seed-runner.service.ts")
const SPEC = at("src/tests/integration/order/order.integration-spec.ts")
const BUILDER = at("src/tests/fixtures/builders/order.builder.ts")
const WORLD = at("src/tests/world/row-security.client.ts")
const WORLD_SQL_FILE = at("src/tests/world/row-security.sql.ts")
const PASS_THROUGH = at(PASS_THROUGH_FILE)
const PASS_THROUGH_SPEC = at("src/modules/domain/reports/customer-source.client.spec.ts")
const OTHER_SPEC = at("src/modules/domain/reports/other-source.client.spec.ts")

const QUERY_TYPE = "declare const em: { query(text: string): Promise<unknown> }\n"
const TAG_TYPE = "declare const sql: (parts: TemplateStringsArray) => string\n"
const CALL_TYPE = "declare const callDbFunction: (manager: unknown, name: string, args: unknown[]) => Promise<unknown>; declare const em: unknown\n"

test("the law publishes its rule under its name", () => {
    assert.equal(rules["no-raw-sql"], noRawSql)
})

test("no-raw-sql: entities on the EntityManager carry domain reads and writes; a function goes through callDbFunction", () => {
    tester.run("no-raw-sql", noRawSql, {
        valid: [
            { filename: DOMAIN, code: "declare const em: { find(entity: unknown, options: unknown): Promise<unknown> }; declare class OrderEntity {}\nexport const list = () => em.find(OrderEntity, { take: 50 })" },
            { filename: DOMAIN, code: "declare const em: { createQueryBuilder(entity: unknown, alias: string): { where(text: string, params: unknown): unknown } }; declare class OrderEntity {}\nexport const q = () => em.createQueryBuilder(OrderEntity, \"o\").where(\"o.id = :id\", { id: 1 })" },
            { filename: DOMAIN, code: `${CALL_TYPE}export const run = () => callDbFunction(em, "pg_notify", ["jobs", "{}"])` },
            { filename: DOMAIN, code: `${CALL_TYPE}export const run = () => callDbFunction(em, "hashtextextended", ["key", 0])` },
        ],
        invalid: [
            { filename: DOMAIN, code: "declare const em: { createQueryBuilder(table: string, alias: string): unknown }\nexport const q = () => em.createQueryBuilder(\"orders\", \"o\")", errors: [{ messageId: "builder" }] },
            { filename: DOMAIN, code: "declare const em: { createQueryBuilder(): unknown }\nexport const q = () => em.createQueryBuilder()", errors: [{ messageId: "builder" }] },
            { filename: FEATURE, code: "declare const em: { getRepository(entity: unknown): unknown }; declare class OrderEntity {}\nexport const r = () => em.getRepository(OrderEntity)", errors: [{ messageId: "builder" }] },
            { filename: DOMAIN, code: `${CALL_TYPE}export const run = () => callDbFunction(em, "drop_everything", [])`, errors: [{ messageId: "unlisted" }] },
            { filename: DOMAIN, code: `${QUERY_TYPE}export const run = () => em.query("select * from orders")`, errors: [{ messageId: "query" }] },
            { filename: FEATURE, code: `${TAG_TYPE}export const text = sql\`select * from orders\``, errors: [{ messageId: "template" }] },
        ],
    })
})

test("no-raw-sql: platform/database has no blanket exemption; its composer alone holds the call and LISTEN templates", () => {
    tester.run("no-raw-sql", noRawSql, {
        valid: [
            { filename: COMPOSER, code: "declare const manager: { query(text: string, params: unknown[]): Promise<unknown> }; declare const part: string\nexport const call = () => manager.query(`SELECT * FROM \"${part}\"()`, [])" },
            { filename: COMPOSER, code: `${CALL_TYPE}export const notify = () => callDbFunction(em, "pg_notify", ["jobs", "{}"])` },
        ],
        invalid: [
            { filename: DATABASE, code: `${QUERY_TYPE}export const run = () => em.query("select 1")`, errors: [{ messageId: "query" }] },
            { filename: DATABASE, code: "declare const em: { query(text: string): Promise<unknown> }; declare const part: string\nexport const run = () => em.query(`select ${part}`)", errors: [{ messageId: "query" }] },
            { filename: COMPOSER, code: `${QUERY_TYPE}export const run = () => em.query("SELECT pg_notify($1, $2)")`, errors: [{ messageId: "query" }] },
            { filename: DATABASE, code: `${TAG_TYPE}export const text = sql\`select 1\``, errors: [{ messageId: "template" }] },
        ],
    })
})

test("no-raw-sql: a listed pass-through file and its spec may call .query with a plain string", () => {
    passThroughTester.run("no-raw-sql", noRawSql, {
        valid: [
            { filename: PASS_THROUGH, code: `${QUERY_TYPE}export const read = (text: string) => em.query(text)` },
            { filename: PASS_THROUGH, code: `${QUERY_TYPE}export const read = () => em.query("SET SESSION MAX_EXECUTION_TIME = ?")` },
            { filename: PASS_THROUGH_SPEC, code: `${QUERY_TYPE}export const probe = () => em.query("select 1")` },
            { filename: SEED_RUNNER, code: `${QUERY_TYPE}export const seed = (text: string) => em.query(text)` },
        ],
        invalid: [
            { filename: PASS_THROUGH, code: "declare const em: { query(text: string): Promise<unknown> }; declare const table: string\nexport const read = () => em.query(`select * from ${table}`)", errors: [{ messageId: "query" }] },
            { filename: PASS_THROUGH, code: `${QUERY_TYPE}export const read = () => em.query("select * from " + "orders")`, errors: [{ messageId: "query" }] },
            { filename: PASS_THROUGH, code: `${QUERY_TYPE}export const read = () => em.query(\`select 1\`)`, errors: [{ messageId: "query" }] },
            { filename: PASS_THROUGH, code: `${TAG_TYPE}export const text = sql\`select 1\``, errors: [{ messageId: "template" }] },
            { filename: DOMAIN, code: `${QUERY_TYPE}export const read = () => em.query("select 1")`, errors: [{ messageId: "query" }] },
            { filename: OTHER_SPEC, code: `${QUERY_TYPE}export const probe = () => em.query("select 1")`, errors: [{ messageId: "query" }] },
        ],
    })
})

test("no-raw-sql: a pass-through file is refused when no list names it", () => {
    tester.run("no-raw-sql", noRawSql, {
        valid: [
            { filename: SEED_RUNNER, code: `${QUERY_TYPE}export const seed = (text: string) => em.query(text)` },
            { filename: at("src/modules/platform/database/seed-runner.service.spec.ts"), code: `${QUERY_TYPE}export const probe = () => em.query("select 1")` },
        ],
        invalid: [
            { filename: PASS_THROUGH, code: `${QUERY_TYPE}export const read = (text: string) => em.query(text)`, errors: [{ messageId: "query" }] },
            { filename: PASS_THROUGH_SPEC, code: `${QUERY_TYPE}export const probe = () => em.query("select 1")`, errors: [{ messageId: "query" }] },
        ],
    })
})

test("no-raw-sql: a *.sql.ts file and an import of the sql tag belong to the test world alone", () => {
    tester.run("no-raw-sql", noRawSql, {
        valid: [
            { filename: WORLD_SQL_FILE, code: "export const QUEUE_DEPTH = 1" },
            { filename: TAG_MODULE, code: "export const PAGE_SIZE_MAX = 100" },
            { filename: DOMAIN, code: "import { LIST_ROWS_MAX } from \"../limits\"\nexport const rows = LIST_ROWS_MAX" },
            { filename: WORLD, code: "import { sql } from \"../database\"\nexport const probe = sql" },
            { filename: WORLD_SQL_FILE, code: "import { ident, type SqlText } from \"../database\"\nexport type Probe = SqlText\nexport const name = ident" },
        ],
        invalid: [
            { filename: at("src/modules/domain/order/order.sql.ts"), code: "export const ORDER_COLUMNS = \"id\"", errors: [{ messageId: "sqlFile" }] },
            { filename: at("src/modules/platform/database/persistence/rate-limit.sql.ts"), code: "export const RATE_LIMIT = 1", errors: [{ messageId: "sqlFile" }] },
            { filename: DOMAIN, code: "import { sql } from \"../database\"\nexport const text = sql", errors: [{ messageId: "sqlTagImport" }] },
            { filename: DATABASE, code: "import { ident as identifier } from \"../database\"\nexport const name = identifier", errors: [{ messageId: "sqlTagImport" }] },
            { filename: BUILDER, code: "import type { SqlText, SqlIdent } from \"../database\"\nexport type Pair = [SqlText, SqlIdent]", errors: [{ messageId: "sqlTagImport" }, { messageId: "sqlTagImport" }] },
        ],
    })
})

test("no-raw-sql: the test world keeps raw SQL for probes; plain CRUD and listed function calls go through entities and callDbFunction", () => {
    tester.run("no-raw-sql", noRawSql, {
        valid: [
            { filename: SPEC, code: "declare const world: { db: { primary: { find(entity: unknown, options: unknown): Promise<unknown> } } }; declare class OrderEntity {}\nexport const list = () => world.db.primary.find(OrderEntity, { take: 5 })" },
            { filename: WORLD, code: "declare const manager: { query(text: string, params: unknown[]): Promise<unknown> }\nexport const ordersVisibleTo = (ownerId: string) => manager.query(\"select count(*) from orders where owner_id = $1\", [ownerId])" },
            { filename: WORLD, code: `${TAG_TYPE}export const QUEUE_DEPTH = sql\`select count(*) from pgmq.q_orders\`` },
            { filename: WORLD, code: `${TAG_TYPE}export const CAN_SELECT = sql\`SELECT has_table_privilege($1, $2, 'SELECT')\`` },
            { filename: WORLD, code: `${TAG_TYPE}export const LOCK = sql\`LOCK TABLE public.orders IN ACCESS EXCLUSIVE MODE\`` },
            { filename: WORLD, code: `${TAG_TYPE}export const BURY = sql\`UPDATE pgmq.q_orders SET vt = now() WHERE msg_id = $1\`` },
            { filename: WORLD, code: `${TAG_TYPE}export const SECRET = sql\`SELECT secret FROM public.job_claim_log WHERE id = $1\`` },
            { filename: WORLD_SQL_FILE, code: `${TAG_TYPE}export const POLICIES = sql\`SELECT policyname FROM pg_policies WHERE tablename = $1\`` },
            { filename: SPEC, code: `${CALL_TYPE.replace("em: unknown", "world: { db: { primary: unknown } }")}export const run = () => callDbFunction(world.db.primary, "gen_random_uuid", [])` },
            { filename: SPEC, code: `${CALL_TYPE}export const run = () => callDbFunction(em, "public.job_claim", ["mail"])` },
        ],
        invalid: [
            { filename: SPEC, code: "declare const world: { db: { primary: { query(text: string): Promise<unknown> } } }\nexport const seed = () => world.db.primary.query(\"insert into orders (id) values (1)\")", errors: [{ messageId: "query" }] },
            { filename: BUILDER, code: `${TAG_TYPE}export const SEED = sql\`insert into orders (id) values (1)\``, errors: [{ messageId: "template" }] },
            { filename: SPEC, code: `${CALL_TYPE.replace("em: unknown", "world: { db: { primary: unknown } }")}export const run = () => callDbFunction(world.db.primary, "public.drop_everything", [])`, errors: [{ messageId: "unlisted" }] },
            { filename: WORLD, code: `${TAG_TYPE}export const CALL = sql\`SELECT public.job_claim($1, $2)\``, errors: [{ messageId: "worldCallHelper" }] },
            { filename: WORLD, code: `${TAG_TYPE}export const CALL = sql\`select * from pg_notify($1, $2) as sent;\``, errors: [{ messageId: "worldCallHelper" }] },
            { filename: WORLD_SQL_FILE, code: `${TAG_TYPE}export const CALL = sql\`SELECT to_regproc($1)\``, errors: [{ messageId: "worldCallHelper" }] },
            { filename: WORLD, code: `${TAG_TYPE}export const WRITE = sql\`INSERT INTO public.orders (id) VALUES ($1)\``, errors: [{ messageId: "worldTableWrite" }] },
            { filename: WORLD, code: `${TAG_TYPE}export const WRITE = sql\`update be_access.members set role = $1\``, errors: [{ messageId: "worldTableWrite" }] },
            { filename: WORLD_SQL_FILE, code: `${TAG_TYPE}export const WRITE = sql\`DELETE FROM public.orders WHERE id = $1\``, errors: [{ messageId: "worldTableWrite" }] },
        ],
    })
})
