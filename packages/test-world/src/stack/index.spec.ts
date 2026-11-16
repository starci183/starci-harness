import { tmpdir } from "node:os"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import { TestWorldErrorCode } from "../errors"
import type { AttachRequest, Namespace } from "./contracts"
import { Docker } from "./docker"
import type { ExecResult } from "./exec"
import type { PgClient } from "./pg"
import { createStack } from "./index"
import { DEBEZIUM_IMAGE, KAFKA_IMAGE, POSTGRES_LOGICAL_ARGS, containerName, kafkaProxyName, serviceContainerName } from "./naming"
import { Registry } from "./registry"

const scratch = mkdtempSync(join(tmpdir(), "starci-tw-stack-"))
let counter = 0

/** A scripted docker: containers, published ports and the calls made. */
const fakeDocker = () => {
    const containers = new Map<string, { running: boolean; ports: Map<number, number> }>()
    const calls: Array<string> = []
    let nextPort = 40000
    const ok = (stdout = ""): ExecResult => ({ code: 0, stdout, stderr: "" })
    const exec = async (_command: string, args: ReadonlyArray<string>): Promise<ExecResult> => {
        calls.push(args.join(" "))
        const [verb] = args
        if (verb === "network") return ok()
        if (verb === "inspect") return containers.has(args[args.length - 1] ?? "") ? ok(containers.get(args[args.length - 1] ?? "")?.running ? "running" : "exited") : { code: 1, stdout: "", stderr: "no such" }
        if (verb === "run") {
            const name = args[args.indexOf("--name") + 1] ?? ""
            const ports = new Map<number, number>()
            args.forEach((arg, index) => {
                const match = /^127\.0\.0\.1::(\d+)$/.exec(arg)
                if (args[index - 1] === "-p" && match?.[1] !== undefined) ports.set(Number(match[1]), (nextPort += 1))
            })
            containers.set(name, { running: true, ports })
            return ok("id")
        }
        if (verb === "port") {
            const port = containers.get(args[1] ?? "")?.ports.get(Number((args[2] ?? "").split("/")[0]))
            return port === undefined ? { code: 1, stdout: "", stderr: "" } : ok(`127.0.0.1:${port}`)
        }
        if (verb === "start") {
            const found = containers.get(args[1] ?? "")
            if (found !== undefined) found.running = true
            return ok()
        }
        if (verb === "rm") {
            containers.delete(args[args.length - 1] ?? "")
            return ok()
        }
        if (verb === "ps") {
            return ok(
                [...containers.keys()]
                    .map((name) => `${name}|${containers.get(name)?.running ? "running" : "exited"}|${name.split("-")[2] ?? ""}|image`)
                    .join("\n"),
            )
        }
        return ok()
    }
    return { docker: new Docker(exec), containers, calls, runCount: () => calls.filter((call) => call.startsWith("run ")).length }
}

const fakeFetch = (log: Array<string>, healthStatus = 204) =>
    (async (url: string | URL | Request, init?: RequestInit) => {
        const path = new URL(String(url)).pathname
        log.push(`${init?.method ?? "GET"} ${path}`)
        if (path === "/q/health/live") return new Response(null, { status: healthStatus })
        if (path === "/version") return new Response('"2.9.0"', { status: 200 })
        if (path === "/proxies" && (init?.method ?? "GET") === "GET") return new Response("{}", { status: 200 })
        if (path.endsWith("/toxics") && (init?.method ?? "GET") === "GET") return new Response("[]", { status: 200 })
        if (/^\/proxies\/[^/]+$/.test(path) && init?.method === "POST") return new Response("{}", { status: 200 })
        if (path === "/proxies") return new Response("{}", { status: 201 })
        return new Response(null, { status: 204 })
    }) as typeof fetch

const fakePg = (queries: Array<string>) => (): PgClient => ({
    connect: async () => undefined,
    on: () => undefined,
    end: async () => undefined,
    query: async (sql: string) => {
        queries.push(sql)
        // The replication slot of a connector that started is active.
        return { rows: sql.includes("SELECT active FROM pg_replication_slots") ? [{ active: true }] : [{ "?column?": 1 }] }
    },
})

