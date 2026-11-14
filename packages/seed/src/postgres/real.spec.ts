import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"
import pg from "pg"
import { exportOnce, memorySpool, restoreFrom } from "../copies.ts"
import type { OpenContext, WriteContext } from "../driver.ts"
import { createGitDriver } from "../git/driver.ts"
import type { DataEntry, ManifestHeader } from "../manifest.ts"
import { byteOrder, recordValue } from "../manifest.ts"
import type { PostgresRunner } from "./store.ts"
import { postgresStore } from "./store.ts"

/* ---------------------------------------------------------------------------------------------------------------
 * A REAL PostgreSQL. The server is, in this order:
 *   1. the one STARCI_SEED_PG_URL names (a throwaway server: the spec creates and drops its own scratch databases);
 *   2. a Docker container of the image pinned in contexts/stack/pins.yaml (`postgres` 17.11, by digest), started on a
 *      random loopback port with a random password and removed after the run, when `docker info` answers;
 *   3. neither: every test below is skipped with that reason.
 * The `pg` client lives in this spec only.
 * ---------------------------------------------------------------------------------------------------------------- */

const PG_IMAGE = "postgres@sha256:31ba9c94a03ada9988f2bb493a22a75eef3a185884533e5cdbcd498ea835b08f"

interface Server {
    readonly admin: pg.Pool
    readonly urlFor: (database: string) => string
}

const root = mkdtempSync(join(tmpdir(), "seed-postgres-spec-"))
const cleanups: (() => Promise<void> | void)[] = []
after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup()
    rmSync(root, { recursive: true, force: true })
})

async function waitFor(url: string): Promise<pg.Pool> {
    const pool = new pg.Pool({ connectionString: url, max: 4 })
    for (let attempt = 0; attempt < 90; attempt += 1) {
        try {
            await pool.query("SELECT 1")
            return pool
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 1000))
        }
    }
    await pool.end()
    throw new Error("the PostgreSQL server did not answer in time")
}

async function startServer(): Promise<{ server: Server } | { skip: string }> {
    const given = process.env.STARCI_SEED_PG_URL
    if (given !== undefined && given !== "") {
        const url = new URL(given)
        const admin = await waitFor(given)
        cleanups.push(() => admin.end())
        return { server: { admin, urlFor: (database) => { const next = new URL(url); next.pathname = `/${database}`; return next.toString() } } }
    }
    if (spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0) return { skip: "no STARCI_SEED_PG_URL and Docker does not answer" }
    const password = randomBytes(12).toString("hex")
    const started = spawnSync("docker", ["run", "-d", "--rm", "-p", "127.0.0.1::5432", "-e", `POSTGRES_PASSWORD=${password}`, PG_IMAGE], { encoding: "utf8" })
    if (started.status !== 0) return { skip: "Docker could not start the pinned postgres image" }
    const container = started.stdout.trim()
    cleanups.push(() => {
        spawnSync("docker", ["rm", "-f", container], { stdio: "ignore" })
    })
    const mapping = /:(\d+)\s*$/mu.exec(spawnSync("docker", ["port", container, "5432/tcp"], { encoding: "utf8" }).stdout)
    assert.ok(mapping?.[1] !== undefined, "docker port answered no mapping")
    const base = `postgres://postgres:${password}@127.0.0.1:${mapping[1]}`
    const admin = await waitFor(`${base}/postgres`)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await admin.query("SELECT 1")
    cleanups.push(() => admin.end())
    return { server: { admin, urlFor: (database) => `${base}/${database}` } }
}

const started = await startServer()
const skip = "skip" in started ? started.skip : false

/* ---------------------------------------------------------------------------------------------------------------
 * The schema: every shape the store must carry.
 * ---------------------------------------------------------------------------------------------------------------- */

