import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { OIDC_ACCESS_TOKEN_INVALID, OIDC_ERROR_CODES } from "../../contracts/oidc.ts"
import type { OidcOutcome } from "../../contracts/oidc.ts"
import { FakeClock, FakeOidcIssuer } from "../../testing/index.ts"
import { OidcError } from "../errors.ts"
import { GITHUB_ACTIONS_ISSUER, GITHUB_ACTIONS_JWKS_URI, githubActionsIssuer } from "./github-actions.ts"
import type { GitHubActionsIssuerOptions } from "./github-actions.ts"
import { GOOGLE_ISSUER, GOOGLE_ISSUER_ALIAS, GOOGLE_JWKS_URI, googleIssuer } from "./google.ts"
import { createIssuerVerifier, mapped, unmapped } from "./issuer.ts"
import type { IssuerPreset } from "./issuer.ts"
import { keycloakIssuer, keycloakIssuerUrl, keycloakOptions } from "./keycloak.ts"

const reasonOf = (outcome: OidcOutcome<unknown>): unknown => (outcome.kind === "refused" ? outcome.detail?.reason : "ok")
const claimOf = (outcome: OidcOutcome<unknown>): unknown => (outcome.kind === "refused" ? outcome.detail?.claim : undefined)
const valueOf = <T>(outcome: OidcOutcome<T>): T => {
    assert.equal(outcome.kind, "ok", JSON.stringify(outcome))
    return (outcome as { readonly value: T }).value
}

const fake = async () => {
    const clock = new FakeClock()
    const issuer = await FakeOidcIssuer.create({ clock, audience: "ci-attestation" })
    return { clock, issuer, transport: { http: issuer.http, clock } }
}

/** The claims a workflow run of `starci183/starci-next` on main carries. */
const RUN = {
    repository: "starci183/starci-next",
    repository_id: "123456789",
    repository_owner: "starci183",
    workflow: "CI",
    workflow_ref: "starci183/starci-next/.github/workflows/ci.yml@refs/heads/main",
    ref: "refs/heads/main",
    sha: "0123456789abcdef0123456789abcdef01234567",
    run_id: "987654321",
    run_attempt: "1",
    actor: "starci183",
    event_name: "push",
}
const SUB = "repo:starci183/starci-next:ref:refs/heads/main"

describe("issuer presets: the contract", () => {
    it("a preset is data and one mapping; the verifier pins the algorithm, the issuer, the audience and the required claims before the mapping runs", async () => {
        const { issuer, transport } = await fake()
        const preset: IssuerPreset<string> = {
            name: "stub",
            issuer: issuer.issuer,
            issuerAliases: [],
            keys: { kind: "jwks", uri: issuer.endpoints().jwksUri },
            algorithms: ["RS256"],
            audience: ["ci-attestation"],
            requiredClaims: ["team"],
            identityOf: (claims) => (claims.team === "core" ? mapped(String(claims.sub)) : unmapped("policy", "team")),
        }
        const verifier = createIssuerVerifier(preset, transport)
        assert.equal(verifier.preset, preset)
        assert.equal(valueOf(await verifier.verify(await issuer.mintAccessToken({ sub: "u-1", extra: { team: "core" } }))), "u-1")
        const other = await verifier.verify(await issuer.mintAccessToken({ extra: { team: "web" } }))
        assert.deepEqual(other, { kind: "refused", code: OIDC_ACCESS_TOKEN_INVALID, detail: { reason: "policy", claim: "team" } })
        assert.equal(reasonOf(await verifier.verify(await issuer.mintAccessToken())), "claims", "a required claim is missing")
        assert.equal(reasonOf(await verifier.verify("junk")), "malformed")
    })

    it("refuses a preset without an audience, with an algorithm outside the asymmetric list or with a key address it cannot trust", () => {
        const base: IssuerPreset<string> = { name: "x", issuer: "https://idp.test", issuerAliases: [], keys: { kind: "jwks", uri: "https://idp.test/keys" }, algorithms: ["RS256"], audience: ["a"], requiredClaims: [], identityOf: () => mapped("x") }
        const configuration = (error: unknown) => error instanceof OidcError && error.code === OIDC_ERROR_CODES.ConfigurationInvalid
        assert.throws(() => createIssuerVerifier({ ...base, audience: [] }), configuration)
        assert.throws(() => createIssuerVerifier({ ...base, algorithms: ["HS256" as never] }), configuration)
        assert.throws(() => createIssuerVerifier({ ...base, keys: { kind: "jwks", uri: "http://idp.test/keys" } }), configuration)
        assert.equal(unmapped("claims").kind, "refused")
        assert.deepEqual(unmapped("claims"), { kind: "refused", reason: "claims" })
    })
})

