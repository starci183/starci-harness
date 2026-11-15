import "reflect-metadata"
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { spawnSync } from "node:child_process"
import { after, describe, test } from "node:test"
import { DomainError } from "@starci/common"
import pg from "pg"
import { DataSource } from "typeorm"
import { defer } from "./contracts.ts"
import type { ClaimedJob, Clock, JobContext, JobHandler, OutboxOptions, ParkedJob } from "./contracts.ts"
import { Outbox } from "./outbox.ts"
import { pgDatabase, run } from "./sql.ts"
import type { OutboxDatabase } from "./sql.ts"
import { outboxDdl } from "./tables.ts"
import type { OutboxTables } from "./tables.ts"

/* ---------------------------------------------------------------------------------------------------------------
 * A REAL PostgreSQL. The server is, in this order:
 *   1. the one STARCI_OUTBOX_PG_URL names (a throwaway server: the spec creates and drops its own scratch databases);
 *   2. a Docker container of the image pinned in contexts/stack/pins.yaml (`postgres` 17.11, by digest), started on a
 *      random loopback port with a random password and removed after the run, when `docker info` answers;
 *   3. neither: every test below is skipped with that reason.
 * ---------------------------------------------------------------------------------------------------------------- */

const PG_IMAGE = "postgres@sha256:31ba9c94a03ada9988f2bb493a22a75eef3a185884533e5cdbcd498ea835b08f"
const TERMINATED = "57P01"

const cleanups: (() => Promise<void> | void)[] = []
const strayErrors: string[] = []
after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup()
    assert.deepEqual(strayErrors, [], "no idle connection failed for another reason")
})

const poolOf = (connectionString: string, max: number): pg.Pool => {
    const pool = new pg.Pool({ connectionString, max })
    pool.on("error", (error: Error & { code?: string }) => {
        if (error.code !== TERMINATED) strayErrors.push(error.code ?? error.name)
    })
    return pool
}

/** The column `n` of the first row a statement answers. */
const scalar = async (pool: pg.Pool, sql: string, params: unknown[] = []): Promise<unknown> => (await run(pool, sql, params))[0]?.n

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const waitFor = async (url: string): Promise<pg.Pool> => {
    const pool = poolOf(url, 4)
    for (let attempt = 0; attempt < 90; attempt += 1) {
        try {
            await pool.query("SELECT 1")
            return pool
        } catch {
            await pause(1000)
        }
    }
    await pool.end()
    throw new Error("the PostgreSQL server did not answer in time")
}

interface Server {
    readonly admin: pg.Pool
    readonly urlFor: (database: string) => string
}

const startServer = async (): Promise<{ server: Server } | { skip: string }> => {
    const given = process.env.STARCI_OUTBOX_PG_URL
    if (given !== undefined && given !== "") {
        const admin = await waitFor(given)
        cleanups.push(() => admin.end())
        return {
            server: {
                admin,
                urlFor: (database) => {
                    const next = new URL(given)
                    next.pathname = `/${database}`
                    return next.toString()
                },
            },
        }
    }
    if (spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0) return { skip: "no STARCI_OUTBOX_PG_URL and Docker does not answer" }
    const password = randomBytes(12).toString("hex")
    const started = spawnSync("docker", ["run", "-d", "--rm", "-p", "127.0.0.1::5432", "-e", `POSTGRES_PASSWORD=${password}`, PG_IMAGE, "-c", "max_connections=300"], {
        encoding: "utf8",
    })
    if (started.status !== 0) return { skip: "Docker could not start the pinned postgres image" }
    const container = started.stdout.trim()
    cleanups.push(() => {
        spawnSync("docker", ["rm", "-f", container], { stdio: "ignore" })
    })
    const mapping = /:(\d+)\s*$/mu.exec(spawnSync("docker", ["port", container, "5432/tcp"], { encoding: "utf8" }).stdout)
    assert.ok(mapping?.[1] !== undefined, "docker port answered no mapping")
    const base = `postgres://postgres:${password}@127.0.0.1:${mapping[1]}`
    const admin = await waitFor(`${base}/postgres`)
    await pause(1500)
    await admin.query("SELECT 1")
    cleanups.push(() => admin.end())
    return { server: { admin, urlFor: (database) => `${base}/${database}` } }
}