const namespace = (snake: string): Namespace => ({ snake, kebab: snake.replace(/_/g, "-"), root: `/repo/${snake}` })

const harness = (probed: Array<number> = [], process: { readonly home?: string; readonly pid?: number; readonly isAlive?: (pid: number) => boolean; readonly docker?: ReturnType<typeof fakeDocker>; readonly healthStatus?: number; readonly readyTimeoutMs?: number } = {}) => {
    const docker = process.docker ?? fakeDocker()
    const http: Array<string> = []
    const queries: Array<string> = []
    const redisCalls: Array<string> = []
    const stack = createStack({
        docker: docker.docker,
        home: process.home ?? join(scratch, `home${(counter += 1)}`),
        pause: async () => undefined,
        fetch: fakeFetch(http, process.healthStatus),
        ...(process.readyTimeoutMs === undefined ? {} : { readyTimeoutMs: process.readyTimeoutMs }),
        pg: fakePg(queries),
        redis: async (_host, _port, commands) => {
            redisCalls.push(commands.map((command) => command.join(" ")).join(" | "))
            // A connector that is delivering: the message a drain emitted is in the stream.
            const emitted = [...queries].reverse().find((query) => query.includes("pg_logical_emit_message"))
            const id = /'starci-world', '([^']+)'/.exec(emitted ?? "")?.[1] ?? ""
            return commands.map((command) => (command[0] === "PING" ? "PONG" : command[0] === "XREVRANGE" ? [["1-0", ["message", Buffer.from(id).toString("base64")]]] : "OK"))
        },
        cluster: {
            up: async () => undefined,
            attach: async () => {
                throw new Error("the fake cluster is not used")
            },
            reset: async () => undefined,
            detach: async () => undefined,
            status: async () => [],
            down: async () => undefined,
        },
        isAlive: process.isAlive ?? (() => true),
        pid: process.pid ?? 4321,
        kafkaProbe: async (_host, port) => {
            probed.push(port)
            return true
        },
    })
    return { docker, http, queries, redisCalls, stack }
}

const request = (ns: Namespace, runId: string): AttachRequest => ({
    namespace: ns,
    runId,
    services: [
        { service: "postgresql", image: "pgvector/pgvector:pg16" },
        { service: "redis", image: "redis:7-alpine" },
    ],
    postgresql: { connections: [{ name: "primary" }] },
})

