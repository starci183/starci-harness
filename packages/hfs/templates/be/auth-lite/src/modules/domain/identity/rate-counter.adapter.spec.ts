// Managed by starci app sync (slot be.identity.sign-in); do not edit: run "npx starci app sync --execute".
import "reflect-metadata"
import { Test } from "@nestjs/testing"
import { LessThanOrEqual, MoreThan } from "typeorm"
import { FakeClock, mockEntityManager, queueQueryBuilders } from "@starci/jest-preset"
import type { MockEntityManager } from "@starci/jest-preset"
import { CLOCK } from "@modules/platform/clock"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { IdentityAttemptEntity } from "./persistence/entities"
import { IdentityRateCounterAdapter } from "./rate-counter.adapter"

const AT = "2026-02-03T04:05:06.000Z"
const NOW = new Date(AT)
const RESET_AT = new Date("2026-02-03T04:20:06.000Z")
const WINDOW_MS = 900_000

const build = async (entityManager: MockEntityManager) => {
    const moduleRef = await Test.createTestingModule({
        providers: [
            IdentityRateCounterAdapter,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: entityManager },
            { provide: CLOCK, useValue: new FakeClock(AT) },
        ],
    }).compile()
    return moduleRef.get(IdentityRateCounterAdapter)
}

describe("IdentityRateCounterAdapter.consume", () => {
    it("counts a hit in the live window and compares it with the limit", async () => {
        const entityManager = mockEntityManager()
        const [counting] = queueQueryBuilders(entityManager, [{ execute: { raw: [{ hits: 3 }] } }, { execute: { raw: [{ hits: 4 }] } }])
        const subject = await build(entityManager)

        expect(await subject.consume("login:abc", WINDOW_MS, 3)).toBe(true)
        expect(await subject.consume("login:abc", WINDOW_MS, 3)).toBe(false)

        expect(counting?.callsOf("where")[0]).toEqual([{ key: "login:abc", resetAt: MoreThan(NOW) }])
    })

    it("restarts an ended window at one hit", async () => {
        const entityManager = mockEntityManager({ update: [IdentityAttemptEntity, { affected: 1 }] })
        queueQueryBuilders(entityManager, [{ execute: { raw: [] } }])
        const subject = await build(entityManager)

        expect(await subject.consume("login:abc", WINDOW_MS, 3)).toBe(true)

        expect(entityManager.update).toHaveBeenCalledWith(IdentityAttemptEntity, { key: "login:abc", resetAt: LessThanOrEqual(NOW) }, { hits: 1, resetAt: RESET_AT })
    })

    it("opens a missing window at one hit, and a limit of zero admits nobody", async () => {
        const entityManager = mockEntityManager({ update: [IdentityAttemptEntity, { affected: 0 }] })
        const [, inserting] = queueQueryBuilders(entityManager, [{ execute: { raw: [] } }, { execute: { raw: [] } }])
        const subject = await build(entityManager)

        expect(await subject.consume("login:abc", WINDOW_MS, 0)).toBe(false)

        expect(inserting?.callsOf("values")[0]).toEqual([{ key: "login:abc", hits: 1, resetAt: RESET_AT }])
    })
})

describe("IdentityRateCounterAdapter.clear", () => {
    it("forgets the window of a key", async () => {
        const entityManager = mockEntityManager({ delete: [IdentityAttemptEntity, {}] })
        const subject = await build(entityManager)

        await subject.clear("login:abc")

        expect(entityManager.delete).toHaveBeenCalledWith(IdentityAttemptEntity, { key: "login:abc" })
    })
})