describe("issuer presets: Keycloak", () => {
    it("verifies a realm access token through the realm's discovery document and builds the principal the module's verifier builds", async () => {
        const { issuer, transport } = await fake()
        const preset = keycloakIssuer({ origin: "https://idp.test", realm: "test", audience: "ci-attestation" })
        assert.equal(preset.issuer, issuer.issuer)
        assert.equal(keycloakIssuerUrl("https://idp.test/", "a b"), "https://idp.test/realms/a%20b")
        const principal = valueOf(await createIssuerVerifier(preset, transport).verify(await issuer.mintAccessToken({ sub: "user-9", roles: ["admin"], email: "a@example.test" })))
        assert.deepEqual([principal.id, principal.roles, principal.email, principal.issuer], ["user-9", ["admin"], "a@example.test", issuer.issuer])
        assert.equal(issuer.count("/.well-known/openid-configuration"), 1)
    })

    it("refuses an ID token as a bearer, another authorized party and a token for another audience", async () => {
        const { issuer, transport } = await fake()
        const verifier = createIssuerVerifier(keycloakIssuer({ origin: "https://idp.test", realm: "test", audience: "ci-attestation", authorizedParty: "someone-else" }), transport)
        assert.equal(reasonOf(await verifier.verify(await issuer.mintAccessToken())), "authorized-party")
        const plain = createIssuerVerifier(keycloakIssuer({ origin: "https://idp.test", realm: "test", audience: ["ci-attestation"], roles: { realm: false, claims: ["groups"] } }), transport)
        assert.equal(reasonOf(await plain.verify(await issuer.mintIdToken({}, undefined, { audience: "ci-attestation" }))), "token-type")
        assert.equal(reasonOf(await plain.verify(await issuer.mintAccessToken({ extra: { groups: "not-a-list" } }))), "claims")
        assert.equal(reasonOf(await plain.verify(await issuer.mintAccessToken({}, { audience: "other" }))), "audience")
    })

    it("gives the trust half of an OidcModule registration", () => {
        assert.deepEqual(keycloakOptions({ origin: "https://id.example.com", realm: "app", audience: "api" }), {
            issuer: "https://id.example.com/realms/app",
            audience: "api",
            algorithms: ["RS256"],
            authorizedParty: undefined,
            roles: undefined,
        })
        assert.equal(keycloakOptions({ origin: "x", realm: "y", audience: "a", endpoints: { issuer: "https://double.test/realms/y" } }).issuer, "https://double.test/realms/y")
    })
})

describe("issuer presets: Google ID tokens", () => {
    it("pins accounts.google.com, both spellings of it and Google's key set", () => {
        const preset = googleIssuer({ clientId: "web-client" })
        assert.deepEqual([preset.issuer, preset.issuerAliases, preset.keys, preset.algorithms, preset.audience], [GOOGLE_ISSUER, [GOOGLE_ISSUER_ALIAS], { kind: "jwks", uri: GOOGLE_JWKS_URI }, ["RS256"], ["web-client"]])
    })

    it("maps a verified Google account to the profile the lite flow gives, and refuses an unverified address, another Workspace and another client", async () => {
        const { issuer, transport } = await fake()
        const verifier = createIssuerVerifier(googleIssuer({ clientId: ["ci-attestation"], hostedDomain: "example.test", endpoints: issuer.endpoints() }), transport)
        const claims = { sub: "1077", email: "a@example.test", name: "A", extra: { email_verified: true, hd: "example.test", picture: "https://p.test/a.png" } }
        assert.deepEqual(valueOf(await verifier.verify(await issuer.mintIdToken(claims, undefined, { audience: "ci-attestation" }))), {
            subject: "1077",
            email: "a@example.test",
            emailVerified: true,
            name: "A",
            picture: "https://p.test/a.png",
            hostedDomain: "example.test",
        })
        const unverified = await verifier.verify(await issuer.mintIdToken({ ...claims, extra: { email_verified: false, hd: "example.test" } }, undefined, { audience: "ci-attestation" }))
        assert.deepEqual([reasonOf(unverified), claimOf(unverified)], ["policy", "email_verified"])
        const workspace = await verifier.verify(await issuer.mintIdToken({ ...claims, extra: { email_verified: "true", hd: "other.test" } }, undefined, { audience: "ci-attestation" }))
        assert.deepEqual([reasonOf(workspace), claimOf(workspace)], ["policy", "hd"])
        assert.equal(reasonOf(await verifier.verify(await issuer.mintIdToken(claims, undefined, { audience: "another-client" }))), "audience")
        const consumer = createIssuerVerifier(googleIssuer({ clientId: "ci-attestation", requireVerifiedEmail: false, endpoints: issuer.endpoints() }), transport)
        const plain = valueOf(await consumer.verify(await issuer.mintIdToken({ sub: "5" }, undefined, { audience: "ci-attestation" })))
        assert.deepEqual([plain.email, plain.emailVerified, plain.hostedDomain, plain.name], [null, false, null, null])
    })
})

