import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, describe, test } from "node:test"
import { Test } from "@nestjs/testing"
import { AiRouterGatewayModule, getAiRouterGatewayToken } from "../src/ai-router-gateway.module.ts"
import { AiRouterTestingModule } from "../src/ai-router-testing.module.ts"
import { AiRouterError } from "../src/errors.ts"
import { createFakeProvider } from "../src/fake.ts"
import { main } from "../src/gateway/cli.ts"
import type { CliIo } from "../src/gateway/cli.ts"
import { loadGatewayConfig, parseGatewayConfig } from "../src/gateway/config-file.ts"
import type { AiRouterGateway } from "../src/gateway/gateway.ts"
import { MemoryKeyStore } from "../src/gateway/keys.ts"
import type { IssuedKey, KeyUsage, VirtualKey } from "../src/gateway/keys.ts"
import { serveGateway } from "../src/gateway/serve.ts"
import { chatBody, http } from "./fixtures/gateway-helpers.ts"

const POOL_YAML = `
gateway:
  port: 0
  adminToken: { env: TEST_ADMIN_TOKEN }
  keyStore: { type: sqlite, path: keys.sqlite }
providers:
  - id: a
    baseUrl: https://a.test/v1
    keys:
      - alias: k1
        env: TEST_UPSTREAM_KEY
      - alias: k2
        file: secrets/k2.txt
    models:
      - id: m1
        aliases: [fast]
        cost: { input: 1, output: 2 }
      - id: e1
        capabilities: [embeddings]
defaults: { model: fast }
profiles:
  lesson: { model: m1, allowFallback: false }
`

let dir = ""

function refused(pattern: RegExp): (error: unknown) => boolean {
    return (error: unknown) => error instanceof AiRouterError && error.errorClass === "config" && pattern.test(error.message)
}

before(async () => {
    dir = await mkdtemp(join(tmpdir(), "ai-router-cli-"))
    await writeFile(join(dir, "pool.yaml"), POOL_YAML)
    await writeFile(join(dir, "memory.json"), JSON.stringify({ providers: [{ id: "a", baseUrl: "https://a.test/v1", keys: [{ alias: "k", env: "X" }], models: [{ id: "m1" }] }] }))
    await mkdir(join(dir, "secrets"))
    await writeFile(join(dir, "secrets", "k2.txt"), "sk-from-file\n")
})
after(() => rm(dir, { recursive: true, force: true }))

