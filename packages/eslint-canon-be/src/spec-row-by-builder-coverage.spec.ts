// proves: BE_TEST_ROW_BY_BUILDER@lite
// proves: BE_TEST_ROW_BY_BUILDER@full
import assert from "node:assert/strict"
import test from "node:test"
import { specNoRawInsert, specNoRepeatedRowLiteral } from "./builders.ts"
import { appDeclaration } from "../fixtures/app.ts"
import { BE_DECLARATION, TYPED_ROOT, at, ruleTester } from "../fixtures/typed/tester.ts"
import { hfsFromDeclaration } from "./lib/hfs.ts"

const UNIT = at("src/modules/domain/order/order.service.spec.ts")
const INTEGRATION = at("src/tests/integration/order/order.integration-spec.ts")
const DB_IMPORT = "import { EntityManager, DataSource, QueryRunner } from 'typeorm'\n"
const ENTITY = `import { Entity } from "typeorm"
@Entity()
class Order { id!: number; status!: string }
class Plain { id!: number }
`

const genuineBuilderOverrides = [
    {
        filename: UNIT,
        code: `${ENTITY}import { builder } from "@starci/jest-preset"
const orderOf = builder<Order>({ id: 0, status: "default" })
orderOf({ id: 1 }); orderOf({ id: 2 })`,
    },
    {
        filename: UNIT,
        code: `${ENTITY}import { builder as createBuilder } from "@starci/jest-preset"
const factory = createBuilder
const factoryAlias = factory
const orderOf = factoryAlias<Order>({ id: 0, status: "default" })
const builtAlias = orderOf
const immutableAlias = builtAlias
immutableAlias({ id: 1 }); immutableAlias({ id: 2 })`,
    },
    {
        filename: INTEGRATION,
        code: `${ENTITY}import * as kit from "@starci/jest-preset"
const orderOf = kit.builder<Order>({ id: 0, status: "default" })
orderOf({ id: 1 }); orderOf({ id: 2 })`,
    },
    {
        filename: UNIT,
        code: `import { orderOf } from "@tests/fixtures/builders/shared-order.builder"
const localOrderOf = orderOf
localOrderOf({ id: "first" }); localOrderOf({ id: "second" })`,
    },
    {
        filename: INTEGRATION,
        code: `import { reexportedOrderOf as importedOrderOf } from "@tests/fixtures/builders/shared-order-export.builder"
const firstAlias = importedOrderOf
const secondAlias = firstAlias
secondAlias({ id: "first" }); secondAlias({ id: "second" })`,
    },
]

const unprovenBuilderOverrides = [
    {
        filename: UNIT,
        code: `${ENTITY}function builder<T extends object>(defaults: T) {
    return (overrides: Partial<T> = {}): T => Object.assign({}, defaults, overrides)
}
const orderOf = builder<Order>({ id: 0, status: "default" })
orderOf({ id: 1 }); orderOf({ id: 2 })`,
        errors: [{ messageId: "repeated" }, { messageId: "repeated" }],
    },
    {
        filename: UNIT,
        code: `${ENTITY}import { builder as kitBuilder } from "@starci/jest-preset"
function pretendFactory(): ReturnType<typeof kitBuilder<Order>> {
    return (overrides = {}) => Object.assign(new Order(), overrides)
}
const orderOf = pretendFactory()
orderOf({ id: 1 }); orderOf({ id: 2 })`,
        errors: [{ messageId: "repeated" }],
    },
    {
        filename: UNIT,
        code: `${ENTITY}import { builder } from "@starci/jest-preset"
let factory = builder
const orderOf = factory<Order>({ id: 0, status: "default" })
orderOf({ id: 1 }); orderOf({ id: 2 })`,
        errors: [{ messageId: "repeated" }, { messageId: "repeated" }],
    },
    {
        filename: UNIT,
        code: `${ENTITY}import { builder } from "@starci/jest-preset"
const orderOf = builder<Order>({ id: 0, status: "default" })
let mutableAlias = orderOf
mutableAlias({ id: 1 }); mutableAlias({ id: 2 })`,
        errors: [{ messageId: "repeated" }, { messageId: "repeated" }],
    },
    {
        filename: UNIT,
        code: `${ENTITY}import { builder } from "@starci/jest-preset"
const orderOf = builder<Order>({ id: 0, status: "default" })
let mutableAlias = orderOf
const immutableAlias = mutableAlias
immutableAlias({ id: 1 }); immutableAlias({ id: 2 })`,
        errors: [{ messageId: "repeated" }, { messageId: "repeated" }],
    },
    {
        filename: INTEGRATION,
        code: `${ENTITY}import { builder } from "@spoof/jest-preset"
const orderOf = builder<Order>({ id: 0, status: "default" })
orderOf({ id: 1 }); orderOf({ id: 2 })`,
        errors: [{ messageId: "repeated" }, { messageId: "repeated" }],
    },
    {
        filename: UNIT,
        code: `${ENTITY}import { builder } from "@starci/jest-preset"
@Entity()
class Envelope { id!: number; order!: Order }
const envelopeOf = builder<Envelope>({ id: 0, order: new Order() })
envelopeOf({ order: { id: 1, status: "first" } })
envelopeOf({ order: { id: 2, status: "second" } })`,
        errors: [{ messageId: "repeated" }],
    },
    {
        filename: UNIT,
        code: `${ENTITY}import { builder } from "@starci/jest-preset"
const firstOf = builder<Order>({ id: 1, status: "first" })
const secondOf = builder<Order>({ id: 2, status: "second" })`,
        errors: [{ messageId: "repeated" }],
    },
    {
        filename: UNIT,
        code: `${ENTITY}import { builder } from "@starci/jest-preset"
const orderOf = builder<Order>({ id: 0, status: "default" })
const first: Partial<Order> = { id: 1 }
const second: Partial<Order> = { id: 2 }
orderOf(first); orderOf(second)`,
        errors: [{ messageId: "repeated" }, { messageId: "repeated" }],
    },
]

