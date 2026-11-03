import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { AUTH_ERROR_CODES } from "../contracts/index.ts"
import { testAuthOptions } from "../testing/index.ts"
import { AuthError } from "./errors.ts"
import { DEFAULT_REUSE_GRACE_MS, RACED_SUCCESSORS_MAX, REFRESH_REUSE_EVENT, AuthSessions } from "./sessions.ts"
import { AuthTokens } from "./tokens.ts"
import { AuthPrincipalVerifier } from "./verifier.ts"
import { digestOf } from "./primitives.ts"

const device = { userAgent: "agent", ip: "203.0.113.9" }
const subject = { userId: "user-1", email: "a@example.test" }

const build = () => {
    const options = testAuthOptions()
    const events: { event: string; context: unknown }[] = []
    const tokens = new AuthTokens(options)
    const sessions = new AuthSessions({
        options,
        tokens,
        clock: options.clock,
        ids: options.ids ?? { next: () => "x" },
        logger: { warn: (event, context) => events.push({ event, context }) },
    })
    options.accounts.set({ id: "user-1", email: "a@example.test", disabled: false })
    return { options, tokens, sessions, events }
}

const rowOf = (options: ReturnType<typeof build>["options"], token: string) =>
    [...options.sessions.tokens.values()].find((row) => row.tokenHash === digestOf(token))

const refusal = (code: string) => (error: unknown) => error instanceof AuthError && error.code === code

describe("AuthSessions.start", () => {
    it("opens a session, stores only the digest of the refresh token and answers verifiable tokens", async () => {
        const { options, tokens, sessions } = build()
        const issued = await sessions.start(subject, device)
        assert.equal(options.sessions.sessions.size, 1)
        const [row] = [...options.sessions.tokens.values()]
        assert.ok(row)
        assert.equal(row.tokenHash, digestOf(issued.cookieToken))
        assert.notEqual(row.tokenHash, issued.cookieToken)
        assert.equal(issued.refreshMaxAgeSeconds, options.refreshTtlSeconds)
        assert.equal(issued.accessExpiresIn, 900)
        assert.deepEqual(issued.user, { id: "user-1", email: "a@example.test" })
        const verified = await tokens.verify(issued.accessToken, options.clock.now())
        assert.equal(verified.kind === "ok" && verified.value.sessionId, [...options.sessions.sessions.keys()][0])
        assert.match(issued.cookieToken, /^[0-9a-z]+$/u)
    })
})

