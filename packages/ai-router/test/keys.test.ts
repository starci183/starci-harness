import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, describe, test } from "node:test"
import { KeyAdmin, KeyAdminError, MemoryKeyStore } from "../src/gateway/keys.ts"
import type { KeyStore } from "../src/gateway/keys.ts"
import { openSqliteKeyStore } from "../src/gateway/sqlite-key-store.ts"
import { ADMIN_TOKEN, chatBody, errorOf, harness, http } from "./gateway-helpers.ts"
import type { Harness } from "./gateway-helpers.ts"

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex")

describe("the key lifecycle", () => {
    let h: Harness

    before(async () => {
        h = await harness()
    })
    after(() => h.close())

    test("create shows the secret once and the store holds only its hash", async () => {
        const issued = await h.admin.create({ label: "lesson_app", owner: "team-a", profiles: ["lesson"] })
        assert.match(issued.secret, /^sk-starci-lesson_app-[0-9a-f]{48}$/)
        assert.match(issued.key.id, /^key_[0-9a-f]{16}$/)
        assert.equal(issued.key.hint, `sk-starci-lesson_app-...${issued.secret.slice(-4)}`)
        assert.equal("hash" in issued.key, false)
        const stored = await h.store.get(issued.key.id)
        assert.ok(stored)
        assert.equal(stored.hash, sha256(issued.secret))
        assert.ok(!JSON.stringify(await h.store.list()).includes(issued.secret))
        assert.ok(!JSON.stringify(await h.admin.list()).includes(issued.secret))
        assert.ok(!JSON.stringify(await h.admin.list()).includes(stored.hash))
        assert.equal((await http(h.url, "/v1/chat/completions", { key: issued.secret, body: chatBody("lesson") })).status, 200)
    })

    test("revoke turns the key into a 401 and is idempotent; a revoked key cannot rotate or change", async () => {
        const issued = await h.admin.create({ label: "gone", profiles: ["*"] })
        const revoked = await h.admin.revoke(issued.key.id)
        assert.equal(revoked.enabled, false)
        assert.equal(typeof revoked.revokedAt, "number")
        assert.deepEqual(await h.admin.revoke(issued.key.id), revoked)
        const reply = await http(h.url, "/v1/chat/completions", { key: issued.secret, body: chatBody("lesson") })
        assert.equal(reply.status, 401)
        assert.match(errorOf(reply).message, /revoked/)
        await assert.rejects(h.admin.rotate(issued.key.id), (error: unknown) => error instanceof KeyAdminError && error.code === "revoked")
        await assert.rejects(h.admin.update(issued.key.id, { enabled: true }), (error: unknown) => error instanceof KeyAdminError && error.code === "revoked")
    })

    test("rotate keeps the id, bindings and usage and retires the old secret", async () => {
        const issued = await h.admin.create({ label: "turn", profiles: ["lesson"] })
        assert.equal((await http(h.url, "/v1/chat/completions", { key: issued.secret, body: chatBody("lesson") })).status, 200)
        const rotated = await h.admin.rotate(issued.key.id)
        assert.equal(rotated.key.id, issued.key.id)
        assert.notEqual(rotated.secret, issued.secret)
        assert.deepEqual(rotated.key.profiles, ["lesson"])
        assert.equal((await http(h.url, "/v1/chat/completions", { key: issued.secret, body: chatBody("lesson") })).status, 401)
        assert.equal((await http(h.url, "/v1/chat/completions", { key: rotated.secret, body: chatBody("lesson") })).status, 200)
        assert.equal((await h.admin.usage(issued.key.id)).totals.requests, 2)
    })

    test("a disabled key answers 401 until it is enabled again", async () => {
        const issued = await h.admin.create({ label: "paused", profiles: ["lesson"], enabled: false })
        assert.match(errorOf(await http(h.url, "/v1/models", { key: issued.secret })).message, /disabled/)
        await h.admin.update(issued.key.id, { enabled: true, quota: { requestsPerMinute: 5 } })
        assert.equal((await http(h.url, "/v1/models", { key: issued.secret })).status, 200)
        assert.deepEqual((await h.admin.get(issued.key.id)).quota, { requestsPerMinute: 5 })
    })

    test("a spec is validated against the pool and its own shape", async () => {
        const refused = async (spec: unknown, pattern: RegExp): Promise<void> => {
            await assert.rejects(h.admin.create(spec as never), (error: unknown) => error instanceof KeyAdminError && error.code === "invalid" && pattern.test(error.message))
        }
        await refused({ label: "Bad-Label", profiles: ["*"] }, /label/)
        await refused({ label: "x" }, /at least one profile or model/)
        await refused({ label: "x", profiles: ["nope"] }, /does not serve/)
        await refused({ label: "x", models: ["gpt-9"] }, /does not serve/)
        await refused({ label: "x", models: "m1" }, /list of names/)
        await refused({ label: "x", models: [1] }, /list of names/)
        await refused({ label: "x", models: ["m1"], quota: { requestsPerMinute: 1.5 } }, /positive integer/)
        await refused({ label: "x", models: ["m1"], quota: { costPerDay: -1 } }, /positive number/)
        await refused({ label: "x", models: ["m1"], quota: { perYear: 3 } }, /unknown fields/)
        await refused({ label: "x", models: ["m1"], allowFallback: "yes" }, /true or false/)
        await refused({ label: "x", models: ["m1"], owner: 7 }, /owner/)
        await assert.rejects(h.admin.get("key_missing"), (error: unknown) => error instanceof KeyAdminError && error.code === "not_found")
        await assert.rejects(h.admin.usage((await h.admin.list())[0]?.id ?? "", { from: "yesterday" }), /YYYY-MM-DD/)
    })
})

