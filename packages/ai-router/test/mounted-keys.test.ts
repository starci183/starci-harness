import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { afterEach, beforeEach, describe, mock, test } from "node:test"
import { Test } from "@nestjs/testing"
import { AiRouterGatewayModule, getAiRouterGatewayToken } from "../src/ai-router-gateway.module.ts"
import { AiRouterTestingModule } from "../src/ai-router-testing.module.ts"
import { createFakeProvider } from "../src/fake.ts"
import { createGateway } from "../src/gateway/gateway.ts"
import type { AiRouterGateway } from "../src/gateway/gateway.ts"
import { KeyAdmin, KeyAdminError, MemoryKeyStore, mountedKeyId, MountedKeyError } from "../src/gateway/keys.ts"
import type { MountedKeySpec, StoredKey } from "../src/gateway/keys.ts"
import { createRouter } from "../src/router.ts"
import { ADMIN_TOKEN, chatBody, errorOf, gatewayPool, harness, http } from "./fixtures/gateway-helpers.ts"
import type { Harness } from "./fixtures/gateway-helpers.ts"

/** A store that counts every key write, so a spec can assert a mounted key never reaches it. */
class RecordingStore extends MemoryKeyStore {
    readonly puts: StoredKey[] = []

    override put(key: StoredKey): void {
        this.puts.push(key)
        super.put(key)
    }
}

const SECRET = `sk-starci-nivo_lite-${"a1b2c3d4".repeat(6)}`
const NEXT_SECRET = `sk-starci-nivo_lite-${"f9e8d7c6".repeat(6)}`

function mounted(extra: Partial<MountedKeySpec> = {}): MountedKeySpec {
    return { label: "nivo_lite", secret: SECRET, profiles: ["lesson"], owner: "nivo-lite", ...extra }
}

/** Builds a gateway and returns what it threw, or fails the spec. */
function refusal(mountedKeys: readonly MountedKeySpec[]): MountedKeyError {
    const router = createRouter(gatewayPool(createFakeProvider()))
    try {
        createGateway(router, { keys: new RecordingStore(), mountedKeys })
    } catch (error) {
        assert.ok(error instanceof MountedKeyError)
        return error
    }
    assert.fail("the gateway started")
}

/** Everything an error carries a reader could see: name, message, stack, code, label and cause. */
function shown(error: unknown): string {
    if (!(error instanceof Error)) return String(error)
    return JSON.stringify({ name: error.name, message: error.message, stack: error.stack, cause: String(error.cause), fields: Object.entries(error) })
}

