import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { AttachRequest, Namespace, RunDebezium, RunKafka, RunPostgres, RunRedis } from "../contracts"
import { Docker } from "../docker"
import type { ExecResult } from "../exec"
import type { PgClient, PgConfig } from "../pg"
import { kafkaService, ownedBy, partitionsOf } from "./kafka"
import { debeziumEnv, debeziumPlanOf, debeziumProperties, debeziumService, drainDebezium, messageStreamOf } from "./debezium"
import { mailService } from "./mail"
import { DEBEZIUM_IMAGE, KAFKA_IMAGE, POSTGRES_LOGICAL_ARGS } from "../naming"
import { prepareRealm } from "./keycloak"
import { postgresService, truncateStatements } from "./postgresql"
import { s3Request } from "./minio"
import type { ServiceNet, ServiceTarget } from "./definition"

const namespace: Namespace = { snake: "shop_be_a1b2c3", kebab: "shop-be-a1b2c3", root: "/repo" }

interface PgLog {
    readonly database: string
    readonly sql: string
}

const scriptedPg = (log: Array<PgLog>, tables: ReadonlyArray<Record<string, unknown>> = [], failing: ReadonlyArray<string> = []) => (config: PgConfig): PgClient => ({
    connect: async () => undefined,
    on: () => undefined,
    end: async () => undefined,
    query: async (sql: string) => {
        log.push({ database: config.database, sql })
        if (failing.includes(sql)) throw new Error("cannot truncate a table referenced in a foreign key constraint")
        return { rows: sql.includes("pg_tables") ? tables : [{ "?column?": 1 }] }
    },
})

const targetWith = (net: Partial<ServiceNet>, secrets: Record<string, string> = { password: "pw" }): ServiceTarget => ({
    container: "starci-ts-postgresql-11111111",
    image: "pgvector/pgvector:pg16",
    host: "127.0.0.1",
    port: 5555,
    secrets,
    net: { docker: new Docker(), fetch, pg: scriptedPg([]), redis: async () => [], pause: async () => undefined, ...net },
})

const request = (extra: Partial<AttachRequest>): AttachRequest => ({ namespace, runId: "r1", services: [], ...extra })
const input = (extra: Partial<AttachRequest>) => ({ namespace, request: request(extra), leaseRedisDb: async () => 0, leaseKafkaListener: async () => 1, infra: {} })