describe("AuthSessions.refresh", () => {
    it("rotates: the presented token is spent, a successor is stored, expired tokens go", async () => {
        const { options, sessions } = build()
        const first = await sessions.start(subject, device)
        options.clock.advance(60_000)
        const second = await sessions.refresh(first.cookieToken)
        assert.notEqual(second.cookieToken, first.cookieToken)
        const spent = options.sessions.tokens.get([...options.sessions.tokens.values()].find((row) => row.tokenHash === digestOf(first.cookieToken))?.id ?? "")
        assert.equal(spent?.usedAt?.getTime(), options.clock.now().getTime())
        assert.equal(options.sessions.tokens.size, 2)
    })

    it("gives a replay inside the grace window a successor of its own, which refreshes exactly once (a lost Set-Cookie)", async () => {
        const { options, sessions, events } = build()
        const first = await sessions.start(subject, device)
        await sessions.refresh(first.cookieToken)
        options.clock.advance(DEFAULT_REUSE_GRACE_MS - 1)
        const raced = await sessions.refresh(first.cookieToken)
        assert.notEqual(raced.cookieToken, first.cookieToken)
        assert.equal(options.sessions.tokens.size, 3, "the raced replay stored its own successor")
        assert.equal(options.sessions.sessions.size, 1, "in the same session")
        assert.equal(rowOf(options, first.cookieToken)?.racedCount, 1)
        assert.equal(events.length, 0)
        const next = await sessions.refresh(raced.cookieToken)
        assert.notEqual(next.cookieToken, raced.cookieToken)
        options.clock.advance(DEFAULT_REUSE_GRACE_MS + 1)
        await assert.rejects(sessions.refresh(raced.cookieToken), refusal(AUTH_ERROR_CODES.RefreshReused), "the raced successor is spent by its one refresh")
    })

    it("leaves the sibling successor working after a raced replay", async () => {
        const { options, sessions } = build()
        const first = await sessions.start(subject, device)
        const winner = await sessions.refresh(first.cookieToken)
        options.clock.advance(1000)
        const raced = await sessions.refresh(first.cookieToken)
        const fromWinner = await sessions.refresh(winner.cookieToken)
        const fromRaced = await sessions.refresh(raced.cookieToken)
        assert.notEqual(fromWinner.cookieToken, fromRaced.cookieToken)
        assert.equal(options.sessions.sessions.size, 1)
    })

    it("caps the raced successors of one rotated token, and treats one more replay as reuse", async () => {
        const { options, sessions, events } = build()
        const first = await sessions.start(subject, device)
        await sessions.refresh(first.cookieToken)
        for (let n = 0; n < RACED_SUCCESSORS_MAX; n += 1) await sessions.refresh(first.cookieToken)
        assert.equal(rowOf(options, first.cookieToken)?.racedCount, RACED_SUCCESSORS_MAX)
        await assert.rejects(sessions.refresh(first.cookieToken), refusal(AUTH_ERROR_CODES.RefreshReused))
        assert.equal(options.sessions.sessions.size, 0)
        assert.equal(options.sessions.tokens.size, 0)
        assert.equal(events[0]?.event, REFRESH_REUSE_EVENT)
    })

    it("revokes every sibling of the session on reuse, raced successors included", async () => {
        const { options, sessions } = build()
        const first = await sessions.start(subject, device)
        const winner = await sessions.refresh(first.cookieToken)
        const raced = await sessions.refresh(first.cookieToken)
        options.clock.advance(DEFAULT_REUSE_GRACE_MS + 1)
        await assert.rejects(sessions.refresh(first.cookieToken), refusal(AUTH_ERROR_CODES.RefreshReused))
        assert.equal(options.sessions.tokens.size, 0)
        await assert.rejects(sessions.refresh(winner.cookieToken), refusal(AUTH_ERROR_CODES.RefreshInvalid))
        await assert.rejects(sessions.refresh(raced.cookieToken), refusal(AUTH_ERROR_CODES.RefreshInvalid))
    })

    it("ends the whole session when a spent token comes back after the grace window", async () => {
        const { options, sessions, events } = build()
        const first = await sessions.start(subject, device)
        const winner = await sessions.refresh(first.cookieToken)
        options.clock.advance(DEFAULT_REUSE_GRACE_MS + 1)
        await assert.rejects(sessions.refresh(first.cookieToken), refusal(AUTH_ERROR_CODES.RefreshReused))
        assert.equal(options.sessions.sessions.size, 0)
        assert.equal(options.sessions.tokens.size, 0, "the live successor died with the session")
        assert.equal(events[0]?.event, REFRESH_REUSE_EVENT)
        await assert.rejects(sessions.refresh(winner.cookieToken), refusal(AUTH_ERROR_CODES.RefreshInvalid))
    })

    it("refuses an empty, unknown or expired token", async () => {
        const { options, sessions } = build()
        await assert.rejects(sessions.refresh(""), refusal(AUTH_ERROR_CODES.RefreshInvalid))
        await assert.rejects(sessions.refresh("unknown"), refusal(AUTH_ERROR_CODES.RefreshInvalid))
        const first = await sessions.start(subject, device)
        options.clock.advance(options.refreshTtlSeconds * 1000)
        await assert.rejects(sessions.refresh(first.cookieToken), refusal(AUTH_ERROR_CODES.RefreshInvalid))
    })

    it("ends the session of a disabled, missing or address-less account", async () => {
        for (const standing of [{ id: "user-1", email: "a@example.test", disabled: true }, { id: "user-1", email: null, disabled: false }, undefined]) {
            const { options, sessions } = build()
            const first = await sessions.start(subject, device)
            if (standing === undefined) options.accounts.accounts.clear()
            else options.accounts.set(standing)
            await assert.rejects(sessions.refresh(first.cookieToken), refusal(AUTH_ERROR_CODES.AccountDisabled))
            assert.equal(options.sessions.sessions.size, 0)
        }
    })

    it("ends a racing session whose account was disabled in the meantime", async () => {
        const { options, sessions } = build()
        const first = await sessions.start(subject, device)
        await sessions.refresh(first.cookieToken)
        options.accounts.set({ id: "user-1", email: "a@example.test", disabled: true })
        await assert.rejects(sessions.refresh(first.cookieToken), refusal(AUTH_ERROR_CODES.AccountDisabled))
        assert.equal(options.sessions.sessions.size, 0)
    })

    it("rolls the rotation back when a write fails, so the presented token stays live", async () => {
        const { options, sessions } = build()
        const first = await sessions.start(subject, device)
        const insert = options.sessions.transaction.bind(options.sessions)
        let failed = false
        options.sessions.transaction = (work) =>
            insert(async (tx) => {
                const wrapped = {
                    ...tx,
                    insertToken: () => {
                        failed = true
                        return Promise.reject(new Error("disk full"))
                    },
                }
                return work(wrapped)
            })
        await assert.rejects(sessions.refresh(first.cookieToken), /disk full/u)
        assert.equal(failed, true)
        options.sessions.transaction = insert
        const retry = await sessions.refresh(first.cookieToken)
        assert.notEqual(retry.cookieToken, first.cookieToken)
    })
})

