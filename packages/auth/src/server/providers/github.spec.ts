import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { AUTH_ERROR_CODES } from "../../contracts/index.ts"
import { AuthError } from "../errors.ts"
import { GITHUB_ENDPOINTS, GITHUB_SCOPES, githubProfileOf } from "./github.ts"

describe("githubProfileOf (what the app learns from GitHub)", () => {
    it("takes the numeric account id as the subject, never the login, and the primary verified address", () => {
        const profile = githubProfileOf({
            user: { id: 1, login: "octo", name: "Octo Cat", email: "public@example.test", avatar_url: "https://avatars.test/1" },
            emails: [
                { email: "unverified@example.test", primary: true, verified: false },
                { email: "other@example.test", primary: false, verified: true },
            ],
        })
        assert.deepEqual(profile, { provider: "github", subject: "1", email: "other@example.test", emailVerified: true, name: "Octo Cat", picture: "https://avatars.test/1" })
    })

    it("falls back to the public profile address as unverified, and to the login for a name", () => {
        assert.deepEqual(githubProfileOf({ user: { id: 2, login: "anon", email: "public@example.test" }, emails: undefined }), {
            provider: "github",
            subject: "2",
            email: "public@example.test",
            emailVerified: false,
            name: "anon",
            picture: null,
        })
        assert.deepEqual(githubProfileOf({ user: { id: 3, login: "", name: "" }, emails: [{ email: "", verified: true }, "junk"] }), {
            provider: "github",
            subject: "3",
            email: null,
            emailVerified: false,
            name: null,
            picture: null,
        })
    })

    it("refuses an answer without a positive integer account id", () => {
        for (const user of [undefined, null, [], { login: "x" }, { id: "1" }, { id: 0 }, { id: 1.5 }, { id: Number.MAX_SAFE_INTEGER + 1 }]) {
            assert.throws(() => githubProfileOf({ user, emails: [] }), (error: unknown) => error instanceof AuthError && error.code === AUTH_ERROR_CODES.ProviderRejected, JSON.stringify(user))
        }
    })

    it("speaks to github.com and its REST API with the profile and address scopes only", () => {
        assert.deepEqual(Object.values(GITHUB_ENDPOINTS).map((url) => new URL(url).origin), ["https://github.com", "https://github.com", "https://api.github.com", "https://api.github.com"])
        assert.deepEqual(GITHUB_SCOPES, ["read:user", "user:email"])
    })
})
