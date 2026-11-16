import { TestWorldErrorCode, worldError } from "../../errors"
import type { AttachRequest, RunDebezium, RunInfra, RunPostgres } from "../contracts"
import { httpOk, waitUntil } from "../health"
import { debeziumSlotName } from "../naming"
import { withPg } from "../pg"
import type { PgConfig } from "../pg"
import type { RespValue } from "../resp"
import { randomSecret } from "./definition"
import type { DebeziumPlan, ServiceDefinition, ServiceNet } from "./definition"

/** The container port of Debezium Server's management endpoint (`/q/health/live`): the only port it publishes. */
export const DEBEZIUM_HTTP_PORT = 8080
/** The prefix of the logical decoding messages the library emits to learn the connector has caught up. */
export const DRAIN_PREFIX = "starci-world"
/** How long a drain (and a start) waits for the connector, in milliseconds. */
const DRAIN_TIMEOUT_MS = 30_000
const ACTIVE_TIMEOUT_MS = 90_000
const DROP_ATTEMPTS = 20

const PG_INTERNAL_PORT = 5432
const REDIS_INTERNAL_PORT = 6379

const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`

const pgConfigOf = (postgres: RunPostgres, database: string): PgConfig => ({ host: postgres.host, port: postgres.directPort, user: postgres.user, password: postgres.password, database })

/** The stream a logical decoding message lands in: the declared single stream, or `<prefix>.message`. */
export const messageStreamOf = (run: Pick<RunDebezium, "stream" | "streamPrefix">): string => run.stream ?? `${run.streamPrefix}.message`

/**
 * What the slot's Debezium Server is configured from: the captured database and schemas of the slot's Postgres, the slot's
 * Redis DB, and the names derived from the slot's namespace (slot and publication `<snake>_cdc`, topic prefix `<kebab>`, so
 * streams are `<kebab>.<schema>.<table>`), so two slots or two repositories never share a slot, a publication or a stream.
 */
export const debeziumPlanOf = (request: AttachRequest, infra: Pick<RunInfra, "postgresql" | "redis">): DebeziumPlan => {
    const { debezium } = request
    const { postgresql, redis } = infra
    if (debezium === undefined || postgresql === undefined || redis === undefined) {
        throw worldError(TestWorldErrorCode.InfrastructureFailed, "debezium needs the slot's provisioned postgresql and redis and its own request")
    }
    const database = postgresql.databases[debezium.connections[0] ?? ""]
    if (database === undefined) throw worldError(TestWorldErrorCode.InfrastructureFailed, `debezium captures ${debezium.connections.join(", ")}, which postgresql did not provision`)
    const schemas = debezium.connections.flatMap((name) => {
        const login = postgresql.schemas[name]
        return login === undefined ? [] : [login.schema]
    })
    const { namespace } = request
    return {
        slotName: debeziumSlotName(namespace.snake),
        topicPrefix: namespace.kebab,
        stream: debezium.stream === undefined ? null : `${namespace.kebab}.${debezium.stream}`,
        postgres: { host: postgresql.container, port: PG_INTERNAL_PORT, user: postgresql.user, password: postgresql.password, database, schemas: [...new Set(schemas)] },
        redis: { host: redis.container, port: REDIS_INTERNAL_PORT, db: redis.db },
        tables: debezium.tables ?? [],
        properties: debezium.properties ?? {},
    }
}

/**
 * The Debezium Server properties (without the `debezium.` prefix) of a plan: the library's, then the declaration's after them
 * (the declaration validation refuses the ones the library owns, so only defaults such as the payload format are overridden).
 */
export const debeziumProperties = (plan: DebeziumPlan): Readonly<Record<string, string>> => ({
    "sink.type": "redis",
    "sink.redis.address": `${plan.redis.host}:${plan.redis.port}`,
    "sink.redis.db.index": String(plan.redis.db),
    "source.connector.class": "io.debezium.connector.postgresql.PostgresConnector",
    "source.offset.storage.file.filename": "/tmp/starci-offsets.dat",
    "source.offset.flush.interval.ms": "200",
    "source.database.hostname": plan.postgres.host,
    "source.database.port": String(plan.postgres.port),
    "source.database.user": plan.postgres.user,
    "source.database.password": plan.postgres.password,
    "source.database.dbname": plan.postgres.database,
    "source.topic.prefix": plan.topicPrefix,
    "source.plugin.name": "pgoutput",
    "source.slot.name": plan.slotName,
    "source.publication.name": plan.slotName,
    // Every table, whenever it is created: the migrate step runs after the connector starts.
    "source.publication.autocreate.mode": "all_tables",
    // Changes only: the rows a migration or a seed wrote before a spec file are not events, and a reset empties the stream anyway.
    "source.snapshot.mode": "no_data",
    "format.key.schemas.enable": "false",
    "format.value.schemas.enable": "false",
    ...(plan.postgres.schemas.length === 0 ? {} : { "source.schema.include.list": plan.postgres.schemas.join(",") }),
    ...(plan.tables.length === 0 ? {} : { "source.table.include.list": plan.tables.join(",") }),
    ...(plan.stream === null
        ? {}
        : {
              transforms: "stream",
              "transforms.stream.type": "org.apache.kafka.connect.transforms.RegexRouter",
              "transforms.stream.regex": ".*",
              "transforms.stream.replacement": plan.stream,
          }),
    ...plan.properties,
})

/** The container environment of a plan: each property as `DEBEZIUM_<NAME>` (dots to underscores, upper case), the form Debezium Server reads. */
export const debeziumEnv = (plan: DebeziumPlan): Readonly<Record<string, string>> =>
    Object.fromEntries(Object.entries(debeziumProperties(plan)).map(([key, value]) => [`DEBEZIUM_${key.toUpperCase().replaceAll(/[^A-Z0-9]/g, "_")}`, value]))

/** Whether a Redis reply, searched as text, carries `needle`. */
const mentions = (reply: RespValue | undefined, needle: string): boolean => JSON.stringify(reply ?? null).includes(needle)

/**
 * Waits until the connector has delivered everything the database committed so far: it emits a logical decoding message (a
 * transactional `pg_logical_emit_message`, no table touched) and waits for that message in the slot's message stream, and WAL is
 * ordered, so every change committed before it is in its stream by then.
 */
export const drainDebezium = async (net: ServiceNet, infra: Pick<RunInfra, "postgresql" | "redis">, run: RunDebezium, timeoutMs = DRAIN_TIMEOUT_MS): Promise<void> => {
    const { postgresql, redis } = infra
    if (postgresql === undefined || redis === undefined) throw worldError(TestWorldErrorCode.NotDeclared, "draining debezium needs the slot's postgresql and redis")
    const marker = randomSecret()
    await withPg(net.pg, pgConfigOf(postgresql, run.database), (client) => client.query(`SELECT pg_logical_emit_message(true, ${literal(DRAIN_PREFIX)}, ${literal(marker)})`))
    const encoded = Buffer.from(marker).toString("base64")
    await waitUntil(
        `debezium ${run.slotName} delivering the committed changes to ${messageStreamOf(run)}`,
        async () => {
            const [, latest] = await net.redis(redis.host, redis.directPort, [["SELECT", String(redis.db)], ["XREVRANGE", messageStreamOf(run), "+", "-", "COUNT", "100"]])
            return mentions(latest, encoded)
        },
        { timeoutMs, intervalMs: 100, pause: net.pause },
    )
}

/** Drops the slot (ending its walsender when it is still attached) and the publication; a database that is already gone has no publication. */
const dropReplication = async (net: ServiceNet, postgres: RunPostgres, run: Pick<RunDebezium, "slotName" | "publicationName" | "database">): Promise<void> => {
    const slot = literal(run.slotName)
    await withPg(net.pg, pgConfigOf(postgres, "postgres"), async (admin) => {
        for (let attempt = 1; ; attempt += 1) {
            try {
                await admin.query(`SELECT pg_terminate_backend(active_pid) FROM pg_replication_slots WHERE slot_name = ${slot} AND active_pid IS NOT NULL`)
                await admin.query(`SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots WHERE slot_name = ${slot}`)
                return
            } catch (cause) {
                if (attempt >= DROP_ATTEMPTS) throw worldError(TestWorldErrorCode.InfrastructureFailed, `dropping the replication slot ${run.slotName}: ${cause instanceof Error ? cause.message : String(cause)}`, cause)
                await net.pause(250)
            }
        }
    })
    try {
        await withPg(net.pg, pgConfigOf(postgres, run.database), (client) => client.query(`DROP PUBLICATION IF EXISTS "${run.publicationName.replaceAll('"', '""')}"`))
    } catch (cause) {
        // The database went first (a reclaimed run): its publications went with it.
        if ((cause as { readonly code?: string }).code !== "3D000") throw cause
    }
}