describe("the config file", () => {
    test("loads YAML: env keys stay references, file keys read their file at each attempt, paths resolve from the file", async () => {
        const config = await loadGatewayConfig(join(dir, "pool.yaml"))
        assert.deepEqual(config.gateway.adminToken, { env: "TEST_ADMIN_TOKEN" })
        assert.deepEqual(config.gateway.keyStore, { type: "sqlite", path: join(dir, "keys.sqlite") })
        assert.equal(config.gateway.host, "127.0.0.1")
        const [k1, k2] = config.pool.providers[0]?.keys ?? []
        assert.deepEqual(k1, { alias: "k1", env: "TEST_UPSTREAM_KEY" })
        assert.ok(k2 !== undefined && "resolve" in k2)
        assert.equal(await k2.resolve(), "sk-from-file")
        assert.equal("gateway" in config.pool, false)
    })

    test("loads JSON with the defaults: port 8080, a memory store, no admin token", async () => {
        const config = await loadGatewayConfig(join(dir, "memory.json"))
        assert.deepEqual(config.gateway, { port: 8080, host: "127.0.0.1", maxBodyBytes: 4 * 1024 * 1024, adminToken: null, keyStore: { type: "memory" } })
    })

    test("refuses a secret written inline, a secret-bearing header, an unknown or mistyped field", () => {
        const provider = { id: "a", baseUrl: "https://a.test/v1", models: [{ id: "m" }] }
        assert.throws(() => parseGatewayConfig({ providers: [{ ...provider, keys: [{ alias: "k", apiKey: "sk-live" }] }] }), refused(/never inline/))
        assert.throws(() => parseGatewayConfig({ providers: [{ ...provider, keys: [{ alias: "k", value: "sk-live" }] }] }), refused(/never inline/))
        assert.throws(() => parseGatewayConfig({ providers: [{ ...provider, keys: [{ alias: "k" }] }] }), refused(/exactly one of env or file/))
        assert.throws(() => parseGatewayConfig({ providers: [{ ...provider, keys: [{ alias: "k", env: "A", file: "b" }] }] }), refused(/exactly one/))
        assert.throws(() => parseGatewayConfig({ providers: [{ ...provider, headers: { "x-api-key": "sk" }, keys: [{ alias: "k", env: "A" }] }] }), refused(/carry a secret/))
        assert.throws(() => parseGatewayConfig({ providers: [{ ...provider, keys: [{ alias: "k", env: "A" }] }], extra: 1 }), refused(/not a known field/))
        assert.throws(() => parseGatewayConfig({ providers: [{ ...provider, keys: [{ alias: "k", env: 3 }] }] }), refused(/must be a string/))
        assert.throws(() => parseGatewayConfig({ providers: "a" }), refused(/must be a list/))
        assert.throws(() => parseGatewayConfig({}), refused(/providers is required/))
        assert.throws(() => parseGatewayConfig([]), refused(/must be a mapping/))
        const keys = [{ alias: "k", env: "A" }]
        assert.throws(() => parseGatewayConfig({ providers: [{ ...provider, keys }], defaults: { allowFallback: "no" } }), refused(/true or false/))
        assert.throws(() => parseGatewayConfig({ providers: [{ ...provider, keys }], defaults: { require: ["telepathy"] } }), refused(/one of/))
        assert.throws(() => parseGatewayConfig({ providers: [{ ...provider, keys }], resilience: { authDisableMs: "x" } }), refused(/number/))
        assert.throws(() => parseGatewayConfig({ providers: [{ ...provider, keys }], gateway: { port: 70_000 } }), refused(/port/))
        assert.throws(() => parseGatewayConfig({ providers: [{ ...provider, keys }], gateway: { maxBodyBytes: 0.5 } }), refused(/maxBodyBytes/))
        assert.throws(() => parseGatewayConfig({ providers: [{ ...provider, keys }], gateway: { keyStore: { type: "sqlite" } } }), refused(/path is required/))
        assert.throws(() => parseGatewayConfig({ providers: [{ ...provider, keys }], gateway: { adminToken: { env: "A", file: "b" } } }), refused(/exactly one/))
        const ok = parseGatewayConfig({ providers: [{ ...provider, keys }], resilience: { authDisableMs: null }, profiles: { p: { model: "m" } }, gateway: { keyStore: { type: "sqlite", path: ":memory:" }, adminToken: { file: "t" } } }, dir)
        assert.deepEqual(ok.gateway.keyStore, { type: "sqlite", path: ":memory:" })
        assert.deepEqual(ok.gateway.adminToken, { file: join(dir, "t") })
        const withGateway = (gateway: Record<string, unknown>) => ({ providers: [{ ...provider, keys }], gateway })
        assert.equal(parseGatewayConfig(withGateway({ appPort: 3001 })).gateway.port, 3002)
        assert.equal(parseGatewayConfig(withGateway({ appPort: 3000, portOffset: 5 })).gateway.port, 3005)
        assert.equal(parseGatewayConfig(withGateway({ appPort: 3001 })).gateway.host, "127.0.0.1")
        assert.throws(() => parseGatewayConfig(withGateway({ port: 8080, appPort: 3001 })), refused(/cannot be combined/))
        assert.throws(() => parseGatewayConfig(withGateway({ portOffset: 1 })), refused(/needs config.gateway.appPort/))
        assert.throws(() => parseGatewayConfig(withGateway({ appPort: 0 })), refused(/appPort must be a port number/))
        assert.throws(() => parseGatewayConfig(withGateway({ appPort: 3001, portOffset: 0 })), refused(/portOffset must be/))
        assert.throws(() => parseGatewayConfig(withGateway({ appPort: 65535 })), refused(/appPort \+ portOffset/))
    })

    test("names an unreadable or unparsable file", async () => {
        await assert.rejects(loadGatewayConfig(join(dir, "missing.yaml")), refused(/cannot read/))
        await writeFile(join(dir, "broken.json"), "{")
        await assert.rejects(loadGatewayConfig(join(dir, "broken.json")), refused(/does not parse/))
    })
})

