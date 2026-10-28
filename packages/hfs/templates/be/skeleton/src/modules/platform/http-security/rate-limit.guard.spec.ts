import "reflect-metadata"
import type { ExecutionContext, Type } from "@nestjs/common"
import type { Request } from "express"
import { Reflector } from "@nestjs/core"
import { Test } from "@nestjs/testing"
import { FakeClock, mock, mockEntityManager } from "@starci/jest-preset"
import type { MockEntityManager } from "@starci/jest-preset"
import { CLOCK } from "@modules/platform/clock"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { HttpSecurityErrorCode } from "./errors/http-security.error"
import { HTTP_SECURITY_OPTIONS } from "./http-security.decorators"
import type { HttpSecurityOptions } from "./http-security.options"
import { HIT_RATE_WINDOW, PRUNE_RATE_WINDOWS } from "./persistence/rate-limit.sql"
import { RateLimit, RateLimitGuard, RateTier } from "./rate-limit.guard"

const AT = "2026-02-03T04:05:06.000Z"
const RESET_AT = "2026-02-03T04:06:06.000Z"
const options: HttpSecurityOptions = {
    allowedOrigins: [],
    rateLimit: { windowMs: 60_000, defaultLimit: 2, strictLimit: 1 },
    webhooks: {},
}

const build = async (entityManager: MockEntityManager, tier?: RateTier) => {
    const reflector = mock<Reflector>()
    reflector.getAllAndOverride.mockReturnValue(tier)
    const moduleRef = await Test.createTestingModule({
        providers: [
            RateLimitGuard,
            { provide: Reflector, useValue: reflector },
            { provide: CLOCK, useValue: new FakeClock(AT) },
            { provide: HTTP_SECURITY_OPTIONS, useValue: options },
            { provide: PRIMARY_ENTITY_MANAGER, useValue: entityManager },
        ],
    }).compile()
    return { guard: moduleRef.get(RateLimitGuard), reflector }
}

/** An execution context of one POST from `ip` on the door; the handler and the class carry the tier metadata. */
const contextOf = (ip: string | undefined, handler = () => undefined, door: Type<unknown> = class Door {}) => {
    const http = mock<ReturnType<ExecutionContext["switchToHttp"]>>()
    http.getRequest.mockImplementation(() => mock<Request>({ headers: {}, method: "POST", ip }))
    const context = mock<ExecutionContext>()
    context.switchToHttp.mockReturnValue(http)
    context.getHandler.mockReturnValue(handler)
    context.getClass.mockReturnValue(door)
    return context
}

describe("RateLimit", () => {
    it("marks a door with the tier it declares, and the guard counts it under that tier's limit", async () => {
        class Door {}
        RateLimit(RateTier.Strict)(Door)
        const entityManager = mockEntityManager({ query: [HIT_RATE_WINDOW, [{ hits: 2 }]] })
        const { guard, reflector } = await build(entityManager, RateTier.Strict)
        const handler = () => undefined

        expect(Reflect.getMetadata("platform.http-security.rate-tier", Door)).toBe(RateTier.Strict)
        await expect(guard.canActivate(contextOf("127.0.0.1", handler, Door))).rejects.toMatchObject({
            code: HttpSecurityErrorCode.RateLimited,
        })
        expect(reflector.getAllAndOverride).toHaveBeenCalledWith("platform.http-security.rate-tier", [handler, Door])
        expect(entityManager.query).toHaveBeenCalledWith(HIT_RATE_WINDOW, [
            "strict:127.0.0.1",
            new Date(AT),
            new Date(RESET_AT),
        ])
    })
})

describe("RateLimitGuard", () => {
    it("admits a caller under the default limit of an unmarked door, counting in the shared window", async () => {
        const entityManager = mockEntityManager({ query: [HIT_RATE_WINDOW, [{ hits: 2 }]] })
        const { guard } = await build(entityManager)

        await expect(guard.canActivate(contextOf("127.0.0.1"))).resolves.toBe(true)
        expect(entityManager.query).toHaveBeenCalledWith(HIT_RATE_WINDOW, [
            "default:127.0.0.1",
            new Date(AT),
            new Date(RESET_AT),
        ])
    })

    it("refuses a caller whose shared window is over the default limit", async () => {
        const { guard } = await build(mockEntityManager({ query: [HIT_RATE_WINDOW, [{ hits: 3 }]] }))

        await expect(guard.canActivate(contextOf("127.0.0.1"))).rejects.toMatchObject({
            code: HttpSecurityErrorCode.RateLimited,
        })
    })

    it("prunes the expired windows when a hit opens a fresh one", async () => {
        const entityManager = mockEntityManager({
            query: [
                [HIT_RATE_WINDOW, [{ hits: 1 }]],
                [PRUNE_RATE_WINDOWS, []],
            ],
        })
        const { guard } = await build(entityManager)

        await expect(guard.canActivate(contextOf("127.0.0.1"))).resolves.toBe(true)
        expect(entityManager.query).toHaveBeenCalledWith(PRUNE_RATE_WINDOWS, [new Date(AT)])
    })

    it("counts a request without an address under the unknown key", async () => {
        const entityManager = mockEntityManager({ query: [HIT_RATE_WINDOW, [{ hits: 2 }]] })
        const { guard } = await build(entityManager)

        await expect(guard.canActivate(contextOf(undefined))).resolves.toBe(true)
        expect(entityManager.query).toHaveBeenCalledWith(HIT_RATE_WINDOW, [
            "default:unknown",
            new Date(AT),
            new Date(RESET_AT),
        ])
    })

    it("bounds the window key to the length the table stores", async () => {
        const entityManager = mockEntityManager({ query: [HIT_RATE_WINDOW, [{ hits: 2 }]] })
        const { guard } = await build(entityManager)

        await guard.canActivate(contextOf("f".repeat(300)))

        expect(entityManager.query).toHaveBeenCalledWith(HIT_RATE_WINDOW, [
            `default:${"f".repeat(120)}`,
            new Date(AT),
            new Date(RESET_AT),
        ])
    })

    it("refuses the request when the store answers no window", async () => {
        const { guard } = await build(mockEntityManager({ query: [HIT_RATE_WINDOW, []] }))

        await expect(guard.canActivate(contextOf("127.0.0.1"))).rejects.toMatchObject({
            code: HttpSecurityErrorCode.RateLimited,
        })
    })
})