const SCHEMA = `
CREATE TYPE mood AS ENUM ('sad', 'ok');
CREATE TABLE accounts (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  balance numeric(40,10),
  big bigint,
  ratio double precision,
  born date,
  seen timestamptz,
  span interval,
  doc jsonb,
  raw json,
  blob bytea,
  tags text[],
  feeling mood,
  total numeric GENERATED ALWAYS AS (balance * 2) STORED
);
CREATE TABLE aa_children (id integer PRIMARY KEY, account_id integer NOT NULL REFERENCES accounts (id), note text);
CREATE TABLE things (id serial PRIMARY KEY, label text);
CREATE TABLE words (word text PRIMARY KEY, n integer);
CREATE TABLE memberships (org text, "user" text, role text, PRIMARY KEY (org, "user"));
CREATE TABLE no_key (line text);
CREATE TABLE jobs (id integer PRIMARY KEY, payload text);
CREATE TABLE events (id bigint, at timestamptz, note text, PRIMARY KEY (id, at)) PARTITION BY RANGE (at);
CREATE TABLE events_2026 PARTITION OF events FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE TABLE events_2027 PARTITION OF events FOR VALUES FROM ('2027-01-01') TO ('2028-01-01');
`

const DATA = `
INSERT INTO accounts (name, balance, big, ratio, born, seen, span, doc, raw, blob, tags, feeling) VALUES
  ('Zoë "quoted" \\ back
slash', 12345678901234567890.1234567890, 9223372036854775807, 0.1, '2026-02-03', '2026-02-03 10:11:12.123456+07', '1 day 2 hours 3.5 seconds',
   '{"b": 1.50, "a": [1, 2, {"x": null}], "big": 12345678901234567890123}', '{"k":   [1, 2]}', '\\x00ff10', ARRAY['a', 'b,c', NULL, 'd"e'], 'ok'),
  ('plain', NULL, -9223372036854775808, 'NaN', 'infinity', 'infinity', NULL, 'null', NULL, '\\x', '{}', NULL),
  ('third', 0.0000000001, 0, 1e300, '0001-01-01', '2026-12-31 23:59:59.999999+00', '-1 years', '{}', 'null', NULL, NULL, 'sad');
INSERT INTO aa_children VALUES (1, 1, 'child one'), (2, 3, NULL);
INSERT INTO things (label) VALUES ('one'), ('two'), ('three');
INSERT INTO words VALUES ('10', 1), ('9', 2), ('a', 3), ('B', 4), ('é', 5), ('Z', 6), ('_', 7), ('ab', 8), ('a b', 9);
INSERT INTO memberships VALUES ('acme', 'zed', 'owner'), ('acme', 'amy', 'member'), ('Beta', 'amy', NULL);
INSERT INTO no_key VALUES ('lost'), ('lost');
INSERT INTO jobs VALUES (1, 'queued');
INSERT INTO events VALUES (1, '2026-06-01 00:00:00+00', 'first'), (2, '2027-06-01 00:00:00+00', 'second'), (3, '2026-07-01 00:00:00+00', 'third');
`

async function scalar(pool: pg.Pool, sql: string): Promise<unknown> {
    return Object.values((await pool.query(sql)).rows[0] as Record<string, unknown>)[0]
}

const roles: string[] = []
cleanups.push(async () => {
    for (const role of roles) await server?.admin.query(`DROP ROLE IF EXISTS ${role}`)
})
const suffix = randomBytes(4).toString("hex")
let counter = 0

function runnerOver(pool: pg.Pool): PostgresRunner {
    const over = (client: pg.Pool | pg.PoolClient): PostgresRunner["query"] => async (sql, params = []) => (await client.query(sql, [...params])).rows as Record<string, unknown>[]
    return {
        query: over(pool),
        async transaction(isolation, work) {
            const client = await pool.connect()
            try {
                await client.query(`BEGIN ISOLATION LEVEL ${isolation.toUpperCase()}`)
                const tx: PostgresRunner = { query: over(client), transaction: () => Promise.reject(new Error("a transaction does not nest")) }
                const result = await work(tx)
                await client.query("COMMIT")
                return result
            } catch (cause) {
                await client.query("ROLLBACK").catch(() => undefined)
                throw cause
            } finally {
                client.release()
            }
        },
    }
}

interface Scratch {
    readonly pool: pg.Pool
    readonly run: PostgresRunner
}