const started = await startServer()
const skip = "skip" in started ? started.skip : false
const server = (): Server => {
    if ("skip" in started) throw new Error(started.skip)
    return started.server
}

/* ---------------------------------------------------------------------------------------------------------------
 * One scratch database per test, holding the outbox tables and an `effects` table a handler writes in its transaction.
 * ---------------------------------------------------------------------------------------------------------------- */

interface Lab {
    readonly url: string
    readonly pool: pg.Pool
    readonly db: OutboxDatabase
    readonly clock: ManualClock
    readonly errors: string[]
    readonly parked: ParkedJob[]
    readonly outbox: (options?: Partial<OutboxOptions>) => Outbox
    readonly effects: () => Promise<readonly { readonly job: string; readonly fence: number }[]>
    readonly state: (id: string) => Promise<Readonly<Record<string, unknown>>>
}

class ManualClock implements Clock {
    current = new Date("2026-11-16T10:00:00.000Z")
    now(): Date {
        return new Date(this.current.getTime())
    }
    advance(ms: number): void {
        this.current = new Date(this.current.getTime() + ms)
    }
}

const lab = async (tables: OutboxTables = {}, poolSize = 8): Promise<Lab> => {
    const name = `outbox_${randomBytes(6).toString("hex")}`
    await server().admin.query(`CREATE DATABASE ${name}`)
    const url = server().urlFor(name)
    const pool = poolOf(url, poolSize)
    cleanups.push(async () => {
        await pool.end()
        await server().admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
    })
    await pool.query(outboxDdl(tables))
    await pool.query("CREATE TABLE effects (job_id uuid NOT NULL, fence bigint NOT NULL, note text)")
    const db = pgDatabase(pool)
    const clock = new ManualClock()
    const errors: string[] = []
    const parked: ParkedJob[] = []
    return {
        url,
        pool,
        db,
        clock,
        errors,
        parked,
        outbox: (options = {}) =>
            new Outbox({
                ...tables,
                database: db,
                clock,
                onError: (event, cause) => {
                    errors.push(`${event}: ${String(cause)}`)
                },
                onParked: (job) => {
                    parked.push(job)
                    return Promise.resolve()
                },
                ...options,
            }),
        effects: async () =>
            (await pool.query<{ job_id: string; fence: string }>("SELECT job_id::text, fence::text FROM effects ORDER BY job_id")).rows.map((row) => ({
                job: row.job_id,
                fence: Number(row.fence),
            })),
        state: async (id) => {
            const row = (await pool.query<Record<string, unknown>>(`SELECT * FROM ${tables.jobs ?? "outbox_jobs"} WHERE id = $1`, [id])).rows[0]
            assert.ok(row !== undefined, `job ${id}`)
            return row
        },
    }
}

/** A handler that writes one effect row in the job's transaction, then does what `then` says. */
const recorder = (name: string, then: (job: ClaimedJob, context: JobContext) => Promise<unknown> = () => Promise.resolve()): JobHandler => ({
    name,
    handle: async (job, context) => {
        await context.tx.query("INSERT INTO effects (job_id, fence) VALUES ($1, $2)", [job.id, job.fence])
        return then(job, context)
    },
})

const enqueueOne = async (outbox: Outbox, pool: pg.Pool, job: { scope?: string | null; queue?: string; name: string; key: string; notBefore?: Date }): Promise<string> => {
    const answer = await outbox.enqueue(pool, {
        scope: job.scope ?? null,
        queue: job.queue ?? "work",
        name: job.name,
        payload: { key: job.key },
        onceKey: `test:${job.key}`,
        notBefore: job.notBefore,
    })
    assert.ok(answer.id !== null)
    return answer.id
}

