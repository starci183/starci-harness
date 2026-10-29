import { IdempotencyErrorCode } from "@modules/platform/idempotency"
import { Test } from "@nestjs/testing"
import type { ClientOperation } from "./inbox.port"
import { FakeClock, fakeTransaction, mockEntityManager, queueQueryBuilders } from "@starci/jest-preset"
import { BATCH_ROWS, DatabaseError, DatabaseErrorCode } from "@modules/platform/database"
import { CLOCK } from "@modules/platform/clock"
import { InboxError, InboxErrorCode } from "./errors/inbox.error"
import { requestFingerprint } from "./request-fingerprint.policy"
import { PostgresInbox } from "./inbox.service"

// The statements callDbFunction of platform/database sends for each inbox function.
const CLAIM_EVENT = 'SELECT * FROM "public"."inbox_claim_event"($1, $2)'
const CLAIM_CLIENT = 'SELECT * FROM "public"."inbox_claim_client"($1, $2, $3, $4)'
const SAVE_CLIENT_OUTCOME = 'SELECT * FROM "public"."inbox_save_client_outcome"($1, $2, $3)'
const SWEEP_CLIENTS = 'SELECT * FROM "public"."inbox_sweep_clients"($1, $2)'

const runClient = <T>(
    inbox: PostgresInbox,
    request: ClientOperation,
    manager: ReturnType<typeof mockEntityManager>,
    effect: () => Promise<T>,
): Promise<T> => fakeTransaction(manager).em.transaction((tx) => inbox.runClient(request, tx, effect))

const REQUEST = {
    principalId: "person-1",
    operation: "checkout.place",
    idempotencyKey: "key-1",
    request: { total: 2400 },
}
const OUTCOME = { kind: "ok", value: { orderId: "order-1" } }

/** A provider receipt entity as a capability maps its inbox table. */
class SpecReceiptEntity {
    id!: string
    provider!: string
    deliveryId!: string
}

const RECEIPT = { entity: SpecReceiptEntity, row: (deliveryId: string) => ({ provider: "spec", deliveryId }) }

const build = async () => {
    const module = await Test.createTestingModule({
        providers: [PostgresInbox, { provide: CLOCK, useValue: new FakeClock("2026-02-03T04:05:06.000Z") }],
    }).compile()
    return module.get(PostgresInbox)
}

describe("PostgresInbox delivery claims", () => {
    it("claims a normalized delivery id through the caller's transaction", async () => {
        const subject = await build()
        const transaction = fakeTransaction(mockEntityManager({ query: [CLAIM_EVENT, [{ event_id: "delivery-1" }]] }))

        const fresh = await transaction.em.transaction((manager) =>
            subject.claim("webhook:spec", "  delivery-1  ", manager),
        )

        expect(fresh).toBe(true)
        expect(transaction.em.query).toHaveBeenCalledWith(CLAIM_EVENT, ["webhook:spec", "delivery-1"])
        expect(transaction.commits).toBe(1)
    })

    it("returns false when the source and event id have already been claimed", async () => {
        const subject = await build()
        const manager = mockEntityManager({ query: [CLAIM_EVENT, []] })

        await expect(subject.claim("webhook:spec", "delivery-1", manager)).resolves.toBe(false)

        expect(manager.query).toHaveBeenCalledTimes(1)
    })
})

describe("PostgresInbox delivery rollback and validation", () => {
    it("rolls the claim back when later work in the receipt transaction fails", async () => {
        const subject = await build()
        const transaction = fakeTransaction(mockEntityManager({ query: [CLAIM_EVENT, [{ event_id: "delivery-1" }]] }))
        const failure = new DatabaseError({ code: DatabaseErrorCode.IdentifierRejected })

        await expect(
            transaction.em.transaction(async (manager) => {
                expect(await subject.claim("webhook:spec", "delivery-1", manager)).toBe(true)
                throw failure
            }),
        ).rejects.toBe(failure)

        expect(transaction.commits).toBe(0)
        expect(transaction.rollbacks).toBe(1)
        expect(transaction.committedWrites).toEqual([])
        expect(transaction.rolledBackWrites).toHaveLength(1)
    })

    it.each([
        ["no", undefined],
        ["a blank", "   "],
    ])("refuses %s delivery id before writing a claim", async (_label, eventId) => {
        const subject = await build()
        const manager = mockEntityManager()

        await expect(subject.claim("webhook:spec", eventId, manager)).rejects.toMatchObject({
            code: DatabaseErrorCode.WebhookDeliveryIdRequired,
        })

        expect(manager.query).not.toHaveBeenCalled()
    })
})

