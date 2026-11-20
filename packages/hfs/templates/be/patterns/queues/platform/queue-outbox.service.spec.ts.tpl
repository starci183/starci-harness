import { Test } from "@nestjs/testing"
import { FakeClock, fakeTransaction, mockEntityManager } from "@starci/jest-preset"
import { CLOCK } from "@modules/platform/clock"
import { QueueOutboxService } from "./queue-outbox.service"

// The statement callDbFunction of platform/database sends for queue_write.
const INSERT_QUEUE_ROW = 'SELECT * FROM "public"."queue_write"($1, $2, $3, $4)'
import { QueueErrorCode } from "./errors/queue.error"

const AT = "2026-02-03T04:05:06.000Z"

const build = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [QueueOutboxService, { provide: CLOCK, useValue: new FakeClock(AT) }],
    }).compile()
    return { outbox: moduleRef.get(QueueOutboxService) }
}

describe("QueueOutboxService", () => {
    describe("write", () => {
        it("writes the job as a row of the outbox of the transaction it is given", async () => {
            const { outbox } = await build()
            const tx = fakeTransaction(mockEntityManager({ query: [INSERT_QUEUE_ROW, []] }))

            await tx.em.transaction((manager) => outbox.write(manager, "mail", { id: "m-1" }, "request-1"))

            expect(tx.em.query).toHaveBeenCalledWith(INSERT_QUEUE_ROW, [
                "mail",
                JSON.stringify({ id: "m-1" }),
                new Date(AT),
                "request-1",
            ])
            expect(tx.commits).toBe(1)
        })

        it("leaves no row behind when the transaction rolls back", async () => {
            const { outbox } = await build()
            const tx = fakeTransaction(mockEntityManager({ query: [INSERT_QUEUE_ROW, []] }))
            const failure = new Error("the change failed")

            await expect(
                tx.em.transaction(async (manager) => {
                    await outbox.write(manager, "mail", { id: "m-1" }, "request-1")
                    return Promise.reject(failure)
                }),
            ).rejects.toBe(failure)

            expect(tx.rollbacks).toBe(1)
            expect(tx.committedWrites).toEqual([])
        })

        it("rejects an unsafe correlation id before writing any SQL", async () => {
            const { outbox } = await build()
            const tx = fakeTransaction(mockEntityManager())
            await expect(
                tx.em.transaction((manager) => outbox.write(manager, "mail", {}, "bad\nid")),
            ).rejects.toMatchObject({ code: QueueErrorCode.CorrelationInvalid })
            expect(tx.em.query).not.toHaveBeenCalled()
            expect(tx.rollbacks).toBe(1)
        })
    })
})