describe("postgresql service", () => {
    it("readiness is a real select 1", async () => {
        const log: Array<PgLog> = []
        assert.equal(await postgresService.ready(targetWith({ pg: scriptedPg(log) })), true)
        assert.deepEqual(log, [{ database: "postgres", sql: "select 1" }])
    })

    it("provision drops, creates and adds extensions per connection under <snake>_<connection>", async () => {
        const log: Array<PgLog> = []
        const result = await postgresService.provision(
            targetWith({ pg: scriptedPg(log) }),
            input({ postgresql: { connections: [{ name: "primary", extensions: ["vector", "pgcrypto"] }, { name: "analytics" }] } }),
        )
        assert.deepEqual(result.run, {
            user: "postgres",
            password: "pw",
            databases: { primary: "shop_be_a1b2c3_primary", analytics: "shop_be_a1b2c3_analytics" },
            schemas: {},
        })
        assert.deepEqual(log, [
            { database: "postgres", sql: 'DROP DATABASE IF EXISTS "shop_be_a1b2c3_primary" WITH (FORCE)' },
            { database: "postgres", sql: 'CREATE DATABASE "shop_be_a1b2c3_primary"' },
            { database: "postgres", sql: 'DROP DATABASE IF EXISTS "shop_be_a1b2c3_analytics" WITH (FORCE)' },
            { database: "postgres", sql: 'CREATE DATABASE "shop_be_a1b2c3_analytics"' },
            { database: "shop_be_a1b2c3_primary", sql: 'CREATE EXTENSION IF NOT EXISTS "vector" SCHEMA public' },
            { database: "shop_be_a1b2c3_primary", sql: 'CREATE EXTENSION IF NOT EXISTS "pgcrypto" SCHEMA public' },
        ])
    })

    it("reset truncates every table except ledgers and keepTables, with triggers off, falling back to DELETE on an FK refusal", async () => {
        const log: Array<PgLog> = []
        const tables = [
            { schemaname: "public", tablename: "users" },
            { schemaname: "public", tablename: "orders" },
            { schemaname: "public", tablename: "roles" },
            { schemaname: "public", tablename: "typeorm_migrations" },
            { schemaname: "public", tablename: "typeorm_metadata" },
            { schemaname: "audit", tablename: "kysely_migrations_lock" },
        ]
        const run: RunPostgres = {
            host: "127.0.0.1",
            port: 30100,
            directPort: 5555,
            proxy: "r1-postgresql",
            image: "pgvector/pgvector:pg16",
            container: "c",
            user: "postgres",
            password: "pw",
            databases: { primary: "shop_be_a1b2c3_primary" },
            schemas: {},
        }
        await postgresService.reset(targetWith({ pg: scriptedPg(log, tables, ['TRUNCATE TABLE "public"."users" RESTART IDENTITY']) }), run, { namespace, keepTables: { primary: ["roles"] }, notes: {}, infra: {} })
        const sql = log.map((entry) => entry.sql)
        assert.equal(sql[0], "SET session_replication_role = replica")
        assert.match(sql[1] ?? "", /FROM pg_tables/)
        assert.deepEqual(sql.slice(2), ['TRUNCATE TABLE "public"."users" RESTART IDENTITY', 'DELETE FROM "public"."users"', 'TRUNCATE TABLE "public"."orders" RESTART IDENTITY'])
        assert.ok(log.every((entry) => entry.database === "shop_be_a1b2c3_primary"))
    })

    it("schema-per-context: connections naming one database share it, each with its schema and its own login role", async () => {
        const log: Array<PgLog> = []
        const result = await postgresService.provision(
            targetWith({ pg: scriptedPg(log) }),
            input({
                postgresql: {
                    connections: [
                        { name: "identity", database: "core", schema: "identity", extensions: ["pgcrypto"] },
                        { name: "order", database: "core", schema: "ordering" },
                        { name: "analytics" },
                    ],
                },
            }),
        )
        const { databases, schemas } = result.run
        assert.deepEqual(databases, { identity: "shop_be_a1b2c3_core", order: "shop_be_a1b2c3_core", analytics: "shop_be_a1b2c3_analytics" })
        assert.deepEqual(Object.keys(schemas).sort(), ["identity", "order"])
        assert.equal(schemas.identity?.schema, "identity")
        assert.equal(schemas.identity?.user, "shop_be_a1b2c3_identity")
        assert.equal(schemas.order?.user, "shop_be_a1b2c3_order")
        assert.notEqual(schemas.identity?.password, schemas.order?.password)
        const sql = log.map((entry) => `${entry.database}: ${entry.sql.replace(/PASSWORD '[^']*'/, "PASSWORD <generated>")}`)
        assert.deepEqual(sql, [
            'postgres: DROP DATABASE IF EXISTS "shop_be_a1b2c3_core" WITH (FORCE)',
            'postgres: CREATE DATABASE "shop_be_a1b2c3_core"',
            'postgres: DROP DATABASE IF EXISTS "shop_be_a1b2c3_analytics" WITH (FORCE)',
            'postgres: CREATE DATABASE "shop_be_a1b2c3_analytics"',
            'postgres: DROP ROLE IF EXISTS "shop_be_a1b2c3_identity"',
            'postgres: CREATE ROLE "shop_be_a1b2c3_identity" LOGIN PASSWORD <generated>',
            'postgres: DROP ROLE IF EXISTS "shop_be_a1b2c3_order"',
            'postgres: CREATE ROLE "shop_be_a1b2c3_order" LOGIN PASSWORD <generated>',
            'shop_be_a1b2c3_core: CREATE EXTENSION IF NOT EXISTS "pgcrypto" SCHEMA public',
            'shop_be_a1b2c3_core: CREATE SCHEMA IF NOT EXISTS "identity" AUTHORIZATION "shop_be_a1b2c3_identity"',
            'shop_be_a1b2c3_core: ALTER ROLE "shop_be_a1b2c3_identity" IN DATABASE "shop_be_a1b2c3_core" SET search_path = "identity", public',
            'shop_be_a1b2c3_core: GRANT CONNECT, TEMPORARY ON DATABASE "shop_be_a1b2c3_core" TO "shop_be_a1b2c3_identity"',
            'shop_be_a1b2c3_core: GRANT USAGE ON SCHEMA public TO "shop_be_a1b2c3_identity"',
            'shop_be_a1b2c3_core: CREATE SCHEMA IF NOT EXISTS "ordering" AUTHORIZATION "shop_be_a1b2c3_order"',
            'shop_be_a1b2c3_core: ALTER ROLE "shop_be_a1b2c3_order" IN DATABASE "shop_be_a1b2c3_core" SET search_path = "ordering", public',
            'shop_be_a1b2c3_core: GRANT CONNECT, TEMPORARY ON DATABASE "shop_be_a1b2c3_core" TO "shop_be_a1b2c3_order"',
            'shop_be_a1b2c3_core: GRANT USAGE ON SCHEMA public TO "shop_be_a1b2c3_order"',
        ])
    })

    it("schema-per-context reset empties only the connection's schema; deprovision drops each shared database once and the roles", async () => {
        const tables = [
            { schemaname: "identity", tablename: "persons" },
            { schemaname: "ordering", tablename: "orders" },
            { schemaname: "ordering", tablename: "typeorm_migrations" },
        ]
        const run: RunPostgres = {
            host: "127.0.0.1",
            port: 30100,
            directPort: 5555,
            proxy: "r1-postgresql",
            image: "postgres:16",
            container: "c",
            user: "postgres",
            password: "pw",
            databases: { identity: "ns_core", order: "ns_core" },
            schemas: { identity: { schema: "identity", user: "ns_identity", password: "a" }, order: { schema: "ordering", user: "ns_order", password: "b" } },
        }
        const log: Array<PgLog> = []
        await postgresService.reset(targetWith({ pg: scriptedPg(log, tables) }), run, { namespace, keepTables: {}, notes: {}, infra: {} })
        const truncated = log.map((entry) => entry.sql).filter((sql) => sql.startsWith("TRUNCATE"))
        assert.deepEqual(truncated, ['TRUNCATE TABLE "identity"."persons" RESTART IDENTITY', 'TRUNCATE TABLE "ordering"."orders" RESTART IDENTITY'])
        const dropped: Array<PgLog> = []
        await postgresService.deprovision(targetWith({ pg: scriptedPg(dropped) }), run, { namespace, releaseRedisDb: async () => undefined, infra: {} })
        assert.deepEqual(dropped.map((entry) => entry.sql), ['DROP DATABASE IF EXISTS "ns_core" WITH (FORCE)', 'DROP ROLE IF EXISTS "ns_identity"', 'DROP ROLE IF EXISTS "ns_order"'])
    })

    it("truncateStatements skips migration ledgers and kept tables by name or schema.name", () => {
        const statements = truncateStatements(
            [
                { schema: "public", table: "a" },
                { schema: "public", table: "SequelizeMigrations" },
                { schema: "x", table: "b" },
                { schema: "x", table: "c" },
            ],
            ["x.b"],
        )
        assert.deepEqual(statements.map((statement) => statement.truncate), ['TRUNCATE TABLE "public"."a" RESTART IDENTITY', 'TRUNCATE TABLE "x"."c" RESTART IDENTITY'])
    })
})

