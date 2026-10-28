import "reflect-metadata"
import type { ExecutionContext, Type } from "@nestjs/common"
import type { Request } from "express"
import { Reflector } from "@nestjs/core"
import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { HttpSecurityErrorCode } from "./errors/http-security.error"
import { HTTP_SECURITY_OPTIONS } from "./http-security.decorators"
import type { HttpSecurityOptions } from "./http-security.options"
import { OriginGuard, ServerToServer } from "./origin.guard"

const options: HttpSecurityOptions = {
    allowedOrigins: ["https://app.test"],
    rateLimit: { windowMs: 60_000, defaultLimit: 100, strictLimit: 10 },
    webhooks: {},
}

class OpenDoor {}

class SignedDoor {}
ServerToServer()(SignedDoor)

const build = async (method: string, headers: Request["headers"], door: Type<unknown> = OpenDoor) => {
    const request = mock<Request>({ headers, method })
    const http = mock<ReturnType<ExecutionContext["switchToHttp"]>>()
    http.getRequest.mockReturnValue(request)
    const context = mock<ExecutionContext>()
    context.switchToHttp.mockReturnValue(http)
    context.getHandler.mockReturnValue(() => undefined)
    context.getClass.mockReturnValue(door)
    const moduleRef = await Test.createTestingModule({
        providers: [OriginGuard, Reflector, { provide: HTTP_SECURITY_OPTIONS, useValue: options }],
    }).compile()
    return { guard: moduleRef.get(OriginGuard), context }
}

describe("OriginGuard", () => {
    it.each(["GET", "HEAD", "OPTIONS"])("allows the safe %s method without an origin", async (method) => {
        const { guard, context } = await build(method, {})

        expect(guard.canActivate(context)).toBe(true)
    })

    it("allows a state-changing request carrying an allowed Origin header", async () => {
        const { guard, context } = await build("POST", { origin: "https://app.test" })

        expect(guard.canActivate(context)).toBe(true)
    })

    it("falls back to the origin of an allowed Referer when Origin is absent", async () => {
        const { guard, context } = await build("PATCH", { referer: "https://app.test/notes/one" })

        expect(guard.canActivate(context)).toBe(true)
    })

    it.each([
        { name: "no Origin and no Referer", headers: {} },
        { name: "a Referer that is not a URL", headers: { referer: "not a URL" } },
        { name: "an Origin outside the allowlist", headers: { origin: "https://foreign.test" } },
        { name: "the opaque null Origin", headers: { origin: "null" } },
        { name: "a Referer outside the allowlist", headers: { referer: "https://foreign.test/form" } },
        {
            name: "a foreign Origin beside an allowed Referer",
            headers: { origin: "https://foreign.test", referer: "https://app.test/notes/one" },
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
