import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, test } from "node:test"
import { TestWorldError, TestWorldErrorCode } from "../errors"
import type { TestWorldConfig } from "./types"
import { validateDeclaration } from "./validate"

const roots: string[] = []

const fixture = (files: Readonly<Record<string, string>>): string => {
    const root = mkdtempSync(join(tmpdir(), "tw-a3v-"))
    roots.push(root)
    for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true })
        writeFileSync(join(root, path), content)
    }
    return root
}

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const FILES = {
    ".starcistacks/dev/environment.json": "{}",
    "seeds/a.sql": "select 1",
    "realm.json": JSON.stringify({ realm: "app" }),
    "docker/api.Dockerfile": "FROM node",
}

const config = (overrides: Record<string, unknown> = {}): TestWorldConfig =>
    ({
        stack: ".starcistacks/dev",
        stacks: { postgresql: { connections: [{ name: "main", seeds: ["seeds/a.sql"] }] }, redis: {} },
        fakes: { llm: {} },
        apps: { api: {} },
        migrate: { module: () => Promise.resolve(), options: () => ({}) },
        ...overrides,
    }) as unknown as TestWorldConfig

const problemsOf = (subject: TestWorldConfig, root: string): string => {
    try {
        validateDeclaration(subject, root)
    } catch (error) {
        assert.ok(error instanceof TestWorldError)
        assert.equal(error.code, TestWorldErrorCode.ConfigInvalid)
        return error.message
    }
    return assert.fail("expected the declaration to be invalid")
}

