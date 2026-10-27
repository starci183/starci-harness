import { BATCH_ROWS } from "@modules/platform/database"
import { IdempotencyErrorCode } from "@modules/platform/idempotency"
import { Test } from "@nestjs/testing"
import type { ClientOperation } from "./inbox.port"
import { FakeClock, fakeTransaction, mockEntityManager } from "@starci/jest-preset"
import { CLOCK } from "@modules/platform/clock"
import { CLAIM_MANAGERS } from "./inbox.decorators"
import { PostgresInbox } from "./inbox.service"
import { InboxError, InboxErrorCode } from "./errors/inbox.error"
import { requestFingerprint } from "./request-fingerprint.policy"
import { CLAIM_CLIENT, CLAIM_EVENT, RELEASE_EVENT, SAVE_CLIENT_OUTCOME, SWEEP_CLIENTS } from "./persistence/inbox.sql"

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

const build = async (manager: ReturnType<typeof mockEntityManager>) => {
    const clock = new FakeClock("2026-02-03T04:05:06.000Z")
    const moduleRef = await Test.createTestingModule({
        providers: [
            PostgresInbox,
            { provide: CLAIM_MANAGERS, useValue: [manager] },
            { provide: CLOCK, useValue: clock },
        ],
    }).compile()
    return moduleRef.get(PostgresInbox)
}

describe("PostgresInbox claim", () => {
    it("answers true for the first claim, stamped with the clock", async () => {
        const manager = mockEntityManager({ query: [CLAIM_EVENT, [{ event_id: "e-1" }]] })
        const inbox = await build(manager)

        await expect(inbox.claim("payments", "e-1")).resolves.toBe(true)
        expect(manager.query).toHaveBeenCalledWith(CLAIM_EVENT, [
            "payments",
            "e-1",
            new FakeClock("2026-02-03T04:05:06.000Z").now(),
        ])
    })

    it("uses the supplied transaction manager for the claim query without reaching the configured manager", async () => {
        const configured = mockEntityManager()
        const tx = fakeTransaction(mockEntityManager({ query: [CLAIM_EVENT, [{ event_id: "e-1" }]] }))
        const inbox = await build(configured)

        await expect(tx.em.transaction((manager) => inbox.claim("payments", "e-1", manager))).resolves.toBe(true)

        const params = ["payments", "e-1", new FakeClock("2026-02-03T04:05:06.000Z").now()]
        expect(tx.em.query).toHaveBeenCalledWith(CLAIM_EVENT, params)
        expect(configured.query).not.toHaveBeenCalled()
        expect(tx.committedWrites).toEqual([{ method: "query", args: [CLAIM_EVENT, params] }])
        expect(tx.commits).toBe(1)
    })

    it("answers false for a duplicate through the supplied manager without falling back to the configured manager", async () => {
        const configured = mockEntityManager()
        const supplied = mockEntityManager({ query: [CLAIM_EVENT, []] })
        const inbox = await build(configured)

        await expect(inbox.claim("payments", "e-1", supplied)).resolves.toBe(false)

        expect(supplied.query).toHaveBeenCalledWith(CLAIM_EVENT, [
            "payments",
            "e-1",
            new FakeClock("2026-02-03T04:05:06.000Z").now(),
        ])
        expect(configured.query).not.toHaveBeenCalled()
    })

    it("propagates the supplied manager query error so its transaction rolls back without root fallback", async () => {
        const failure = new Error("claim statement failed")
        const configured = mockEntityManager()
        const tx = fakeTransaction(mockEntityManager({ query: [CLAIM_EVENT, []] }))
        tx.em.query.mockRejectedValueOnce(failure)
        const inbox = await build(configured)

        await expect(tx.em.transaction((manager) => inbox.claim("payments", "e-1", manager))).rejects.toBe(failure)

        expect(configured.query).not.toHaveBeenCalled()
        expect(tx.rollbacks).toBe(1)
        expect(tx.commits).toBe(0)
        expect(tx.committedWrites).toEqual([])
    })

    it("answers false when the event was claimed before", async () => {
        const inbox = await build(mockEntityManager({ query: [CLAIM_EVENT, []] }))

        await expect(inbox.claim("payments", "e-1")).resolves.toBe(false)
    })
})

describe("PostgresInbox release", () => {
    it("deletes the claim of the event", async () => {
        const manager = mockEntityManager({ query: [RELEASE_EVENT, []] })
        const inbox = await build(manager)

        await expect(inbox.release("payments", "e-1")).resolves.toBeUndefined()
        expect(manager.query).toHaveBeenCalledWith(RELEASE_EVENT, ["payments", "e-1"])
    })
})

