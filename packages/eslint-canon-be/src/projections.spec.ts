/**
 * Twin tests for the projection laws (R161 `BE_PROJECTION_WRITE_OWNER`, R162 `BE_PROJECTION_SHAPE`).
 *
 *   node --test src/projections.spec.ts
 *
 * The fixture project declares the user-score projection (`projections/user-score`) with its entity and class; a case's path decides its
 * slot, tier and kind.
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, BE_DECLARATION, typedTester } from "../fixtures/typed/tester.ts"
import { projectionShape, projectionWriteOwner, rules } from "./projections.ts"

const tester = typedTester({ declaration: { ...BE_DECLARATION, patterns: ["projection", "event-bus", "fenced-job"] } })

const PROJECTION = at("src/modules/projections/user-score/scratch.projection.ts")
const PROJECTION_INDEX = at("src/modules/projections/scratch/index.ts")
const CONTRACTS = at("src/modules/projections/user-score/user-score.contracts.ts")
const OTHER_PROJECTION = at("src/modules/projections/other/other.projection.ts")
const DOMAIN = at("src/modules/domain/order/placing.service.ts")
const API_HANDLER = at("src/features/api/checkout/application/show-score.handler.ts")
const REACTOR = at("src/features/reactors/stock/stock.consumer.ts")
const JOB = at("src/features/jobs/send/send.processor.ts")
const WORLD = at("src/tests/world/use-test-world.ts")

test("every rule this law declares is exported under its published name", () => {
    for (const [name, rule] of Object.entries(rules)) assert.ok(rule && rule.meta && rule.create, `${name} is not a rule`)
})

const ENTITY = `import type { EntityManager } from "typeorm"
import { UserScoreProjectionEntity } from "@modules/projections/user-score/user-score.projection-entity"
`

test("projection-write-owner: a read-model table is written only by its own projection", () => {
    assert.doesNotThrow(() => {
        tester.run("projection-write-owner", projectionWriteOwner, {
            valid: [
                { filename: PROJECTION, code: `${ENTITY}export const recompute = (manager: EntityManager) => manager.update(UserScoreProjectionEntity, { userId: "a" }, { total: 1 })` },
                { filename: PROJECTION, code: `${ENTITY}export const wipe = (manager: EntityManager) => manager.delete(UserScoreProjectionEntity, {})` },
                { filename: PROJECTION, code: `${ENTITY}export const read = (manager: EntityManager) => manager.find(UserScoreProjectionEntity, {})` },
                { filename: DOMAIN, code: `${ENTITY}export const read = (manager: EntityManager) => manager.find(UserScoreProjectionEntity, {})` },
                { filename: DOMAIN, code: `import type { EntityManager } from "typeorm"\nimport { OrderEntity } from "./persistence/entities/order.entity"\nexport const w = (manager: EntityManager) => manager.update(OrderEntity, { id: "a" }, { status: "x" })` },
                { filename: WORLD, code: `${ENTITY}export const seed = (manager: EntityManager, row: UserScoreProjectionEntity) => manager.save(row)` },
            ],
            invalid: [
                { filename: DOMAIN, code: `${ENTITY}export const w = (manager: EntityManager) => manager.update(UserScoreProjectionEntity, { userId: "a" }, { total: 9 })`, errors: [{ messageId: "foreign" }] },
                { filename: API_HANDLER, code: `${ENTITY}export const w = (manager: EntityManager, row: UserScoreProjectionEntity) => manager.save(row)`, errors: [{ messageId: "foreign" }] },
                { filename: OTHER_PROJECTION, code: `${ENTITY}export const w = (manager: EntityManager) => manager.increment(UserScoreProjectionEntity, { userId: "a" }, "total", 1)`, errors: [{ messageId: "foreign" }] },
                { filename: CONTRACTS, code: `${ENTITY}export const w = (manager: EntityManager) => manager.delete(UserScoreProjectionEntity, {})`, errors: [{ messageId: "foreign" }] },
                { filename: DOMAIN, code: `${ENTITY}export const w = (manager: EntityManager) => manager.createQueryBuilder().update(UserScoreProjectionEntity).set({ total: 1 }).execute()`, errors: [{ messageId: "foreign" }] },
            ],
        })
    })
})

const PROJECTION_HEAD = `import { UserScoreProjectionEntity } from "./user-score.projection-entity"\n`

test("projection-shape: recompute and get only, the entity stays inside, and the api never recomputes", () => {
    assert.doesNotThrow(() => {
        tester.run("projection-shape", projectionShape, {
            valid: [
                { filename: PROJECTION, code: `${PROJECTION_HEAD}export class UserScoreProjection {\n async recomputeUserScore(): Promise<void> {}\n async getUserScore(): Promise<number> { return 0 }\n private tidy(): void { void UserScoreProjectionEntity }\n}` },
                { filename: PROJECTION, code: `export class UserScoreProjection { constructor(private readonly n: number) {}\n async recompute(): Promise<void> {}\n async get(): Promise<number> { return this.n } }` },
                { filename: PROJECTION_INDEX, code: `export { UserScoreProjection } from "./user-score.projection"` },
                { filename: API_HANDLER, code: `import type { UserScoreProjection } from "@modules/projections/user-score"\nexport const show = (projection: UserScoreProjection) => projection.getUserScore("a")` },
                { filename: REACTOR, code: `import type { UserScoreProjection } from "@modules/projections/user-score"\nexport const react = (projection: UserScoreProjection) => projection.recomputeUserScore("a", 1)` },
                { filename: JOB, code: `import type { UserScoreProjection } from "@modules/projections/user-score"\nexport const rebuild = (projection: UserScoreProjection) => projection.recomputeUserScore("a", 1)` },
            ],
            invalid: [
                { filename: PROJECTION, code: `export class UserScoreProjection {\n async rebuildEverything(): Promise<void> {}\n}`, errors: [{ messageId: "vocabulary" }] },
                { filename: PROJECTION, code: `export class UserScoreProjection {\n async recomputeUserScore(): Promise<void> {}\n async set(): Promise<void> {}\n}`, errors: [{ messageId: "vocabulary" }] },
                { filename: PROJECTION_INDEX, code: `export { UserScoreProjection } from "./user-score.projection"\nexport { UserScoreProjectionEntity } from "./user-score.projection-entity"`, errors: [{ messageId: "entityExported" }] },
                { filename: API_HANDLER, code: `import type { UserScoreProjection } from "@modules/projections/user-score"\nexport const show = (projection: UserScoreProjection) => projection.recomputeUserScore("a", 1)`, errors: [{ messageId: "apiRecompute" }] },
            ],
        })
    })
})
