import { FakeClock, fakeIds, mock } from "@starci/jest-preset"
import { Test } from "@nestjs/testing"
import { runWithCorrelation } from "./correlation.policy"
import { createJsonLogger } from "./json-logger.service"
import { LoggingLogEvent } from "./logging.log-events"
import type { Logger } from "./logging.port"
import { LOGGER } from "./logging.decorators"
import { createNestLogger, NestLoggerService } from "./nest-logger.service"

const build = async () => {
    const logger = mock<Logger>()
    const moduleRef = await Test.createTestingModule({
        providers: [NestLoggerService, { provide: LOGGER, useValue: logger }],
    }).compile()
    return { logger, adapter: moduleRef.get<NestLoggerService>(NestLoggerService) }
}

describe("NestLoggerService", () => {
    it("maps all framework levels to owned enum identities through the logging port", async () => {
        const { logger, adapter } = await build()
        const failure = new Error("bootstrap failed")

        adapter.log("started", "NestApplication")
        adapter.warn("recovering", "Injector")
        adapter.debug(42)
        adapter.verbose({ operation: "bootstrap" }, { ignored: "unstructured" })
        adapter.error(failure, failure.stack, "ExceptionHandler")
        adapter.fatal("stopping")

        expect(logger.info).toHaveBeenNthCalledWith(1, LoggingLogEvent.FrameworkLog, {
            message: "started",
            context: "NestApplication",
        })
        expect(logger.info).toHaveBeenNthCalledWith(2, LoggingLogEvent.FrameworkDebug, { message: "42" })
        expect(logger.info).toHaveBeenNthCalledWith(3, LoggingLogEvent.FrameworkVerbose, { message: "[object Object]" })
        expect(logger.warn).toHaveBeenCalledWith(LoggingLogEvent.FrameworkWarning, {
            message: "recovering",
            context: "Injector",
        })
        expect(logger.error).toHaveBeenNthCalledWith(1, LoggingLogEvent.FrameworkError, failure, {
            message: "Error: bootstrap failed",
            context: "ExceptionHandler",
        })
        expect(logger.error).toHaveBeenNthCalledWith(2, LoggingLogEvent.FrameworkFatal, "stopping", {
            message: "stopping",
        })
    })

    it("stamps bootstrap lines and uses the active request identity during framework logging", () => {
        const lines: Array<string> = []
        const output = jest.spyOn(process.stdout, "write").mockImplementation((chunk) => lines.push(String(chunk)) > 0)
        try {
            const adapter = createNestLogger(createJsonLogger(new FakeClock("2026-10-24T00:00:00Z"), fakeIds()))
            adapter.log("booting", "NestFactory")
            runWithCorrelation("request-id", () => {
                adapter.log("handling", "Router")
            })

            expect(lines).toHaveLength(2)
            expect(lines[0]).toContain('"correlationId":"00000000-0000-4000-8000-000000000001"')
            expect(lines[1]).toContain('"correlationId":"request-id"')
            expect(lines[0]).toContain('"context":"NestFactory"')
            expect(lines[1]).toContain('"context":"Router"')
            expect(lines.every((line) => line.includes(`"event":"${LoggingLogEvent.FrameworkLog}"`))).toBe(true)
        } finally {
            output.mockRestore()
        }
    })
})
