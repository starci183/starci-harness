import { Test } from "@nestjs/testing"
import { EnvSource } from "@modules/platform/config"
import { parsePassportConfig } from "./passport.config"

const CONFIG: unique symbol = Symbol("passport.config")

const REQUIRED = {
    GOOGLE_CLIENT_ID: "client",
    GOOGLE_CLIENT_SECRET: "client-secret",
    GOOGLE_CALLBACK_URL: "https://api.example.com/auth/google/callback",
    AUTH_JWT_ISSUER: "https://api.example.com",
    AUTH_JWT_AUDIENCE: "app",
    AUTH_JWT_PRIVATE_KEY: "key",
    AUTH_JWT_KEY_ID: "kid-1",
}

const build = async () => {
    const moduleRef = await Test.createTestingModule({ providers: [{ provide: CONFIG, useValue: { parsePassportConfig } }] }).compile()
    return moduleRef.get<{ parsePassportConfig: typeof parsePassportConfig }>(CONFIG)
}

const parse = async (extra: Record<string, string>) => (await build()).parsePassportConfig(new EnvSource({ ...REQUIRED, ...extra }))

describe("AUTH_COOKIE_DOMAIN", () => {
    it("leaves the refresh cookie host-only when the key is not declared", async () => {
        expect((await parse({})).refresh.cookieDomain).toBeUndefined()
    })

    it("reads a bare registrable domain", async () => {
        expect((await parse({ AUTH_COOKIE_DOMAIN: "example.com" })).refresh.cookieDomain).toBe("example.com")
        expect((await parse({ AUTH_COOKIE_DOMAIN: "Sub.Example.CO.uk" })).refresh.cookieDomain).toBe("sub.example.co.uk")
    })

    it.each(["https://example.com", "example.com:443", "example.com/path", ".example.com", "localhost", "127.0.0.1", "exa mple.com", "-a.example.com"])(
        "refuses %s at boot, naming the key",
        async (value) => {
            await expect(parse({ AUTH_COOKIE_DOMAIN: value })).rejects.toMatchObject({ code: "CONFIG_KEY_INVALID", params: { key: "AUTH_COOKIE_DOMAIN" } })
        },
    )
})
