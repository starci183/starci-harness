import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { AuthClient } from "@starci/auth/client"
import type { AuthPrincipal, PrincipalVerifier as LitePrincipalVerifier } from "@starci/auth/server"
import type { OidcAuthClient } from "./client/index.ts"
import { createOidcClient } from "./client/index.ts"
import type { OidcClientOutcome, OidcPrincipal, PrincipalVerifier } from "./contracts/index.ts"
import { createOidc } from "./server/oidc.ts"
import { FakeOidcIssuer } from "./testing/index.ts"

/** The part of `AuthClient` of `@starci/auth/client` a session consumer reads; the OIDC client answers all of it. */
type SessionSurface = Pick<AuthClient, "signOut" | "renew" | "accessToken" | "peek" | "user" | "headers" | "drop" | "subscribe" | "getSnapshot" | "getServerSnapshot" | "watch">

describe("one interface in both editions", () => {
    it("the OIDC verifier is a PrincipalVerifier of @starci/auth, so a guard typed against it does not change", async () => {
        const issuer = await FakeOidcIssuer.create()
        const oidc = createOidc(issuer.options())
        const lite: LitePrincipalVerifier = oidc.verifier
        const own: PrincipalVerifier = oidc.verifier
        const outcome = await lite.verify(await issuer.mintAccessToken({ sub: "u" }))
        assert.equal(outcome.kind, "ok")
        assert.equal((await own.verify("junk")).kind, "refused")
        const principal: AuthPrincipal = outcome.value
        assert.equal(principal.role, "authenticated")
    })

    it("the principal is an AuthPrincipal with roles added, and the refusal carries the code @starci/auth refuses with", async () => {
        const issuer = await FakeOidcIssuer.create()
        const verifier = createOidc(issuer.options()).verifier
        const outcome = await verifier.verify(await issuer.mintAccessToken({ roles: ["x"] }))
        const principal: OidcPrincipal | undefined = outcome.kind === "ok" ? outcome.value : undefined
        assert.deepEqual(principal?.roles, ["x"])
        const refusal = await verifier.verify("junk")
        assert.equal(refusal.kind === "refused" && refusal.code, "PASSPORT_ACCESS_TOKEN_INVALID")
    })

    it("the OIDC client answers the session surface of createAuthClient, and its outcomes have the shape of AuthOutcome", () => {
        const client: OidcAuthClient = createOidcClient({ issuer: "https://idp.test/realms/t", clientId: "c", redirectUri: "https://app.test/cb" })
        const surface: SessionSurface = client
        assert.equal(surface.getSnapshot().status, "loading")
        const failed: OidcClientOutcome<number> = { success: false, message: "refused", error: "x" }
        assert.equal(failed.success, false)
    })
})
