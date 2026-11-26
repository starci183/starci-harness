import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { Writable } from "node:stream"
import { FakeClock, fakeIds } from "@starci/jest-preset"
import { createJsonLogger, JsonLoggerService } from "./json-logger.service"
import { REDACTED } from "./log-redaction.policy"
import { LoggingLogEvent } from "./logging.log-events"
import type { LoggingOptions } from "./logging.options"
import { runWithCorrelation } from "./correlation.policy"

type WrittenLine = { stream: "out" | "err"; line: string }

const readJsonLine = (line: string | undefined): Record<string, unknown> => {
    const entry: unknown = JSON.parse(line ?? "")
    if (typeof entry !== "object" || entry === null) return {}
    return { ...entry }
}

const build = (options: LoggingOptions = {}) => {
    const clock = new FakeClock("2026-05-06T07:08:09.000Z")
    const written: Array<WrittenLine> = []
    const sink = (stream: WrittenLine["stream"]): Writable =>
        new Writable({
            write: (chunk: Buffer | string, _encoding, done) => {
                written.push({ stream, line: String(chunk) })
                done()
            },
        })
    const out = sink("out")
    const err = sink("err")
    const logger = new JsonLoggerService(clock, fakeIds(), out, err, options)
    return { logger, clock, written }
}

describe("JsonLoggerService", () => {
    it("writes one info JSON line to stdout stamped by the clock", () => {
        const { logger, written } = build()
        logger.info("cart.opened", { personId: "p-1" })
        expect(written).toEqual([
            {
                stream: "out",
                line: `${JSON.stringify({ personId: "p-1", correlationId: "00000000-0000-4000-8000-000000000001", level: "info", event: "cart.opened", time: "2026-05-06T07:08:09.000Z" })}\n`,
            },
        ])
    })

    it("writes a warning without caller fields to stderr", () => {
        const { logger, clock, written } = build()
        clock.advance(1000)
        logger.warn(LoggingLogEvent.StartupFailed)
        expect(readJsonLine(written[0]?.line)).toEqual({
            level: "warn",
            event: LoggingLogEvent.StartupFailed,
            time: "2026-05-06T07:08:10.000Z",
            correlationId: "00000000-0000-4000-8000-000000000001",
        })
        expect(written[0]?.stream).toBe("err")
    })
})

describe("JsonLoggerService error details", () => {
    it("retains the error name, message and stack without dumping the Error object", () => {
        const { logger, written } = build()
        const cause = new TypeError("boom")
        logger.error("db.failed", cause, { operation: "PlaceOrderHandler" })
        expect(readJsonLine(written[0]?.line)).toEqual({
            operation: "PlaceOrderHandler",
            errorName: "TypeError",
            errorMessage: "boom",
            stack: cause.stack,
            level: "error",
            event: "db.failed",
            time: "2026-05-06T07:08:09.000Z",
            correlationId: "00000000-0000-4000-8000-000000000001",
        })
        expect(written[0]?.stream).toBe("err")
    })

    it("retains an error's code, including zero, and protects cause details from caller fields", () => {
        const { logger, written } = build()
        const cause = Object.assign(new Error("connection lost"), { code: 0 })
        logger.error("db.failed", cause, { errorName: "fake", errorMessage: "fake", errorCode: "fake", stack: "fake" })
        expect(readJsonLine(written[0]?.line)).toMatchObject({ errorName: "Error", errorMessage: "connection lost", errorCode: 0, stack: cause.stack })
    })

    it("serializes a non-Error cause and preserves a code carried by an object cause", () => {
        const { logger, written } = build()
        logger.error("db.failed", "plain failure")
        logger.error("db.failed", { code: "CONNECTION_CLOSED" })
        logger.error("db.failed", null)
        expect(written.map(({ line }) => readJsonLine(line).errorMessage)).toEqual(["plain failure", "[object Object]", "null"])
        expect(readJsonLine(written[1]?.line).errorCode).toBe("CONNECTION_CLOSED")
        expect(readJsonLine(written[0]?.line)).not.toHaveProperty("errorCode")
    })

    it("logs one cause object once, whichever logger of the process meets it again", () => {
        const first = build()
        const second = build()
        const cause = new Error("once")
        first.logger.error("cqrs.operation_failed", cause)
        first.logger.error("errors.unhandled", cause)
        second.logger.error("errors.unhandled", cause)
        expect(first.written).toHaveLength(1)
        expect(second.written).toHaveLength(0)
    })
})

describe("JsonLoggerService reserved fields and redaction", () => {
    it("writes reserved level, event and time last so caller fields cannot forge them", () => {
        const { logger, written } = build()
        const fields = { level: "error", event: "forged", time: "1900-01-01T00:00:00Z", personId: "p-1" }
        logger.info("cart.opened", fields)
        logger.warn("cart.warning", fields)
        logger.error("cart.failed", "failure", fields)
        expect(written.map(({ line }) => readJsonLine(line).level)).toEqual(["info", "warn", "error"])
        expect(written.map(({ line }) => readJsonLine(line).event)).toEqual(["cart.opened", "cart.warning", "cart.failed"])
        expect(written.every(({ line }) => readJsonLine(line).time === "2026-05-06T07:08:09.000Z")).toBe(true)
    })

    it("masks credential-named fields at any depth and keeps ids readable", () => {
        const { logger, written } = build()
        logger.info("auth.refreshed", {
            sessionId: "s-1",
            tokenCount: 2,
            refreshToken: "r-secret",
            request: { headers: { authorization: "Bearer x", "x-api-key": "k" }, password: "p" },
        })
        expect(readJsonLine(written[0]?.line)).toMatchObject({
            sessionId: "s-1",
            tokenCount: 2,
            refreshToken: REDACTED,
            request: { headers: { authorization: REDACTED, "x-api-key": REDACTED }, password: REDACTED },
        })
    })
})