/** Waits until the connector holds its replication slot: it is streaming, so a change committed from now on reaches the stream. */
const waitStreaming = (net: ServiceNet, postgres: RunPostgres, run: Pick<RunDebezium, "slotName" | "database">, timeoutMs = ACTIVE_TIMEOUT_MS): Promise<void> =>
    waitUntil(
        `debezium holding the replication slot ${run.slotName}`,
        async () => {
            const rows = await withPg(net.pg, pgConfigOf(postgres, "postgres"), (client) => client.query(`SELECT active FROM pg_replication_slots WHERE slot_name = ${literal(run.slotName)}`))
            return rows.rows[0]?.active === true
        },
        { timeoutMs, intervalMs: 250, pause: net.pause },
    )

/** `restart()` of the world handle and `restore()` after `cut()`: starts the stopped container and waits until it streams again. */
export const waitDebeziumStreaming = (net: ServiceNet, postgres: RunPostgres, run: RunDebezium): Promise<void> => waitStreaming(net, postgres, run)

/**
 * Debezium Server: one container per data slot (a slot's replication slot, offsets and failure are its own), started by the
 * slot's attach once its Postgres and Redis DB exist, because its configuration is those. It reads the slot's database
 * through a replication slot and a publication named from the namespace and writes the change events to the slot's Redis DB
 * (a stream per table `<namespace.kebab>.<schema>.<table>`, or one declared stream). Nothing the app talks to goes through it,
 * so it has no toxiproxy proxy: its outage is the container stopping and starting. The published port is the management
 * endpoint, polled for readiness.
 */
