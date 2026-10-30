import { Test } from "@nestjs/testing"
import { exportPKCS8, generateKeyPair, SignJWT } from "jose"
import { Secret } from "@modules/platform/config"
import { PassportErrorCode } from "./errors/passport.error"
import { createTokenKit, tokenKit } from "./passport.tokens"

const TOKENS: unique symbol = Symbol("passport.tokens")

type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"]

const ISSUER = "https://api.example.test"
const AUDIENCE = "app"

const build = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [{ provide: TOKENS, useValue: { createTokenKit, tokenKit } }],
    }).compile()
    return moduleRef.get<{ createTokenKit: typeof createTokenKit; tokenKit: typeof tokenKit }>(TOKENS)
}

const keyPair = async () => {
    const { privateKey } = await generateKeyPair("ES256", { extractable: true })
    return { privateKey, options: { issuer: ISSUER, audience: AUDIENCE, privateKey: new Secret(await exportPKCS8(privateKey)), keyId: "k1", accessTtlSeconds: 60 } }
}

/** A token the kit's own key signs with the given claims, so only the claim checks can refuse it. */
const ownSigned = (privateKey: SigningKey, claims: Record<string, unknown>, { subject = "user-1", expires = true } = {}) => {
    const jwt = new SignJWT(claims).setProtectedHeader({ alg: "ES256", kid: "k1" }).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt()
    if (subject !== "") jwt.setSubject(subject)
    if (expires) jwt.setExpirationTime("60s")
    return jwt.sign(privateKey)
}

describe("createTokenKit", () => {
    it("verifies its own token with an email against its own key set and publishes only the public key", async () => {
        const subject = await build()
        const { options } = await keyPair()
        const kit = await subject.createTokenKit(options)

        expect(await kit.verify(await kit.issue({ id: "user-1", email: "a@example.test" }))).toEqual({ kind: "ok", value: { id: "user-1", role: "authenticated", email: "a@example.test" } })
        expect(kit.jwks.keys).toHaveLength(1)
        expect(kit.jwks.keys[0]).toMatchObject({ kid: "k1", alg: "ES256", use: "sig", kty: "EC", crv: "P-256" })
        expect(kit.jwks.keys[0]).not.toHaveProperty("d")
    })

    it("issues a token without an email claim for a user who has none", async () => {
        const subject = await build()
        const { options } = await keyPair()
        const kit = await subject.createTokenKit(options)

        expect(await kit.verify(await kit.issue({ id: "user-2" }))).toEqual({ kind: "ok", value: { id: "user-2", role: "authenticated" } })
    })

    it("refuses a token another key signed, naming the failed signature", async () => {
        const subject = await build()
        const kit = await subject.createTokenKit((await keyPair()).options)
        const other = await subject.createTokenKit((await keyPair()).options)

        expect(await kit.verify(await other.issue({ id: "user-1" }))).toEqual({
            kind: "refused",
            code: PassportErrorCode.AccessTokenInvalid,
            params: { cause: "JWSSignatureVerificationFailed: signature verification failed" },
        })
    })

    it("refuses a correctly signed token whose subject, expiry or role is not the one it issues", async () => {
        const subject = await build()
        const { privateKey, options } = await keyPair()
        const kit = await subject.createTokenKit(options)
        const invalid = { kind: "refused", code: PassportErrorCode.AccessTokenInvalid }

        expect(await kit.verify(await ownSigned(privateKey, { role: "authenticated" }, { subject: "" }))).toEqual(invalid)
        expect(await kit.verify(await ownSigned(privateKey, { role: "authenticated" }, { expires: false }))).toEqual(invalid)
        expect(await kit.verify(await ownSigned(privateKey, { role: "service_role" }))).toEqual(invalid)
        expect(await kit.verify(await ownSigned(privateKey, { role: "authenticated", email: 7 }))).toEqual({ kind: "ok", value: { id: "user-1", role: "authenticated" } })
    })
})

describe("tokenKit", () => {
    it("signs, verifies and publishes through the one key import it starts", async () => {
        const subject = await build()
        const { options } = await keyPair()
        const kit = subject.tokenKit(options)

        expect(await kit.verify(await kit.issue({ id: "user-3", email: "c@example.test" }))).toEqual({ kind: "ok", value: { id: "user-3", role: "authenticated", email: "c@example.test" } })
        expect((await kit.jwks()).keys.map((key) => key.kid)).toEqual(["k1"])
    })
})
