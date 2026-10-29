import "reflect-metadata"
import type { ExecutionContext, Type } from "@nestjs/common"
import type { Request, Response } from "express"
import { Reflector } from "@nestjs/core"
import { Test } from "@nestjs/testing"
import { In, LessThanOrEqual, MoreThan } from "typeorm"
import { FakeClock, mock, mockEntityManager, queueQueryBuilders } from "@starci/jest-preset"
import type { MockEntityManager } from "@starci/jest-preset"
import { CLOCK } from "@modules/platform/clock"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { HttpSecurityErrorCode } from "./errors/http-security.error"
import { HTTP_SECURITY_OPTIONS } from "./http-security.decorators"
import type { HttpSecurityOptions } from "./http-security.options"
import { RateWindowEntity } from "./persistence/entities/rate-window.entity"
import { RateLimit, RateLimitGuard, RateTier } from "./rate-limit.guard"
import type { RateLimitExceeded } from "./rate-limit.guard"

const AT = "2026-02-03T04:05:06.000Z"
const RESET_AT = "2026-02-03T04:06:06.000Z"
const options: HttpSecurityOptions = {
    allowedOrigins: [],
    rateLimit: { windowMs: 60_000, defaultLimit: 2, strictLimit: 1 },
    webhooks: {},
}

/** The caller's live window holding `hits`. */
const windowOf = (hits: number): RateWindowEntity => ({ key: "default:127.0.0.1", hits, resetAt: new Date(RESET_AT) })

/** The answers of a store whose live window of the caller holds `hits` after this hit's increment. */
const liveWindow = (hits: number) =>
    ({ increment: [RateWindowEntity, { affected: 1 }], findOneBy: [RateWindowEntity, windowOf(hits)] }) as const

/** The answers of a store where this hit opens the caller's window (no live or ended one) and the prune finds none ended. */
const OPENING_WINDOW = {
    increment: [RateWindowEntity, { affected: 0 }],
    update: [RateWindowEntity, { affected: 0 }],
    find: [RateWindowEntity, []],
} as const