class TransientError extends Error {
    readonly failureClass = "transient"
}

class RefusedError extends DomainError<"APP_REFUSED"> {}

/* ---------------------------------------------------------------------------------------------------------------- */

describe("the outbox on real Postgres", { skip }, () => {
    test("enqueue: the job exists exactly when the caller's transaction commits, and once per once key", async () => {
        const { pool, outbox } = await lab()
        const box = outbox()
        const client = await pool.connect()
        await client.query("BEGIN")
        const first = await box.enqueue(client, { scope: "s1", queue: "work", name: "w", payload: { a: 1 }, onceKey: "w:1" })
        await client.query("ROLLBACK")
        client.release()
        assert.equal(first.created, true)
        assert.equal(await scalar(pool, "SELECT count(*)::int AS n FROM outbox_jobs"), 0, "a rolled-back enqueue leaves nothing")

        const created = await box.enqueue(pool, { scope: "s1", queue: "work", name: "w", payload: { a: 1 }, onceKey: "w:1" })
        const again = await box.enqueue(pool, { scope: "s1", queue: "work", name: "w", payload: { a: 2 }, onceKey: "w:1" })
        assert.deepEqual(again, { id: created.id, created: false })
        await assert.rejects(box.enqueue(pool, { scope: null, queue: "work", name: "w", payload: {}, onceKey: "nokey" }), { code: "OUTBOX_JOB_INVALID" })
    })

    test("drain: the handler's writes, its chained job and the done mark commit together; a failure rolls them back", async () => {
        const { pool, outbox, effects, state } = await lab()
        const box = outbox()
        box.handle(
            recorder("first", async (job, context) => {
                await context.enqueue({ scope: job.scope, queue: "work", name: "second", payload: {}, onceKey: `second:${job.id}` })
                assert.equal(context.effectKey("mail"), `${job.id}:mail`)
            }),
        )
        box.handle(recorder("second"))
        box.handle(
            recorder("broken", () => {
                throw new RefusedError({ code: "APP_REFUSED" })
            }),
        )
        const id = await enqueueOne(box, pool, { name: "first", key: "1", scope: "s" })
        const broken = await enqueueOne(box, pool, { name: "broken", key: "2", scope: "s" })
        const report = await box.drain()
        assert.deepEqual(report, { done: 2, deferred: 0, retried: 0, parked: 1, lost: 0, timersFired: 0 })
        assert.equal((await state(id)).state, "done")
        const rows = await effects()
        assert.equal(rows.length, 2, "first and second wrote; broken's write rolled back")
        assert.equal(rows.some((row) => row.job === broken), false)
        const parked = await state(broken)
        assert.equal(parked.state, "parked")
        assert.equal(parked.failure_class, "input")
        assert.equal(parked.park_reason, "class")
        assert.match(String(parked.last_error), /RefusedError APP_REFUSED/u)
        assert.equal(await scalar(pool, "SELECT count(*)::int AS n FROM outbox_slots WHERE job_id IS NOT NULL"), 0, "every slot is free")
    })

    test("TypeORM: a DataSource is the outbox database and its EntityManager the caller's transaction", async () => {
        const { url, pool, clock } = await lab()
        const source = new DataSource({ type: "postgres", url, poolSize: 4 })
        await source.initialize()
        cleanups.push(() => source.destroy())
        const box = new Outbox({ database: source, clock })
        box.handle({
            name: "orm",
            handle: async (job, context) => {
                await context.tx.query("INSERT INTO effects (job_id, fence) VALUES ($1, $2)", [job.id, job.fence])
            },
        })
        const enqueued = await source.transaction((manager) => box.enqueue(manager, { scope: "org", queue: "work", name: "orm", payload: {}, onceKey: "orm:1" }))
        assert.equal(enqueued.created, true)
        assert.equal((await box.drain()).done, 1)
        assert.equal(await scalar(pool, "SELECT state AS n FROM outbox_jobs WHERE id = $1", [enqueued.id]), "done")
    })

    test("the ladder: a transient failure retries after each pause, parks when spent, alerts once per episode", async () => {
        const { pool, clock, outbox, state, parked } = await lab()
        const box = outbox({ resumeSweepMs: 60_000, autoResumes: 1 })
        let calls = 0
        box.handle({
            name: "flaky",
            handle: () => {
                calls += 1
                throw new TransientError("the peer is busy")
            },
        })
        const id = await enqueueOne(box, pool, { name: "flaky", key: "f", scope: "s" })
        assert.equal((await box.drain()).retried, 1)
        assert.equal((await box.drain()).retried, 0, "not due before the pause")
        for (const pauseSeconds of [5, 10]) {
            clock.advance(pauseSeconds * 1000)
            assert.equal((await box.drain()).retried, 1)
        }
        clock.advance(20_000)
        assert.equal((await box.drain()).parked, 1)
        assert.equal(calls, 4)
        let row = await state(id)
        assert.deepEqual([row.state, row.park_reason, row.failure_class, row.attempts], ["parked", "exhausted", "transient", 4])
        assert.equal(parked.length, 1)
        assert.equal(parked[0]?.why, "exhausted")

        assert.equal(await box.resumeTransient(), 0, "a dead letter waits one sweep before the machine hands it back")
        clock.advance(60_000)
        assert.equal(await box.resumeTransient(), 1)
        clock.advance(35_000 * 4)
        for (let start = 0; start < 4; start += 1) {
            await box.drain()
            clock.advance(20_000)
        }
        row = await state(id)
        assert.deepEqual([row.state, row.resume_count], ["parked", 1])
        assert.equal(parked.length, 1, "the machine's hand-back keeps the episode: no second alert")
        clock.advance(60_000)
        assert.equal(await box.resumeTransient(), 0, "the sweep's hand-backs are bounded")

        assert.equal(await box.resume(id, "person"), true)
        assert.equal(await box.resume(id, "person"), false, "only a parked job resumes")
        for (let start = 0; start < 4; start += 1) {
            await box.drain()
            clock.advance(20_000)
        }
        assert.equal(parked.length, 2, "a person's resume opens a new episode, which alerts again")
        const listed = await box.parked({ scope: "s" })
        assert.deepEqual(listed.map((job) => [job.id, job.resumeCount]), [[id, 2]])
        assert.equal(await box.close(id, "not needed"), true)
        assert.equal((await state(id)).state, "closed")
        assert.equal(await box.close(id, "again"), false)
    })

    test("classes: a missing handler is code, a refused payload is input, a plain throw is code, all parked at once", async () => {
        const { pool, outbox, state } = await lab()
        const box = outbox()
        box.handle({ name: "guarded", accepts: (payload): payload is { key: "ok" } => (payload as { key?: unknown }).key === "ok", handle: () => Promise.resolve() })
        box.handle({
            name: "bug",
            handle: () => {
                throw new TypeError("undefined is not a function")
            },
        })
        const missing = await enqueueOne(box, pool, { name: "nobody", key: "m" })
        const refused = await enqueueOne(box, pool, { name: "guarded", key: "bad" })
        const accepted = await enqueueOne(box, pool, { name: "guarded", key: "ok" })
        const bug = await enqueueOne(box, pool, { name: "bug", key: "b" })
        await box.drain()
        assert.deepEqual([(await state(missing)).failure_class, (await state(missing)).last_error], ["code", "OutboxError OUTBOX_HANDLER_MISSING"])
        assert.equal((await state(refused)).failure_class, "input")
        assert.equal((await state(accepted)).state, "done")
        assert.deepEqual([(await state(bug)).failure_class, (await state(bug)).last_error], ["code", "TypeError: undefined is not a function"])
    })

    test("defer: the job comes back later with its writes kept and its start not spent", async () => {
        const { pool, clock, outbox, state, effects } = await lab()
        const box = outbox()
        let calls = 0
        box.handle(
            recorder("waits", () => {
                calls += 1
                return Promise.resolve(calls < 3 ? defer(30) : undefined)
            }),
        )
        const id = await enqueueOne(box, pool, { name: "waits", key: "d", scope: "s" })
        assert.equal((await box.drain()).deferred, 1)
        assert.deepEqual([(await state(id)).state, (await state(id)).attempts], ["queued", 0])
        clock.advance(30_000)
        await box.drain()
        clock.advance(30_000)
        assert.equal((await box.drain()).done, 1)
        assert.equal((await effects()).length, 3)
        assert.equal((await state(id)).attempts, 1)
    })

    test("the fence: an expired lease is claimed again with a bumped fence, and the stale worker commits nothing", async () => {
        const { pool, clock, outbox, state, effects } = await lab()
        const stale = outbox({ leaseMs: 10_000, workerId: "stale" })
        const fresh = outbox({ leaseMs: 10_000, workerId: "fresh" })
        for (const box of [stale, fresh]) box.handle(recorder("job"))
        const id = await enqueueOne(stale, pool, { name: "job", key: "x", scope: "s" })
        const [held] = await stale.claim()
        assert.ok(held !== undefined)
        assert.deepEqual([held.fence, held.attempt], [1, 1])
        assert.deepEqual(await fresh.claim(), [], "a live lease is not claimable")
        clock.advance(10_001)
        const [taken] = await fresh.claim()
        assert.deepEqual([taken?.fence, taken?.attempt], [2, 2])
        assert.ok(taken !== undefined)
        assert.equal(await fresh.run(taken), "done")
        assert.equal(await stale.run(held), "lost", "the done mark names a fence the row no longer holds")
        assert.deepEqual(await effects(), [{ job: id, fence: 2 }], "the stale handler's write rolled back with its mark")
        assert.equal((await state(id)).claimed_by, null)
    })

    test("renewal: the lease is renewed while the handler runs, and a lost fence aborts it; a failing alert hook is reported", async () => {
        const { pool, clock, outbox, state, errors } = await lab()
        const pending: (() => void)[] = []
        const box = outbox({
            leaseMs: 9000,
            schedule: (work) => {
                pending.push(work)
                return () => undefined
            },
            onParked: () => Promise.reject(new Error("chat is down")),
        })
        let aborted = false
        box.handle({
            name: "long",
            handle: (_job, context) =>
                new Promise((_resolve, reject) => {
                    context.signal.addEventListener("abort", () => {
                        aborted = true
                        reject(new TransientError("stopped"))
                    })
                }),
        })
        box.handle({
            name: "dead",
            handle: () => {
                throw new RefusedError({ code: "APP_REFUSED" })
            },
        })
        const id = await enqueueOne(box, pool, { name: "long", key: "r", scope: "s" })
        const [job] = await box.claim()
        assert.ok(job !== undefined)
        const result = box.run(job)
        for (let wait = 0; wait < 100 && pending.length === 0; wait += 1) await pause(5)
        clock.advance(5000)
        pending.shift()?.()
        const renewed = clock.current.getTime() + 9000
        for (let wait = 0; wait < 100 && pending.length === 0; wait += 1) await pause(5)
        assert.equal(((await state(id)).lease_until as Date).getTime(), renewed)
        assert.equal(((await run(pool, "SELECT lease_until FROM outbox_slots WHERE job_id = $1", [id]))[0]?.lease_until as Date).getTime(), renewed)
        await pool.query("UPDATE outbox_jobs SET fence = fence + 1 WHERE id = $1", [id])
        pending.shift()?.()
        assert.equal(await result, "lost")
        assert.equal(aborted, true)
        await enqueueOne(box, pool, { name: "dead", key: "d" })
        assert.equal((await box.drain()).parked, 1)
        assert.deepEqual(errors, ["parked-hook: Error: chat is down"])
    })

    test("a crash loop: a job whose every start died is parked past its ladder without running", async () => {
        const { pool, clock, outbox, state, effects } = await lab()
        const box = outbox({ leaseMs: 1000 })
        box.handle(recorder("crash"))
        const id = await enqueueOne(box, pool, { name: "crash", key: "c", scope: "s" })
        let last: ClaimedJob | undefined
        for (let start = 0; start < 5; start += 1) {
            ;[last] = await box.claim()
            clock.advance(1001)
        }
        assert.ok(last !== undefined)
        assert.equal(last.attempt, 5)
        clock.current = new Date(clock.current.getTime() - 1001)
        assert.equal(await box.run(last), "parked")
        assert.deepEqual([(await state(id)).park_reason, (await effects()).length], ["exhausted", 0])
    })

    test("scheduled starts and timers: not before their time, a re-arm moves, a cancel stops, a sweep fires once", async () => {
        const { pool, clock, outbox, state } = await lab()
        const box = outbox()
        const fired: unknown[] = []
        box.handle({
            name: "timer.fired",
            handle: (job) => {
                fired.push(job.payload)
                return Promise.resolve()
            },
        })
        box.handle(recorder("later"))
        const later = await enqueueOne(box, pool, { name: "later", key: "l", notBefore: new Date(clock.current.getTime() + 60_000) })
        await box.armTimer(pool, { scope: "s", key: "remind:1", dueAt: new Date(clock.current.getTime() + 10_000), payload: { n: 1 } })
        await box.armTimer(pool, { scope: "s", key: "remind:1", dueAt: new Date(clock.current.getTime() + 20_000), payload: { n: 2 } })
        await box.armTimer(pool, { scope: "s", key: "gone:1", dueAt: clock.current, payload: {} })
        await box.armTimer(pool, { scope: "s", key: "gone:2", dueAt: clock.current, payload: {} })
        await box.armTimer(pool, { scope: null, key: "gone:3", dueAt: clock.current, payload: {} })
        assert.equal(await box.cancelTimer(pool, "s", "gone:1"), true)
        assert.equal(await box.cancelTimersByPrefix(pool, "s", "gone:"), 1)
        assert.equal(await box.cancelTimer(pool, null, "gone:3"), true)
        assert.deepEqual(await box.drain(), { done: 0, deferred: 0, retried: 0, parked: 0, lost: 0, timersFired: 0 })
        clock.advance(10_000)
        assert.equal((await box.drain()).timersFired, 0, "the re-arm moved the timer")
        clock.advance(10_000)
        const report = await box.drain()
        assert.deepEqual([report.timersFired, report.done], [1, 1])
        assert.equal(fired.length, 1)
        assert.deepEqual((fired[0] as { data: unknown }).data, { n: 2 })
        assert.equal((await state(later)).state, "queued")
        clock.advance(40_000)
        assert.equal((await box.drain()).done, 1)
        assert.equal((await box.drain()).timersFired, 0, "a timer fires once")
    })

    test("fairness: one busy scope cannot fill a claim, and each scope holds at most its slots", async () => {
        const { pool, outbox } = await lab()
        const box = outbox({ defaultConcurrency: 2, batch: 10, queueConcurrency: { solo: 1 } })
        for (let n = 0; n < 50; n += 1) await enqueueOne(box, pool, { name: "x", key: `big:${String(n)}`, scope: "big" })
        for (const scope of ["a", "b", "c", "d"]) for (let n = 0; n < 3; n += 1) await enqueueOne(box, pool, { name: "x", key: `${scope}:${String(n)}`, scope })
        for (let n = 0; n < 3; n += 1) await enqueueOne(box, pool, { name: "x", key: `solo:${String(n)}`, scope: "a", queue: "solo" })
        const first = await box.claim()
        const byScope = (jobs: readonly ClaimedJob[]): Record<string, number> => {
            const counts: Record<string, number> = {}
            for (const job of jobs) counts[`${job.queue}/${String(job.scope)}`] = (counts[`${job.queue}/${String(job.scope)}`] ?? 0) + 1
            return counts
        }
        assert.deepEqual(byScope(first), { "solo/a": 1, "work/a": 2, "work/b": 2, "work/big": 2, "work/c": 2, "work/d": 1 })
        const second = await box.claim()
        assert.deepEqual(byScope(second), { "work/d": 1 }, "only the slot left free is taken while the first claims run")
        const total = await scalar(pool, "SELECT count(*)::int AS n FROM outbox_slots WHERE job_id IS NOT NULL")
        assert.equal(total, 11)
    })

    test("concurrency: 6 workers x 12 scopes x 20 jobs, through the loop: no deadlock, no double run, no scope over its slots", async () => {
        const WORKERS = 6
        const SCOPES = 12
        const JOBS = 20
        const LIMIT = 3
        const { pool, url, errors } = await lab({}, 4)
        const inFlight = new Map<string, number>()
        let overLimit = 0
        const handler: JobHandler = {
            name: "work",
            handle: async (job, context) => {
                const scope = String(job.scope)
                const now = (inFlight.get(scope) ?? 0) + 1
                inFlight.set(scope, now)
                if (now > LIMIT) overLimit += 1
                try {
                    await context.tx.query("INSERT INTO effects (job_id, fence) VALUES ($1, $2)", [job.id, job.fence])
                    await pause(Math.floor(Math.random() * 4))
                } finally {
                    inFlight.set(scope, (inFlight.get(scope) ?? 1) - 1)
                }
            },
        }
        const seed = new Outbox({ database: pgDatabase(pool) })
        for (let n = 0; n < JOBS; n += 1) {
            for (let s = 0; s < SCOPES; s += 1) await enqueueOne(seed, pool, { name: "work", key: `${String(s)}:${String(n)}`, scope: `scope-${String(s).padStart(2, "0")}` })
        }
        const workers = Array.from({ length: WORKERS }, (_, index) => {
            const own = poolOf(url, 4)
            cleanups.push(() => own.end())
            const box = new Outbox({
                database: pgDatabase(own),
                workerId: `w${String(index)}`,
                pollMs: 5,
                batch: 8,
                defaultConcurrency: LIMIT,
                onError: (event, cause) => {
                    errors.push(`${event}: ${cause instanceof Error ? `${cause.message} ${String(Reflect.get(cause, "code"))}` : String(cause)}`)
                },
            })
            box.handle(handler)
            return box
        })
        for (const box of workers) box.start()
        const deadline = Date.now() + 120_000
        for (;;) {
            const left = await scalar(pool, "SELECT count(*)::int AS n FROM outbox_jobs WHERE state <> 'done'")
            if (left === 0 || Date.now() > deadline) break
            await pause(50)
        }
        await Promise.all(workers.map((box) => box.stop(1000)))
        assert.deepEqual(errors, [], "no worker failed: no deadlock (40P01), no lost settle")
        const rows = (await pool.query("SELECT job_id, count(*)::int AS n FROM effects GROUP BY job_id")).rows as { n: number }[]
        assert.equal(rows.length, SCOPES * JOBS, "every job ran")
        assert.equal(rows.filter((row) => row.n !== 1).length, 0, "no job ran twice")
        assert.equal(overLimit, 0, `no scope ran more than ${String(LIMIT)} at once`)
        assert.deepEqual(
            [await scalar(pool, "SELECT max(fence)::int AS n FROM outbox_jobs"), await scalar(pool, "SELECT max(attempts)::int AS n FROM outbox_jobs")],
            [1, 1],
            "every job was claimed once",
        )
    })

    test("claim storm: 8 claimers over interleaved scopes, 60 rounds, never deadlock and never claim a row twice", async () => {
        const { pool, url } = await lab({}, 4)
        const seed = new Outbox({ database: pgDatabase(pool) })
        for (let n = 0; n < 40; n += 1) for (let s = 0; s < 12; s += 1) await enqueueOne(seed, pool, { name: "w", key: `${String(s)}:${String(n)}`, scope: `s${String(s)}` })
        const claimers = Array.from({ length: 8 }, () => {
            const own = poolOf(url, 2)
            cleanups.push(() => own.end())
            return new Outbox({ database: pgDatabase(own), batch: 20, defaultConcurrency: 2 })
        })
        const seen = new Set<string>()
        let twice = 0
        for (let round = 0; round < 60; round += 1) {
            const claims = await Promise.all(claimers.map((box) => box.claim()))
            for (const job of claims.flat()) {
                if (seen.has(`${job.id}:${String(job.fence)}`)) twice += 1
                seen.add(`${job.id}:${String(job.fence)}`)
            }
            await pool.query("WITH j AS (UPDATE outbox_jobs SET state = 'done' WHERE state = 'running' RETURNING id) UPDATE outbox_slots SET job_id = NULL WHERE job_id IN (SELECT id FROM j)")
        }
        assert.equal(twice, 0)
        assert.equal(seen.size, 480)
    })

    test("graceful stop: running jobs get the grace, then go back to the queue with their start not spent", async () => {
        const { pool, outbox, state, effects } = await lab()
        const box = outbox({ pollMs: 5, clock: { now: () => new Date() } })
        let started = 0
        box.handle(
            recorder("slow", async (_job, context) => {
                started += 1
                await new Promise<void>((resolve) => {
                    context.signal.addEventListener("abort", () => {
                        resolve()
                    })
                })
                throw new Error("aborted")
            }),
        )
        box.handle(recorder("quick"))
        const slow = await enqueueOne(box, pool, { name: "slow", key: "s", scope: "s" })
        const quick = await enqueueOne(box, pool, { name: "quick", key: "q", scope: "s" })
        box.start()
        box.start()
        for (let wait = 0; wait < 200 && (started === 0 || (await state(quick)).state !== "done"); wait += 1) await pause(10)
        assert.equal(box.busy, 1)
        await box.stop(50)
        const row = await state(slow)
        assert.deepEqual([row.state, row.attempts, row.lease_until], ["queued", 0, null])
        assert.equal((await effects()).filter((effect) => effect.job === slow).length, 0)
    })

    test("a new build hands back what an older build parked; purge, stats, custom names and a uuid scope", async () => {
        const tables: OutboxTables = { schema: "jobs", jobs: "queue_rows", slots: "queue_slots", timers: "queue_timers", scopeType: "uuid" }
        const name = `outbox_${randomBytes(6).toString("hex")}`
        await server().admin.query(`CREATE DATABASE ${name}`)
        const pool = poolOf(server().urlFor(name), 4)
        cleanups.push(async () => {
            await pool.end()
            await server().admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
        })
        await pool.query("CREATE SCHEMA jobs")
        await pool.query(outboxDdl(tables))
        const clock = new ManualClock()
        const old = new Outbox({ ...tables, database: pgDatabase(pool), clock, buildId: "b1" })
        old.handle({
            name: "n",
            handle: () => {
                throw new RefusedError({ code: "APP_REFUSED" })
            },
        })
        const scope = "4f8f1f0e-6f43-4b8a-9b55-6a3c3c0f0a01"
        const id = await enqueueOne(old, pool, { name: "n", key: "u", scope })
        await old.drain()
        assert.equal((await run(pool, "SELECT state, parked_build FROM jobs.queue_rows"))[0]?.parked_build, "b1")
        const next = new Outbox({ ...tables, database: pgDatabase(pool), clock, buildId: "b2", pollMs: 60_000, timerSweepMs: 60_000 })
        next.handle({ name: "n", handle: () => Promise.resolve() })
        next.start()
        for (let wait = 0; wait < 100 && (await run(pool, "SELECT state FROM jobs.queue_rows"))[0]?.state !== "done"; wait += 1) await pause(20)
        await next.stop(10)
        assert.equal((await run(pool, "SELECT state, resume_count FROM jobs.queue_rows"))[0]?.state, "done")
        assert.deepEqual(await next.stats(), [{ queue: "work", state: "done", count: 1 }])
        clock.advance(1000)
        assert.equal(await next.purge(clock.now()), 1)
        assert.equal(id.length, 36)
    })
})
