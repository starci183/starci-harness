import type { Writable } from "node:stream"
import { FakeClock, fakeIds, mock } from "@starci/jest-preset"
import { CLOCK } from "@modules/platform/clock"
import { IDS } from "@modules/platform/ids"
import { Test } from "@nestjs/testing"
import { createJsonLogger, JsonLoggerService } from "./json-logger.service"
import { LOG_ERR, LOG_OUT } from "./logging.decorators"
import { LoggingLogEvent } from "./logging.log-events"
import { runWithCorrelation } from "./correlation.policy"

type WrittenLine = { stream: "out" | "err"; line: string }

const readJsonLine = (line: string | undefined): Record<string, unknown> => {
    try {
        const entry: unknown = JSON.parse(line ?? "")
        if (typeof entry !== "object" || entry === null) return {}
        return { ...entry }
    } catch (error) {
        throw error
    }
}

const build = async () => {
    const clock = new FakeClock("2026-05-06T07:08:09.000Z")
    const written: Array<WrittenLine> = []
    const out = mock<Writable>({ write: (chunk: string) => written.push({ stream: "out", line: chunk }) > 0 })
    const err = mock<Writable>({ write: (chunk: string) => written.push({ stream: "err", line: chunk }) > 0 })
    const moduleRef = await Test.createTestingModule({
        providers: [
            JsonLoggerService,
            { provide: CLOCK, useValue: clock },
            { provide: LOG_OUT, useValue: out },
            { provide: LOG_ERR, useValue: err },
            { provide: IDS, useValue: fakeIds() },
        ],
    }).compile()
    return { logger: moduleRef.get<JsonLoggerService>(JsonLoggerService), clock, written }
}

describe("JsonLoggerService", () => {
    it("writes one info JSON line to stdout stamped by the clock", async () => {
        const { logger, written } = await build()
        logger.info("cart.opened", { personId: "p-1" })
        expect(written).toEqual([
            {
                stream: "out",
                line: `${JSON.stringify({ personId: "p-1", correlationId: "00000000-0000-4000-8000-000000000001", level: "info", event: "cart.opened", time: "2026-05-06T07:08:09.000Z" })}\n`,
            },
        ])
    })

    it("writes a warning without caller fields to stderr", async () => {
        const { logger, clock, written } = await build()
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
    it("retains the error name, message and stack without dumping the Error object", async () => {
        const { logger, written } = await build()
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

    it("retains an error's code, including zero, and protects cause details from caller fields", async () => {
        const { logger, written } = await build()
        const cause = Object.assign(new Error("connection lost"), { code: 0 })
        logger.error("db.failed", cause, { errorName: "fake", errorMessage: "fake", errorCode: "fake", stack: "fake" })
        expect(readJsonLine(written[0]?.line)).toEqual({
            errorName: "Error",
            errorMessage: "connection lost",
            errorCode: 0,
            stack: cause.stack,
            level: "error",
            event: "db.failed",
            time: "2026-05-06T07:08:09.000Z",
            correlationId: "00000000-0000-4000-8000-000000000001",
        })
    })

    it("serializes a non-Error cause and preserves a code carried by an object cause", async () => {
        const { logger, written } = await build()
        logger.error("db.failed", "plain failure")
        logger.error("db.failed", { code: "CONNECTION_CLOSED" })
        logger.error("db.failed", null)
        expect(written.map(({ line }) => readJsonLine(line).errorMessage)).toEqual([
            "plain failure",
            "[object Object]",
            "null",
        ])
        expect(readJsonLine(written[1]?.line).errorCode).toBe("CONNECTION_CLOSED")
        expect(readJsonLine(written[0]?.line)).not.toHaveProperty("errorCode")
    })
})

describe("JsonLoggerService reserved fields", () => {
    it("writes reserved level, event and time last so caller fields cannot forge them", async () => {
        const { logger, written } = await build()
        const fields = { level: "error", event: "forged", time: "1900-01-01T00:00:00Z", personId: "p-1" }
        logger.info("cart.opened", fields)
        logger.warn("cart.warning", fields)
        logger.error("cart.failed", "failure", fields)
        expect(written.map(({ line }) => readJsonLine(line).level)).toEqual(["info", "warn", "error"])
        expect(written.map(({ line }) => readJsonLine(line).event)).toEqual([
            "cart.opened",
            "cart.warning",
            "cart.failed",
        ])
        expect(written.every(({ line }) => readJsonLine(line).time === "2026-05-06T07:08:09.000Z")).toBe(true)
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

    it("keeps info on stdout when the info option is stdout", () => {
        const lines: Array<string> = []
        jest.spyOn(process.stdout, "write").mockImplementation((chunk) => lines.push(`out:${String(chunk)}`) > 0)
        createJsonLogger(new FakeClock("2026-05-06T07:08:09.000Z"), fakeIds(), { info: "stdout" }).info(
            LoggingLogEvent.ServerStarted,
        )
        expect(lines.map((line) => line.slice(0, 4))).toEqual(["out:"])
    })
})

describe("JsonLoggerService correlation", () => {
    it("stamps every level with the active identity and refuses caller overrides", async () => {
        const { logger, written } = await build()
        runWithCorrelation("request-id", () => {
            logger.info(LoggingLogEvent.ServerStarted, { correlationId: "override" })
            logger.warn(LoggingLogEvent.StartupFailed)
            logger.error(LoggingLogEvent.StartupFailed, new Error("failed"))
        })
        expect(written).toHaveLength(3)
        expect(written.every(({ line }) => readJsonLine(line).correlationId === "request-id")).toBe(true)
    })
})

describe("JsonLogger outside a correlation scope", () => {
    it("stamps every line with one root identity drawn once", async () => {
        const { logger, written } = await build()

        logger.info("cart.opened")
        logger.warn("cart.slow")

        expect(written.map((entry) => entry.line)).toEqual([
            `${JSON.stringify({ correlationId: "00000000-0000-4000-8000-000000000001", level: "info", event: "cart.opened", time: "2026-05-06T07:08:09.000Z" })}\n`,
            `${JSON.stringify({ correlationId: "00000000-0000-4000-8000-000000000001", level: "warn", event: "cart.slow", time: "2026-05-06T07:08:09.000Z" })}\n`,
        ])
    })
})