describe("PostgresInbox entity receipts", () => {
    it("claims the trimmed delivery id, then inserts the receipt row it keys in the caller's transaction and answers its id", async () => {
        const subject = await build()
        const manager = mockEntityManager({ query: [CLAIM_EVENT, [{ event_id: "delivery-1" }]] })
        const [insert] = queueQueryBuilders(manager, [{ execute: { raw: [{ id: "receipt-1" }] } }])

        await expect(subject.claimRow("webhook:spec", "  delivery-1  ", manager, RECEIPT)).resolves.toBe("receipt-1")

        expect(manager.query).toHaveBeenCalledWith(CLAIM_EVENT, ["webhook:spec", "delivery-1"])
        expect(manager.createQueryBuilder).toHaveBeenCalledWith(SpecReceiptEntity, "receipt")
        expect(insert?.callsOf("values")).toEqual([[{ provider: "spec", deliveryId: "delivery-1" }]])
        expect(insert?.callsOf("orIgnore")).toEqual([[]])
        expect(insert?.callsOf("returning")).toEqual([["id"]])
    })

    it("inserts no receipt for a delivery already claimed", async () => {
        const subject = await build()
        const manager = mockEntityManager({ query: [CLAIM_EVENT, []] })

        await expect(subject.claimRow("webhook:spec", "delivery-1", manager, RECEIPT)).resolves.toBeUndefined()

        expect(manager.createQueryBuilder).not.toHaveBeenCalled()
    })

    it("answers undefined when the receipt row already exists", async () => {
        const subject = await build()
        const manager = mockEntityManager({ query: [CLAIM_EVENT, [{ event_id: "delivery-1" }]] })
        queueQueryBuilders(manager, [{ execute: { raw: [] } }])

        await expect(subject.claimRow("webhook:spec", "delivery-1", manager, RECEIPT)).resolves.toBeUndefined()
    })

    it("refuses a returned receipt row without a text id", async () => {
        const subject = await build()
        const manager = mockEntityManager({ query: [CLAIM_EVENT, [{ event_id: "delivery-1" }]] })
        queueQueryBuilders(manager, [{ execute: { raw: [{ id: 7 }] } }])

        await expect(subject.claimRow("webhook:spec", "delivery-1", manager, RECEIPT)).rejects.toMatchObject({
            code: DatabaseErrorCode.ReturningRowRejected,
        })
    })

    it("refuses a missing delivery id before claiming or inserting", async () => {
        const subject = await build()
        const manager = mockEntityManager()

        await expect(subject.claimRow("webhook:spec", undefined, manager, RECEIPT)).rejects.toMatchObject({
            code: DatabaseErrorCode.WebhookDeliveryIdRequired,
        })

        expect(manager.query).not.toHaveBeenCalled()
        expect(manager.createQueryBuilder).not.toHaveBeenCalled()
    })
})

describe("PostgresInbox client transaction admission", () => {
    it("refuses a manager outside an active transaction before claiming or applying an effect", async () => {
        const inbox = await build()
        const manager = mockEntityManager()
        await expect(inbox.runClient(REQUEST, manager, () => Promise.resolve(OUTCOME))).rejects.toMatchObject({
            code: InboxErrorCode.TransactionRequired,
        })
        expect(manager.query).not.toHaveBeenCalled()
    })

    it("refuses an existing incomplete claim instead of applying the effect again", async () => {
        const manager = mockEntityManager({
            query: [
                CLAIM_CLIENT,
                [{ request_fingerprint: requestFingerprint(REQUEST.request), outcome: {}, incomplete: true }],
            ],
        })
        const inbox = await build()
        let calls = 0
        await expect(
            runClient(inbox, REQUEST, manager, () => {
                calls += 1
                return Promise.resolve(OUTCOME)
            }),
        ).rejects.toMatchObject({ code: InboxErrorCode.OutcomeMissing })
        expect(calls).toBe(0)
    })
})

