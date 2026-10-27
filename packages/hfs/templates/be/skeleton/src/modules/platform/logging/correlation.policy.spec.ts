import { Test } from "@nestjs/testing"
import { fakeIds } from "@starci/jest-preset"
import { DomainError } from "@modules/platform/errors"
import { correlationFromHeaders, isCorrelationId, runWithCorrelation, stampLogFields } from "./correlation.policy"

type LoggingScopeErrorCode = "LOGGING_SCOPE_FAILED"
class LoggingScopeError extends DomainError<LoggingScopeErrorCode> {}

const SUBJECT = Symbol("correlation-policy")
const FIRST_ID = "00000000-0000-4000-8000-000000000001"
const traceId = "4bf92f3577b34da6a3ce929d0e0e4736"
const spanId = "00f067aa0ba902b7"
const build = async () => {
    const ids = fakeIds()
    const moduleRef = await Test.createTestingModule({
        providers: [
            {
                provide: SUBJECT,
                useValue: { correlationFromHeaders, isCorrelationId, runWithCorrelation, stampLogFields },
            },
        ],
    }).compile()
    return { subject: moduleRef.get<typeof import("./correlation.policy")>(SUBJECT), ids }
}

describe("correlationFromHeaders", () => {
    it("uses the validated trace id before the request id", async () => {
        const { subject, ids } = await build()
        expect(
            subject.correlationFromHeaders(
                { traceparent: `00-${traceId}-${spanId}-01`, "x-request-id": "request-1" },
                ids,
            ),
        ).toBe(traceId)
    })

    it.each([`01-${traceId}-${spanId}-01`, `01-${traceId}-${spanId}-01-future-field`])(
        "reads the known prefix of a higher traceparent version: %s",
        async (traceparent) => {
            const { subject, ids } = await build()
            expect(subject.correlationFromHeaders({ traceparent, "x-request-id": "request-1" }, ids)).toBe(traceId)
        },
    )

    it.each([
        "malformed",
        `ff-${traceId}-${spanId}-01`,
        `ff-${traceId}-${spanId}-01-future-field`,
        `00-${traceId}-${spanId}-01-extra`,
        `01-${traceId}-${spanId}-01extra`,
        `01-${traceId}-${spanId}-01_extra`,
        `01-${traceId}-${spanId}-0`,
        `00-${traceId}-${spanId}-01\n`,
        `01-${traceId}-${spanId}-01\n`,
        `00-${"0".repeat(32)}-${spanId}-01`,
        `00-${traceId}-${"0".repeat(16)}-01`,
        `00-${traceId.toUpperCase()}-${spanId}-01`,
    ])("falls back to a request id when traceparent is invalid: %s", async (traceparent) => {
        const { subject, ids } = await build()
        expect(subject.correlationFromHeaders({ traceparent, "x-request-id": "request-1" }, ids)).toBe("request-1")
    })

    it("does not choose among repeated traceparent values", async () => {
        const { subject, ids } = await build()
        expect(
            subject.correlationFromHeaders(
                { traceparent: [`00-${traceId}-${spanId}-01`], "x-request-id": "request-1" },
                ids,
            ),
        ).toBe("request-1")
    })

    it("accepts the bounded safe request id alphabet", async () => {
        const { subject, ids } = await build()
        expect(subject.correlationFromHeaders({ "x-request-id": "A-1._:z" }, ids)).toBe("A-1._:z")
        expect(subject.correlationFromHeaders({ "x-request-id": "a".repeat(128) }, ids)).toHaveLength(128)
    })

    it.each([
        { requestId: undefined },
        { requestId: "" },
        { requestId: "a".repeat(129) },
        { requestId: "line\nbreak" },
        { requestId: "request-id\n" },
        { requestId: "request-id\r" },
        { requestId: "unsafe value" },
        { requestId: ["a", "b"] },
    ])("mints through Ids for absent or unsafe request ids: %p", async ({ requestId }) => {
        const { subject, ids } = await build()
        expect(subject.correlationFromHeaders({ "x-request-id": requestId }, ids)).toBe(FIRST_ID)
        expect(ids.issued).toEqual([FIRST_ID])
    })
})

describe("logging correlation scopes", () => {
    it("stamps the logger root identity outside a scope", async () => {
        const { subject } = await build()
        expect(subject.stampLogFields(undefined, FIRST_ID)).toEqual({ correlationId: FIRST_ID })
    })

    it("returns the work's result and restores a nested scope", async () => {
        const { subject } = await build()
        const result = subject.runWithCorrelation("outer", () => {
            expect(subject.stampLogFields({ correlationId: "override", owner: "logging" }, FIRST_ID)).toEqual({
                correlationId: "outer",
                owner: "logging",
            })
            subject.runWithCorrelation("inner", () =>
                expect(subject.stampLogFields({}, FIRST_ID)).toEqual({ correlationId: "inner" }),
            )
            expect(subject.stampLogFields({}, FIRST_ID)).toEqual({ correlationId: "outer" })
            return "result"
        })
        expect(result).toBe("result")
        expect(subject.stampLogFields({}, FIRST_ID)).toEqual({ correlationId: FIRST_ID })
    })

    it("restores the surrounding scope after a throw", async () => {
        const { subject } = await build()
        const failure = new LoggingScopeError({ code: "LOGGING_SCOPE_FAILED" })
        expect(() =>
            subject.runWithCorrelation("failed", () => {
                throw failure
            }),
        ).toThrow(failure)
        expect(subject.stampLogFields({}, FIRST_ID)).toEqual({ correlationId: FIRST_ID })
    })

    it("isolates interleaved asynchronous requests", async () => {
        const { subject } = await build()
        let releaseFirst: (() => void) | undefined
        const firstReady = new Promise<void>((resolve) => {
            releaseFirst = resolve
        })
        const first = subject.runWithCorrelation("first", async () => {
            await firstReady
            return subject.stampLogFields({}, FIRST_ID)
        })
        const second = subject.runWithCorrelation("second", async () => {
            await Promise.resolve()
            releaseFirst?.()
            return subject.stampLogFields({}, FIRST_ID)
        })
        await expect(Promise.all([first, second])).resolves.toEqual([
            { correlationId: "first" },
            { correlationId: "second" },
        ])
        expect(subject.stampLogFields({}, FIRST_ID)).toEqual({ correlationId: FIRST_ID })
    })
})