describe("mounted keys", () => {
    let h: Harness
    let store: RecordingStore
    const errors: unknown[] = []
    const logged: string[] = []

    beforeEach(async () => {
        errors.length = 0
        logged.length = 0
        for (const method of ["log", "info", "warn", "error", "debug"] as const) {
            mock.method(console, method, (...args: unknown[]) => {
                logged.push(args.map(String).join(" "))
            })
        }
        store = new RecordingStore()
        h = await harness({
            keys: store,
            mountedKeys: [mounted({ quota: { requestsPerMinute: 2 } })],
            onError: (error) => {
                errors.push(error)
            },
        })
    })
    afterEach(async () => {
        mock.restoreAll()
        await h.close()
    })

    test("a mounted key authenticates by its secret and is never written to the store", async () => {
        const reply = await http(h.url, "/v1/chat/completions", { key: SECRET, body: chatBody("lesson") })
        assert.equal(reply.status, 200)
        assert.equal(store.puts.length, 0)
        assert.deepEqual(store.list(), [])
        const [key] = await h.admin.list()
        assert.ok(key)
        assert.equal(key.id, mountedKeyId("nivo_lite"))
        assert.match(key.id, /^key_[0-9a-f]{16}$/)
        assert.equal(key.id, `key_${createHash("sha256").update("mounted:nivo_lite").digest("hex").slice(0, 16)}`)
        assert.equal(key.mounted, true)
        assert.equal(key.owner, "nivo-lite")
        assert.equal(key.hint, `sk-starci-nivo_lite-...${SECRET.slice(-4)}`)
        assert.deepEqual(key.profiles, ["lesson"])
        // The key's bindings hold: a profile it is not bound to is refused.
        assert.equal((await http(h.url, "/v1/chat/completions", { key: SECRET, body: chatBody("quiz") })).status, 403)
    })

    test("a wrong or unknown token is refused, and stored keys still authenticate beside mounted ones", async () => {
        for (const token of [NEXT_SECRET, `${SECRET}x`, SECRET.slice(0, -1), "sk-other-thing"]) {
            const reply = await http(h.url, "/v1/chat/completions", { key: token, body: chatBody("lesson") })
            assert.equal(reply.status, 401)
            assert.equal(errorOf(reply).code, "invalid_api_key")
        }
        const stored = await h.key({ label: "batch" })
        assert.equal((await http(h.url, "/v1/chat/completions", { key: stored, body: chatBody("lesson") })).status, 200)
        assert.equal(store.puts.length, 1)
        assert.equal(store.puts[0]?.label, "batch")
        assert.deepEqual(
            (await h.admin.list()).map((key) => [key.label, key.mounted]).sort(),
            [
                ["batch", undefined],
                ["nivo_lite", true],
            ],
        )
    })

    test("quota and usage are kept under the stable id, which a new secret of the label keeps", async () => {
        const id = mountedKeyId("nivo_lite")
        assert.equal((await http(h.url, "/v1/chat/completions", { key: SECRET, body: chatBody("lesson") })).status, 200)
        assert.equal((await http(h.url, "/v1/chat/completions", { key: SECRET, body: chatBody("lesson") })).status, 200)
        const limited = await http(h.url, "/v1/chat/completions", { key: SECRET, body: chatBody("lesson") })
        assert.equal(limited.status, 429)
        assert.equal(errorOf(limited).code, "requests_per_minute_exceeded")
        assert.equal((await h.admin.usage(id)).totals.requests, 3)
        assert.equal((await h.admin.usage(id)).totals.succeeded, 2)
        // The next deploy mounts a new secret for the label over the same store: same id, same counters.
        const next = await harness({ keys: store, mountedKeys: [mounted({ secret: NEXT_SECRET, quota: { requestsPerMinute: 2 } })] })
        try {
            next.clock.now = h.clock.now
            assert.equal((await http(next.url, "/v1/chat/completions", { key: SECRET, body: chatBody("lesson") })).status, 401)
            assert.equal((await http(next.url, "/v1/chat/completions", { key: NEXT_SECRET, body: chatBody("lesson") })).status, 429)
            assert.equal((await next.admin.usage(id)).totals.requests, 4)
        } finally {
            await next.close()
        }
        assert.equal(store.puts.length, 0)
    })

    test("revoke, rotate and update of a mounted key are refused, over the admin API and in process", async () => {
        const id = mountedKeyId("nivo_lite")
        for (const [method, path, body] of [
            ["POST", `/admin/keys/${id}/revoke`, undefined],
            ["POST", `/admin/keys/${id}/rotate`, undefined],
            ["PATCH", `/admin/keys/${id}`, { enabled: false }],
        ] as const) {
            const reply = await http(h.url, path, { method, key: ADMIN_TOKEN, ...(body === undefined ? {} : { body }) })
            assert.equal(reply.status, 409)
            assert.equal(errorOf(reply).code, "key_mounted")
            assert.match(errorOf(reply).message, /mounted from a secret.*changing that secret and redeploying/)
        }
        await assert.rejects(h.admin.revoke(id), (error: unknown) => error instanceof KeyAdminError && error.code === "mounted")
        const read = await http(h.url, `/admin/keys/${id}`, { key: ADMIN_TOKEN })
        assert.equal(read.status, 200)
        assert.equal(read.json.mounted, true)
        assert.equal(read.json.enabled, true)
        assert.equal((await http(h.url, "/v1/chat/completions", { key: SECRET, body: chatBody("lesson") })).status, 200)
        assert.equal(store.puts.length, 0)
    })

    test("the secret is in no log, event, error, admin answer or store row", async () => {
        await http(h.url, "/v1/chat/completions", { key: SECRET, body: chatBody("lesson") })
        const listed = await http(h.url, "/admin/keys", { key: ADMIN_TOKEN })
        const revoked = await http(h.url, `/admin/keys/${mountedKeyId("nivo_lite")}/revoke`, { method: "POST", key: ADMIN_TOKEN })
        const refusals = [
            refusal([mounted(), mounted()]),
            refusal([mounted({ label: "other" })]),
            refusal([mounted({ profiles: ["nope"] })]),
            refusal([
                mounted({
                    secret: () => {
                        throw new Error(`could not parse ${SECRET}`)
                    },
                }),
            ]),
        ]
        const seen = [...logged, ...errors.map(shown), ...refusals.map(shown), listed.text, revoked.text, JSON.stringify(await h.admin.list()), JSON.stringify(store.list())].join("\n")
        assert.equal(seen.includes(SECRET), false)
        assert.equal(seen.includes(SECRET.slice("sk-starci-nivo_lite-".length)), false)
        assert.ok(refusals.every((error) => error.cause === undefined))
    })
})

