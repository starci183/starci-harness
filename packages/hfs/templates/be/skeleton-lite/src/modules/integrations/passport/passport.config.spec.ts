import { Test } from "@nestjs/testing"
import { EnvSource } from "@modules/platform/config"
import { parsePassportConfig } from "./passport.config"

const CONFIG: unique symbol = Symbol("passport.config")

const REQUIRED = {
    AUTH_JWT_ISSUER: "https://api.example.com",
    AUTH_JWT_PRIVATE_KEY: "key",
    AUTH_WEB_ORIGIN: "https://app.example.com/home",
}

const build = async () => {
    const moduleRef = await Test.createTestingModule({ providers: [{ provide: CONFIG, useValue: { parsePassportConfig } }] }).compile()
    return moduleRef.get<{ parsePassportConfig: typeof parsePassportConfig }>(CONFIG)
}

const parse = async (extra: Record<string, string>) => (await build()).parsePassportConfig(new EnvSource({ ...REQUIRED, ...extra }))

describe("the required keys", () => {
    it("reads the issuer, the web origin and the signing key, and defaults the lifetimes and the budget", async () => {
        const options = await parse({})
        expect(options.issuer).toBe("https://api.example.com")
        expect(options.returnOrigin).toBe("https://app.example.com")
        expect(options.keys).toHaveLength(1)
        expect(options.audience).toBeUndefined()
        expect(options).toMatchObject({
            accessTtlSeconds: 900,
            refreshTtlSeconds: 2_592_000,
            bcryptCost: 10,
            google: null,
            cookie: { name: "refresh_token" },
            budget: { loginAttempts: 10, resetAttempts: 5, windowMs: 900_000 },
        })
    })

    it("refuses a boot without the signing key", async () => {
        const subject = await build()
        const { AUTH_JWT_PRIVATE_KEY: _key, ...without } = REQUIRED
        expect(() => subject.parsePassportConfig(new EnvSource(without))).toThrow()
    })
})

describe("the Google client", () => {
    it("is declared by its client id and then needs its secret and callback", async () => {
        const options = await parse({ GOOGLE_CLIENT_ID: "client", GOOGLE_CLIENT_SECRET: "secret", GOOGLE_CALLBACK_URL: "https://api.example.com/auth/google/callback" })
        expect(options.google).toMatchObject({ clientId: "client", callbackUrl: "https://api.example.com/auth/google/callback" })
        await expect(parse({ GOOGLE_CLIENT_ID: "client" })).rejects.toBeDefined()
    })
})

describe("the key set", () => {
    it("keeps the previous public key beside the signing key while a rotation runs", async () => {
        const options = await parse({ AUTH_JWT_KEY_ID: "new", AUTH_JWT_PREVIOUS_PUBLIC_KEY: "previous-pem", AUTH_JWT_PREVIOUS_KEY_ID: "old" })
        expect(options.keys.map((key) => key.keyId)).toEqual(["new", "old"])
        expect(options.keys[1]?.publicKey).toBe("previous-pem")
    })
})

describe("AUTH_COOKIE_DOMAIN", () => {
    it("leaves the refresh cookie host-only when the key is not declared", async () => {
        expect((await parse({})).cookie.domain).toBeUndefined()
    })

    it("reads a bare registrable domain", async () => {
        expect((await parse({ AUTH_COOKIE_DOMAIN: "example.com" })).cookie.domain).toBe("example.com")
        expect((await parse({ AUTH_COOKIE_DOMAIN: "Sub.Example.CO.uk" })).cookie.domain).toBe("sub.example.co.uk")
    })

    it.each(["https://example.com", "example.com:443", "example.com/path", ".example.com", "localhost", "127.0.0.1", "exa mple.com", "-a.example.com"])(
        "refuses %s at boot, naming the key",
        async (value) => {
            await expect(parse({ AUTH_COOKIE_DOMAIN: value })).rejects.toMatchObject({ code: "CONFIG_KEY_INVALID", params: { key: "AUTH_COOKIE_DOMAIN" } })
        },
    )
})