for (const edition of ["lite", "full"]) {
    test(`R99 proves the immutable kit factory behind direct overrides in ${edition}`, () => {
        const hfs = hfsFromDeclaration({ ...appDeclaration("be", BE_DECLARATION), edition }, TYPED_ROOT)
        assert.equal(hfs.edition, edition)
        ruleTester({ root: TYPED_ROOT, hfs }).run("spec-no-repeated-row-literal", specNoRepeatedRowLiteral, {
            valid: genuineBuilderOverrides,
            invalid: unprovenBuilderOverrides,
        })
    })

    test(`R99 accepts builder calls and reads and rejects direct database writes in ${edition}`, () => {
        const hfs = hfsFromDeclaration({ ...appDeclaration("be", BE_DECLARATION), edition }, TYPED_ROOT)
        assert.equal(hfs.edition, edition)
        ruleTester({ root: TYPED_ROOT, hfs }).run("spec-no-raw-insert", specNoRawInsert, {
            valid: [
                { filename: INTEGRATION, code: `${DB_IMPORT}declare const db: EntityManager\ndeclare const orderBuilder: (manager: EntityManager) => { build(): Promise<object> }\nasync function arrange() { await orderBuilder(db).build(); await db.query("SELECT * FROM orders") }` },
                { filename: UNIT, code: "declare const cache: { save(value: number): void }\ncache.save(1)" },
            ],
            invalid: [
                { filename: UNIT, code: `${DB_IMPORT}declare const db: EntityManager\ndb.save({ id: 1 })`, errors: [{ messageId: "write" }] },
                { filename: INTEGRATION, code: `${DB_IMPORT}declare const db: EntityManager\nclass Order {}\ndb.insert(Order, {}); db.upsert(Order, {}, ["id"]); db.update(Order, {}, {}); db.delete(Order, {}); db.remove({ id: 1 })`, errors: [{ messageId: "write" }, { messageId: "write" }, { messageId: "write" }, { messageId: "write" }, { messageId: "write" }] },
                { filename: INTEGRATION, code: `${DB_IMPORT}declare const source: DataSource\nsource.manager.save({ id: 1 })`, errors: [{ messageId: "write" }] },
                { filename: INTEGRATION, code: `${DB_IMPORT}declare const runner: QueryRunner\nrunner.query("INSERT INTO orders (id) VALUES (1)"); runner.query("UPDATE orders SET status = 'paid'"); runner.query("DELETE FROM orders")`, errors: [{ messageId: "sql" }, { messageId: "sql" }, { messageId: "sql" }] },
            ],
        })
    })

    test(`R99 accepts builder-derived rows and rejects repeated entity literals in ${edition}`, () => {
        const hfs = hfsFromDeclaration({ ...appDeclaration("be", BE_DECLARATION), edition }, TYPED_ROOT)
        assert.equal(hfs.edition, edition)
        ruleTester({ root: TYPED_ROOT, hfs }).run("spec-no-repeated-row-literal", specNoRepeatedRowLiteral, {
            valid: [
                { filename: INTEGRATION, code: `${ENTITY}declare const orderRow: () => Order\nconst first: Order = { ...orderRow(), status: "new" }\nconst second: Order = { ...orderRow(), status: "paid" }\nexport { first, second }` },
                { filename: UNIT, code: `${ENTITY}const first: Order = { id: 1, status: "new" }\nexport { first }` },
                { filename: UNIT, code: `${ENTITY}const first: Plain = { id: 1 }\nconst second: Plain = { id: 2 }\nexport { first, second }` },
                // Query contracts mention an entity but describe selectors, not arranged rows.
                { filename: INTEGRATION, code: `${ENTITY}${DB_IMPORT}declare const db: EntityManager\nasync function read() { await db.count(Order, { where: { id: 1 } }); await db.count(Order, { where: { id: 2 } }); await db.findOne(Order, { where: { id: 1 } }); await db.find(Order, { where: [{ id: 1 }, { id: 2 }], order: { id: "ASC" } }); await db.findBy(Order, { id: 2 }) }` },
                { filename: UNIT, code: `${ENTITY}import type { FindOptionsWhere as Where, FindManyOptions } from "typeorm"\ntype Selector<T> = Where<T>\nconst a: Selector<Order> = { id: 1 }\nconst b: Selector<Order> = { id: 2 }\nconst c: FindManyOptions<Order> = { where: { id: 3 } }\nexport { a, b, c }` },
            ],
            invalid: [
                { filename: INTEGRATION, code: `${ENTITY}const first: Order = { id: 1, status: "new" }\nconst second: Order = { id: 2, status: "paid" }\nexport { first, second }`, errors: [{ messageId: "repeated" }] },
                { filename: UNIT, code: `${ENTITY}declare const arrange: (row: Partial<Order>) => void\narrange({ id: 1 })\narrange({ id: 2 })`, errors: [{ messageId: "repeated" }] },
                // A local row alias with the same spelling as an ORM selector gains no exemption.
                { filename: UNIT, code: `${ENTITY}type FindOptionsWhere<T> = Partial<T>\ndeclare const arrange: (row: FindOptionsWhere<Order>) => void\narrange({ id: 1 })\narrange({ id: 2 })`, errors: [{ messageId: "repeated" }] },
            ],
        })
    })
}
