import type { INestApplication } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import type { NextFunction, Request, RequestHandler, Response } from "express"
import type { CorrelationIds, CorrelationRunner } from "./correlation.port"
import { applyCorrelation, correlationMiddleware } from "./correlation-request.policy"
import { CORRELATION_IDS, CORRELATION_RUNNER } from "./logging.decorators"
import { runWithCorrelation, stampLogFields } from "./correlation.policy"

const SUBJECT = Symbol("request-correlation-policy")
const build = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [{ provide: SUBJECT, useValue: { applyCorrelation, correlationMiddleware } }],
    }).compile()
    return moduleRef.get<typeof import("./correlation-request.policy")>(SUBJECT)
}

describe("request correlation", () => {
    it("copies the explicit identity to the request and response and scopes downstream work", async () => {
        const subject = await build()
        const ids = mock<CorrelationIds>({ fromHeaders: () => "request-id" })
        const runner = mock<CorrelationRunner>({ run: runWithCorrelation })
        const request = mock<Request>({ headers: { "x-request-id": "request-id" } })
        const setHeader = jest.fn()
        const response = mock<Response>({ setHeader })
        const next: NextFunction = jest.fn(() => {
            expect(stampLogFields({}, "root-id")).toEqual({ correlationId: "request-id" })
        })

        subject.correlationMiddleware(ids, runner)(request, response, next)

        expect(request).toHaveProperty("correlationId", "request-id")
        expect(setHeader).toHaveBeenCalledWith("x-request-id", "request-id")
        expect(next).toHaveBeenCalledTimes(1)
    })

    it("installs the middleware using the registered logging ports", async () => {
        const subject = await build()
        const ids = mock<CorrelationIds>({ fromHeaders: () => "installed-id" })
        const runner = mock<CorrelationRunner>({ run: runWithCorrelation })
        const installed: Array<RequestHandler> = []
        const app: INestApplication = mock<INestApplication>({
            get: jest.fn().mockImplementation((key: unknown) => (key === CORRELATION_IDS ? ids : runner)),
            use: (handler: RequestHandler): INestApplication => {
                installed.push(handler)
                return app
            },
        })
        subject.applyCorrelation(app)

        expect(app.get).toHaveBeenCalledWith(CORRELATION_IDS)
        expect(app.get).toHaveBeenCalledWith(CORRELATION_RUNNER)

        expect(installed).toHaveLength(1)
        const setHeader = jest.fn()
        installed[0]?.(mock<Request>({ headers: {} }), mock<Response>({ setHeader }), jest.fn())
        expect(setHeader).toHaveBeenCalledWith("x-request-id", "installed-id")
    })
})
