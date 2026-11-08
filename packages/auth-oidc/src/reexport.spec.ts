import "reflect-metadata"
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import * as mergedClient from "@starci/auth/client/oidc"
import * as merged from "@starci/auth/oidc"
import * as mergedTesting from "@starci/auth/testing"
import * as client from "./client/index.ts"
import * as contracts from "./contracts/index.ts"
import type { OidcPrincipal as RetiredPrincipal } from "./contracts/index.ts"
import * as server from "./server/index.ts"
import * as testing from "./testing/index.ts"

/** The runtime names each entry of 0.2.0 exported: every one is still there, and is the very value `@starci/auth` exports. */
const SERVER_020 = [
    "OidcAdminClient", "adminBaseOf", "OidcBroker", "OidcClient", "OidcDiscovery", "discoveryUrl", "readMetadata", "OidcError", "OidcTokenClient", "OidcKeys", "readKeySet",
    "OidcModule", "OIDC_OPTIONS", "createOidc", "OIDC_ADMIN_CLIENT", "OIDC_BROKER", "OIDC_CLIENT", "OIDC_DISCOVERY", "OIDC_KEYS", "OIDC_PRINCIPAL_VERIFIER", "OIDC_REGISTRATION",
    "OIDC_TOKEN_CLIENT", "OIDC_TOKEN_VERIFIER", "fetchHttp", "isAdmissibleUrl", "resolveOptions", "isRecord", "pkceChallenge", "randomReference", "sameValue", "systemClock",
    "refreshOf", "rolesOf", "OidcTokenVerifier", "OidcPrincipalVerifier", "refuseSessions",
] as const
const CLIENT_020 = ["createOidcClient", "sameSitePath", "OIDC_CLIENT_CODES"] as const
const CONTRACTS_020 = [
    "OIDC_ALGORITHMS", "OIDC_DEFAULT_ALGORITHMS", "OIDC_ROLE", "OIDC_ACCESS_TOKEN_INVALID", "OIDC_ERROR_CODES", "OIDC_ERROR_KINDS", "OIDC_CLAIMS", "OIDC_ROLE_BOUNDS",
    "OIDC_SUBJECT_MAX_LENGTH", "OIDC_CLIENT_CODES",
] as const
const TESTING_020 = ["FakeClock", "FakeOidcIssuer"] as const

const same = (entry: Readonly<Record<string, unknown>>, source: Readonly<Record<string, unknown>>, names: readonly string[]): void => {
    for (const name of names) {
        assert.ok(name in entry, `${name} is still exported`)
        assert.equal(entry[name], source[name], `${name} is the value @starci/auth exports`)
    }
}

describe("@starci/auth-oidc 0.3.0 re-exports @starci/auth", () => {
    it("every runtime name of each 0.2.0 entry is still exported, and is @starci/auth's own value", () => {
        same(server, merged, SERVER_020)
        same(client, mergedClient, CLIENT_020)
        same(contracts, merged, CONTRACTS_020)
        same(testing, mergedTesting, TESTING_020)
        assert.equal(Object.keys(contracts).length, CONTRACTS_020.length, "the contracts entry carries only the OIDC contract")
    })

    it("keeps the injection tokens of 0.2.0, so an app's providers and the merged package resolve the same symbols", () => {
        assert.equal(server.OIDC_PRINCIPAL_VERIFIER, Symbol.for("@starci/auth-oidc/principal-verifier"))
        assert.equal(server.OIDC_BROKER, Symbol.for("@starci/auth-oidc/broker"))
    })

    it("verifies a token of the fake issuer through the retired entries", async () => {
        const issuer = await testing.FakeOidcIssuer.create()
        const outcome = await server.createOidc(issuer.options()).verifier.verify(await issuer.mintAccessToken({ sub: "u-1", roles: ["member"] }))
        const principal: RetiredPrincipal | undefined = outcome.kind === "ok" ? outcome.value : undefined
        assert.deepEqual(principal?.roles, ["member"])
        assert.ok(server.githubActionsIssuer, "the 0.3.0 server entry also passes on what @starci/auth/oidc added")
    })
})
