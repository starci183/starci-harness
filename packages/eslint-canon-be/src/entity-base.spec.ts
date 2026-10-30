/**
 * Twin tests for the entity-base law (R342 `BE_ENTITY_EXTENDS_BASE`, BE-PERSISTENCE-3): an entity inherits created_at, updated_at and
 * the generated uuid id from AbstractEntity / UuidAbstractEntity and never repeats them. The @starci/hfs entity template and the
 * skeleton note entity (an app-set timestamp) pass; the base file itself is exempt.
 *
 *   node --test src/entity-base.spec.ts
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import tsParser from "@typescript-eslint/parser"
import { canonRuleTester } from "../fixtures/rule-tester.ts"
import { appDeclaration } from "../fixtures/app.ts"
import { at, BE_DECLARATION, TYPED_ROOT } from "../fixtures/typed/tester.ts"
import { hfsFromDeclaration } from "./lib/hfs.ts"
import { entityExtendsBase, rules } from "./entity-base.ts"

const testerFor = (edition: "lite" | "full") => canonRuleTester({
    languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module" },
    settings: { starci: { hfs: hfsFromDeclaration({ ...appDeclaration("be", BE_DECLARATION), edition }, TYPED_ROOT) } },
})
const lite = testerFor("lite")
const full = testerFor("full")

const ENTITY = at("src/modules/domain/order/persistence/entities/order.entity.ts")
const BASE = at("src/modules/platform/database/abstract.entity.ts")
const HEAD = "import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from \"typeorm\"\nimport { AbstractEntity, UuidAbstractEntity } from \"@modules/platform/database\"\n"
const entity = (body: string, extendsClause = "") => `${HEAD}@Entity({ schema: "public", name: "orders" })\nexport class OrderEntity${extendsClause} {\n${body}\n}\n`

const ID = "    @PrimaryGeneratedColumn(\"uuid\", { name: \"id\" })\n    id!: string\n"
const CREATED = "    @Column({ name: \"created_at\", type: \"timestamptz\", insert: false, update: false })\n    createdAt!: Date\n"
const UPDATED = "    @Column({ name: \"updated_at\", type: \"timestamptz\", insert: false, update: false })\n    updatedAt!: Date\n"
const OWNER = "    @Column({ name: \"owner_id\", type: \"uuid\" })\n    ownerId!: string\n"

const TABLE_TEMPLATE = new URL("../../hfs/templates/be/table/entity.ts.tpl", import.meta.url)
const NOTE_ENTITY = new URL("../../hfs/templates/be/skeleton/src/modules/domain/note/persistence/entities/note.entity.ts", import.meta.url)
const BASE_TEMPLATE = new URL("../../hfs/templates/be/skeleton/src/modules/platform/database/abstract.entity.ts", import.meta.url)

test("the law publishes its rule under its name", () => {
    assert.equal(rules["entity-extends-base"], entityExtendsBase)
})

for (const [edition, tester] of [["lite", lite], ["full", full]] as const) {
    test(`entity-extends-base (${edition}): an entity inherits the columns every table shares`, () => {
        tester.run("entity-extends-base", entityExtendsBase, {
            valid: [
                { filename: ENTITY, code: entity(OWNER, " extends UuidAbstractEntity") },
                { filename: ENTITY, code: entity(`${ID}${OWNER}`, " extends AbstractEntity") },
                { filename: ENTITY, code: readFileSync(TABLE_TEMPLATE, "utf8").replaceAll("{{table}}", "orders").replaceAll("{{Singular}}", "Order") },
                // an app-set timestamp is the "table without them" of the ruling
                { filename: ENTITY, code: readFileSync(NOTE_ENTITY, "utf8") },
                { filename: ENTITY, code: entity("    @Column({ name: \"created_at\", type: \"timestamptz\" })\n    createdAt!: Date\n    @Column({ name: \"updated_at\", type: \"timestamptz\" })\n    updatedAt!: Date") },
                // a bigint key and no updated_at: a table without the shared columns
                { filename: ENTITY, code: entity("    @PrimaryGeneratedColumn(\"increment\", { type: \"bigint\", name: \"id\" })\n    id!: string") },
                // a column that merely resembles one
                { filename: ENTITY, code: entity("    @Column({ name: \"deleted_at\", type: \"timestamptz\", insert: false })\n    deletedAt!: Date | null") },
                // no @Entity: not a table
                { filename: ENTITY, code: `${HEAD}export abstract class Plain {\n${CREATED}${UPDATED}}\n` },
                // the base file declares the columns once
                { filename: BASE, code: readFileSync(BASE_TEMPLATE, "utf8").replace("export abstract class AbstractEntity", "@Entity()\nexport abstract class AbstractEntity") },
            ],
            invalid: [
                { filename: ENTITY, code: entity(`${CREATED}${UPDATED}`), errors: [{ messageId: "timestamp", data: { entity: "OrderEntity", column: "created_at", base: "AbstractEntity" } }, { messageId: "timestamp", data: { entity: "OrderEntity", column: "updated_at", base: "AbstractEntity" } }] },
                { filename: ENTITY, code: entity(`${ID}${CREATED}${UPDATED}${OWNER}`), errors: [{ messageId: "key" }, { messageId: "timestamp", data: { entity: "OrderEntity", column: "created_at", base: "UuidAbstractEntity" } }, { messageId: "timestamp", data: { entity: "OrderEntity", column: "updated_at", base: "UuidAbstractEntity" } }] },
                { filename: ENTITY, code: entity(`${OWNER}${CREATED}`, " extends UuidAbstractEntity"), errors: [{ messageId: "timestamp", data: { entity: "OrderEntity", column: "created_at", base: "AbstractEntity" } }] },
                { filename: ENTITY, code: entity("    @CreateDateColumn({ name: \"created_at\", type: \"timestamptz\" })\n    createdAt!: Date"), errors: [{ messageId: "timestamp" }] },
                { filename: ENTITY, code: entity("    @UpdateDateColumn()\n    updatedAt!: Date"), errors: [{ messageId: "timestamp", data: { entity: "OrderEntity", column: "updated_at", base: "AbstractEntity" } }] },
                { filename: ENTITY, code: entity("    @Column({ type: \"timestamptz\", default: () => \"now()\" })\n    createdAt!: Date"), errors: [{ messageId: "timestamp" }] },
                { filename: ENTITY, code: entity("    @Column({ name: \"updated_at\", type: \"timestamptz\", update: false })\n    modified!: Date"), errors: [{ messageId: "timestamp" }] },
                { filename: ENTITY, code: entity(`    @PrimaryGeneratedColumn("uuid")\n    id!: string\n${CREATED}${UPDATED}`), errors: [{ messageId: "key" }, { messageId: "timestamp" }, { messageId: "timestamp" }] },
            ],
        })
    })
}