describe("PostgresInbox runClient admission", () => {
    it("refuses a manager outside an active transaction before claiming or applying an effect", async () => {
        const inbox = await build(mockEntityManager())
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
        const inbox = await build(mockEntityManager())
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

describe("PostgresInbox runClient persistence", () => {
    it("claims before its callback and returns the persisted outcome through the same transaction", async () => {
        const configured = mockEntityManager()
        const manager = mockEntityManager()
        const fingerprint = requestFingerprint(REQUEST.request)
        manager.query
            .mockResolvedValueOnce([{ request_fingerprint: fingerprint, outcome: null }])
            .mockResolvedValueOnce([{ outcome: { value: OUTCOME } }])
        const transaction = fakeTransaction(manager)
        const inbox = await build(configured)

        const outcome = await transaction.em.transaction((tx) =>
            inbox.runClient(REQUEST, tx, () => {
                expect(transaction.em.query).toHaveBeenCalledTimes(1)
                return Promise.resolve(OUTCOME)
            }),
        )

        expect(outcome).toEqual(OUTCOME)
        expect(configured.query).not.toHaveBeenCalled()
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

describe("PostgresInbox runClient replay", () => {
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
            const inbox = await build(mockEntityManager())
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
})

describe("PostgresInbox runClient key and request validation", () => {
    it.each(["a-different-fingerprint", null])(
        "refuses a reused key carrying fingerprint %p before any callback",
        async (fingerprint) => {
            const manager = mockEntityManager({
                query: [CLAIM_CLIENT, [{ request_fingerprint: fingerprint, outcome: { value: OUTCOME } }]],
            })
            const inbox = await build(mockEntityManager())
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
        const inbox = await build(manager)

        await expect(runClient(inbox, request, manager, () => Promise.resolve(OUTCOME))).rejects.toMatchObject({
            code: IdempotencyErrorCode.RequestInvalid,
        })

        expect(manager.query).not.toHaveBeenCalled()
    })
})

describe("PostgresInbox runClient rollback", () => {
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
        const inbox = await build(mockEntityManager())
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

    it("propagates a database claim failure without calling the callback", async () => {
        const manager = mockEntityManager()
        const failure = new Error("claim failed")
        manager.query.mockRejectedValueOnce(failure)
        const inbox = await build(mockEntityManager())
        let calls = 0

        await expect(
            runClient(inbox, REQUEST, manager, () => {
                calls += 1
                return Promise.resolve(OUTCOME)
            }),
        ).rejects.toBe(failure)

        expect(calls).toBe(0)
    })
})

describe("PostgresInbox runClient outcome validation", () => {
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
        const inbox = await build(mockEntityManager())

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

describe("PostgresInbox runClient write failures", () => {
    it("refuses missing claim and saved rows rather than committing an unrecorded result", async () => {
        for (const responses of [
            [[]],
            [[{ request_fingerprint: requestFingerprint(REQUEST.request), outcome: null }], []],
        ]) {
            const manager = mockEntityManager()
            for (const response of responses) manager.query.mockResolvedValueOnce(response)
            const transaction = fakeTransaction(manager)
            const inbox = await build(mockEntityManager())

            await expect(
                transaction.em.transaction((tx) => inbox.runClient(REQUEST, tx, () => Promise.resolve(OUTCOME))),
            ).rejects.toMatchObject({
                code: InboxErrorCode.OutcomeMissing,
            })

            expect(transaction.rollbacks).toBe(1)
        }
    })

    it("rolls back the claim and effect when saving the outcome fails", async () => {
        const manager = mockEntityManager()
        const failure = new Error("outcome write failed")
        manager.query
            .mockResolvedValueOnce([{ request_fingerprint: requestFingerprint(REQUEST.request), outcome: null }])
            .mockRejectedValueOnce(failure)
        const transaction = fakeTransaction(manager)
        const inbox = await build(mockEntityManager())

        await expect(
            transaction.em.transaction((tx) => inbox.runClient(REQUEST, tx, () => Promise.resolve(OUTCOME))),
        ).rejects.toBe(failure)

        expect(transaction.rollbacks).toBe(1)
        expect(transaction.committedWrites).toEqual([])
    })
})

describe("PostgresInbox sweepClients", () => {
    it.each([
        { rows: [], expected: 0 },
        { rows: [{ deleted_count: 0 }], expected: 0 },
        { rows: [{ deleted_count: 17 }], expected: 17 },
    ])("returns the bounded deleted row count $expected through the supplied manager", async ({ rows, expected }) => {
        const configured = mockEntityManager()
        const manager = mockEntityManager({ query: [SWEEP_CLIENTS, rows] })
        const inbox = await build(configured)
        const cutoff = new FakeClock("2026-01-01T00:00:00.000Z").now()

        await expect(inbox.sweepClients(cutoff, manager)).resolves.toBe(expected)

        expect(manager.query).toHaveBeenCalledWith(SWEEP_CLIENTS, [cutoff, BATCH_ROWS])
        expect(configured.query).not.toHaveBeenCalled()
    })
})