/** A scratch database made from the schema (and the data when asked), in a non-C collation when the server has one. */
async function scratch(server: Server, withData: boolean): Promise<Scratch> {
    const name = `seed_${suffix}_${String((counter += 1))}`
    try {
        await server.admin.query(`CREATE DATABASE ${name} TEMPLATE template0 ENCODING 'UTF8' LOCALE 'en_US.utf8'`)
    } catch {
        await server.admin.query(`CREATE DATABASE ${name} TEMPLATE template0 ENCODING 'UTF8'`)
    }
    const pool = new pg.Pool({ connectionString: server.urlFor(name), max: 4 })
    cleanups.push(async () => {
        await pool.end()
        await server.admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
    })
    await pool.query(SCHEMA)
    if (withData) await pool.query(DATA)
    return { pool, run: runnerOver(pool) }
}

const store = (db: Scratch, pageRows = 2) => postgresStore({ id: "database", run: db.run, exclude: [{ table: "public.jobs", reason: "a queue, rebuilt by the app" }], pageRows })

const header: ManifestHeader = { format: "app-seed-backup@1", purpose: "seed-backup", takenAt: "2026-11-15T00:00:00.000Z", source: { project: "spec", environment: "test" } }
const exportOf = async (db: Scratch, pageRows?: number) => exportOnce([store(db, pageRows)], {}, memorySpool(), header)
const keysOf = async (source: Awaited<ReturnType<typeof exportOf>>): Promise<DataEntry[]> => {
    const out: DataEntry[] = []
    for await (const item of source.entries()) out.push(item.entry)
    return out
}

const gitEnv = { GIT_AUTHOR_NAME: "spec", GIT_AUTHOR_EMAIL: "spec@example.test", GIT_COMMITTER_NAME: "spec", GIT_COMMITTER_EMAIL: "spec@example.test" }

const sealing = ((): { recipient: string; open: OpenContext } | null => {
    if (spawnSync("sops", ["--version"]).status !== 0 || spawnSync("age-keygen", ["--version"]).status !== 0) return null
    const file = join(root, "age.txt")
    assert.equal(spawnSync("age-keygen", ["-o", file]).status, 0)
    const recipient = /# public key: (age1\S+)/u.exec(readFileSync(file, "utf8"))?.[1]
    assert.ok(recipient !== undefined)
    return { recipient, open: { identity: { kind: "age-identity", env: { SOPS_AGE_KEY_FILE: file } } } }
})()

/* ---------------------------------------------------------------------------------------------------------------- */

const server = "server" in started ? started.server : null
const withServer = (name: string, body: (server: Server) => Promise<void>): void => {
    test(name, { skip }, async () => {
        assert.ok(server !== null)
        await body(server)
    })
}

withServer("describes the held tables (a partition is not one), and names the tables it cannot hold with their reasons", async (srv) => {
    const description = await store(await scratch(srv, false)).describe()
    assert.deepEqual(description.sets.map((set) => set.set), ["public.aa_children", "public.accounts", "public.events", "public.memberships", "public.things", "public.words"])
    assert.deepEqual(
        description.cannot.map((item) => [item.what, item.reason.slice(0, 22)]),
        [
            ["export and import of table public.jobs", "excluded by the app: a"],
            ["export and import of table public.no_key", "it has no primary key,"],
        ],
    )
})

withServer("an unchanged database exports to the same digest, and the git driver commits nothing the second time", async (srv) => {
    const db = await scratch(srv, true)
    const first = await exportOf(db)
    const second = await exportOf(db, 3)
    assert.equal(first.manifest.exportDigest, second.manifest.exportDigest, "the page size must not change the export")
    const checkout = join(root, "git-copy")
    const driver = createGitDriver({ id: "copy", checkout, env: gitEnv })
    const context: WriteContext = { recipients: sealing === null ? [] : [sealing.recipient], dryRun: false }
    const plain = sealing === null
    const source = (value: typeof first) => (plain ? { ...value, manifest: { ...value.manifest, purpose: "seed-standard" as const } } : value)
    const written = await driver.write(source(first), context)
    assert.ok(written.changed > 0)
    const again = await driver.write(source(await exportOf(db)), context)
    assert.equal(again.changed, 0, "an unchanged database must change no file")
    const [ref] = await driver.list()
    assert.ok(ref !== undefined)
    assert.equal((await driver.verify(ref, sealing?.open ?? null)).healthy, true)
    const changed = await db.pool.query("UPDATE words SET n = 99 WHERE word = 'ab'")
    assert.equal(changed.rowCount, 1)
    const third = await driver.write(source(await exportOf(db)), context)
    assert.ok(third.changed > 0 && third.changed < written.changed, "one changed row changes few files")
})

