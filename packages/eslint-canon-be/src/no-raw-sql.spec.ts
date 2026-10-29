/**
 * Twin tests for the lite persistence law (R334 `BE_PERSISTENCE_NO_RAW_SQL`).
 *
 *   node --test src/no-raw-sql.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import tsParser from "@typescript-eslint/parser"
import { canonRuleTester } from "../fixtures/rule-tester.mjs"
import { at, fixtureHfs } from "../fixtures/typed/tester.mjs"
import { noRawSql, rules } from "./no-raw-sql.ts"

const tester = canonRuleTester({
    languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module" },
    settings: { starci: { hfs: fixtureHfs() } },
})

const DOMAIN = at("src/modules/domain/order/order.service.ts")
const FEATURE = at("src/features/api/orders/application/list-orders.handler.ts")
const DATABASE = at("src/modules/platform/database/migration-runner.service.ts")
const SPEC = at("src/tests/integration/order/order.integration-spec.ts")
const BUILDER = at("src/tests/fixtures/builders/order.builder.ts")
const WORLD = at("src/tests/world/row-security.client.ts")

test("the law publishes its rule under its name", () => {
    assert.equal(rules["no-raw-sql"], noRawSql)
})

test("no-raw-sql: entities on the EntityManager carry domain reads and writes; raw SQL stays in platform/database", () => {
    tester.run("no-raw-sql", noRawSql, {
        valid: [
            { filename: DOMAIN, code: "declare const em: { find(entity: unknown, options: unknown): Promise<unknown> }; declare class OrderEntity {}\nexport const list = () => em.find(OrderEntity, { take: 50 })" },
            { filename: DOMAIN, code: "declare const em: { createQueryBuilder(entity: unknown, alias: string): { where(text: string, params: unknown): unknown } }; declare class OrderEntity {}\nexport const q = () => em.createQueryBuilder(OrderEntity, \"o\").where(\"o.id = :id\", { id: 1 })" },
            { filename: DATABASE, code: "declare const em: { query(text: string): Promise<unknown> }\nexport const run = () => em.query(\"select 1\")" },
            { filename: DATABASE, code: "declare const sql: (parts: TemplateStringsArray) => string\nexport const text = sql`select 1`" },
            { filename: DOMAIN, code: "declare const callDbFunction: (manager: unknown, name: string, args: unknown[]) => Promise<unknown>; declare const em: unknown\nexport const run = () => callDbFunction(em, \"pg_notify\", [\"jobs\", \"{}\"])" },
        ],
        invalid: [
            { filename: DOMAIN, code: "declare const em: { createQueryBuilder(table: string, alias: string): unknown }\nexport const q = () => em.createQueryBuilder(\"orders\", \"o\")", errors: [{ messageId: "builder" }] },
            { filename: DOMAIN, code: "declare const em: { createQueryBuilder(): unknown }\nexport const q = () => em.createQueryBuilder()", errors: [{ messageId: "builder" }] },
            { filename: FEATURE, code: "declare const em: { getRepository(entity: unknown): unknown }; declare class OrderEntity {}\nexport const r = () => em.getRepository(OrderEntity)", errors: [{ messageId: "builder" }] },
            { filename: DOMAIN, code: "declare const callDbFunction: (manager: unknown, name: string, args: unknown[]) => Promise<unknown>; declare const em: unknown\nexport const run = () => callDbFunction(em, \"drop_everything\", [])", errors: [{ messageId: "unlisted" }] },
            { filename: DOMAIN, code: "declare const em: { query(text: string): Promise<unknown> }\nexport const run = () => em.query(\"select * from orders\")", errors: [{ messageId: "query" }] },
            { filename: FEATURE, code: "declare const sql: (parts: TemplateStringsArray) => string\nexport const text = sql`select * from orders`", errors: [{ messageId: "template" }] },
        ],
    })
})

test("no-raw-sql: test code reads and writes through entities on world.db; only the test world holds raw SQL", () => {
    tester.run("no-raw-sql", noRawSql, {
        valid: [
            { filename: SPEC, code: "declare const world: { db: { primary: { find(entity: unknown, options: unknown): Promise<unknown> } } }; declare class OrderEntity {}\nexport const list = () => world.db.primary.find(OrderEntity, { take: 5 })" },
            { filename: WORLD, code: "declare const manager: { query(text: string, params: unknown[]): Promise<unknown> }\nexport const ordersVisibleTo = (ownerId: string) => manager.query(\"select count(*) from orders where owner_id = $1\", [ownerId])" },
            { filename: WORLD, code: "declare const sql: (parts: TemplateStringsArray) => string\nexport const QUEUE_DEPTH = sql`select count(*) from pgmq.q_orders`" },
            { filename: SPEC, code: "declare const callDbFunction: (manager: unknown, name: string, args: unknown[]) => Promise<unknown>; declare const world: { db: { primary: unknown } }\nexport const run = () => callDbFunction(world.db.primary, \"gen_random_uuid\", [])" },
        ],
        invalid: [
            { filename: SPEC, code: "declare const world: { db: { primary: { query(text: string): Promise<unknown> } } }\nexport const seed = () => world.db.primary.query(\"insert into orders (id) values (1)\")", errors: [{ messageId: "query" }] },
            { filename: BUILDER, code: "declare const sql: (parts: TemplateStringsArray) => string\nexport const SEED = sql`insert into orders (id) values (1)`", errors: [{ messageId: "template" }] },
            { filename: SPEC, code: "declare const callDbFunction: (manager: unknown, name: string, args: unknown[]) => Promise<unknown>; declare const world: { db: { primary: unknown } }\nexport const run = () => callDbFunction(world.db.primary, \"public.drop_everything\", [])", errors: [{ messageId: "unlisted" }] },
        ],
    })
})