describe("issuer presets: GitHub Actions OIDC (the CI attestation of a workflow run)", () => {
    const build = async (overrides: Partial<GitHubActionsIssuerOptions> = {}) => {
        const context = await fake()
        const verifier = createIssuerVerifier(githubActionsIssuer({ audience: "ci-attestation", repository: "starci183/starci-next", endpoints: context.issuer.endpoints(), ...overrides }), context.transport)
        const mint = (extra: Readonly<Record<string, unknown>> = {}, more: Parameters<FakeOidcIssuer["mintAccessToken"]>[1] = {}) => context.issuer.mintAccessToken({ sub: SUB, extra: { ...RUN, ...extra } }, more)
        return { ...context, verifier, mint }
    }

    it("pins GitHub's issuer, its key set and RS256, and needs an audience and an owner/name repository", () => {
        const preset = githubActionsIssuer({ audience: "ci-attestation", repository: "starci183/starci-next" })
        assert.deepEqual([preset.issuer, preset.keys, preset.algorithms, preset.audience], [GITHUB_ACTIONS_ISSUER, { kind: "jwks", uri: GITHUB_ACTIONS_JWKS_URI }, ["RS256"], ["ci-attestation"]])
        const configuration = (error: unknown) => error instanceof OidcError && error.code === OIDC_ERROR_CODES.ConfigurationInvalid
        assert.throws(() => githubActionsIssuer({ audience: [], repository: "a/b" }), configuration)
        assert.throws(() => githubActionsIssuer({ audience: "", repository: "a/b" }), configuration)
        assert.throws(() => githubActionsIssuer({ audience: "x", repository: "no-owner" }), configuration)
    })

    it("a valid run token attests the repository, the workflow, the ref, the commit and the run", async () => {
        const { verifier, mint } = await build({ repositoryId: "123456789", workflows: [".github/workflows/ci.yml"], refs: ["refs/heads/main"] })
        assert.deepEqual(valueOf(await verifier.verify(await mint())), {
            subject: SUB,
            repository: "starci183/starci-next",
            repositoryId: "123456789",
            repositoryOwner: "starci183",
            workflow: "CI",
            workflowRef: RUN.workflow_ref,
            workflowPath: ".github/workflows/ci.yml",
            ref: "refs/heads/main",
            sha: RUN.sha,
            runId: "987654321",
            runAttempt: "1",
            actor: "starci183",
            eventName: "push",
            environment: null,
        })
    })

    it("refuses a token minted for another audience", async () => {
        const { verifier, mint } = await build()
        assert.equal(reasonOf(await verifier.verify(await mint({}, { audience: "sts.amazonaws.com" }))), "audience")
    })

    it("refuses a run of another repository, even one whose sub names ours", async () => {
        const { verifier, mint, issuer } = await build()
        const pinned = await build({ repositoryId: "1" })
        const other = await verifier.verify(await mint({ repository: "attacker/starci-next", workflow_ref: "attacker/starci-next/.github/workflows/ci.yml@refs/heads/main" }))
        assert.deepEqual([reasonOf(other), claimOf(other)], ["policy", "repository"])
        const forgedSub = await verifier.verify(await issuer.mintAccessToken({ sub: "repo:attacker/x:ref:refs/heads/main", extra: RUN }))
        assert.deepEqual([reasonOf(forgedSub), claimOf(forgedSub)], ["policy", "sub"])
        const renamed = await pinned.verifier.verify(await pinned.mint())
        assert.deepEqual([reasonOf(renamed), claimOf(renamed)], ["policy", "repository_id"])
        const cased = await build({ repository: "StarCi183/Starci-Next" })
        const caseOnly = valueOf(await cased.verifier.verify(await cased.mint()))
        assert.equal(caseOnly.repository, "starci183/starci-next")
    })

    it("refuses an expired run token", async () => {
        const { verifier, mint } = await build()
        assert.equal(reasonOf(await verifier.verify(await mint({}, { expiresInSeconds: -60 }))), "expired")
    })

    it("refuses a workflow, a ref or a workflow_ref the policy does not admit, and a token that lacks a run claim", async () => {
        const pinned = await build({ workflows: [".github/workflows/release.yml"], refs: ["refs/tags/v1.0.0"] })
        const workflow = await pinned.verifier.verify(await pinned.mint())
        assert.deepEqual([reasonOf(workflow), claimOf(workflow)], ["policy", "workflow_ref"])
        const refs = await build({ refs: ["refs/tags/v1.0.0"] })
        const ref = await refs.verifier.verify(await refs.mint())
        assert.deepEqual([reasonOf(ref), claimOf(ref)], ["policy", "ref"])
        const open = await build()
        const foreignWorkflow = await open.verifier.verify(await open.mint({ workflow_ref: "elsewhere/shared/.github/workflows/ci.yml@refs/heads/main" }))
        assert.deepEqual([reasonOf(foreignWorkflow), claimOf(foreignWorkflow)], ["policy", "workflow_ref"])
        assert.equal(reasonOf(await open.verifier.verify(await open.mint({ run_id: undefined }))), "claims")
        assert.equal(reasonOf(await open.verifier.verify(await open.mint({ run_id: "12; drop" }))), "claims")
        assert.equal(reasonOf(await open.verifier.verify(await open.mint({ sha: 7 }))), "claims")
    })

    it("refuses a token signed by a key GitHub does not publish", async () => {
        const { verifier, mint } = await build()
        assert.equal(reasonOf(await verifier.verify(await mint({}, { signer: "foreign" }))), "signature")
    })
})
