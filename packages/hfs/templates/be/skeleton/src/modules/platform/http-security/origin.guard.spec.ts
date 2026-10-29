import "reflect-metadata"
import type { ExecutionContext, Type } from "@nestjs/common"
import type { Request } from "express"
import { Reflector } from "@nestjs/core"
import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { HttpSecurityErrorCode } from "./errors/http-security.error"
import { HTTP_SECURITY_OPTIONS, RequireOrigin } from "./http-security.decorators"
import type { HttpSecurityOptions } from "./http-security.options"
import { OriginGuard, ServerToServer } from "./origin.guard"

const options: HttpSecurityOptions = {
    allowedOrigins: ["https://app.test"],
    rateLimit: { windowMs: 60_000, defaultLimit: 100, strictLimit: 10 },
    webhooks: {},
}

class OpenDoor {}

@RequireOrigin()
class CookieDoor {}

class SignInDoor {
    @RequireOrigin()
    start(): undefined {
        return undefined
    }
}

class SignedDoor {}
ServerToServer()(SignedDoor)

const build = async (
    method: string,
    headers: Request["headers"],
    door: Type<unknown> = OpenDoor,
    handler: () => void = () => undefined,
) => {
    const request = mock<Request>({ headers, method })
    const http = mock<ReturnType<ExecutionContext["switchToHttp"]>>()
    http.getRequest.mockReturnValue(request)
    const context = mock<ExecutionContext>()
    context.switchToHttp.mockReturnValue(http)
    context.getHandler.mockReturnValue(handler)
    context.getClass.mockReturnValue(door)
    const moduleRef = await Test.createTestingModule({
        providers: [OriginGuard, Reflector, { provide: HTTP_SECURITY_OPTIONS, useValue: options }],
    }).compile()
    return { guard: moduleRef.get(OriginGuard), context }
}

describe("OriginGuard", () => {
    it.each(["GET", "HEAD", "OPTIONS"])("allows the safe %s method without an origin", async (method) => {
        const { guard, context } = await build(method, { cookie: "session=opaque" }, CookieDoor)

        expect(guard.canActivate(context)).toBe(true)
    })

    it("allows a state-changing request carrying an allowed Origin header", async () => {
        const { guard, context } = await build("POST", {
            origin: "https://app.test",
        })

        expect(guard.canActivate(context)).toBe(true)
    })

    it("falls back to the origin of an allowed Referer when Origin is absent", async () => {
        const { guard, context } = await build("PATCH", {
            referer: "https://app.test/notes/one",
        })

        expect(guard.canActivate(context)).toBe(true)
    })

    it.each([
        { name: "no Origin and no Referer", headers: {} },
        { name: "a Referer that is not a URL", headers: { referer: "not a URL" } },
        {
            name: "an Origin outside the allowlist",
            headers: { origin: "https://foreign.test" },
        },
        { name: "the opaque null Origin", headers: { origin: "null" } },
        {
            name: "a Referer outside the allowlist",
            headers: { referer: "https://foreign.test/form" },
        },
        {
            name: "a foreign Origin beside an allowed Referer",
            headers: {
                origin: "https://foreign.test",
                referer: "https://app.test/notes/one",
            },
        },
    ])("refuses a state-changing request with $name", async ({ headers }) => {
        const { guard, context } = await build("DELETE", headers)

        expect(() => guard.canActivate(context)).toThrow(HttpSecurityErrorCode.OriginRejected)
    })

    it("allows a state-changing request without an origin on a door marked server-to-server", async () => {
        const { guard, context } = await build("POST", {}, SignedDoor)

        expect(guard.canActivate(context)).toBe(true)
    })
})

describe("OriginGuard", () => {
    it.each(["POST", "PUT", "PATCH", "DELETE"])(
        "allows a cookie-bearing %s with an actual allowed Origin",
        async (method) => {
            const { guard, context } = await build(method, {
                origin: "https://app.test",
                cookie: "session=opaque",
            })

            expect(guard.canActivate(context)).toBe(true)
        },
    )

    it.each([
        { name: "no Origin", headers: {} },
        {
            name: "an allowed Referer alone",
            headers: { referer: "https://app.test/form" },
        },
        { name: "a malformed Referer alone", headers: { referer: "not a URL" } },
        { name: "a foreign Origin", headers: { origin: "https://foreign.test" } },
        { name: "an opaque Origin", headers: { origin: "null" } },
        { name: "an empty Origin", headers: { origin: "" } },
        {
            name: "a foreign Origin beside an allowed Referer",
            headers: {
                origin: "https://foreign.test",
                referer: "https://app.test/form",
            },
        },
    ])("refuses a cookie-bearing mutation with $name", async ({ headers }) => {
        const { guard, context } = await build("POST", {
            ...headers,
            cookie: "session=opaque",
        })

        expect(() => guard.canActivate(context)).toThrow(HttpSecurityErrorCode.OriginRejected)
    })
})

describe("OriginGuard", () => {
    it.each([{}, { referer: "https://app.test/sign-in" }])(
        "refuses a marked cookie-flow door without Origin before a cookie exists (%o)",
        async (headers) => {
            const { guard, context } = await build("POST", headers, CookieDoor)

            expect(() => guard.canActivate(context)).toThrow(HttpSecurityErrorCode.OriginRejected)
        },
    )

    it("requires Origin on an individually marked handler before a cookie exists", async () => {
        const { guard, context } = await build("POST", {}, SignInDoor, SignInDoor.prototype.start)

        expect(() => guard.canActivate(context)).toThrow(HttpSecurityErrorCode.OriginRejected)
    })

    it("admits a marked cookie-flow door with an actual allowed Origin before a cookie exists", async () => {
        const { guard, context } = await build("POST", { origin: "https://app.test" }, CookieDoor)

        expect(guard.canActivate(context)).toBe(true)
    })

    it("refuses Referer-only admission when a server-to-server door receives a cookie", async () => {
        const { guard, context } = await build(
            "POST",
            { cookie: "session=opaque", referer: "https://app.test/form" },
            SignedDoor,
        )

        expect(() => guard.canActivate(context)).toThrow(HttpSecurityErrorCode.OriginRejected)
    })

    it("refuses Referer-only admission when a server-to-server handler requires Origin", async () => {
        const { guard, context } = await build(
            "POST",
            { referer: "https://app.test/form" },
            SignedDoor,
            SignInDoor.prototype.start,
        )

        expect(() => guard.canActivate(context)).toThrow(HttpSecurityErrorCode.OriginRejected)
    })
})