describe("PostgresInbox client outcome persistence", () => {
    it("claims before its callback and returns the persisted outcome through the same transaction", async () => {
        const manager = mockEntityManager()
        const fingerprint = requestFingerprint(REQUEST.request)
        manager.query
            .mockResolvedValueOnce([{ request_fingerprint: fingerprint, outcome: null }])
            .mockResolvedValueOnce([{ outcome: { value: OUTCOME } }])
        const transaction = fakeTransaction(manager)
        const inbox = await build()

        const outcome = await transaction.em.transaction((tx) =>
            inbox.runClient(REQUEST, tx, () => {
                expect(transaction.em.query).toHaveBeenCalledTimes(1)
                return Promise.resolve(OUTCOME)
            }),
        )

        expect(outcome).toEqual(OUTCOME)
        expect(transaction.em.query).toHaveBeenNthCalledWith(1, CLAIM_CLIENT, [
            "client:person-1:checkout.place",
            "key-1",
            fingerprint,
            new FakeClock("2026-02-03T04:05:06.000Z").now(),
        ])
        expect(transaction.em.query).toHaveBeenNthCalledWith(2, SAVE_CLIENT_OUTCOME, [
            "client:person-1:checkout.place",
            "key-1",
            JSON.stringify({ value: OUTCOME }),
        ])
        expect(transaction.commits).toBe(1)
    })
})

describe("PostgresInbox client replay and fingerprint identity", () => {
    it.each([OUTCOME, { kind: "refused", code: "ORDER_EMPTY_CART" }, null])(
        "replays the stored JSON outcome %p without running the callback",
        async (outcome) => {
            const manager = mockEntityManager({
                query: [
                    CLAIM_CLIENT,
                    [
                        {
                            request_fingerprint: requestFingerprint(REQUEST.request),
                            outcome: { value: outcome },
                        },
                    ],
                ],
            })
            const inbox = await build()
            let calls = 0

            await expect(
                runClient(inbox, REQUEST, manager, () => {
                    calls += 1
                    return Promise.resolve(outcome)
                }),
            ).resolves.toEqual(outcome)

            expect(calls).toBe(0)
            expect(manager.query).toHaveBeenCalledTimes(1)
        },
    )

    it.each(["a-different-fingerprint", null])(
        "refuses a reused key carrying fingerprint %p before any callback",
        async (fingerprint) => {
            const manager = mockEntityManager({
                query: [CLAIM_CLIENT, [{ request_fingerprint: fingerprint, outcome: { value: OUTCOME } }]],
            })
            const inbox = await build()
            let calls = 0

            await expect(
                runClient(inbox, REQUEST, manager, () => {
                    calls += 1
                    return Promise.resolve(OUTCOME)
                }),
            ).rejects.toMatchObject({
                code: IdempotencyErrorCode.KeyReused,
            })

            expect(calls).toBe(0)
            expect(manager.query).toHaveBeenCalledTimes(1)
        },
    )
})

describe("PostgresInbox client request validation", () => {
    it.each([
        { ...REQUEST, principalId: " " },
        { ...REQUEST, principalId: "a:b" },
        { ...REQUEST, operation: " " },
        { ...REQUEST, operation: "a:b" },
        { ...REQUEST, idempotencyKey: " " },
        { ...REQUEST, idempotencyKey: "a".repeat(65) },
        { ...REQUEST, request: { unsupported: undefined } },
    ])("refuses an invalid scope, key or request before querying %p", async (request) => {
        const manager = mockEntityManager()
        const inbox = await build()

        await expect(runClient(inbox, request, manager, () => Promise.resolve(OUTCOME))).rejects.toMatchObject({
            code: IdempotencyErrorCode.RequestInvalid,
        })

        expect(manager.query).not.toHaveBeenCalled()
    })
})