describe("validateDeclaration", () => {
    test("a valid declaration answers the selected infra services", () => {
        const root = fixture(FILES)
        const selected = validateDeclaration(
            config({
                stacks: {
                    postgresql: { connections: [{ name: "main", seeds: ["seeds/a.sql"] }] },
                    keycloak: { realm: "realm.json" },
                    qdrant: { fakedBy: "llm", reason: "no self-hosted image" },
                },
                k3d: { enable: true, images: { api: "docker/api.Dockerfile" } },
                identity: { register: "keycloak", signIn: () => Promise.resolve({ personId: "p", sessionToken: "t" }) },
            }),
            root,
        )
        assert.deepEqual(selected, ["postgresql", "keycloak"])
    })

    test("lists every problem at once", () => {
        const root = fixture({ "realm.json": "not json" })
        const message = problemsOf(
            config({
                stack: ".starcistacks/missing",
                stacks: {
                    postgresql: { connections: [{ name: "1bad", seeds: ["seeds/none.sql"] }, { name: "dup" }, { name: "dup" }] },
                    keycloak: { realm: "realm.json" },
                    stripe: {},
                    gpu: { fakedBy: "nothing", reason: "" },
                    vision: { fakedBy: "", reason: "gpu" },
                },
                k3d: { enable: true, images: { api: "docker/none.Dockerfile" } },
                identity: { register: "keycloak" },
                apps: { "bad-name": {} },
                migrate: undefined,
            }),
            root,
        )
        for (const expected of [
            "the directory .starcistacks/missing does not exist",
            "connections[0].name",
            "seeds: seeds/none.sql does not exist",
            'connections[2].name: "dup" is declared twice',
            "not valid JSON",
            "stacks.stripe: not an infrastructure service",
            'stacks.gpu.fakedBy: "nothing" is not an entry of `fakes`',
            "stacks.gpu.reason",
            "stacks.vision.fakedBy: must name",
            "k3d.images.api",
            "apps.bad-name",
            "identity.signIn",
            "migrate: the migrate block is required",
        ]) {
            assert.ok(message.includes(expected), `missing "${expected}" in:\n${message}`)
        }
    })

    test("postgres needs connections; realm file needs a realm name and must exist", () => {
        const root = fixture({ ...FILES, "empty.json": "{}" })
        assert.match(problemsOf(config({ stacks: { postgresql: { connections: [] } } }), root), /connections: at least one/)
        assert.match(problemsOf(config({ stacks: { keycloak: { realm: "empty.json" } } }), root), /no `realm` name/)
        assert.match(problemsOf(config({ stacks: { keycloak: { realm: "nope.json" } } }), root), /nope\.json does not exist/)
    })

    test("a known service may be faked when it names a fake and a reason", () => {
        const root = fixture(FILES)
        const selected = validateDeclaration(config({ stacks: { redis: { fakedBy: "llm", reason: "stateless compute" } } }), root)
        assert.deepEqual(selected, [])
    })

    test("k3d Dockerfiles are only checked when the cluster is enabled", () => {
        const root = fixture(FILES)
        assert.doesNotThrow(() => validateDeclaration(config({ k3d: { enable: false, images: { api: "docker/none.Dockerfile" } } }), root))
    })

    test("schema-per-context: contexts sharing a database each declare a distinct schema, never public or pg_*", () => {
        const root = fixture(FILES)
        const withConnections = (connections: ReadonlyArray<Record<string, unknown>>) => config({ stacks: { postgresql: { connections }, redis: {} } })
        assert.doesNotThrow(() =>
            validateDeclaration(withConnections([{ name: "identity", database: "core", schema: "identity" }, { name: "order", database: "core", schema: "ordering" }, { name: "audit" }]), root),
        )
        assert.doesNotThrow(() => validateDeclaration(withConnections([{ name: "solo", schema: "solo" }]), root))
        assert.match(problemsOf(withConnections([{ name: "identity", database: "core", schema: "identity" }, { name: "order", database: "core" }]), root), /order share the database core with other contexts and must each declare a schema/)
        assert.match(problemsOf(withConnections([{ name: "a", database: "core", schema: "x" }, { name: "b", database: "core", schema: "x" }]), root), /schema x is declared twice in the database core/)
        assert.match(problemsOf(withConnections([{ name: "a", schema: "public" }]), root), /neither public nor pg_\*/)
        assert.match(problemsOf(withConnections([{ name: "a", database: "bad-name", schema: "a" }]), root), /database: "bad-name"/)
    })

    test("mail is selected as a real service and can never be declared as faked", () => {
        const root = fixture(FILES)
        assert.deepEqual(validateDeclaration(config({ stacks: { mail: {}, redis: {} } }), root), ["redis", "mail"])
        assert.match(problemsOf(config({ stacks: { mail: { fakedBy: "llm", reason: "no smtp here" } } }), root), /stacks\.mail: the mail sink holds the messages an app sent and always runs real/)
    })

    test("kafka is own infrastructure and can never be declared as faked", () => {
        const root = fixture(FILES)
        assert.match(problemsOf(config({ stacks: { kafka: { fakedBy: "llm", reason: "no broker here" } } }), root), /stacks\.kafka: kafka is our own event bus and always runs real/)
    })

    test("postgres logical replication is a boolean", () => {
        const root = fixture(FILES)
        assert.doesNotThrow(() => validateDeclaration(config({ stacks: { postgresql: { connections: [{ name: "main" }], logicalReplication: true }, redis: {} } }), root))
        assert.match(problemsOf(config({ stacks: { postgresql: { connections: [{ name: "main" }], logicalReplication: "yes" }, redis: {} } }), root), /stacks\.postgresql\.logicalReplication: must be true or false, got yes/)
    })

    describe("stacks.debezium", () => {
        const withDebezium = (debezium: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
            config({ stacks: { postgresql: { connections: [{ name: "main" }, { name: "audit" }], logicalReplication: true }, redis: {}, debezium, ...extra } })

        test("passes with a logical postgres and redis, and is selected last as a real service", () => {
            const root = fixture(FILES)
            assert.deepEqual(validateDeclaration(withDebezium({ connections: ["main"], tables: ["public.orders"], stream: "cdc", properties: { "format.value.schemas.enable": "true" } }), root), ["postgresql", "redis", "debezium"])
            assert.doesNotThrow(() => validateDeclaration(config({ stacks: { postgresql: { connections: [{ name: "a", database: "core", schema: "a" }, { name: "b", database: "core", schema: "b" }], logicalReplication: true }, redis: {}, debezium: {} } }), root))
        })

        test("can never be declared as faked: it reads the real WAL", () => {
            const root = fixture(FILES)
            assert.match(problemsOf(withDebezium({ fakedBy: "llm", reason: "no image" }), root), /stacks\.debezium: Debezium Server is a stack service that reads the real WAL and always runs real/)
        })

        test("needs a real postgres with logical replication and a real redis", () => {
            const root = fixture(FILES)
            assert.match(problemsOf(config({ stacks: { postgresql: { connections: [{ name: "main" }] }, redis: {}, debezium: {} } }), root), /stacks\.postgresql\.logicalReplication` must be true/)
            assert.match(problemsOf(config({ stacks: { redis: {}, debezium: {} } }), root), /stacks\.postgresql` must be declared and not faked/)
            assert.match(problemsOf(config({ stacks: { postgresql: { connections: [{ name: "main" }], logicalReplication: true }, debezium: {} } }), root), /stacks\.redis` must be declared and not faked/)
            assert.match(problemsOf(config({ stacks: { postgresql: { connections: [{ name: "main" }], logicalReplication: true }, redis: { fakedBy: "llm", reason: "cache" }, debezium: {} } }), root), /stacks\.redis` must be declared and not faked/)
        })

        test("captures declared connections of one database", () => {
            const root = fixture(FILES)
            assert.match(problemsOf(withDebezium({ connections: ["nope"] }), root), /connections: "nope" is not a connection of stacks\.postgresql\.connections \(main, audit\)/)
            assert.match(problemsOf(withDebezium({}), root), /one Debezium Server reads one database, but main, audit are captured/)
            assert.match(problemsOf(withDebezium({ connections: [] }), root), /stacks\.debezium\.connections: at least one Postgres connection is captured/)
        })

        test("tables, stream and properties are checked: the library's own properties and a double route are refused", () => {
            const root = fixture(FILES)
            const message = problemsOf(
                withDebezium({
                    connections: ["main"],
                    tables: ["orders", "public.ok"],
                    stream: "bad stream",
                    properties: { "debezium.sink.type": "kafka", "source.slot.name": "mine", "sink.redis.db.index": "9", "source.database.hostname": "h", "transforms.x.type": "t", "format.value": "json" },
                }),
                root,
            )
            for (const expected of [
                'stacks.debezium.tables: "orders" must be schema.table',
                'stacks.debezium.stream: "bad stream" must match',
                "properties.debezium.sink.type: write the property without",
                "properties.source.slot.name: the library owns it",
                "properties.sink.redis.db.index: the library owns it",
                "properties.source.database.hostname: the library owns it",
                "properties.transforms.x.type: `stream` routes every event through the library's own transform",
            ]) {
                assert.ok(message.includes(expected), `missing "${expected}" in:\n${message}`)
            }
            assert.equal(message.includes("properties.format.value:"), false, "a payload property is the declaration's")
            assert.doesNotThrow(() => validateDeclaration(withDebezium({ connections: ["main"], properties: { "transforms.unwrap.type": "io.debezium.transforms.ExtractNewRecordState", transforms: "unwrap" } }), root))
        })
    })
})
