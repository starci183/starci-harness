// The host model's seams: ops/host.yaml loads, an http check judges a status and a json body, `start.secrets` reach the child
// environment through the secret loader and a missing key is refused by name, `host down` stops dependents first, and the
// compose stack carries no secret value and pins every image by digest. Values here are fixtures; no real secret.env is read.
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { inRequiresOrder, inStopOrder, loadHost, probeService, selectServices, startEnv } from "./host.js"
import type { HostConfig, HostService } from "./host.js"

const opsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "ops")

const serviceOf = (config: HostConfig, id: string): HostService => {
    const found = config.services.find((service) => service.id === id)
    if (found === undefined) throw new Error(`ops/host.yaml declares no ${id}`)
    return found
}

const serve = async (t: { after: (fn: () => void) => void }): Promise<string> => {
    const server = createServer((request, response) => {
        if (request.url === "/status") response.end(JSON.stringify({ status: "UP" }))
        else if (request.url === "/starting") response.end(JSON.stringify({ status: "STARTING" }))
        else {
            response.statusCode = 404
            response.end("no")
        }
    })
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
    t.after(() => server.close())
    return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
}

void test("ops/host.yaml loads and declares the starci compose group and the local registry behind docker", () => {
    const config = loadHost(opsDir)
    const ids = config.services.map((service) => service.id)
    for (const id of ["sonar-postgres", "sonar", "sonar-bootstrap", "sonar-tunnel", "local-registry"]) assert.ok(ids.includes(id), id)
    const byId = new Map(config.services.map((service) => [service.id, service]))
    assert.deepEqual(byId.get("sonar-tunnel")?.requires, ["sonar", "sonar-bootstrap"])
    assert.deepEqual(byId.get("sonar-tunnel")?.start?.secrets, ["SONARQUBE_DB_PASSWORD", "SONARQUBE_ADMIN_PASSWORD", "CLOUDFLARE_TUNNEL_TOKEN"])
    const order = inRequiresOrder(config, [serviceOf(config, "sonar-tunnel")]).map((service) => service.id)
    assert.deepEqual(order, ["docker", "sonar-postgres", "sonar", "sonar-bootstrap", "sonar-tunnel"])
})

void test("an http check is up on its status and, with json, on the body value", async (t) => {
    const base = await serve(t)
    const up = await probeService({ http: { url: `${base}/status`, status: 200 }, json: { path: "status", equals: "UP" } }, ".", 5)
    assert.equal(up.up, true)
    const starting = await probeService({ http: { url: `${base}/starting`, status: 200 }, json: { path: "status", equals: "UP" } }, ".", 5)
    assert.equal(starting.up, false)
    assert.match(starting.evidence, /status = "STARTING"/)
    const missing = await probeService({ http: { url: `${base}/nope`, status: 200 } }, ".", 5)
    assert.equal(missing.up, false)
    assert.match(missing.evidence, /answered 404, not 200/)
    const refused = await probeService({ http: { url: "http://127.0.0.1:1/", status: 200 } }, ".", 5)
    assert.equal(refused.up, false)
})

void test("start.secrets come from the secret loader into the environment, and a missing key is refused by name only", (t) => {
    const saved = { db: process.env.SONARQUBE_DB_PASSWORD, admin: process.env.SONARQUBE_ADMIN_PASSWORD }
    t.after(() => {
        if (saved.db === undefined) delete process.env.SONARQUBE_DB_PASSWORD
        else process.env.SONARQUBE_DB_PASSWORD = saved.db
        if (saved.admin === undefined) delete process.env.SONARQUBE_ADMIN_PASSWORD
        else process.env.SONARQUBE_ADMIN_PASSWORD = saved.admin
    })
    const value = ["fixture", "db", "value"].join("-")
    process.env.SONARQUBE_DB_PASSWORD = value
    delete process.env.SONARQUBE_ADMIN_PASSWORD
    assert.deepEqual(startEnv({ argv: ["x"], detach: false, env: { PLAIN: "1" }, secrets: ["SONARQUBE_DB_PASSWORD"] }), { PLAIN: "1", SONARQUBE_DB_PASSWORD: value })
    assert.throws(
        () => startEnv({ argv: ["x"], detach: false, secrets: ["SONARQUBE_DB_PASSWORD", "SONARQUBE_ADMIN_PASSWORD"] }),
        (error: unknown) => error instanceof Error && "code" in error && error.code === "HOST_SECRET_MISSING" && error.message.includes("SONARQUBE_ADMIN_PASSWORD") && !error.message.includes(value),
    )
})

