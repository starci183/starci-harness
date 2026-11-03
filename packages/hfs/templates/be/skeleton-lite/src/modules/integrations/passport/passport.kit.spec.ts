import { Test } from "@nestjs/testing"
import { generateTestKeyPair } from "@starci/auth/testing"
import { PassportErrorCode } from "./errors/passport.error"
import { passportKit } from "./passport.kit"
import type { PassportOptions } from "./passport.options"

const KIT: unique symbol = Symbol("passport.kit")

const FAR_FUTURE = 32_503_680_000_000
const LONG_AGO = 0

const build = async () => {
    const moduleRef = await Test.createTestingModule({ providers: [{ provide: KIT, useValue: { passportKit } }] }).compile()
    return moduleRef.get<{ passportKit: typeof passportKit }>(KIT).passportKit
}

const optionsFor = (keys: PassportOptions["keys"]): PassportOptions => ({
    issuer: "https://api.example.test",
    audience: undefined,
    keys,
    accessTtlSeconds: 60,
    refreshTtlSeconds: 3600,
    reuseGraceMs: undefined,
    bcryptCost: 4,
    returnOrigin: "https://app.example.test",
    google: null,
    cookie: { name: "refresh_token" },
    budget: { loginAttempts: 10, resetAttempts: 5, windowMs: 900_000 },
})

describe("passportKit", () => {
    it("verifies a token its own signer issued and builds the principal from it", async () => {
        const create = await build()
        const kit = create(optionsFor([{ privateKey: generateTestKeyPair().privateKey, keyId: "k1" }]))
        const { token } = await kit.tokens.sign({ sub: "user-1", email: "a@example.test", sessionId: "s-1" }, new Date(FAR_FUTURE))

        expect(await kit.verify(token)).toEqual({ kind: "ok", value: { id: "user-1", role: "authenticated", sessionId: "s-1", email: "a@example.test" } })
        expect((await kit.tokens.jwks()).keys).toHaveLength(1)
    })

    it("refuses an expired token, a token of another key and a token that is no token", async () => {
        const create = await build()
        const kit = create(optionsFor([{ privateKey: generateTestKeyPair().privateKey }]))
        const stranger = create(optionsFor([{ privateKey: generateTestKeyPair().privateKey }]))
        const expired = await kit.tokens.sign({ sub: "user-1", sessionId: "s-1" }, new Date(LONG_AGO))
        const foreign = await stranger.tokens.sign({ sub: "user-1", sessionId: "s-1" }, new Date(FAR_FUTURE))

        for (const token of [expired.token, foreign.token, "not-a-token"]) {
            expect(await kit.verify(token)).toEqual({ kind: "refused", code: PassportErrorCode.AccessTokenInvalid })
        }
    })

    it("keeps verifying the token of a retired key while its public key stays in the set", async () => {
        const create = await build()
        const retired = generateTestKeyPair()
        const before = create(optionsFor([{ privateKey: retired.privateKey, keyId: "old" }]))
        const { token } = await before.tokens.sign({ sub: "user-1", sessionId: "s-1" }, new Date(FAR_FUTURE))
        const after = create(optionsFor([{ privateKey: generateTestKeyPair().privateKey, keyId: "new" }, { publicKey: retired.publicKey, keyId: "old" }]))

        expect((await after.verify(token)).kind).toBe("ok")
        expect((await after.tokens.jwks()).keys.map((key) => key["kid"])).toEqual(["new", "old"])
    })
})