withServer("exports each table in UTF-8 byte order of its keys, whatever the database collation says", async (srv) => {
    const db = await scratch(srv, true)
    const entries = (await keysOf(await exportOf(db))).filter((entry) => entry.set === "public.words")
    const keys = entries.map((entry) => entry.key)
    assert.deepEqual(keys, [...keys].sort(byteOrder))
    assert.deepEqual(keys, ["10", "9", "B", "Z", "_", "a", "a b", "ab", "é"])
    const sql = (await db.pool.query("SELECT word FROM words ORDER BY word")).rows.map((row: { word: string }) => row.word)
    assert.equal(sql.length, keys.length)
    const memberships = (await keysOf(await exportOf(db))).filter((entry) => entry.set === "public.memberships").map((entry) => entry.key)
    assert.deepEqual(memberships, ['["Beta","amy"]', '["acme","amy"]', '["acme","zed"]'])
    const ids = (await keysOf(await exportOf(db))).filter((entry) => entry.set === "public.accounts").map((entry) => entry.key)
    assert.deepEqual(ids, ["1", "2", "3"])
})

withServer("a generated column is not held, bytea, jsonb, numeric, intervals and arrays are held as exact text", async (srv) => {
    const db = await scratch(srv, true)
    const entries = await keysOf(await exportOf(db))
    const first = entries.find((entry) => entry.set === "public.accounts" && entry.key === "1")
    assert.ok(first !== undefined)
    const row = recordValue(first) as Record<string, string | null>
    assert.equal("total" in row, false)
    assert.equal(row.blob, "\\x00ff10")
    assert.equal(row.balance, "12345678901234567890.1234567890")
    assert.equal(row.big, "9223372036854775807")
    assert.equal(row.seen, "2026-02-03 03:11:12.123456+00")
    assert.equal(row.span, "P1DT2H3.5S")
    assert.equal(row.doc, '{"a": [1, 2, {"x": null}], "b": 1.50, "big": 12345678901234567890123}')
    assert.equal(row.raw, '{"k":   [1, 2]}')
    assert.equal(row.tags, '{a,"b,c",NULL,"d\\"e"}')
    assert.equal(row.feeling, "ok")
    assert.equal(row.name, 'Zoë "quoted" \\ back\nslash')
})

withServer("export, then import into a second database made from the same schema, then export again: equal digests, and every value is back as its own type", async (srv) => {
    const a = await scratch(srv, true)
    const b = await scratch(srv, false)
    const out = await exportOf(a)
    const reports = await restoreFrom(out, [store(b)], { dryRun: false, mode: "merge" })
    assert.equal(reports.length, 1)
    const [report] = reports
    assert.ok(report !== undefined)
    assert.equal(report.outcome, "applied")
    assert.deepEqual(report.sets.map((set) => [set.set, set.created]), [["public.aa_children", 2], ["public.accounts", 3], ["public.events", 3], ["public.memberships", 3], ["public.things", 3], ["public.words", 9]])
    const back = await exportOf(b)
    assert.equal(back.manifest.exportDigest, out.manifest.exportDigest)
    const typed = (await b.pool.query("SELECT blob = '\\x00ff10'::bytea AS blob, big = 9223372036854775807 AS big, balance = 12345678901234567890.1234567890 AS balance, doc = '{\"b\": 1.5, \"a\": [1, 2, {\"x\": null}], \"big\": 12345678901234567890123}'::jsonb AS doc, span = interval '1 day 2 hours 3.5 seconds' AS span, tags = ARRAY['a', 'b,c', NULL, 'd\"e'] AS tags, total = balance * 2 AS total FROM accounts WHERE id = 1")).rows[0] as Record<string, boolean>
    assert.deepEqual(typed, { blob: true, big: true, balance: true, doc: true, span: true, tags: true, total: true })
    assert.equal(await scalar(b.pool, "SELECT count(*)::int AS n FROM events_2027"), 1)
    assert.equal(await scalar(b.pool, "SELECT count(*)::int AS n FROM no_key"), 0)
    assert.equal(await scalar(b.pool, "SELECT count(*)::int AS n FROM jobs"), 0)
    const again = await restoreFrom(out, [store(b)], { dryRun: false, mode: "merge" })
    assert.equal(again[0]?.outcome, "unchanged")
})

