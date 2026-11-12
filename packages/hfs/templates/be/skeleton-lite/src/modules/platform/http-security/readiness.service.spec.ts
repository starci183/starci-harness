import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { DATABASE_PROBE } from "@modules/platform/database"
import type { DatabaseProbeService } from "@modules/platform/database"
import { TIMER } from "@modules/platform/retry"
import type { Timer } from "@modules/platform/retry"
import { HTTP_SECURITY_ERROR_KINDS, HttpSecurityError, HttpSecurityErrorCode } from "./errors/http-security.error"
import type { RequiredProbe } from "./readiness.contracts"
import { ReadinessService } from "./readiness.service"
import { REQUIRED_PROBES } from "./required-probes.decorators"
import type { RequiredProbesService } from "./required-probes.service"

/** Asymmetric matchers read as `unknown`: jest types them `any`, which may not flow into a property or a typed argument. */
const anyOf = (type: unknown): unknown => expect.any(type)

const build = async () => {
    const database = mock<DatabaseProbeService>()
    const storage = mock<RequiredProbe>()
    const timer = mock<Timer>()
    const cancel = jest.fn()
    timer.schedule.mockReturnValue(cancel)
    storage.probe.mockResolvedValue(undefined)
    const required = mock<RequiredProbesService>()
    required.list.mockReturnValue([storage])
    const moduleRef = await Test.createTestingModule({
        providers: [
            ReadinessService,
            { provide: DATABASE_PROBE, useValue: database },
            { provide: TIMER, useValue: timer },
            { provide: REQUIRED_PROBES, useValue: required },
        ],
    }).compile()
    return { service: moduleRef.get(ReadinessService), database, storage, timer, cancel }
}

describe("ReadinessService", () => {
    it("probes the required database and every registered dependency before reporting ready", async () => {
        const { service, database, storage, timer } = await build()
        database.probe.mockResolvedValue(undefined)

        await expect(service.probeRequired()).resolves.toEqual({ ok: true })

        expect(database.probe).toHaveBeenCalledTimes(1)
        expect(storage.probe).toHaveBeenCalledTimes(1)
        expect(timer.schedule).toHaveBeenCalledWith(anyOf(Function), 1000)
    })

    it("preserves the database failure under the unavailable error kind that answers 503", async () => {
        const { service, database, cancel } = await build()
        const cause = new Error("connection unavailable")
        database.probe.mockRejectedValue(cause)
        const probe = service.probeRequired()

        await expect(probe).rejects.toBeInstanceOf(HttpSecurityError)
        await expect(probe).rejects.toMatchObject({ code: HttpSecurityErrorCode.RequiredDependencyUnavailable, cause })
        expect(HTTP_SECURITY_ERROR_KINDS[HttpSecurityErrorCode.RequiredDependencyUnavailable]).toBe("unavailable")
        expect(cancel).toHaveBeenCalledTimes(1)
    })

    it("answers unavailable when a registered dependency fails while the database answers", async () => {
        const { service, database, storage } = await build()
        const cause = new Error("object store unreachable")
        database.probe.mockResolvedValue(undefined)
        storage.probe.mockRejectedValue(cause)

        await expect(service.probeRequired()).rejects.toMatchObject({
            code: HttpSecurityErrorCode.RequiredDependencyUnavailable,
            cause,
        })
    })

    it("fails within the bounded timeout when a required dependency never answers", async () => {
        const { service, database, timer, cancel } = await build()
        database.probe.mockReturnValue(new Promise(() => undefined))
        const probe = service.probeRequired()
        const expected = expect(probe).rejects.toMatchObject({
            code: HttpSecurityErrorCode.RequiredDependencyUnavailable,
            cause: new Error("Required dependency readiness timed out"),
        })

        expect(timer.schedule).toHaveBeenCalledWith(anyOf(Function), 1000)
        timer.schedule.mock.calls.at(0)?.[0]()
        await expected
        expect(cancel).toHaveBeenCalledTimes(1)
    })

    it("cancels the deadline when the dependencies answer early", async () => {
        const { service, database, cancel } = await build()
        database.probe.mockResolvedValue(undefined)

        await expect(service.probeRequired()).resolves.toEqual({ ok: true })

        expect(cancel).toHaveBeenCalledTimes(1)
    })

    it("preserves a synchronous database failure before a deadline can be scheduled", async () => {
        const { service, database, timer, cancel } = await build()
        const failure = new HttpSecurityError({ code: HttpSecurityErrorCode.RequiredDependencyUnavailable })
        database.probe.mockImplementation(() => {
            throw failure
        })

        await expect(service.probeRequired()).rejects.toBe(failure)
        expect(timer.schedule).not.toHaveBeenCalled()
        expect(cancel).not.toHaveBeenCalled()
    })
})