describe("AuthSessions.access", () => {
    it("answers an access token for the cookie session without rotating it", async () => {
        const { options, sessions } = build()
        const first = await sessions.start(subject, device)
        const a = await sessions.access(first.cookieToken)
        const b = await sessions.access(first.cookieToken)
        assert.equal(a.cookieToken, first.cookieToken)
        assert.equal(b.cookieToken, first.cookieToken)
        assert.equal(options.sessions.tokens.size, 1)
    })

    it("counts a token a sibling just rotated, and ends the session of an older replay", async () => {
        const { options, sessions, events } = build()
        const first = await sessions.start(subject, device)
        await sessions.refresh(first.cookieToken)
        options.clock.advance(1000)
        assert.equal((await sessions.access(first.cookieToken)).cookieToken, first.cookieToken)
        options.clock.advance(DEFAULT_REUSE_GRACE_MS)
        await assert.rejects(sessions.access(first.cookieToken), refusal(AUTH_ERROR_CODES.RefreshReused))
        assert.equal(options.sessions.sessions.size, 0)
        assert.equal(events.length, 1)
    })

    it("refuses an empty, unknown or expired token and a disabled account", async () => {
        const { options, sessions } = build()
        await assert.rejects(sessions.access(""), refusal(AUTH_ERROR_CODES.RefreshInvalid))
        await assert.rejects(sessions.access("unknown"), refusal(AUTH_ERROR_CODES.RefreshInvalid))
        const first = await sessions.start(subject, device)
        options.accounts.set({ id: "user-1", email: "a@example.test", disabled: true })
        await assert.rejects(sessions.access(first.cookieToken), refusal(AUTH_ERROR_CODES.AccountDisabled))
        const second = await sessions.start(subject, device)
        options.accounts.set({ id: "user-1", email: "a@example.test", disabled: false })
        options.clock.advance(options.refreshTtlSeconds * 1000)
        await assert.rejects(sessions.access(second.cookieToken), refusal(AUTH_ERROR_CODES.RefreshInvalid))
    })
})

describe("AuthSessions end", () => {
    it("ends the session of a token; an empty or unknown token changes nothing", async () => {
        const { options, sessions } = build()
        const first = await sessions.start(subject, device)
        await sessions.end("")
        await sessions.end("unknown")
        assert.equal(options.sessions.sessions.size, 1)
        await sessions.end(first.cookieToken)
        assert.equal(options.sessions.sessions.size, 0)
    })

    it("signs out the other devices and keeps the caller's session", async () => {
        const { options, sessions } = build()
        const here = await sessions.start(subject, device)
        await sessions.start(subject, device)
        const hereId = [...options.sessions.sessions.keys()][0] ?? ""
        await assert.rejects(sessions.endOthers("user-1", undefined), refusal(AUTH_ERROR_CODES.Unauthenticated))
        await sessions.endOthers("user-1", hereId)
        assert.deepEqual([...options.sessions.sessions.keys()], [hereId])
        assert.equal((await sessions.access(here.cookieToken)).cookieToken, here.cookieToken)
        assert.equal((await sessions.jwks()).keys.length, 1)
    })

    it("honours a configured grace window", async () => {
        const { options, tokens } = build()
        const sessions = new AuthSessions({ options: { ...options, reuseGraceMs: 1000 }, tokens, clock: options.clock, ids: options.ids ?? { next: () => "x" } })
        const first = await sessions.start(subject, device)
        await sessions.refresh(first.cookieToken)
        options.clock.advance(1001)
        await assert.rejects(sessions.refresh(first.cookieToken), refusal(AUTH_ERROR_CODES.RefreshReused))
    })
})

describe("AuthSessions full name", () => {
    it("answers the full name the directory knows on a refresh and the session door, in the body and the access token", async () => {
        const { options, tokens, sessions } = build()
        options.accounts.set({ id: "user-1", email: "a@example.test", disabled: false, name: "Ada Lovelace" })
        const first = await sessions.start(subject, device)
        assert.equal(first.user.name, undefined, "a subject without a name signs in without one")
        const refreshed = await sessions.refresh(first.cookieToken)
        assert.deepEqual(refreshed.user, { id: "user-1", email: "a@example.test", name: "Ada Lovelace" })
        assert.deepEqual((await sessions.access(refreshed.cookieToken)).user, refreshed.user)
        const principal = await new AuthPrincipalVerifier(tokens, options.clock).verify(refreshed.accessToken)
        assert.deepEqual(principal.kind === "ok" ? principal.value : null, {
            id: "user-1",
            role: "authenticated",
            sessionId: [...options.sessions.sessions.keys()][0],
            email: "a@example.test",
            name: "Ada Lovelace",
        })
    })
})