describe("kafka service", () => {
    const PREFIX = "shop-be-a1b2c3."
    /** A scripted broker: `--list` of topics and of groups answer the given listings; `failing` groups refuse deletion. */
    const broker = (listing: { readonly topics: string; readonly groups: string; readonly describe?: string }, failing: ReadonlyArray<string> = []) => {
        const calls: Array<ReadonlyArray<string>> = []
        const docker = new Docker(async (_command, args): Promise<ExecResult> => {
            calls.push(args)
            const joined = args.join(" ")
            if (joined.includes("kafka-consumer-groups.sh") && args.includes("--list")) return { code: 0, stdout: listing.groups, stderr: "" }
            if (joined.includes("kafka-consumer-groups.sh") && args.includes("--delete")) {
                const group = args[args.indexOf("--group") + 1] ?? ""
                return failing.includes(group) ? { code: 1, stdout: "", stderr: "GroupNotEmptyException" } : { code: 0, stdout: "", stderr: "" }
            }
            if (args.includes("--list")) return { code: 0, stdout: listing.topics, stderr: "" }
            if (args.includes("--describe")) return { code: 0, stdout: listing.describe ?? "", stderr: "" }
            return { code: 0, stdout: "", stderr: "" }
        })
        return { calls, docker }
    }

    it("provision creates the slot's prefixed topics and answers its listener, topic prefix and group prefix", async () => {
        const { calls, docker } = broker({ topics: "", groups: "" })
        const provisioned = await kafkaService.provision(targetWith({ docker }), { ...input({ kafka: { topics: ["orders"] } }), leaseKafkaListener: async () => 3 })
        assert.deepEqual(provisioned.run, { listener: 3, topicPrefix: PREFIX, groupPrefix: PREFIX, topics: { orders: `${PREFIX}orders` } })
        assert.deepEqual(calls[0], ["exec", "starci-ts-postgresql-11111111", "/opt/kafka/bin/kafka-topics.sh", "--bootstrap-server", "localhost:9092", "--create", "--if-not-exists", "--topic", `${PREFIX}orders`, "--partitions", "1", "--replication-factor", "1"])
    })

    it("deprovision deletes only the slot's groups and topics, never another slot's or repository's", async () => {
        const { calls, docker } = broker({
            topics: `other.topic\n${PREFIX}orders\n${PREFIX}mail\nshop-be-a1b2c3-w2.orders\n`,
            groups: `${PREFIX}billing\nother.group\nshop-be-a1b2c3-w2.billing\n`,
        })
        const run = { listener: 1, topicPrefix: PREFIX, groupPrefix: PREFIX, topics: {} } as unknown as RunKafka
        await kafkaService.deprovision(targetWith({ docker }), run, { namespace, releaseRedisDb: async () => undefined, infra: {} })
        const deleted = calls.filter((args) => args.includes("--delete")).map((args) => args.slice(-2).join(" "))
        assert.deepEqual(deleted, [`--group ${PREFIX}billing`, `--topic ${PREFIX}orders`, `--topic ${PREFIX}mail`])
    })

    it("deprovision waits out a group whose dead member has not timed out, then fails naming it (after deleting the topics)", async () => {
        const { calls, docker } = broker({ topics: `${PREFIX}orders\n`, groups: `${PREFIX}stuck\n` }, [`${PREFIX}stuck`])
        let waited = 0
        const target: ServiceTarget = { ...targetWith({ docker }), net: { ...targetWith({ docker }).net, pause: async (ms: number) => void (waited += ms) } }
        const run = { listener: 1, topicPrefix: PREFIX, groupPrefix: PREFIX, topics: {} } as unknown as RunKafka
        const realNow = Date.now
        let clock = 0
        Date.now = () => (clock += 5000)
        try {
            await assert.rejects(kafkaService.deprovision(target, run, { namespace, releaseRedisDb: async () => undefined, infra: {} }), /still have members .* shop-be-a1b2c3\.stuck/)
        } finally {
            Date.now = realNow
        }
        assert.ok(waited > 0)
        assert.ok(calls.some((args) => args.includes("--topic") && args.includes(`${PREFIX}orders`) && args.includes("--delete")))
    })

    it("reset empties the slot's topics up to the high watermark and deletes its idle groups, tolerating a busy one", async () => {
        const describe = `Topic: ${PREFIX}orders\tTopicId: x\tPartitionCount: 2\n\tTopic: ${PREFIX}orders\tPartition: 0\tLeader: 1\n\tTopic: ${PREFIX}orders\tPartition: 1\tLeader: 1\n`
        const { calls, docker } = broker({ topics: `${PREFIX}orders\nother.topic\n`, groups: `${PREFIX}busy\n`, describe }, [`${PREFIX}busy`])
        const run = { listener: 1, topicPrefix: PREFIX, groupPrefix: PREFIX, topics: {} } as unknown as RunKafka
        await kafkaService.reset(targetWith({ docker }), run, { namespace, keepTables: {}, notes: {}, infra: {} })
        const described = calls.find((args) => args.includes("--describe"))
        assert.equal(described?.[described.indexOf("--topic") + 1], `${PREFIX}orders`)
        const written = calls.find((args) => args[2] === "sh")
        assert.match(written?.[4] ?? "", /"partitions":\[\{"topic":"shop-be-a1b2c3\.orders","partition":0,"offset":-1\},\{"topic":"shop-be-a1b2c3\.orders","partition":1,"offset":-1\}\]/)
        assert.ok(calls.some((args) => args.join(" ").includes("kafka-delete-records.sh")))
    })

    it("the broker has INTERNAL, CONTROLLER and one listener per slot, each advertising its own proxy port", () => {
        const ports = [30101, 30102, 30103, 30104, 30105, 30106, 30107, 30108]
        const spec = kafkaService.spec(KAFKA_IMAGE, {}, { kafkaListenerPorts: ports })
        assert.equal(spec.env.KAFKA_PROCESS_ROLES, "broker,controller")
        assert.equal(spec.env.KAFKA_LISTENERS, "INTERNAL://:9092,CONTROLLER://:9093,S1://:9101,S2://:9102,S3://:9103,S4://:9104,S5://:9105,S6://:9106,S7://:9107,S8://:9108")
        assert.match(spec.env.KAFKA_ADVERTISED_LISTENERS ?? "", /^INTERNAL:\/\/localhost:9092,S1:\/\/127\.0\.0\.1:30101,.*S8:\/\/127\.0\.0\.1:30108$/)
        assert.equal("KAFKA_ZOOKEEPER_CONNECT" in spec.env, false)
        assert.throws(() => kafkaService.spec(KAFKA_IMAGE, {}, { kafkaListenerPorts: [30101] }), /needs 8 slot listener ports/)
        assert.throws(() => kafkaService.spec(KAFKA_IMAGE, {}, { kafkaListenerPorts: null }), /without its slot listener ports/)
    })

    it("partitionsOf and ownedBy read the scripts' output exactly", () => {
        assert.deepEqual(partitionsOf("Topic: a.b\tPartitionCount: 1\n\tTopic: a.b\tPartition: 0\tLeader: 1"), [{ topic: "a.b", partition: 0 }])
        assert.deepEqual(ownedBy("x.a\nns-w1.a\nns-w10.a\n", "ns-w1."), ["ns-w1.a"])
    })
})