void test("host down stops dependents before what they require", () => {
    const config = loadHost(opsDir)
    const postgres = serviceOf(config, "sonar-postgres")
    assert.deepEqual(inStopOrder(config, [postgres]).map((service) => service.id), ["sonar-tunnel", "sonar-bootstrap", "sonar", "sonar-postgres"])
})

const STACK_FILES = ["sonar.yaml", "tunnel.yaml", "registry.yaml", "embeddings.yaml"]
const STACK_SERVICES = ["sonar-postgres", "sonar", "sonar-bootstrap", "sonar-tunnel", "local-registry", "embeddings-gate", "embeddings-tunnel"]

void test("the compose stack stores no secret value and pins every image by digest", () => {
    for (const file of STACK_FILES) {
        const text = readFileSync(join(opsDir, "host", "stack", file), "utf8")
        for (const image of text.matchAll(/^\s+image:\s*(\S+)/gm)) assert.match(image[1] ?? "", /@sha256:[0-9a-f]{64}$/, `${file}: ${image[1] ?? ""}`)
        for (const secret of text.matchAll(/^\s+(?:POSTGRES_PASSWORD|SONAR_JDBC_PASSWORD|SONARQUBE_ADMIN_PASSWORD|TUNNEL_TOKEN|EMBEDDINGS_API_KEY):\s*(\S+)/gm)) assert.match(secret[1] ?? "", /^\$\{[A-Z_]+:\?/, `${file}: a secret is not read from the environment`)
    }
})

void test("the host stack is one compose project in one folder: every file names the project starci, and every stack service starts from that folder", () => {
    for (const file of STACK_FILES) assert.match(readFileSync(join(opsDir, "host", "stack", file), "utf8"), /^name: \$\{STARCI_HOST_PROJECT:-starci\}$/m, file)
    for (const gone of ["sonar", "registry"]) assert.ok(!existsSync(join(opsDir, "host", gone)), `ops/host/${gone} moved into ops/host/stack`)
    const config = loadHost(opsDir)
    assert.deepEqual(config.services.filter((service) => service.stack === "starci").map((service) => service.id), STACK_SERVICES)
    for (const id of STACK_SERVICES) {
        const argv = serviceOf(config, id).start?.argv ?? []
        assert.deepEqual(argv.slice(0, 4), ["docker", "compose", "--project-directory", "{runtime}/ops/host/stack"], id)
        const files = argv.flatMap((token, at) => (argv[at - 1] === "-f" ? [token] : []))
        assert.ok(files.length > 0 && files.every((file) => file.startsWith("{runtime}/ops/host/stack/")), `${id}: ${files.join(", ")}`)
        assert.deepEqual(argv.slice(-4, -1), ["up", "-d", "--no-recreate"], id)
    }
})

void test("a stack selects its services, in ops/host.yaml order, and an unknown stack is refused", () => {
    const config = loadHost(opsDir)
    assert.deepEqual(selectServices(config, [], "starci").map((service) => service.id), STACK_SERVICES)
    assert.deepEqual(inRequiresOrder(config, selectServices(config, [], "starci")).map((service) => service.id), ["docker", ...STACK_SERVICES.slice(0, 5), "embeddings", ...STACK_SERVICES.slice(5)])
    assert.deepEqual(selectServices(config, ["sonar"], "starci").map((service) => service.id), ["sonar"], "an id narrows the stack")
    assert.throws(() => selectServices(config, [], "nope"), (error: unknown) => error instanceof Error && "code" in error && error.code === "HOST_UNKNOWN_STACK")
    assert.throws(() => selectServices(config, ["orca"], "starci"), (error: unknown) => error instanceof Error && "code" in error && error.code === "HOST_UNKNOWN_SERVICE")
})

void test("the local registry is a service of the host stack: ping check on 4873, compose up --no-recreate, docker stop, behind docker, its storage a named volume", () => {
    const config = loadHost(opsDir)
    const registry = serviceOf(config, "local-registry")
    assert.equal(registry.check?.http?.url, "http://127.0.0.1:4873/-/ping")
    assert.deepEqual(registry.start?.argv, ["docker", "compose", "--project-directory", "{runtime}/ops/host/stack", "-f", "{runtime}/ops/host/stack/registry.yaml", "up", "-d", "--no-recreate", "local-registry"])
    assert.equal(registry.start.env, undefined, "the storage is a named volume: no host folder is handed to compose")
    assert.equal(registry.start.secrets, undefined, "the registry starts without the Sonar secrets")
    assert.deepEqual(registry.stop?.argv, ["docker", "stop", "starci-local-registry"])
    assert.deepEqual(registry.requires, ["docker"])
    assert.deepEqual(inRequiresOrder(config, [registry]).map((service) => service.id), ["docker", "local-registry"])
})

void test("a start env value expands the state tokens: {shared-state} is STARCI_LOCAL_ROOT when it is set", (t) => {
    const saved = process.env.STARCI_LOCAL_ROOT
    t.after(() => {
        if (saved === undefined) delete process.env.STARCI_LOCAL_ROOT
        else process.env.STARCI_LOCAL_ROOT = saved
    })
    const root = join(tmpdir(), "shared-state-fixture")
    process.env.STARCI_LOCAL_ROOT = root
    assert.deepEqual(startEnv({ argv: ["x"], detach: false, env: { FOLDER: "{shared-state}/local-registry/storage" } }), { FOLDER: `${root}/local-registry/storage` })
})

void test("the embedding model is the host's native Ollama behind a token gate and its own tunnel: the gate and the public origin are up only while they refuse a call without the token", () => {
    const config = loadHost(opsDir)
    const model = serviceOf(config, "embeddings")
    assert.equal(model.stack, undefined, "the model runs in the host's native Ollama, never a container of the stack")
    assert.equal(model.check?.http?.url, "http://127.0.0.1:11434/api/tags")
    assert.deepEqual(model.check.json, { path: "models.0.name", equals: "qwen3-embedding:8b" })
    const gate = serviceOf(config, "embeddings-gate")
    assert.deepEqual(gate.check?.http, { url: "http://127.0.0.1:11435/v1/models", status: 401 })
    assert.deepEqual(gate.requires, ["docker", "embeddings"])
    const tunnel = serviceOf(config, "embeddings-tunnel")
    assert.deepEqual(tunnel.check?.http, { url: "https://embed.starci.org/v1/models", status: 401 })
    for (const service of [gate, tunnel]) assert.deepEqual(service.start?.secrets, ["EMBEDDINGS_API_KEY", "HOST_SERVICES_TUNNEL_TOKEN"], service.id)
    assert.deepEqual(inRequiresOrder(config, [tunnel]).map((service) => service.id), ["docker", "embeddings", "embeddings-gate", "embeddings-tunnel"])
    const caddyfile = readFileSync(join(opsDir, "host", "stack", "embeddings.Caddyfile"), "utf8")
    assert.ok(caddyfile.includes('not header Authorization "Bearer {$EMBEDDINGS_API_KEY}"'), "the token is read from the environment, never written")
    assert.match(caddyfile, /max_size 1MB/)
    assert.ok(caddyfile.includes("path /v1/embeddings /api/embed"))
    assert.match(caddyfile, /respond "Not Found" 404/)
})