withServer("a sequence is set after an import, so the next row takes the next number; an identity column too", async (srv) => {
    const a = await scratch(srv, true)
    const b = await scratch(srv, false)
    await restoreFrom(await exportOf(a), [store(b)], { dryRun: false, mode: "merge" })
    assert.equal(await scalar(b.pool, "INSERT INTO things (label) VALUES ('four') RETURNING id"), 4)
    assert.equal(await scalar(b.pool, "INSERT INTO accounts (name) VALUES ('next') RETURNING id"), 4)
})

withServer("a mirror deletes what the copy lacks, an update keeps the row, and a foreign key does not fire mid-restore", async (srv) => {
    const a = await scratch(srv, true)
    const b = await scratch(srv, false)
    await restoreFrom(await exportOf(a), [store(b)], { dryRun: false, mode: "merge" })
    await a.pool.query("DELETE FROM aa_children WHERE id = 2")
    await a.pool.query("DELETE FROM words WHERE word = 'a b'")
    await a.pool.query("UPDATE memberships SET role = 'admin' WHERE org = 'acme' AND \"user\" = 'amy'")
    const next = await exportOf(a)
    const report = (await restoreFrom(next, [store(b)], { dryRun: false, mode: "mirror" }))[0]
    assert.deepEqual(report?.sets.map((set) => [set.set, set.updated, set.removed]), [["public.aa_children", 0, 1], ["public.accounts", 0, 0], ["public.events", 0, 0], ["public.memberships", 1, 0], ["public.things", 0, 0], ["public.words", 0, 1]])
    assert.equal((await exportOf(b)).manifest.exportDigest, next.manifest.exportDigest)
    const orphans = await keysOf(await exportOf(a))
    const c = await scratch(srv, false)
    const child = (async function* () {
        await Promise.resolve()
        yield* orphans.filter((entry) => entry.set === "public.aa_children")
    })()
    const orphan = await store(c).import(child, { dryRun: false, mode: "merge" })
    assert.equal(orphan.outcome, "applied")
    assert.equal(await scalar(c.pool, "SELECT count(*)::int FROM aa_children"), 1)
    assert.equal(await scalar(c.pool, "SELECT count(*)::int FROM accounts"), 0)
})

withServer("a dry run counts what would change and writes nothing, and moves no sequence", async (srv) => {
    const a = await scratch(srv, true)
    const b = await scratch(srv, false)
    const out = await exportOf(a)
    const dry = (await restoreFrom(out, [store(b)], { dryRun: true, mode: "mirror" }))[0]
    assert.ok(dry !== undefined)
    assert.equal(dry.outcome, "applied")
    assert.equal(dry.sets.find((set) => set.set === "public.words")?.created, 9)
    assert.equal((await exportOf(b)).manifest.sets.length, 0)
    assert.equal(await scalar(b.pool, "INSERT INTO things (label) VALUES ('first') RETURNING id"), 1)
})

withServer("a role without the owner right cannot import: a refusal with the SQLSTATE, and nothing written", async (srv) => {
    const a = await scratch(srv, true)
    const b = await scratch(srv, false)
    const role = `seed_reader_${suffix}`
    await srv.admin.query(`CREATE ROLE ${role} LOGIN PASSWORD 'x${suffix}'`)
    roles.push(role)
    await b.pool.query(`GRANT ALL ON ALL TABLES IN SCHEMA public TO ${role}`)
    const url = new URL(srv.urlFor(String(await scalar(b.pool, "SELECT current_database()"))))
    url.username = role
    url.password = `x${suffix}`
    const limited = new pg.Pool({ connectionString: url.toString(), max: 2 })
    cleanups.push(() => limited.end())
    const target = postgresStore({ id: "database", run: runnerOver(limited), pageRows: 2 })
    await assert.rejects(restoreFrom(await exportOf(a), [target], { dryRun: false, mode: "merge" }), (error: unknown) => {
        const refusal = error as { code?: string; params?: Record<string, string> }
        return refusal.code === "DATA_STORE_FAILED" && refusal.params?.cause === "error 42501"
    })
    assert.equal(await scalar(b.pool, "SELECT count(*)::int AS n FROM words"), 0)
})