describe("keycloak realm preparation", () => {
    const file = JSON.stringify({
        id: "abc",
        realm: "shop",
        clients: [{ clientId: "backend", directAccessGrantsEnabled: false }, { clientId: "web", directAccessGrantsEnabled: true }],
        users: [{ username: "Admin" }],
    })

    it("re-targets the realm name, drops the id, detects the password client and lists seed users", () => {
        const prepared = prepareRealm(file, "shop-be-a1b2c3", "realm.json")
        assert.equal(prepared.stored, "shop-be-a1b2c3-shop")
        assert.equal(prepared.body.realm, "shop-be-a1b2c3-shop")
        assert.equal("id" in prepared.body, false)
        assert.equal(prepared.passwordClientId, "web")
        assert.deepEqual(prepared.seedUsers, ["admin"])
    })

    it("gives every confidential client a secret generated for the run, never the file's, and leaves public clients alone", () => {
        const withSecrets = JSON.stringify({
            realm: "shop",
            clients: [
                { clientId: "web", publicClient: true, directAccessGrantsEnabled: true },
                { clientId: "admin-reader", publicClient: false, serviceAccountsEnabled: true, secret: "committed" },
                { clientId: "api", bearerOnly: true },
            ],
        })
        let next = 0
        const prepared = prepareRealm(withSecrets, "k", "realm.json", () => `generated-${(next += 1)}`)
        assert.deepEqual(prepared.clientSecrets, { "admin-reader": "generated-1" })
        const clients = prepared.body.clients as ReadonlyArray<Record<string, unknown>>
        assert.equal(clients.find((client) => client.clientId === "admin-reader")?.secret, "generated-1")
        assert.equal("secret" in (clients.find((client) => client.clientId === "web") ?? {}), false)
        assert.equal("secret" in (clients.find((client) => client.clientId === "api") ?? {}), false)
    })

    it("gives every namespace its own entity ids: user ids remapped (stable per namespace), other ids dropped", () => {
        const pinned = "4f1c2b7e-8a3d-4e5f-9b6a-0c1d2e3f4a5b"
        const exported = JSON.stringify({
            realm: "shop",
            clients: [{ id: "c-1", clientId: "web", publicClient: true, directAccessGrantsEnabled: true }],
            users: [{ id: pinned, username: "demo@shop.dev" }, { username: "no-id" }],
            roles: { realm: [{ id: "r-1", name: "admin" }], client: { web: [{ id: "r-2", name: "reader" }] } },
            groups: [{ id: "g-1", name: "staff", subGroups: [{ id: "g-2", name: "leads" }] }],
            clientScopes: [{ id: "s-1", name: "profile" }],
            components: { "org.keycloak.keys.KeyProvider": [{ id: "k-1", name: "rsa", subComponents: { x: [{ id: "k-2", name: "sub" }] } }] },
        })
        const one = prepareRealm(exported, "shop-a1b2c3-w1", "realm.json")
        const two = prepareRealm(exported, "shop-a1b2c3-w2", "realm.json")
        const idOf = (prepared: typeof one): unknown => (prepared.body.users as ReadonlyArray<Record<string, unknown>>)[0]?.id
        assert.match(String(idOf(one)), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
        assert.notEqual(idOf(one), idOf(two))
        assert.notEqual(idOf(one), pinned)
        assert.deepEqual(one.userIds, { [pinned]: idOf(one) })
        assert.deepEqual(prepareRealm(exported, "shop-a1b2c3-w1", "realm.json").userIds, one.userIds, "stable per namespace")
        assert.equal("id" in ((one.body.users as ReadonlyArray<Record<string, unknown>>)[1] ?? {}), false)
        const text = JSON.stringify(one.body)
        for (const dropped of ["c-1", "r-1", "r-2", "g-1", "g-2", "s-1", "k-1", "k-2"]) assert.equal(text.includes(`"${dropped}"`), false, dropped)
        assert.match(text, /"name":"leads"/)
        assert.match(text, /"name":"sub"/)
    })

    it("refuses a file without a realm name", () => {
        assert.throws(() => prepareRealm("{}", "k", "realm.json"), /no "realm"/)
    })
})

describe("minio s3 client", () => {
    it("signs path-style requests with sigv4 and no aws sdk", async () => {
        let seen: { url: string; headers: Record<string, string> } | null = null
        const fake = (async (url: string | URL | Request, init?: RequestInit) => {
            seen = { url: String(url), headers: init?.headers as Record<string, string> }
            return new Response("<ListAllMyBucketsResult/>", { status: 200 })
        }) as typeof fetch
        const result = await s3Request(targetWith({ fetch: fake }), { accessKey: "ak", secretKey: "sk" }, "GET", "/shop-be-a1b2c3-uploads", { "list-type": "2" }, new Date("2026-01-02T03:04:05Z"))
        assert.equal(result.status, 200)
        const captured = seen as unknown as { url: string; headers: Record<string, string> }
        assert.equal(captured.url, "http://127.0.0.1:5555/shop-be-a1b2c3-uploads?list-type=2")
        assert.equal(captured.headers["x-amz-date"], "20260102T030405Z")
        assert.match(captured.headers.authorization ?? "", /^AWS4-HMAC-SHA256 Credential=ak\/20260102\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/)
    })
})

describe("mail service", () => {
    const CHAOS = JSON.stringify({ Sender: { ErrorCode: 451, Probability: 0 }, Recipient: { ErrorCode: 550, Probability: 100 }, Authentication: { ErrorCode: 535, Probability: 0 } })
    const sinkFetch = (calls: Array<string>, livez = 200) =>
        (async (url: string | URL | Request, init?: RequestInit) => {
            const path = new URL(String(url)).pathname
            calls.push(`${init?.method ?? "GET"} ${new URL(String(url)).port}${path}${typeof init?.body === "string" ? ` ${init.body}` : ""}`)
            if (path === "/livez") return new Response("ok", { status: livez })
            if (path === "/api/v1/chaos" && (init?.method ?? "GET") === "GET") return new Response(CHAOS, { status: 200 })
            return new Response("ok", { status: 200 })
        }) as typeof fetch
    const sinkTarget = (calls: Array<string>, extraPorts: Record<number, number> | null = { 8025: 6666 }): ServiceTarget => ({
        ...targetWith({ fetch: sinkFetch(calls) }),
        container: "starci-ts-mail-33333333",
        image: "axllent/mailpit:v1.31.6",
        ...(extraPorts === null ? {} : { extraPorts }),
    })

    it("is a container per data slot that proxies SMTP and publishes the HTTP API beside it, with chaos enabled", () => {
        assert.equal(mailService.port, 1025)
        assert.deepEqual(mailService.extraPorts, [8025])
        assert.equal(mailService.scope, "namespace")
        assert.deepEqual(mailService.newSecrets(), {})
        const spec = mailService.spec("axllent/mailpit:v1.31.6", {}, { kafkaListenerPorts: null })
        assert.equal(spec.env.MP_ENABLE_CHAOS, "true")
        assert.equal(spec.env.MP_SMTP_AUTH_ACCEPT_ANY, "true")
        assert.deepEqual(spec.command, [])
    })

    it("is ready when the API answers livez, and not before it is published or while it refuses", async () => {
        const calls: Array<string> = []
        assert.equal(await mailService.ready(sinkTarget(calls)), true)
        assert.deepEqual(calls, ["GET 6666/livez"])
        assert.equal(await mailService.ready(sinkTarget([], null)), false)
        assert.equal(await mailService.ready({ ...sinkTarget([]), net: { ...sinkTarget([]).net, fetch: sinkFetch([], 503) } }), false)
    })

    it("provision empties the sink and stops its chaos, and answers the API port", async () => {
        const calls: Array<string> = []
        const result = await mailService.provision(sinkTarget(calls), input({}))
        assert.deepEqual(result.run, { apiPort: 6666 })
        assert.deepEqual(calls, [
            "DELETE 6666/api/v1/messages",
            "GET 6666/api/v1/chaos",
            `PUT 6666/api/v1/chaos ${JSON.stringify({ Sender: { ErrorCode: 451, Probability: 0 }, Recipient: { ErrorCode: 550, Probability: 0 }, Authentication: { ErrorCode: 535, Probability: 0 } })}`,
        ])
        await assert.rejects(mailService.provision(sinkTarget([], null), input({})), /publishes no HTTP API port \(8025\)/)
    })

    it("reset empties the sink and stops its chaos on the run's API port; deprovision removes the slot's container", async () => {
        const calls: Array<string> = []
        const run = { host: "127.0.0.1", port: 30105, directPort: 5555, proxy: "p", image: "i", container: "c", apiPort: 7777 }
        await mailService.reset(sinkTarget(calls, null), run, { namespace, keepTables: {}, notes: {}, infra: {} })
        assert.deepEqual(calls.map((call) => call.split(" ")[1]), ["7777/api/v1/messages", "7777/api/v1/chaos", "7777/api/v1/chaos"])
        const removed: Array<string> = []
        const docker = new Docker(async (_command, args) => {
            removed.push(args.join(" "))
            return { code: 0, stdout: "", stderr: "" }
        })
        await mailService.deprovision({ ...sinkTarget([]), net: { ...sinkTarget([]).net, docker } }, run, { namespace, releaseRedisDb: async () => undefined, infra: {} })
        assert.deepEqual(removed, ["rm -f -v starci-ts-mail-33333333"])
    })
})

describe("postgresql logical replication", () => {
    it("the default server has no logical decoding; the logical one adds exactly the declared arguments", () => {
        const base = ["-c", "fsync=off", "-c", "synchronous_commit=off", "-c", "full_page_writes=off", "-c", "max_connections=300"]
        assert.deepEqual(postgresService.spec("postgres:16", { password: "pw" }, { kafkaListenerPorts: null }).command, base)
        assert.deepEqual(postgresService.spec("postgres:16", { password: "pw" }, { kafkaListenerPorts: null, logicalReplication: false }).command, base)
        const logical = postgresService.spec("postgres:16", { password: "pw" }, { kafkaListenerPorts: null, logicalReplication: true }).command
        assert.deepEqual(logical, [...base, ...POSTGRES_LOGICAL_ARGS])
        assert.deepEqual(POSTGRES_LOGICAL_ARGS, ["-c", "wal_level=logical", "-c", "max_replication_slots=16", "-c", "max_wal_senders=16"])
    })
})

describe("debezium service", () => {
    const postgres: RunPostgres = {
        host: "127.0.0.1",
        port: 30100,
        directPort: 5555,
        proxy: "r1-postgresql",
        image: "postgres:17",
        container: "starci-ts-postgresql-aaaaaaaa",
        user: "postgres",
        password: "pw",
        databases: { primary: "shop_be_a1b2c3_primary", billing: "shop_be_a1b2c3_shared" },
        schemas: { billing: { schema: "billing", user: "u", password: "p" } },
    }
    const redis: RunRedis = { host: "127.0.0.1", port: 30101, directPort: 6379, proxy: "r1-redis", image: "redis:7", container: "starci-ts-redis-bbbbbbbb", db: 4 }
    const debeziumRequest = (extra: Partial<NonNullable<AttachRequest["debezium"]>> = {}): AttachRequest => request({ debezium: { connections: ["primary"], ...extra } })
    const planOf = (extra: Partial<NonNullable<AttachRequest["debezium"]>> = {}) => debeziumPlanOf(debeziumRequest(extra), { postgresql: postgres, redis })
    const run: RunDebezium = { host: "127.0.0.1", port: 30102, directPort: 7001, proxy: "", image: DEBEZIUM_IMAGE, container: "starci-ts-debezium-cccccccc", slotName: "shop_be_a1b2c3_cdc", publicationName: "shop_be_a1b2c3_cdc", streamPrefix: "shop-be-a1b2c3", stream: null, database: "shop_be_a1b2c3_primary" }

    it("the plan names the slot, publication and stream prefix from the namespace and reads what the slot's postgres and redis provisioned", () => {
        assert.deepEqual(planOf(), {
            slotName: "shop_be_a1b2c3_cdc",
            topicPrefix: "shop-be-a1b2c3",
            stream: null,
            postgres: { host: "starci-ts-postgresql-aaaaaaaa", port: 5432, user: "postgres", password: "pw", database: "shop_be_a1b2c3_primary", schemas: [] },
            redis: { host: "starci-ts-redis-bbbbbbbb", port: 6379, db: 4 },
            tables: [],
            properties: {},
        })
        const shared = planOf({ connections: ["billing"], stream: "cdc", tables: ["billing.orders"] })
        assert.deepEqual(shared.postgres.schemas, ["billing"])
        assert.equal(shared.postgres.database, "shop_be_a1b2c3_shared")
        assert.equal(shared.stream, "shop-be-a1b2c3.cdc")
        assert.deepEqual(shared.tables, ["billing.orders"])
        const long = debeziumPlanOf({ ...debeziumRequest(), namespace: { snake: `${"x".repeat(60)}_w1`, kebab: "k", root: "/r" } }, { postgresql: postgres, redis })
        assert.ok(long.slotName.length <= 63 && long.slotName.endsWith("_cdc"), long.slotName)
        assert.throws(() => debeziumPlanOf(debeziumRequest({ connections: ["nope"] }), { postgresql: postgres, redis }), /did not provision/)
        assert.throws(() => debeziumPlanOf(request({}), { postgresql: postgres, redis }), /needs the slot's provisioned/)
    })

    it("the properties capture changes only from the slot's database into the slot's Redis DB, the declaration's last", () => {
        const properties = debeziumProperties(planOf())
        assert.equal(properties["sink.type"], "redis")
        assert.equal(properties["sink.redis.address"], "starci-ts-redis-bbbbbbbb:6379")
        assert.equal(properties["sink.redis.db.index"], "4")
        assert.equal(properties["source.database.dbname"], "shop_be_a1b2c3_primary")
        assert.equal(properties["source.slot.name"], "shop_be_a1b2c3_cdc")
        assert.equal(properties["source.publication.name"], "shop_be_a1b2c3_cdc")
        assert.equal(properties["source.topic.prefix"], "shop-be-a1b2c3")
        assert.equal(properties["source.snapshot.mode"], "no_data")
        assert.equal(properties["source.publication.autocreate.mode"], "all_tables")
        assert.equal(properties["format.value.schemas.enable"], "false")
        assert.equal(properties["source.schema.include.list"], undefined)
        assert.equal(properties.transforms, undefined)
        const declared = debeziumProperties(planOf({ connections: ["billing"], stream: "cdc", tables: ["billing.orders"], properties: { "format.value.schemas.enable": "true", "source.snapshot.mode": "initial" } }))
        assert.equal(declared["source.schema.include.list"], "billing")
        assert.equal(declared["source.table.include.list"], "billing.orders")
        assert.equal(declared["transforms.stream.replacement"], "shop-be-a1b2c3.cdc")
        assert.equal(declared["transforms.stream.type"], "org.apache.kafka.connect.transforms.RegexRouter")
        assert.equal(declared["format.value.schemas.enable"], "true")
        assert.equal(declared["source.snapshot.mode"], "initial")
    })

    it("the container environment is the properties as DEBEZIUM_* variables, and the container has no command of its own", () => {
        const env = debeziumEnv(planOf())
        assert.equal(env.DEBEZIUM_SINK_TYPE, "redis")
        assert.equal(env.DEBEZIUM_SINK_REDIS_DB_INDEX, "4")
        assert.equal(env.DEBEZIUM_SOURCE_DATABASE_PASSWORD, "pw")
        assert.equal(env.DEBEZIUM_SOURCE_OFFSET_FLUSH_INTERVAL_MS, "200")
        assert.equal(env.DEBEZIUM_SOURCE_PUBLICATION_AUTOCREATE_MODE, "all_tables")
        const spec = debeziumService.spec(DEBEZIUM_IMAGE, {}, { kafkaListenerPorts: null, debezium: planOf() })
        assert.deepEqual(spec.env, env)
        assert.deepEqual(spec.command, [])
        assert.throws(() => debeziumService.spec(DEBEZIUM_IMAGE, {}, { kafkaListenerPorts: null }), /without its plan/)
        assert.equal(debeziumService.port, 8080)
        assert.equal(debeziumService.scope, "namespace")
        assert.equal(debeziumService.proxied, false)
        assert.deepEqual(debeziumService.after, ["postgresql", "redis"])
    })

    it("is ready when the management endpoint answers live, and not while it refuses", async () => {
        const urls: Array<string> = []
        const live = (status: number) =>
            (async (url: string | URL | Request) => {
                urls.push(String(url))
                return new Response("{}", { status })
            }) as typeof fetch
        assert.equal(await debeziumService.ready({ ...targetWith({ fetch: live(200) }), port: 7001 }), true)
        assert.deepEqual(urls, ["http://127.0.0.1:7001/q/health/live"])
        assert.equal(await debeziumService.ready(targetWith({ fetch: live(503) })), false)
    })

    const streaming = (sink: Array<PgLog>, answers: ReadonlyArray<boolean> = [true]) => {
        let asked = 0
        return (config: PgConfig): PgClient => ({
            connect: async () => undefined,
            on: () => undefined,
            end: async () => undefined,
            query: async (sql: string) => {
                sink.push({ database: config.database, sql })
                if (!sql.includes("SELECT active FROM pg_replication_slots")) return { rows: [] }
                const active = answers[Math.min(asked, answers.length - 1)] ?? false
                asked += 1
                return { rows: [{ active }] }
            },
        })
    }

    it("provision waits until the connector holds its slot, then answers the slot, stream and database it reads", async () => {
        const log: Array<PgLog> = []
        const provisioned = await debeziumService.provision(targetWith({ pg: streaming(log, [false, false, true]) }), { ...input({ debezium: { connections: ["primary"], stream: "cdc" } }), infra: { postgresql: postgres, redis } })
        assert.deepEqual(provisioned.run, { slotName: "shop_be_a1b2c3_cdc", publicationName: "shop_be_a1b2c3_cdc", streamPrefix: "shop-be-a1b2c3", stream: "shop-be-a1b2c3.cdc", database: "shop_be_a1b2c3_primary" })
        assert.equal(log.filter((entry) => entry.sql.includes("pg_replication_slots")).length, 3)
        assert.ok(log.every((entry) => entry.database === "postgres"))
        await assert.rejects(debeziumService.provision(targetWith({}), input({ debezium: { connections: ["primary"] } })), /needs the slot's provisioned/)
    })

    it("a connector that never streams is removed with its slot, and the failure is the timeout", async () => {
        const log: Array<PgLog> = []
        const removed: Array<string> = []
        const docker = new Docker(async (_command, args) => {
            removed.push(args.join(" "))
            return { code: 0, stdout: "", stderr: "" }
        })
        await assert.rejects(
            debeziumService.provision(targetWith({ pg: streaming(log, [false]), docker }), { ...input({ debezium: { connections: ["primary"] } }), infra: { postgresql: postgres, redis } }),
            /debezium holding the replication slot shop_be_a1b2c3_cdc was not ready/,
        )
        assert.deepEqual(removed, ["rm -f -v starci-ts-postgresql-11111111"])
        assert.ok(log.some((entry) => entry.sql.includes("pg_drop_replication_slot")))
    })

    const marker = (log: ReadonlyArray<PgLog>): string => {
        const emitted = [...log].reverse().find((entry) => entry.sql.includes("pg_logical_emit_message"))
        const id = /'starci-world', '([^']+)'/.exec(emitted?.sql ?? "")?.[1] ?? ""
        return Buffer.from(id).toString("base64")
    }

    it("a drain emits a logical message and waits for it in the message stream, so every earlier change has been delivered", async () => {
        const log: Array<PgLog> = []
        const redisCalls: Array<string> = []
        let polls = 0
        const net = {
            ...targetWith({}).net,
            pg: scriptedPg(log),
            redis: async (_host: string, port: number, commands: ReadonlyArray<ReadonlyArray<string>>) => {
                redisCalls.push(`${port} ${commands.map((command) => command.join(" ")).join(" | ")}`)
                polls += 1
                return commands.map((command) => (command[0] === "XREVRANGE" ? (polls < 3 ? [] : [["1-0", ["message", marker(log)]]]) : "OK"))
            },
        }
        await drainDebezium(net, { postgresql: postgres, redis }, run)
        assert.equal(log[0]?.database, "shop_be_a1b2c3_primary")
        assert.match(log[0]?.sql ?? "", /^SELECT pg_logical_emit_message\(true, 'starci-world', '[0-9a-f]{24}'\)$/)
        assert.equal(polls, 3)
        assert.equal(redisCalls[0], "6379 SELECT 4 | XREVRANGE shop-be-a1b2c3.message + - COUNT 100")
        assert.equal(messageStreamOf({ ...run, stream: "shop-be-a1b2c3.cdc" }), "shop-be-a1b2c3.cdc")
        const silent = { ...net, redis: async () => ["OK", []] }
        await assert.rejects(drainDebezium(silent, { postgresql: postgres, redis }, run, 1000), /debezium shop_be_a1b2c3_cdc delivering the committed changes to shop-be-a1b2c3.message was not ready after 1000ms/)
        await assert.rejects(drainDebezium(net, { postgresql: postgres }, run), /needs the slot's postgresql and redis/)
    })

    it("reset drains the connector and then empties the slot's Redis DB", async () => {
        const log: Array<PgLog> = []
        const redisCalls: Array<string> = []
        const net = {
            ...targetWith({}).net,
            pg: scriptedPg(log),
            redis: async (_host: string, _port: number, commands: ReadonlyArray<ReadonlyArray<string>>) => {
                redisCalls.push(commands.map((command) => command.join(" ")).join(" | "))
                return commands.map((command) => (command[0] === "XREVRANGE" ? [["1-0", ["message", marker(log)]]] : "OK"))
            },
        }
        await debeziumService.reset({ ...targetWith({}), net }, run, { namespace, keepTables: {}, notes: {}, infra: { postgresql: postgres, redis } })
        assert.deepEqual(redisCalls, ["SELECT 4 | XREVRANGE shop-be-a1b2c3.message + - COUNT 100", "SELECT 4 | FLUSHDB"])
        await assert.rejects(debeziumService.reset({ ...targetWith({}), net }, run, { namespace, keepTables: {}, notes: {}, infra: {} }), /needs the slot's postgresql and redis/)
    })

    it("deprovision removes the container, ends the slot's walsender, drops the slot and then the publication", async () => {
        const log: Array<PgLog> = []
        const removed: Array<string> = []
        const docker = new Docker(async (_command, args) => {
            removed.push(args.join(" "))
            return { code: 0, stdout: "", stderr: "" }
        })
        await debeziumService.deprovision({ ...targetWith({ pg: scriptedPg(log), docker }), container: run.container }, run, { namespace, releaseRedisDb: async () => undefined, infra: { postgresql: postgres, redis } })
        assert.deepEqual(removed, ["rm -f -v starci-ts-debezium-cccccccc"])
        assert.deepEqual(log, [
            { database: "postgres", sql: "SELECT pg_terminate_backend(active_pid) FROM pg_replication_slots WHERE slot_name = 'shop_be_a1b2c3_cdc' AND active_pid IS NOT NULL" },
            { database: "postgres", sql: "SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots WHERE slot_name = 'shop_be_a1b2c3_cdc'" },
            { database: "shop_be_a1b2c3_primary", sql: 'DROP PUBLICATION IF EXISTS "shop_be_a1b2c3_cdc"' },
        ])
    })

    it("deprovision retries a slot the server still holds, tolerates a database that is already gone, and fails by name when the slot stays", async () => {
        const attempts: Array<string> = []
        const stubborn = (config: PgConfig): PgClient => ({
            connect: async () => {
                if (config.database !== "postgres") throw Object.assign(new Error("database does not exist"), { code: "3D000" })
            },
            on: () => undefined,
            end: async () => undefined,
            query: async (sql: string) => {
                attempts.push(sql)
                if (sql.includes("pg_drop_replication_slot") && attempts.filter((entry) => entry.includes("pg_drop_replication_slot")).length < 3) throw new Error("replication slot is active for PID 9")
                return { rows: [] }
            },
        })
        const docker = new Docker(async () => ({ code: 0, stdout: "", stderr: "" }))
        await debeziumService.deprovision(targetWith({ pg: stubborn, docker }), run, { namespace, releaseRedisDb: async () => undefined, infra: { postgresql: postgres } })
        assert.equal(attempts.filter((entry) => entry.includes("pg_drop_replication_slot")).length, 3)
        const never = (): PgClient => ({ connect: async () => undefined, on: () => undefined, end: async () => undefined, query: async () => Promise.reject(new Error("replication slot is active for PID 9")) })
        await assert.rejects(debeziumService.deprovision(targetWith({ pg: never, docker }), run, { namespace, releaseRedisDb: async () => undefined, infra: { postgresql: postgres } }), /dropping the replication slot shop_be_a1b2c3_cdc: replication slot is active for PID 9/)
        const broken = (): PgClient => ({ connect: async () => Promise.reject(Object.assign(new Error("boom"), { code: "XX000" })), on: () => undefined, end: async () => undefined, query: async () => ({ rows: [] }) })
        await assert.rejects(debeziumService.deprovision(targetWith({ pg: broken, docker }), run, { namespace, releaseRedisDb: async () => undefined, infra: { postgresql: postgres } }), /boom/)
    })
})
