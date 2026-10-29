import { exportPKCS8, generateKeyPair } from "jose"
import { Secret } from "@modules/platform/config"
import { createTokenKit } from "./passport.tokens"

const options = async () => {
    const { privateKey } = await generateKeyPair("ES256", { extractable: true })
    return {
        issuer: "https://api.example.test",
        audience: "app",
        privateKey: new Secret(await exportPKCS8(privateKey)),
        keyId: "k1",
        accessTtlSeconds: 60,
    }
}

describe("createTokenKit", () => {
    it("verifies its own token against its own key set and publishes only the public key", async () => {
        const kit = await createTokenKit(await options())
        const verified = await kit.verify(await kit.issue({ id: "user-1", email: "a@example.test" }))

        expect(verified).toEqual({ kind: "ok", value: { id: "user-1", role: "authenticated", email: "a@example.test" } })
        expect(kit.jwks.keys).toHaveLength(1)
        expect(kit.jwks.keys[0]).not.toHaveProperty("d")
    })

    it("refuses a token another key signed", async () => {
        const kit = await createTokenKit(await options())
        const other = await createTokenKit(await options())

        expect((await kit.verify(await other.issue({ id: "user-1" }))).kind).toBe("refused")
    })
})