describe("PostgresInbox client effect rollback", () => {
    it("keeps the exact key and rejects a failed callback by rolling the claim back with the domain transaction", async () => {
        const manager = mockEntityManager({
            query: [
                CLAIM_CLIENT,
                [
                    {
                        request_fingerprint: requestFingerprint(REQUEST.request),
                        outcome: null,
                    },
                ],
            ],
        })
        const transaction = fakeTransaction(manager)
        const inbox = await build()
        const failure = new InboxError({ code: InboxErrorCode.OutcomeMissing })

        await expect(
            transaction.em.transaction((tx) =>
                inbox.runClient({ ...REQUEST, idempotencyKey: " key-1 " }, tx, () => Promise.reject(failure)),
            ),
        ).rejects.toBe(failure)

        expect(transaction.em.query).toHaveBeenCalledWith(CLAIM_CLIENT, [
            "client:person-1:checkout.place",
            " key-1 ",
            requestFingerprint(REQUEST.request),
            new FakeClock("2026-02-03T04:05:06.000Z").now(),
        ])
        expect(transaction.rollbacks).toBe(1)
        expect(transaction.committedWrites).toEqual([])
    })
})

describe("PostgresInbox client claim and serialization failures", () => {
    it("propagates a database claim failure without calling the callback", async () => {
        const manager = mockEntityManager()
        const failure = new Error("claim failed")
        manager.query.mockRejectedValueOnce(failure)
        const inbox = await build()
        let calls = 0

        await expect(
            runClient(inbox, REQUEST, manager, () => {
                calls += 1
                return Promise.resolve(OUTCOME)
            }),
        ).rejects.toBe(failure)

        expect(calls).toBe(0)
    })

    it("refuses a non-JSON callback outcome and rolls back its claim", async () => {
        const transaction = fakeTransaction(
            mockEntityManager({
                query: [
                    CLAIM_CLIENT,
                    [
                        {
                            request_fingerprint: requestFingerprint(REQUEST.request),
                            outcome: null,
                        },
                    ],
                ],
            }),
        )
        const inbox = await build()

        await expect(
            transaction.em.transaction((tx) => inbox.runClient(REQUEST, tx, () => Promise.resolve(undefined))),
        ).rejects.toMatchObject({
            code: InboxErrorCode.OutcomeInvalid,
            cause: { code: IdempotencyErrorCode.RequestInvalid },
        })

        expect(transaction.em.query).toHaveBeenCalledTimes(1)
        expect(transaction.rollbacks).toBe(1)
    })
})

describe("PostgresInbox client incomplete database responses", () => {
    it("refuses missing claim and saved rows rather than committing an unrecorded result", async () => {
        for (const responses of [
            [[]],
            [[{ request_fingerprint: requestFingerprint(REQUEST.request), outcome: null }], []],
        ]) {
            const manager = mockEntityManager()
            for (const response of responses) manager.query.mockResolvedValueOnce(response)
            const transaction = fakeTransaction(manager)
            const inbox = await build()

            await expect(
                transaction.em.transaction((tx) => inbox.runClient(REQUEST, tx, () => Promise.resolve(OUTCOME))),
            ).rejects.toMatchObject({
                code: InboxErrorCode.OutcomeMissing,
            })

            expect(transaction.rollbacks).toBe(1)
        }
    })
})

describe("PostgresInbox client outcome write rollback", () => {
    it("rolls back the claim and effect when saving the outcome fails", async () => {
        const manager = mockEntityManager()
        const failure = new Error("outcome write failed")
        manager.query
            .mockResolvedValueOnce([{ request_fingerprint: requestFingerprint(REQUEST.request), outcome: null }])
            .mockRejectedValueOnce(failure)
        const transaction = fakeTransaction(manager)
        const inbox = await build()

        await expect(
            transaction.em.transaction((tx) => inbox.runClient(REQUEST, tx, () => Promise.resolve(OUTCOME))),
        ).rejects.toBe(failure)

        expect(transaction.rollbacks).toBe(1)
        expect(transaction.committedWrites).toEqual([])
    })
})

describe("PostgresInbox client retention", () => {
    it.each([
        { rows: [], expected: 0 },
        { rows: [{ deleted_count: 0 }], expected: 0 },
        { rows: [{ deleted_count: 17 }], expected: 17 },
    ])("returns the bounded deleted row count $expected through the supplied manager", async ({ rows, expected }) => {
        const manager = mockEntityManager({ query: [SWEEP_CLIENTS, rows] })
        const inbox = await build()
        const cutoff = new FakeClock("2026-01-01T00:00:00.000Z").now()

        await expect(inbox.sweepClients(cutoff, manager)).resolves.toBe(expected)

        expect(manager.query).toHaveBeenCalledWith(SWEEP_CLIENTS, [cutoff, BATCH_ROWS])
    })
})