/** Runs the CLI in process and captures its output. */
async function run(argv: string[], extra: Partial<CliIo> = {}): Promise<{ code: number; out: string; err: string }> {
    let out = ""
    let err = ""
    const code = await main(argv, {
        out: (text) => (out += text),
        err: (text) => (err += text),
        env: { TEST_ADMIN_TOKEN: "cli-admin" },
        ...extra,
    })
    return { code, out, err }
}

describe("ai-router keys on the durable store", () => {
    test("create, list, get, update, rotate, usage and revoke", async () => {
        const config = ["--config", join(dir, "pool.yaml")]
        const created = await run(["keys", "create", "--label", "cli", "--profiles", "lesson", "--models", "fast", "--no-fallback", "--rpm", "60", "--tokens-per-day", "1000", "--cost-per-day", "1.5", "--cost-per-month", "20", "--owner", "ops", ...config])
        assert.equal(created.code, 0, created.err)
        const issued = JSON.parse(created.out) as IssuedKey
        assert.match(issued.secret, /^sk-starci-cli-/)
        assert.deepEqual(issued.key.quota, { requestsPerMinute: 60, tokensPerDay: 1000, costPerDay: 1.5, costPerMonth: 20 })
        assert.equal(issued.key.allowFallback, false)
        const listed = await run(["keys", "list", ...config])
        assert.ok(!listed.out.includes(issued.secret))
        assert.deepEqual((JSON.parse(listed.out) as VirtualKey[]).map((key) => key.id), [issued.key.id])
        assert.equal((JSON.parse((await run(["keys", "get", issued.key.id, ...config])).out) as VirtualKey).owner, "ops")
        const updated = JSON.parse((await run(["keys", "update", issued.key.id, "--fallback", "--disable", ...config])).out) as VirtualKey
        assert.equal(updated.allowFallback, true)
        assert.equal(updated.enabled, false)
        const rotated = JSON.parse((await run(["keys", "rotate", issued.key.id, ...config])).out) as IssuedKey
        assert.notEqual(rotated.secret, issued.secret)
        const usage = JSON.parse((await run(["keys", "usage", issued.key.id, "--from", "2026-01-01", "--to", "2026-12-31", ...config])).out) as KeyUsage
        assert.equal(usage.totals.requests, 0)
        const revoked = JSON.parse((await run(["keys", "revoke", issued.key.id, ...config])).out) as VirtualKey
        assert.equal(typeof revoked.revokedAt, "number")
        const failed = await run(["keys", "rotate", issued.key.id, ...config])
        assert.equal(failed.code, 1)
        assert.match(failed.err, /revoked/)
    })

    test("misuse exits 2 with the help", async () => {
        assert.equal((await run([])).code, 2)
        assert.equal((await run(["--help"])).code, 0)
        assert.equal((await run(["--bogus"])).code, 2)
        assert.equal((await run(["launch"])).code, 2)
        assert.equal((await run(["keys"])).code, 2)
        assert.equal((await run(["keys", "list"])).code, 2)
        assert.equal((await run(["keys", "create", "--config", join(dir, "pool.yaml")])).code, 2)
        assert.equal((await run(["keys", "get", "--config", join(dir, "pool.yaml")])).code, 2)
        assert.equal((await run(["keys", "create", "--label", "x", "--rpm", "many", "--config", join(dir, "pool.yaml")])).code, 2)
        assert.equal((await run(["keys", "update", "k", "--enable", "--disable", "--config", join(dir, "pool.yaml")])).code, 2)
        assert.equal((await run(["keys", "list", "--config", "a", "--url", "b"])).code, 2)
        assert.equal((await run(["keys", "list", "--url", "http://x", "--admin-token-env", "NOPE"])).code, 2)
        assert.match((await run(["keys", "list", "--config", join(dir, "memory.json")])).err, /--url/)
        assert.equal((await run(["serve"])).code, 2)
    })
})