describe("createJsonLogger", () => {
    afterEach(() => jest.restoreAllMocks())

    it("uses process stdout and stderr before the DI container exists", () => {
        const lines: Array<string> = []
        jest.spyOn(process.stdout, "write").mockImplementation((chunk) => lines.push(`out:${String(chunk)}`) > 0)
        jest.spyOn(process.stderr, "write").mockImplementation((chunk) => lines.push(`err:${String(chunk)}`) > 0)
        const logger = createJsonLogger(new FakeClock("2026-05-06T07:08:09.000Z"), fakeIds())
        logger.info(LoggingLogEvent.ServerStarted)
        logger.warn(LoggingLogEvent.StartupFailed)
        expect(lines).toEqual([
            `out:${JSON.stringify({ correlationId: "00000000-0000-4000-8000-000000000001", level: "info", event: LoggingLogEvent.ServerStarted, time: "2026-05-06T07:08:09.000Z" })}\n`,
            `err:${JSON.stringify({ correlationId: "00000000-0000-4000-8000-000000000001", level: "warn", event: LoggingLogEvent.StartupFailed, time: "2026-05-06T07:08:09.000Z" })}\n`,
        ])
    })

    it("sends info to stderr, leaving stdout untouched, when the info option is stderr", () => {
        const lines: Array<string> = []
        jest.spyOn(process.stdout, "write").mockImplementation((chunk) => lines.push(`out:${String(chunk)}`) > 0)
        jest.spyOn(process.stderr, "write").mockImplementation((chunk) => lines.push(`err:${String(chunk)}`) > 0)
        const logger = createJsonLogger(new FakeClock("2026-05-06T07:08:09.000Z"), fakeIds(), { info: "stderr" })
        logger.info(LoggingLogEvent.ServerStarted)
        logger.warn(LoggingLogEvent.StartupFailed)
        expect(lines.map((line) => line.slice(0, 4))).toEqual(["err:", "err:"])
    })
})

describe("JsonLoggerService correlation", () => {
    it("stamps every level with the active identity and refuses caller overrides", () => {
        const { logger, written } = build()
        runWithCorrelation("request-id", () => {
            logger.info(LoggingLogEvent.ServerStarted, { correlationId: "override" })
            logger.warn(LoggingLogEvent.StartupFailed)
            logger.error(LoggingLogEvent.StartupFailed, new Error("failed"))
        })
        expect(written).toHaveLength(3)
        expect(written.every(({ line }) => readJsonLine(line).correlationId === "request-id")).toBe(true)
    })

    it("stamps every line outside a scope with one root identity drawn once", () => {
        const { logger, written } = build()
        logger.info("cart.opened")
        logger.warn("cart.slow")
        expect(written.map(({ line }) => readJsonLine(line).correlationId)).toEqual([
            "00000000-0000-4000-8000-000000000001",
            "00000000-0000-4000-8000-000000000001",
        ])
    })
})

/** A stand-in Loki push endpoint on a free local port that keeps every body it receives. */
const startLoki = async (): Promise<{ server: Server; url: string; bodies: Array<unknown> }> => {
    const bodies: Array<unknown> = []
    const server = createServer((request, response) => {
        let body = ""
        request.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")))
        request.on("end", () => {
            bodies.push(JSON.parse(body))
            response.writeHead(204).end()
        })
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const { port } = server.address() as AddressInfo
    return { server, url: `http://127.0.0.1:${String(port)}`, bodies }
}

const LABELS = { app: "shop", env: "dev", service: "api" }

describe("JsonLoggerService with Loki", () => {
    it("pushes the console line to Loki labelled app, env, service, level and event, with ids only in the line", async () => {
        const loki = await startLoki()
        try {
            const { logger, written } = build({ loki: { url: loki.url, labels: LABELS } })
            logger.info("cart.opened", { cartId: "c-1" })
            await logger.close()
            expect(loki.bodies).toEqual([
                {
                    streams: [
                        {
                            stream: { level: "info", stack: "shop", ...LABELS, event: "cart.opened" },
                            values: [["1778051289000000000", written[0]?.line.trimEnd(), { level: "info" }]],
                        },
                    ],
                },
            ])
        } finally {
            loki.server.close()
        }
    })

    it("keeps the console lines and reports the outage once on stderr when Loki cannot be reached", async () => {
        const loki = await startLoki()
        const url = loki.url
        await new Promise<void>((resolve) => loki.server.close(() => resolve()))
        const { logger, written } = build({ loki: { url, labels: LABELS, timeoutMs: 500 } })
        logger.info("cart.opened")
        logger.warn("cart.slow")
        await expect(logger.close()).resolves.toBeUndefined()
        expect(written.map(({ stream, line }) => `${stream}:${String(readJsonLine(line).event)}`)).toEqual([
            "out:cart.opened",
            "err:cart.slow",
            `err:${LoggingLogEvent.LokiUnreachable}`,
        ])
    })
})