describe("quotas answer 429 with Retry-After", () => {
    let h: Harness

    before(async () => {
        h = await harness()
    })
    after(() => h.close())

    test("requests per minute, counted per UTC minute", async () => {
        const key = await h.key({ quota: { requestsPerMinute: 2 } })
        h.clock.now = Date.UTC(2026, 9, 28, 12, 0, 30)
        assert.equal((await http(h.url, "/v1/chat/completions", { key, body: chatBody("m1") })).status, 200)
        assert.equal((await http(h.url, "/v1/chat/completions", { key, body: chatBody("m1") })).status, 200)
        const limited = await http(h.url, "/v1/chat/completions", { key, body: chatBody("m1") })
        assert.equal(limited.status, 429)
        assert.equal(errorOf(limited).code, "requests_per_minute_exceeded")
        assert.equal(errorOf(limited).type, "rate_limit_error")
        assert.equal(limited.headers.get("retry-after"), "30")
        h.clock.now += 30_000
        assert.equal((await http(h.url, "/v1/chat/completions", { key, body: chatBody("m1") })).status, 200)
    })

    test("tokens per day: the reported tokens of the UTC day", async () => {
        const key = await h.key({ quota: { tokensPerDay: 20 } })
        h.clock.now = Date.UTC(2026, 9, 28, 23, 0, 0)
        assert.equal((await http(h.url, "/v1/chat/completions", { key, body: chatBody("m1") })).status, 200)
        assert.equal((await http(h.url, "/v1/chat/completions", { key, body: chatBody("m1") })).status, 200)
        const limited = await http(h.url, "/v1/chat/completions", { key, body: chatBody("m1") })
        assert.equal(limited.status, 429)
        assert.equal(errorOf(limited).code, "tokens_per_day_exceeded")
        assert.equal(limited.headers.get("retry-after"), "3600")
        h.clock.now = Date.UTC(2026, 9, 29, 0, 0, 1)
        assert.equal((await http(h.url, "/v1/chat/completions", { key, body: chatBody("m1") })).status, 200)
    })

    test("cost per day and per month, from usage and the model's cost", async () => {
        const daily = await h.key({ quota: { costPerDay: 2 } })
        h.clock.now = Date.UTC(2026, 9, 10, 12, 0, 0)
        assert.equal((await http(h.url, "/v1/chat/completions", { key: daily, body: chatBody("m1") })).status, 200)
        assert.equal((await http(h.url, "/v1/chat/completions", { key: daily, body: chatBody("m1") })).status, 200)
        assert.equal(errorOf(await http(h.url, "/v1/chat/completions", { key: daily, body: chatBody("m1") })).code, "cost_per_day_exceeded")
        const monthly = await h.key({ quota: { costPerMonth: 2 } })
        h.clock.now = Date.UTC(2026, 9, 1, 12, 0, 0)
        assert.equal((await http(h.url, "/v1/chat/completions", { key: monthly, body: chatBody("m1") })).status, 200)
        h.clock.now = Date.UTC(2026, 9, 20, 12, 0, 0)
        assert.equal((await http(h.url, "/v1/chat/completions", { key: monthly, body: chatBody("m1") })).status, 200)
        const limited = await http(h.url, "/v1/chat/completions", { key: monthly, body: chatBody("m1") })
        assert.equal(errorOf(limited).code, "cost_per_month_exceeded")
        assert.equal(limited.headers.get("retry-after"), String(11 * 86_400 + 12 * 3600))
        h.clock.now = Date.UTC(2026, 10, 1, 0, 0, 0)
        assert.equal((await http(h.url, "/v1/chat/completions", { key: monthly, body: chatBody("m1") })).status, 200)
    })
})