describe("ai-router serve and keys --url", () => {
    test("serves the config, and keys --url administers it through the admin API", async () => {
        await writeFile(join(dir, "serve.yaml"), POOL_YAML.replace("keyStore: { type: sqlite, path: keys.sqlite }", "keyStore: { type: memory }"))
        const fake = createFakeProvider()
        const stop = new AbortController()
        let out = ""
        const served = main(["serve", "--config", join(dir, "serve.yaml"), "--port", "0", "--host", "127.0.0.1"], {
            out: (text) => (out += text),
            err: () => undefined,
            env: { TEST_ADMIN_TOKEN: "cli-admin" },
            signal: stop.signal,
            fetch: fake.fetch,
        })
        while (!out.includes("listening")) await new Promise((resolve) => setTimeout(resolve, 5))
        const url = (JSON.parse(out) as { listening: string }).listening
        const remote = ["--url", url, "--admin-token-env", "TEST_ADMIN_TOKEN"]
        const created = await run(["keys", "create", "--label", "remote", "--profiles", "lesson", ...remote])
        assert.equal(created.code, 0, created.err)
        const issued = JSON.parse(created.out) as IssuedKey
        process.env.TEST_UPSTREAM_KEY = "sk-env-upstream"
        assert.equal((await http(url, "/v1/chat/completions", { key: issued.secret, body: chatBody("lesson") })).status, 200)
        assert.ok(["sk-env-upstream", "sk-from-file"].includes(fake.calls.at(-1)?.key ?? ""))
        delete process.env.TEST_UPSTREAM_KEY
        for (const command of [["list"], ["get", issued.key.id], ["update", issued.key.id, "--rpm", "5"], ["usage", issued.key.id, "--from", "2020-01-01"], ["rotate", issued.key.id], ["revoke", issued.key.id]]) {
            const result = await run(["keys", ...command, ...remote])
            assert.equal(result.code, 0, `${command.join(" ")}: ${result.err}`)
        }
        assert.equal((JSON.parse((await run(["keys", "list", ...remote])).out) as VirtualKey[]).length, 1)
        const wrong = await run(["keys", "list", "--url", url, "--admin-token-env", "WRONG"], { env: { WRONG: "nope" } })
        assert.equal(wrong.code, 1)
        assert.match(wrong.err, /401/)
        stop.abort()
        assert.equal(await served, 0)
    })

    test("serveGateway releases the store when the port is taken", async () => {
        await writeFile(join(dir, "taken.yaml"), POOL_YAML.replace("keyStore: { type: sqlite, path: keys.sqlite }", "keyStore: { type: memory }"))
        const first = await serveGateway({ config: join(dir, "taken.yaml"), port: 0, onError: () => undefined })
        const port = Number(new URL(first.url).port)
        await assert.rejects(serveGateway({ config: join(dir, "taken.yaml"), port }), /EADDRINUSE/)
        await first.close()
    })
})

describe("AiRouterGatewayModule", () => {
    test("fronts the registered router in a Nest app and listens at bootstrap", async () => {
        const fake = createFakeProvider()
        const keys = new MemoryKeyStore()
        const app = await Test.createTestingModule({
            imports: [
                AiRouterTestingModule.register({ fake, isGlobal: true, name: "chat", providers: [{ id: "a", baseUrl: "https://a.test/v1", keys: [{ alias: "k", resolve: () => "sk-a" }], models: [{ id: "m1" }] }] }),
                AiRouterGatewayModule.register({ name: "chat", keys, listen: { port: 0 } }),
            ],
        }).compile()
        await app.init()
        const gateway = app.get<AiRouterGateway>(getAiRouterGatewayToken("chat"))
        const { secret } = await gateway.admin.create({ label: "nest", models: ["m1"] })
        const { url } = await gateway.listen(0)
        assert.equal((await http(url, "/v1/chat/completions", { key: secret, body: chatBody("m1") })).status, 200)
        await app.close()
    })

    test("registerAsync builds the options from a factory, over the default router", async () => {
        const fake = createFakeProvider()
        const app = await Test.createTestingModule({
            imports: [
                AiRouterTestingModule.register({ fake, isGlobal: true, providers: [{ id: "a", baseUrl: "https://a.test/v1", keys: [{ alias: "k", resolve: () => "sk-a" }], models: [{ id: "m1" }] }] }),
                AiRouterGatewayModule.registerAsync({ useFactory: () => ({ keys: new MemoryKeyStore(), adminToken: () => "t" }) }),
            ],
        }).compile()
        await app.init()
        const gateway = app.get<AiRouterGateway>(getAiRouterGatewayToken())
        assert.deepEqual(await gateway.admin.list(), [])
        await app.close()
    })
})