describe("stack attach", () => {
    it("starts the shared containers keyed by image and answers proxied endpoints", async () => {
        const { docker, stack, http } = harness()
        const infra = await stack.attach(request(namespace("shop_aaaaaa"), "run1"))
        assert.deepEqual(
            [...docker.containers.keys()].sort(),
            [containerName("postgresql", "pgvector/pgvector:pg16"), containerName("redis", "redis:7-alpine"), containerName("toxiproxy", "ghcr.io/shopify/toxiproxy:2.9.0")].sort(),
        )
        assert.equal(infra.postgresql?.host, "127.0.0.1")
        assert.equal(infra.postgresql?.proxy, "run1-postgresql")
        assert.equal(infra.postgresql?.port, 30100)
        assert.equal(infra.redis?.port, 30101)
        assert.notEqual(infra.postgresql?.directPort, infra.postgresql?.port)
        assert.deepEqual(infra.postgresql?.databases, { primary: "shop_aaaaaa_primary" })
        assert.equal(infra.redis?.db, 0)
        assert.match(infra.toxiproxyApi, /^http:\/\/127\.0\.0\.1:\d+$/)
        assert.equal(http.filter((call) => call === "POST /proxies").length, 2)
        const run = docker.calls.find((call) => call.startsWith("run ") && call.includes("starci-ts-postgresql"))
        assert.ok(run?.includes("--restart no"))
        assert.ok(run?.includes("--network starci-test-net"))
        assert.ok(run?.includes("--label starci.test-stack=1"))
        assert.ok(run?.includes("-p 127.0.0.1::5432"))
    })

    it("a second attach of another repo starts nothing and gets its own databases, redis db and proxy ports", async () => {
        const { docker, stack, queries } = harness()
        await stack.attach(request(namespace("shop_aaaaaa"), "run1"))
        const runsAfterFirst = docker.runCount()
        const second = await stack.attach(request(namespace("blog_bbbbbb"), "run2"))
        assert.equal(docker.runCount(), runsAfterFirst)
        assert.equal(second.redis?.db, 1)
        assert.equal(second.postgresql?.port, 30102)
        assert.deepEqual(second.postgresql?.databases, { primary: "blog_bbbbbb_primary" })
        assert.ok(queries.includes('CREATE DATABASE "blog_bbbbbb_primary"'))
    })

    it("refuses a second live run of the same namespace with NamespaceBusy", async () => {
        const { stack } = harness()
        await stack.attach(request(namespace("shop_aaaaaa"), "run1"))
        await assert.rejects(stack.attach(request(namespace("shop_aaaaaa"), "run2")), (error: unknown) => error instanceof Error && "code" in error && error.code === TestWorldErrorCode.NamespaceBusy)
    })

    it("detach drops what the run owns, frees its leases, and lets the namespace attach again", async () => {
        const { stack, queries, redisCalls, http } = harness()
        const ns = namespace("shop_aaaaaa")
        const infra = await stack.attach(request(ns, "run1"))
        await stack.detach({ namespace: ns, runId: "run1", infra })
        assert.ok(queries.includes('DROP DATABASE IF EXISTS "shop_aaaaaa_primary" WITH (FORCE)'))
        assert.ok(redisCalls.includes("SELECT 0 | FLUSHDB"))
        assert.ok(http.includes("DELETE /proxies/run1-postgresql"))
        assert.equal((await stack.status()).leases.length, 0)
        const again = await stack.attach(request(ns, "run3"))
        assert.equal(again.redis?.db, 0)
        assert.equal(again.postgresql?.port, 30100)
    })

    it("mail: one container per data slot, SMTP behind toxiproxy and the API published beside it; detach removes the slot's container", async () => {
        const { docker, stack, http } = harness()
        const mailpit = "axllent/mailpit:v1.31.6"
        const mailRequest = (ns: Namespace, runId: string): AttachRequest => ({ namespace: ns, runId, services: [{ service: "mail", image: mailpit }] })
        const one = namespace("shop_aaaaaa_w1")
        const two = namespace("shop_aaaaaa_w2")
        const first = await stack.attach(mailRequest(one, "run1-w1"))
        const second = await stack.attach(mailRequest(two, "run1-w2"))
        assert.equal(first.mail?.container, containerName("mail", `${mailpit}#shop_aaaaaa_w1`))
        assert.equal(second.mail?.container, containerName("mail", `${mailpit}#shop_aaaaaa_w2`))
        assert.notEqual(first.mail?.container, second.mail?.container, "a slot's messages and chaos never reach another slot")
        assert.equal(docker.runCount(), 3, "toxiproxy and one sink per slot")
        const run = docker.calls.find((call) => call.startsWith("run ") && call.includes(first.mail?.container ?? "?"))
        assert.ok(run?.includes("-p 127.0.0.1::1025") && run.includes("-p 127.0.0.1::8025"), run)
        assert.ok(run?.includes("-e MP_ENABLE_CHAOS=true"), run)
        assert.equal(first.mail?.proxy, "run1-w1-mail")
        assert.notEqual(first.mail?.apiPort, first.mail?.directPort)
        assert.notEqual(first.mail?.apiPort, first.mail?.port, "the API is not behind the SMTP proxy")
        assert.ok(http.includes("POST /proxies"))
        const leased = (await stack.status()).leases
        assert.equal(leased.length, 2)
        await stack.detach({ namespace: one, runId: "run1-w1", infra: first })
        assert.equal(docker.containers.has(first.mail?.container ?? "?"), false, "the slot's sink goes with its run")
        assert.equal(docker.containers.has(second.mail?.container ?? "?"), true)
        assert.ok(http.includes("DELETE /proxies/run1-w1-mail"))
    })

    it("up keeps shared services warm and leaves a data slot's own mail sink to its attach", async () => {
        const { docker, stack } = harness()
        await stack.up([
            { service: "redis", image: "redis:7-alpine" },
            { service: "mail", image: "axllent/mailpit:v1.31.6" },
        ])
        assert.deepEqual(
            [...docker.containers.keys()].sort(),
            [containerName("redis", "redis:7-alpine"), containerName("toxiproxy", "ghcr.io/shopify/toxiproxy:2.9.0")].sort(),
        )
    })

    it("kafka: one broker of the pinned image with a proxy per slot listener; each slot leases its own listener, probed through its proxy", async () => {
        const probed: Array<number> = []
        const { docker, stack, http } = harness(probed)
        const kafkaRequest = (ns: Namespace, runId: string): AttachRequest => ({ namespace: ns, runId, services: [{ service: "kafka", image: KAFKA_IMAGE }], kafka: { topics: ["orders"] } })
        const one = namespace("shop_aaaaaa_w1")
        const two = namespace("shop_aaaaaa_w2")
        const first = await stack.attach(kafkaRequest(one, "run1-w1"))
        assert.equal(http.filter((call) => call === "POST /proxies").length, 8, "one proxy per slot listener")
        const second = await stack.attach(kafkaRequest(two, "run1-w2"))
        assert.ok(docker.containers.has(serviceContainerName("kafka", KAFKA_IMAGE)))
        assert.notEqual(serviceContainerName("kafka", KAFKA_IMAGE), containerName("kafka", KAFKA_IMAGE), "a broker of another listener shape is another container")
        assert.equal(docker.runCount(), 2, "toxiproxy and one broker")
        assert.equal(first.kafka?.listener, 1)
        assert.equal(second.kafka?.listener, 2)
        assert.equal(first.kafka?.proxy, kafkaProxyName(KAFKA_IMAGE, 1))
        assert.equal(second.kafka?.proxy, kafkaProxyName(KAFKA_IMAGE, 2))
        assert.notEqual(first.kafka?.port, second.kafka?.port)
        assert.deepEqual(probed, [first.kafka?.port, second.kafka?.port])
        assert.equal(first.kafka?.groupPrefix, "shop-aaaaaa-w1.")
        const broker = docker.calls.find((call) => call.startsWith("run ") && call.includes("starci-ts-kafka"))
        assert.ok(broker?.includes(`S1://127.0.0.1:${first.kafka?.port}`), broker)
        assert.ok(broker?.includes(`S2://127.0.0.1:${second.kafka?.port}`), broker)
        await stack.detach({ namespace: one, runId: "run1-w1", infra: first })
        assert.equal(http.some((call) => call.startsWith("DELETE /proxies/kafka-")), false, "listener proxies belong to the broker")
        const again = await stack.attach(kafkaRequest(namespace("blog_bbbbbb_w1"), "run2-w1"))
        assert.equal(again.kafka?.listener, 1, "the freed listener is leased again")
        assert.equal(again.kafka?.port, first.kafka?.port)
    })

    it("a run whose process died is reclaimed by the next attach through the same teardown, and its namespace is free again", async () => {
        const home = join(scratch, `home${(counter += 1)}`)
        const docker = fakeDocker()
        const dead = new Set<number>()
        const crashed = harness([], { home, pid: 1111, isAlive: (pid) => !dead.has(pid), docker })
        const ns = namespace("shop_aaaaaa_w1")
        await crashed.stack.attach(request(ns, "crashed-w1"))
        dead.add(1111) // the jest process died: no detach ran
        const next = harness([], { home, pid: 2222, isAlive: (pid) => !dead.has(pid), docker })
        await next.stack.attach(request(namespace("blog_bbbbbb_w1"), "next-w1"))
        assert.ok(next.queries.includes('DROP DATABASE IF EXISTS "shop_aaaaaa_w1_primary" WITH (FORCE)'), "the crashed run's database is dropped")
        assert.ok(next.redisCalls.includes("SELECT 0 | FLUSHDB"), "its redis db is flushed")
        assert.ok(next.http.includes("DELETE /proxies/crashed-w1-postgresql"), "its proxies are removed")
        const leases = (await next.stack.status()).leases.map((lease) => lease.runId)
        assert.deepEqual(leases, ["next-w1"])
        const again = await next.stack.attach(request(ns, "rerun-w1"))
        assert.deepEqual(again.postgresql?.databases, { primary: "shop_aaaaaa_w1_primary" }, "the namespace attaches again")
    })

    it("a dead run that provisioned nothing is dropped without a teardown", async () => {
        const home = join(scratch, `home${(counter += 1)}`)
        const docker = fakeDocker()
        const dead = new Set<number>([3333])
        const live = harness([], { home, pid: 4444, isAlive: (pid) => !dead.has(pid), docker })
        await new Registry({ dir: home }).update((data) => void data.leases.push({ namespace: "ghost_w1", runId: "ghost", pid: 3333, since: "2026-01-01T00:00:00.000Z", containers: [] }))
        await live.stack.attach(request(namespace("shop_aaaaaa_w1"), "live-w1"))
        assert.equal(live.queries.some((query) => query.includes("ghost")), false)
        assert.deepEqual((await live.stack.status()).leases.map((lease) => lease.runId), ["live-w1"])
    })

    it("reset empties the namespace's databases and redis db", async () => {
        const { stack, queries, redisCalls } = harness()
        const ns = namespace("shop_aaaaaa")
        const infra = await stack.attach(request(ns, "run1"))
        await stack.reset({ namespace: ns, infra, keepTables: {} })
        assert.ok(queries.includes("SET session_replication_role = replica"))
        assert.ok(redisCalls.filter((call) => call === "SELECT 0 | FLUSHDB").length >= 2)
    })

    it("down keeps containers a live lease uses and removes everything with force", async () => {
        const { stack, docker } = harness()
        await stack.attach(request(namespace("shop_aaaaaa"), "run1"))
        await stack.down()
        assert.equal(docker.containers.size, 3)
        await stack.down({ force: true })
        assert.equal(docker.containers.size, 0)
    })

    describe("debezium", () => {
        const postgresImage = "pgvector/pgvector:pg16"
        const cdcRequest = (ns: Namespace, runId: string, extra: Partial<NonNullable<AttachRequest["debezium"]>> = {}): AttachRequest => ({
            namespace: ns,
            runId,
            // debezium first on purpose: it is started after the services it reads, whatever the order of the request.
            services: [
                { service: "debezium", image: DEBEZIUM_IMAGE },
                { service: "postgresql", image: postgresImage, logicalReplication: true },
                { service: "redis", image: "redis:7-alpine" },
            ],
            postgresql: { connections: [{ name: "primary" }] },
            debezium: { connections: ["primary"], ...extra },
        })
        const slot = (n: number) => namespace(`shop_aaaaaa_w${n}`)
        const runOf = (docker: ReturnType<typeof fakeDocker>, name: string): string | undefined => docker.calls.find((call) => call.startsWith("run ") && call.includes(name))

        it("a logical postgres is another warm container than the default one; the default container's arguments never change", async () => {
            const { docker, stack } = harness()
            const logical = await stack.attach(cdcRequest(slot(1), "run1-w1"))
            const plain = await stack.attach(request(namespace("blog_bbbbbb_w1"), "run2-w1"))
            assert.notEqual(logical.postgresql?.container, plain.postgresql?.container)
            assert.equal(logical.postgresql?.container, serviceContainerName("postgresql", postgresImage, true))
            assert.equal(plain.postgresql?.container, serviceContainerName("postgresql", postgresImage))
            assert.equal(serviceContainerName("postgresql", postgresImage), containerName("postgresql", postgresImage), "the default identity is the image alone")
            const logicalRun = runOf(docker, logical.postgresql?.container ?? "?")
            const plainRun = runOf(docker, plain.postgresql?.container ?? "?")
            for (const argument of POSTGRES_LOGICAL_ARGS.filter((entry) => entry !== "-c")) assert.ok(logicalRun?.includes(argument), argument)
            assert.equal(plainRun?.includes("wal_level"), false, plainRun)
        })

        it("starts the slot's server after its postgres and redis exist, configured from them, with no proxy, held by the lease", async () => {
            const { docker, stack, http, queries } = harness()
            const infra = await stack.attach(cdcRequest(slot(1), "run1-w1"))
            const run = infra.debezium
            assert.equal(run?.container, containerName("debezium", `${DEBEZIUM_IMAGE}#shop_aaaaaa_w1`))
            assert.equal(run?.proxy, "")
            assert.equal(run?.port, run?.directPort, "its published management port is reached directly")
            assert.equal(run?.slotName, "shop_aaaaaa_w1_cdc")
            assert.equal(run?.publicationName, "shop_aaaaaa_w1_cdc")
            assert.equal(run?.streamPrefix, "shop-aaaaaa-w1")
            assert.equal(run?.database, "shop_aaaaaa_w1_primary")
            assert.equal(run?.stream, null)
            assert.equal(http.filter((call) => call === "POST /proxies").length, 2, "postgresql and redis only: no proxy for the server")
            const started = runOf(docker, "starci-ts-debezium")
            assert.ok(started?.includes("-p 127.0.0.1::8080"), started)
            assert.ok(started?.includes(`-e DEBEZIUM_SOURCE_DATABASE_HOSTNAME=${infra.postgresql?.container}`), started)
            assert.ok(started?.includes("-e DEBEZIUM_SOURCE_DATABASE_DBNAME=shop_aaaaaa_w1_primary"), started)
            assert.ok(started?.includes(`-e DEBEZIUM_SINK_REDIS_ADDRESS=${infra.redis?.container}:6379`), started)
            assert.ok(started?.includes(`-e DEBEZIUM_SINK_REDIS_DB_INDEX=${infra.redis?.db}`), started)
            assert.ok(started?.includes("-e DEBEZIUM_SOURCE_SLOT_NAME=shop_aaaaaa_w1_cdc"), started)
            assert.ok(started?.includes("-e DEBEZIUM_SOURCE_TOPIC_PREFIX=shop-aaaaaa-w1"), started)
            assert.ok(queries.includes('CREATE DATABASE "shop_aaaaaa_w1_primary"'))
            assert.ok(queries.some((query) => query.includes("SELECT active FROM pg_replication_slots WHERE slot_name = 'shop_aaaaaa_w1_cdc'")), "it waits until the connector streams")
            assert.equal((await stack.status()).leases.length, 1)
            await stack.down()
            assert.equal(docker.containers.has(run?.container ?? "?"), true, "a live lease keeps its server")
        })

        it("two slots have a server, a replication slot and a stream prefix each", async () => {
            const { docker, stack } = harness()
            const first = await stack.attach(cdcRequest(slot(1), "run1-w1"))
            const second = await stack.attach(cdcRequest(slot(2), "run1-w2", { stream: "cdc" }))
            assert.notEqual(first.debezium?.container, second.debezium?.container)
            assert.notEqual(first.debezium?.slotName, second.debezium?.slotName)
            assert.notEqual(first.debezium?.streamPrefix, second.debezium?.streamPrefix)
            assert.equal(second.debezium?.stream, "shop-aaaaaa-w2.cdc")
            assert.equal(first.postgresql?.container, second.postgresql?.container, "one warm postgres serves both")
            assert.equal(docker.runCount(), 5, "toxiproxy, postgres, redis and a server per slot")
            const one = runOf(docker, first.debezium?.container ?? "?")
            const two = runOf(docker, second.debezium?.container ?? "?")
            assert.ok(one?.includes("DEBEZIUM_SOURCE_SLOT_NAME=shop_aaaaaa_w1_cdc"))
            assert.ok(two?.includes("DEBEZIUM_SOURCE_SLOT_NAME=shop_aaaaaa_w2_cdc"))
            assert.ok(two?.includes("DEBEZIUM_TRANSFORMS_STREAM_REPLACEMENT=shop-aaaaaa-w2.cdc"))
            assert.equal(one?.includes("DEBEZIUM_TRANSFORMS"), false)
        })

        it("detach removes the server and drops its slot and publication before the database that holds them", async () => {
            const { docker, stack, queries } = harness()
            const ns = slot(1)
            const infra = await stack.attach(cdcRequest(ns, "run1-w1"))
            queries.length = 0
            await stack.detach({ namespace: ns, runId: "run1-w1", infra })
            assert.equal(docker.containers.has(infra.debezium?.container ?? "?"), false)
            const slotDropped = queries.findIndex((query) => query.includes("pg_drop_replication_slot") && query.includes("shop_aaaaaa_w1_cdc"))
            const publicationDropped = queries.indexOf('DROP PUBLICATION IF EXISTS "shop_aaaaaa_w1_cdc"')
            const databaseDropped = queries.indexOf('DROP DATABASE IF EXISTS "shop_aaaaaa_w1_primary" WITH (FORCE)')
            assert.ok(slotDropped >= 0 && publicationDropped > slotDropped && databaseDropped > publicationDropped, JSON.stringify(queries))
            assert.equal(docker.containers.has(infra.postgresql?.container ?? "?"), true, "the shared postgres stays warm")
        })

        it("reset drains the connector after postgres and redis are emptied, and a run that died with its server is reclaimed through the same teardown", async () => {
            const home = join(scratch, `home${(counter += 1)}`)
            const docker = fakeDocker()
            const dead = new Set<number>()
            const crashed = harness([], { home, pid: 1111, isAlive: (pid) => !dead.has(pid), docker })
            const ns = slot(1)
            const infra = await crashed.stack.attach(cdcRequest(ns, "crashed-w1"))
            crashed.queries.length = 0
            crashed.redisCalls.length = 0
            await crashed.stack.reset({ namespace: ns, infra, keepTables: {} })
            const truncated = crashed.queries.indexOf("SET session_replication_role = replica")
            const emitted = crashed.queries.findIndex((query) => query.includes("pg_logical_emit_message"))
            assert.ok(truncated >= 0 && emitted > truncated, "the connector is drained after the database was emptied")
            const flush = `SELECT ${infra.redis?.db} | FLUSHDB`
            assert.equal(crashed.redisCalls.filter((call) => call === flush).length, 2, "redis is flushed by its own reset, and again after the drain")
            assert.equal(crashed.redisCalls.at(-1), flush)
            dead.add(1111)
            const next = harness([], { home, pid: 2222, isAlive: (pid) => !dead.has(pid), docker })
            await next.stack.attach(request(namespace("blog_bbbbbb_w1"), "next-w1"))
            assert.equal(docker.containers.has(infra.debezium?.container ?? "?"), false, "the dead run's server is removed")
            const slotDropped = next.queries.findIndex((query) => query.includes("pg_drop_replication_slot") && query.includes("shop_aaaaaa_w1_cdc"))
            const databaseDropped = next.queries.indexOf('DROP DATABASE IF EXISTS "shop_aaaaaa_w1_primary" WITH (FORCE)')
            assert.ok(slotDropped >= 0 && databaseDropped > slotDropped, "its slot is dropped before its database")
        })

        it("a leftover server of the namespace is removed before the database is dropped, because it would hold the slot", async () => {
            const { docker, stack, queries } = harness()
            const name = containerName("debezium", `${DEBEZIUM_IMAGE}#shop_aaaaaa_w1`)
            docker.containers.set(name, { running: true, ports: new Map() })
            const before = docker.calls.length
            await stack.attach(cdcRequest(slot(1), "run1-w1"))
            assert.ok(docker.calls.findIndex((call, index) => index >= before && call === `rm -f -v ${name}`) >= 0, "the stale server is removed first")
            assert.ok(queries.includes('CREATE DATABASE "shop_aaaaaa_w1_primary"'))
        })

        it("a server that never answers its health is removed and the whole attach is undone", async () => {
            const { docker, stack } = harness([], { healthStatus: 503, readyTimeoutMs: 2000 })
            await assert.rejects(stack.attach(cdcRequest(slot(1), "run1-w1")), (error: unknown) => error instanceof Error && "code" in error && error.code === TestWorldErrorCode.TimedOut)
            assert.equal([...docker.containers.keys()].some((name) => name.startsWith("starci-ts-debezium-")), false, "no server is left running")
            assert.equal((await stack.status()).leases.length, 0)
        })
    })
})