describe("usage accounting", () => {
    test("records requests, tokens, cost, latency and outcomes per key and UTC day, and no prompt", async () => {
        const h = await harness()
        const issued = await h.admin.create({ label: "acct", profiles: ["lesson"], models: ["m2"] })
        const key = issued.secret
        h.clock.now = Date.UTC(2026, 9, 28, 9, 0, 0)
        await http(h.url, "/v1/chat/completions", { key, body: chatBody("lesson") })
        h.fake.on({ model: "m1" }, { stream: { chunks: ["a", "b"] } })
        await http(h.url, "/v1/chat/completions", { key, body: chatBody("lesson", { stream: true }) })
        await http(h.url, "/v1/chat/completions", { key, body: chatBody("quiz", { user: "end-user-42" }) })
        h.fake.on({ model: "m2" }, { status: 500 })
        await http(h.url, "/v1/chat/completions", { key, body: chatBody("m2") })
        const usage = await h.admin.usage(issued.key.id, { from: "2026-10-28", to: "2026-10-28" })
        assert.equal(usage.rows.length, 1)
        const row = usage.rows[0]
        assert.equal(row?.requests, 4)
        assert.equal(row.succeeded, 2)
        assert.equal(row.failed, 2)
        assert.equal(row.promptTokens, 20)
        assert.equal(row.completionTokens, 4)
        assert.ok(Math.abs(row.cost - 2.4) < 1e-9)
        assert.ok(row.latencyMs >= 0)
        assert.deepEqual(row.outcomes, { success: 2, "rejected:model_not_allowed": 1, "error:transient": 1 })
        assert.deepEqual(usage.totals.outcomes, row.outcomes)
        const everything = JSON.stringify([await h.store.usage(issued.key.id, "2000-01-01", "2100-01-01"), await h.store.list()])
        assert.ok(!everything.includes("the secret prompt text"))
        assert.ok(!everything.includes("end-user-42"))
        assert.equal((await h.admin.usage(issued.key.id)).from, "2026-10-01")
        await h.close()
    })

    test("a usage write that fails after the reply went out reaches onError", async () => {
        const store = new MemoryKeyStore()
        const failures: unknown[] = []
        const broken: KeyStore = {
            put: (key) => {
                store.put(key)
            },
            get: (id) => store.get(id),
            byHash: (hash) => store.byHash(hash),
            list: () => store.list(),
            hit: (id, minute) => store.hit(id, minute),
            usage: (id, from, to) => store.usage(id, from, to),
            record: () => {
                throw new Error("disk full")
            },
        }
        const h = await harness({ keys: broken, onError: (error) => failures.push(error) })
        const key = await h.key()
        assert.equal((await http(h.url, "/v1/chat/completions", { key, body: chatBody("m1") })).status, 200)
        assert.equal(failures.length, 1)
        await h.close()
    })
})

describe("the admin API", () => {
    let h: Harness

    before(async () => {
        h = await harness()
    })
    after(() => h.close())

    test("401 without the admin token; a virtual key is not an admin token", async () => {
        assert.equal((await http(h.url, "/admin/keys")).status, 401)
        const key = await h.key()
        assert.equal(errorOf(await http(h.url, "/admin/keys", { key })).code, "invalid_admin_token")
    })

    test("create, list, get, update, revoke, rotate and usage", async () => {
        const created = await http(h.url, "/admin/keys", { key: ADMIN_TOKEN, body: { label: "api", profiles: ["lesson"], quota: { requestsPerMinute: 10 } } })
        assert.equal(created.status, 201)
        const secret = created.json.secret as string
        const id = (created.json.key as { id: string }).id
        assert.equal((await http(h.url, "/v1/chat/completions", { key: secret, body: chatBody("lesson") })).status, 200)
        const listed = await http(h.url, "/admin/keys", { key: ADMIN_TOKEN })
        assert.ok((listed.json.data as { id: string }[]).some((key) => key.id === id))
        assert.ok(!listed.text.includes(secret))
        assert.equal(((await http(h.url, `/admin/keys/${id}`, { key: ADMIN_TOKEN })).json as { label: string }).label, "api")
        const patched = await http(h.url, `/admin/keys/${id}`, { key: ADMIN_TOKEN, method: "PATCH", body: { models: ["m2"] } })
        assert.deepEqual(patched.json.models, ["m2"])
        assert.equal((await http(h.url, `/admin/keys/${id}`, { key: ADMIN_TOKEN, method: "PATCH", body: "[1]" })).status, 400)
        const usage = await http(h.url, `/admin/keys/${id}/usage?from=2026-10-01&to=2026-10-31`, { key: ADMIN_TOKEN })
        assert.equal((usage.json.totals as { requests: number }).requests, 1)
        const rotated = await http(h.url, `/admin/keys/${id}/rotate`, { key: ADMIN_TOKEN, method: "POST" })
        assert.notEqual(rotated.json.secret, secret)
        const revoked = await http(h.url, `/admin/keys/${id}/revoke`, { key: ADMIN_TOKEN, method: "POST" })
        assert.equal((revoked.json as { enabled: boolean }).enabled, false)
        assert.equal((await http(h.url, `/admin/keys/${id}/rotate`, { key: ADMIN_TOKEN, method: "POST" })).status, 409)
    })

    test("400 for a bad spec, 404 for an unknown key or route", async () => {
        assert.equal(errorOf(await http(h.url, "/admin/keys", { key: ADMIN_TOKEN, body: { label: "x" } })).code, "invalid_key_spec")
        assert.equal(errorOf(await http(h.url, "/admin/keys/key_none", { key: ADMIN_TOKEN })).code, "key_not_found")
        assert.equal((await http(h.url, "/admin/keys/key_none/explode", { key: ADMIN_TOKEN, method: "POST" })).status, 404)
        assert.equal((await http(h.url, "/admin/keys", { key: ADMIN_TOKEN, method: "DELETE" })).status, 404)
    })
})