describe("mounted keys refuse startup", () => {
    test("a secret without the sk-starci-<label>- prefix, or too short after it", () => {
        for (const secret of [`sk-starci-other-${"a".repeat(48)}`, "a".repeat(64), `sk-starci-nivo_lite-${"a".repeat(31)}`, `sk-starci-nivo_lite-${"a".repeat(40)} `]) {
            const error = refusal([mounted({ secret })])
            assert.equal(error.code, "invalid")
            assert.equal(error.label, "nivo_lite")
            assert.match(error.message, /mounted key "nivo_lite"/)
            assert.equal(error.message.includes(secret), false)
        }
    })

    test("a label given twice, an invalid label, or bindings the pool does not serve", () => {
        const twice = refusal([mounted(), mounted({ secret: NEXT_SECRET })])
        assert.equal(twice.code, "duplicate_label")
        assert.equal(twice.label, "nivo_lite")
        assert.match(twice.message, /"nivo_lite" is given twice/)
        assert.equal(refusal([mounted({ label: "Nivo Lite" })]).code, "invalid")
        const bindings = refusal([mounted({ profiles: ["nope"] })])
        assert.equal(bindings.code, "invalid")
        assert.match(bindings.message, /^mounted key "nivo_lite": profiles names "nope"/)
        assert.equal(refusal([mounted({ profiles: [], models: [] })]).code, "invalid")
    })

    test("a secret read by a function is read once; a function that throws is refused without its message", () => {
        let reads = 0
        const store = new RecordingStore()
        const admin = new KeyAdmin(store, {
            mounted: [
                mounted({
                    secret: () => {
                        reads += 1
                        return SECRET
                    },
                }),
            ],
        })
        assert.equal(reads, 1)
        return (async () => {
            assert.equal((await admin.authenticate(SECRET))?.id, mountedKeyId("nivo_lite"))
            assert.equal((await admin.authenticate(NEXT_SECRET))?.id, undefined)
            assert.equal(reads, 1)
            const thrown = refusal([
                mounted({
                    secret: () => {
                        throw new Error("NIVO_LITE_KEY is not set")
                    },
                }),
            ])
            assert.equal(thrown.code, "invalid")
            assert.equal(thrown.message, 'the secret of mounted key "nivo_lite" could not be read')
        })()
    })

    test("a mounted secret or id a stored key already holds rejects ready() and listen()", async () => {
        const store = new RecordingStore()
        const issued = await new KeyAdmin(store).create({ label: "nivo_lite", profiles: ["lesson"] })
        const router = createRouter(gatewayPool(createFakeProvider()))
        const gateway: AiRouterGateway = createGateway(router, { keys: store, mountedKeys: [mounted({ secret: issued.secret })] })
        await assert.rejects(gateway.ready(), (error: unknown) => error instanceof MountedKeyError && error.code === "collision" && error.message.includes(issued.key.id) && !error.message.includes(issued.secret))
        await assert.rejects(gateway.listen(0), MountedKeyError)
        await gateway.close()
        store.put({ ...(store.get(issued.key.id) ?? assert.fail("stored")), id: mountedKeyId("nivo_lite"), hash: "other" })
        const byId = createGateway(router, { keys: store, mountedKeys: [mounted()] })
        await assert.rejects(byId.ready(), (error: unknown) => error instanceof MountedKeyError && error.code === "collision" && error.message.includes("has id key_"))
        await byId.close()
    })

    test("the Nest module fails at init on a collision and serves a mounted key otherwise", async () => {
        const store = new RecordingStore()
        const issued = await new KeyAdmin(store).create({ label: "nivo_lite", profiles: ["*"] })
        const build = (secret: string) =>
            Test.createTestingModule({
                imports: [
                    AiRouterTestingModule.register({ fake: createFakeProvider(), isGlobal: true, providers: [{ id: "a", baseUrl: "https://a.test/v1", keys: [{ alias: "k", resolve: () => "sk-a" }], models: [{ id: "m1" }] }] }),
                    AiRouterGatewayModule.register({ keys: store, mountedKeys: [{ label: "nivo_lite", secret: () => secret, models: ["*"] }] }),
                ],
            }).compile()
        await assert.rejects(build(issued.secret), MountedKeyError)
        const moduleRef = await build(SECRET)
        const gateway = moduleRef.get<AiRouterGateway>(getAiRouterGatewayToken())
        const { url } = await gateway.listen(0)
        try {
            assert.equal((await http(url, "/v1/chat/completions", { key: SECRET, body: chatBody("m1") })).status, 200)
        } finally {
            await moduleRef.close()
        }
        assert.equal(store.puts.length, 1)
    })
})