export const debeziumService: ServiceDefinition<RunDebezium> = {
    name: "debezium",
    port: DEBEZIUM_HTTP_PORT,
    scope: "namespace",
    after: ["postgresql", "redis"],
    proxied: false,
    newSecrets: () => ({}),
    spec: (_image, _secrets, hints) => {
        if (hints.debezium === undefined || hints.debezium === null) throw worldError(TestWorldErrorCode.InfrastructureFailed, "the debezium server was started without its plan")
        return { env: debeziumEnv(hints.debezium), command: [] }
    },
    ready: (target) => httpOk(target.net.fetch, `http://${target.host}:${target.port}/q/health/live`),
    provision: async (target, input) => {
        const { postgresql, redis } = input.infra
        const request = input.request.debezium
        if (postgresql === undefined || redis === undefined || request === undefined) {
            throw worldError(TestWorldErrorCode.InfrastructureFailed, "debezium needs the slot's provisioned postgresql and redis and its own request")
        }
        const plan = debeziumPlanOf(input.request, { postgresql, redis })
        const run = { slotName: plan.slotName, publicationName: plan.slotName, streamPrefix: input.namespace.kebab, stream: plan.stream, database: plan.postgres.database }
        try {
            await waitStreaming(target.net, postgresql, run)
        } catch (cause) {
            await target.net.docker.remove(target.container)
            await dropReplication(target.net, postgresql, run).catch(() => undefined)
            throw cause
        }
        return { run }
    },
    // Before every spec file, after the database and the Redis DB were emptied: everything those truncations (and the migrate
    // and seed steps) made is delivered, then dropped, so no spec reads another's events.
    reset: async (target, run, input) => {
        const { postgresql, redis } = input.infra
        if (postgresql === undefined || redis === undefined) throw worldError(TestWorldErrorCode.NotDeclared, "resetting debezium needs the slot's postgresql and redis")
        await drainDebezium(target.net, { postgresql, redis }, run)
        await target.net.redis(redis.host, redis.directPort, [["SELECT", String(redis.db)], ["FLUSHDB"]])
    },
    // Container first (the slot is then inactive), then its slot and publication; the database still exists, since postgresql is torn down after.
    deprovision: async (target, run, input) => {
        await target.net.docker.remove(target.container)
        const { postgresql } = input.infra
        if (postgresql !== undefined) await dropReplication(target.net, postgresql, run)
    },
}