/** The contract every key store keeps, run on each implementation. */
function storeContract(name: string, open: () => Promise<{ store: KeyStore; done: () => Promise<void> }>): void {
    describe(`${name} key store`, () => {
        test("keeps keys by id and hash, counts minutes and adds usage rows", async () => {
            const { store, done } = await open()
            let tick = Date.UTC(2026, 9, 28)
            // Each key is created a millisecond after the last, so the list order is the creation order.
            const admin = new KeyAdmin(store, { clock: () => tick++ })
            const first = await admin.create({ label: "one", models: ["*"], owner: "ops" })
            const second = await admin.create({ label: "two", profiles: ["*"], quota: { costPerMonth: 5 } })
            assert.deepEqual(
                (await admin.list()).map((key) => key.label),
                ["one", "two"],
            )
            assert.equal((await admin.authenticate(first.secret))?.id, first.key.id)
            assert.equal(await admin.authenticate("sk-starci-one-wrong"), undefined)
            assert.equal(await admin.authenticate("other"), undefined)
            assert.deepEqual(await admin.get(second.key.id), second.key)
            const rotated = await admin.rotate(first.key.id)
            assert.equal(await admin.authenticate(first.secret), undefined)
            assert.equal((await admin.authenticate(rotated.secret))?.owner, "ops")
            assert.equal(await store.hit(first.key.id, 100), 1)
            assert.equal(await store.hit(first.key.id, 100), 2)
            assert.equal(await store.hit(first.key.id, 101), 1)
            const delta = { promptTokens: 3, completionTokens: 2, cost: 0.5, latencyMs: 10 }
            await store.record(first.key.id, "2026-10-27", { ...delta, outcome: "success" })
            await store.record(first.key.id, "2026-10-28", { ...delta, outcome: "success" })
            await store.record(first.key.id, "2026-10-28", { ...delta, outcome: "error:transient" })
            await store.record(second.key.id, "2026-10-28", { ...delta, outcome: "success" })
            const rows = await store.usage(first.key.id, "2026-10-28", "2026-10-31")
            assert.equal(rows.length, 1)
            assert.deepEqual(rows[0], {
                keyId: first.key.id,
                day: "2026-10-28",
                requests: 2,
                succeeded: 1,
                failed: 1,
                promptTokens: 6,
                completionTokens: 4,
                cost: 1,
                latencyMs: 20,
                outcomes: { success: 1, "error:transient": 1 },
            })
            assert.equal((await admin.usage(first.key.id, { from: "2026-10-01" })).totals.requests, 3)
            await done()
        })
    })
}

storeContract("the memory", () => Promise.resolve({ store: new MemoryKeyStore(), done: () => Promise.resolve() }))
storeContract("the SQLite", async () => {
    const store = await openSqliteKeyStore(":memory:")
    return { store, done: async () => store.close?.() }
})

describe("the SQLite key store on disk", () => {
    test("survives a reopen and serves the gateway", async () => {
        const dir = await mkdtemp(join(tmpdir(), "ai-router-keys-"))
        const path = join(dir, "keys.sqlite")
        const first = await openSqliteKeyStore(path)
        const issued = await new KeyAdmin(first).create({ label: "durable", profiles: ["lesson"] })
        await first.close?.()
        const store = await openSqliteKeyStore(path)
        const h = await harness({ keys: store })
        assert.equal((await http(h.url, "/v1/chat/completions", { key: issued.secret, body: chatBody("lesson") })).status, 200)
        assert.equal((await h.admin.usage(issued.key.id, { from: "2026-10-01", to: "2026-10-31" })).totals.succeeded, 1)
        await h.close()
        await store.close?.()
        await rm(dir, { recursive: true, force: true })
    })
})