const build = async (entityManager: MockEntityManager, tier?: RateTier, exceeded?: RateLimitExceeded) => {
    const reflector = mock<Reflector>()
    reflector.getAllAndOverride.mockImplementation((key: unknown) =>
        key === "platform.http-security.rate-exceeded" ? exceeded : tier,
    )
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
const contextOf = (
    ip: string | undefined,
    handler = () => undefined,
    door: Type<unknown> = class Door {},
    response = mock<Response>(),
) => {
    const http = mock<ReturnType<ExecutionContext["switchToHttp"]>>()
    http.getRequest.mockImplementation(() => mock<Request>({ headers: {}, method: "POST", ip }))
    http.getResponse.mockReturnValue(response)
    const context = mock<ExecutionContext>()
    context.getType.mockReturnValue("http")
    context.switchToHttp.mockReturnValue(http)
    context.getHandler.mockReturnValue(handler)
    context.getClass.mockReturnValue(door)
    return context
}

describe("RateLimit", () => {
    it("marks a door with the tier it declares, and the guard counts it under that tier's limit", async () => {
        class Door {}
        RateLimit(RateTier.Strict)(Door)
        const entityManager = mockEntityManager(liveWindow(2))
        const { guard, reflector } = await build(entityManager, RateTier.Strict)
        const handler = () => undefined

        expect(Reflect.getMetadata("platform.http-security.rate-tier", Door)).toBe(RateTier.Strict)
        await expect(guard.canActivate(contextOf("127.0.0.1", handler, Door))).rejects.toMatchObject({
            code: HttpSecurityErrorCode.RateLimited,
        })
        expect(reflector.getAllAndOverride).toHaveBeenCalledWith("platform.http-security.rate-tier", [handler, Door])
        expect(entityManager.increment).toHaveBeenCalledWith(
            RateWindowEntity,
            { key: "strict:127.0.0.1", resetAt: MoreThan(new Date(AT)) },
            "hits",
            1,
        )
    })

    it("marks a redirect-only door with its exceeded redirect beside the tier", () => {
        class Door {}
        RateLimit(RateTier.Strict, { redirect: "/sign-in?auth=error" })(Door)

        expect(Reflect.getMetadata("platform.http-security.rate-tier", Door)).toBe(RateTier.Strict)
        expect(Reflect.getMetadata("platform.http-security.rate-exceeded", Door)).toEqual({
            redirect: "/sign-in?auth=error",
        })
    })

    it.each(["https://foreign.test/sign-in", "//foreign.test/sign-in", "/\\foreign.test", "sign-in"])(
        "refuses an exceeded redirect %s that is not a same-site path",
        (redirect) => {
            expect(() => RateLimit(RateTier.Strict, { redirect })).toThrow(HttpSecurityErrorCode.RequestInvalid)
        },
    )
})

describe("RateLimitGuard", () => {
    it("admits a caller under the default limit of an unmarked door, counting in the shared live window", async () => {
        const entityManager = mockEntityManager(liveWindow(2))
        const { guard } = await build(entityManager)

        await expect(guard.canActivate(contextOf("127.0.0.1"))).resolves.toBe(true)
        expect(entityManager.findOneBy).toHaveBeenCalledWith(RateWindowEntity, { key: "default:127.0.0.1" })
    })

    it("refuses a caller whose shared window is over the default limit", async () => {
        const { guard } = await build(mockEntityManager(liveWindow(3)))

        await expect(guard.canActivate(contextOf("127.0.0.1"))).rejects.toMatchObject({
            code: HttpSecurityErrorCode.RateLimited,
        })
    })

    it("refuses the request when the counted window vanished before it was read", async () => {
        const entityManager = mockEntityManager({
            increment: [RateWindowEntity, { affected: 1 }],
            findOneBy: [RateWindowEntity, null],
        })
        const { guard } = await build(entityManager)

        await expect(guard.canActivate(contextOf("127.0.0.1"))).rejects.toMatchObject({
            code: HttpSecurityErrorCode.RateLimited,
        })
    })
})

describe("RateLimitGuard opening a window", () => {
    it("restarts an ended window at one hit and prunes the ended windows", async () => {
        const ended = windowOf(5)
        const entityManager = mockEntityManager({
            increment: [RateWindowEntity, {}],
            update: [RateWindowEntity, { affected: 1 }],
            find: [RateWindowEntity, [ended]],
            delete: [RateWindowEntity, { affected: 1 }],
        })
        const { guard } = await build(entityManager)

        await expect(guard.canActivate(contextOf("127.0.0.1"))).resolves.toBe(true)
        expect(entityManager.update).toHaveBeenCalledWith(
            RateWindowEntity,
            { key: "default:127.0.0.1", resetAt: LessThanOrEqual(new Date(AT)) },
            { hits: 1, resetAt: new Date(RESET_AT) },
        )
        expect(entityManager.find).toHaveBeenCalledWith(RateWindowEntity, {
            select: { key: true },
            where: { resetAt: LessThanOrEqual(new Date(AT)) },
            order: { resetAt: "ASC" },
            take: 100,
        })
        expect(entityManager.delete).toHaveBeenCalledWith(RateWindowEntity, {
            key: In([ended.key]),
            resetAt: LessThanOrEqual(new Date(AT)),
        })
    })

    it("opens a missing window at one hit, ignoring a concurrent opener, and deletes nothing when no window ended", async () => {
        const entityManager = mockEntityManager(OPENING_WINDOW)
        const [opened] = queueQueryBuilders(entityManager, [{ execute: {} }])
        const { guard } = await build(entityManager)

        await expect(guard.canActivate(contextOf("127.0.0.1"))).resolves.toBe(true)
        expect(opened?.callsOf("values")).toEqual([
            [{ key: "default:127.0.0.1", hits: 1, resetAt: new Date(RESET_AT) }],
        ])
        expect(opened?.callsOf("orIgnore")).toEqual([[]])
        expect(entityManager.delete).not.toHaveBeenCalled()
    })

    it("opens a window when the restart answers no affected count", async () => {
        const entityManager = mockEntityManager({
            increment: [RateWindowEntity, { affected: 0 }],
            update: [RateWindowEntity, {}],
            find: [RateWindowEntity, []],
        })
        const [opened] = queueQueryBuilders(entityManager, [{ execute: {} }])
        const { guard } = await build(entityManager)

        await expect(guard.canActivate(contextOf("127.0.0.1"))).resolves.toBe(true)
        expect(opened?.callsOf("insert")).toEqual([[]])
    })
})

describe("RateLimitGuard keys", () => {
    it("counts a request without an address under the unknown key", async () => {
        const entityManager = mockEntityManager(liveWindow(2))
        const { guard } = await build(entityManager)

        await expect(guard.canActivate(contextOf(undefined))).resolves.toBe(true)
        expect(entityManager.findOneBy).toHaveBeenCalledWith(RateWindowEntity, { key: "default:unknown" })
    })

    it("bounds the window key to the length the table stores", async () => {
        const entityManager = mockEntityManager(liveWindow(2))
        const { guard } = await build(entityManager)

        await guard.canActivate(contextOf("f".repeat(300)))

        expect(entityManager.findOneBy).toHaveBeenCalledWith(RateWindowEntity, { key: `default:${"f".repeat(120)}` })
    })
})

describe("RateLimitGuard on a redirect-only door", () => {
    const EXCEEDED: RateLimitExceeded = { redirect: "/sign-in?auth=error" }

    /** A response whose redirect is a plain double, so the spec reads the call without the deprecated overload. */
    const responseOf = () => {
        const redirect = jest.fn()
        return { response: mock<Response>({ redirect }), redirect }
    }

    it("answers the door's own 303 when the caller is over the limit, and still refuses", async () => {
        const { guard } = await build(mockEntityManager(liveWindow(2)), RateTier.Strict, EXCEEDED)
        const { response, redirect } = responseOf()

        await expect(
            guard.canActivate(contextOf("127.0.0.1", () => undefined, class Door {}, response)),
        ).rejects.toMatchObject({ code: HttpSecurityErrorCode.RateLimited })
        expect(redirect).toHaveBeenCalledWith(303, "/sign-in?auth=error")
    })

    it("writes no redirect while the caller is under the limit", async () => {
        const entityManager = mockEntityManager(OPENING_WINDOW)
        queueQueryBuilders(entityManager, [{ execute: {} }])
        const { guard } = await build(entityManager, RateTier.Strict, EXCEEDED)
        const { response, redirect } = responseOf()

        await expect(guard.canActivate(contextOf("127.0.0.1", () => undefined, class Door {}, response))).resolves.toBe(
            true,
        )
        expect(redirect).not.toHaveBeenCalled()
    })

    it("refuses a GraphQL operation over the limit without writing a redirect", async () => {
        const { guard } = await build(mockEntityManager(liveWindow(2)), RateTier.Strict, EXCEEDED)
        const { response, redirect } = responseOf()
        const context = contextOf("127.0.0.1", () => undefined, class Door {}, response)
        context.getType.mockReturnValue("graphql")
        context.getArgs.mockReturnValue([{}, {}, { req: mock<Request>({ headers: {}, ip: "127.0.0.1" }) }, {}])

        await expect(guard.canActivate(context)).rejects.toMatchObject({ code: HttpSecurityErrorCode.RateLimited })
        expect(redirect).not.toHaveBeenCalled()
    })
})
