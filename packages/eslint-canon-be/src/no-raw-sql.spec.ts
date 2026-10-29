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
