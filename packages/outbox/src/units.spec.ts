import "reflect-metadata"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { Module } from "@nestjs/common"
import type { OnModuleInit } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import { DomainError } from "@starci/common"
import { classifyFailure } from "@starci/nest-kit"
import { deferralOf, defer } from "./contracts.ts"
import type { Schedule } from "./contracts.ts"
import { OutboxError, OutboxErrorCode } from "./errors.ts"
import { DEFAULT_LADDERS, isPastLadder, ladderVerdictOf } from "./ladders.ts"
import { OUTBOX, Outbox, OutboxModule, outboxDdl, pgDatabase, reasonOf, resolveTables, rowsOf } from "./index.ts"
import type { OutboxDatabase, PgClientLike, Queryable } from "./index.ts"

/** A database that answers no rows: enough for everything that never reaches Postgres. */
const emptyDatabase = (): OutboxDatabase & { readonly statements: string[] } => {
    const statements: string[] = []
    const query = (sql: string): Promise<unknown> => {
        statements.push(sql)
        return Promise.resolve({ rows: [] })
    }
    return { statements, query, transaction: (work) => work({ query }) }
}

describe("tables and DDL", () => {
    it("names the defaults, refuses an identifier that is not plain, and grants to a role", () => {
        assert.equal(resolveTables().jobs, '"public"."outbox_jobs"')
        assert.throws(() => resolveTables({ jobs: "Jobs; drop" }), { code: OutboxErrorCode.OptionsInvalid })
        assert.throws(() => resolveTables({ scopeType: "int" as "text" }), { code: OutboxErrorCode.OptionsInvalid })
        assert.match(outboxDdl({ grantTo: "app_be", scopeType: "uuid" }), /grant select, insert, update, delete on table .* to "app_be";/u)
        assert.match(outboxDdl({ scopeType: "uuid" }), /scope uuid not null/u)
        assert.throws(() => outboxDdl({ grantTo: "x y" }), { code: OutboxErrorCode.OptionsInvalid })
    })

    it("ships migrations/outbox.sql as the default rendering, the file an app copies into its migrations", () => {
        assert.equal(readFileSync(new URL("../migrations/outbox.sql", import.meta.url), "utf8"), outboxDdl())
    })
})

describe("rows of any driver", () => {
    it("reads pg's { rows }, TypeORM's rows and TypeORM's [rows, affected]", () => {
        assert.deepEqual(rowsOf({ rows: [{ n: 1 }] }), [{ n: 1 }])
        assert.deepEqual(rowsOf([{ n: 1 }, { n: 2 }]), [{ n: 1 }, { n: 2 }])
        assert.deepEqual(rowsOf([[{ n: 1 }], 1]), [{ n: 1 }])
        assert.deepEqual(rowsOf(undefined), [])
        assert.deepEqual(rowsOf({ command: "BEGIN" }), [])
    })

    it("pgDatabase commits, rolls back with the same error, and destroys a client whose rollback failed", async () => {
        const log: string[] = []
        const client = (failRollback: boolean): PgClientLike => ({
            query: (sql: string) => {
                log.push(sql)
                return sql === "ROLLBACK" && failRollback ? Promise.reject(new Error("socket closed")) : Promise.resolve({ rows: [] })
            },
            release: (destroy?: boolean | Error) => {
                log.push(destroy === undefined ? "release" : "destroy")
            },
        })
        let failRollback = false
        const database = pgDatabase({ query: () => Promise.resolve({ rows: [{ n: 1 }] }), connect: () => Promise.resolve(client(failRollback)) })
        assert.equal(await database.transaction(() => Promise.resolve(7)), 7)
        await assert.rejects(database.transaction(() => Promise.reject(new Error("boom"))), /boom/u)
        failRollback = true
        await assert.rejects(database.transaction(() => Promise.reject(new Error("boom"))), /boom/u)
        assert.deepEqual(log, ["BEGIN", "COMMIT", "release", "BEGIN", "ROLLBACK", "release", "BEGIN", "ROLLBACK", "destroy"])
        assert.deepEqual(await database.query("select 1"), { rows: [{ n: 1 }] })
    })
})

describe("ladders, reasons and classes", () => {
    it("retries a transient failure after the ladder's pause and parks otherwise", () => {
        const ladder = DEFAULT_LADDERS.background
        assert.ok(ladder !== undefined)
        assert.deepEqual(ladderVerdictOf(ladder, 1, true), { kind: "retry", afterSeconds: 5 })
        assert.deepEqual(ladderVerdictOf(ladder, 3, true), { kind: "retry", afterSeconds: 20 })
        assert.deepEqual(ladderVerdictOf(ladder, 4, true), { kind: "park", why: "exhausted" })
        assert.deepEqual(ladderVerdictOf(ladder, 1, false), { kind: "park", why: "class" })
        assert.deepEqual(ladderVerdictOf({ starts: 9, pausesSeconds: [7] }, 5, true), { kind: "retry", afterSeconds: 7 })
        assert.deepEqual(ladderVerdictOf({ starts: 9, pausesSeconds: [] }, 5, true), { kind: "retry", afterSeconds: 1 })
        assert.equal(isPastLadder(ladder, 5), true)
        assert.equal(isPastLadder(ladder, 4), false)
    })

    it("names a failure by its coded chain down to the first uncoded throw, scrubbed and bounded", () => {
        const inner = Object.assign(new Error("permission denied"), { code: "42501" })
        const outer = new OutboxError({ code: OutboxErrorCode.JobInvalid, cause: inner })
        assert.equal(reasonOf(outer), "OutboxError OUTBOX_JOB_INVALID <- Error 42501: permission denied")
        assert.equal(reasonOf("text"), "unknown failure")
        assert.equal(reasonOf(new Error("token=abc"), (text) => text.replace("abc", "***")), "Error: token=***")
        assert.equal(reasonOf(new Error("x".repeat(5000))).length, 2000)
    })

    it("takes the class from the error alone: the outbox's own codes and an explicit failureClass, never the words of a code", () => {
        assert.equal(new OutboxError({ code: OutboxErrorCode.HandlerMissing }).failureClass, "code")
        assert.equal(new OutboxError({ code: OutboxErrorCode.PayloadRefused }).failureClass, "input")
        assert.equal(new OutboxError({ code: OutboxErrorCode.LeaseLost }).failureClass, undefined)
        class Unreachable extends DomainError<"APP_MODEL_UNAVAILABLE"> {}
        assert.equal(classifyFailure(new Unreachable({ code: "APP_MODEL_UNAVAILABLE" }), DomainError), "input")
        class Busy extends DomainError<"APP_BUSY"> {
            readonly failureClass = "transient"
        }
        assert.equal(classifyFailure(new Busy({ code: "APP_BUSY" }), DomainError), "transient")
        assert.equal(deferralOf(defer(3)), 3)
        assert.equal(deferralOf(undefined), undefined)
        assert.equal(deferralOf({ deferSeconds: 3 }), undefined)
    })
})

describe("the Outbox without a server", () => {
    it("refuses bad limits, a duplicate handler, an unknown ladder and an empty timer key", async () => {
        const database = emptyDatabase()
        assert.throws(() => new Outbox({ database, leaseMs: 0 }), { code: OutboxErrorCode.OptionsInvalid })
        assert.throws(() => new Outbox({ database, queueConcurrency: { q: 1.5 } }), { code: OutboxErrorCode.OptionsInvalid })
        const outbox = new Outbox({ database })
        outbox.handle({ name: "a", handle: () => Promise.resolve() })
        assert.throws(() => {
            outbox.handle({ name: "a", handle: () => Promise.resolve() })
        }, { code: OutboxErrorCode.HandlerDuplicate })
        assert.throws(() => {
            outbox.handle({ name: "b", ladder: "nightly", handle: () => Promise.resolve() })
        }, { code: OutboxErrorCode.LadderUnknown })
        await assert.rejects(outbox.armTimer(database, { scope: null, key: "", dueAt: new Date(), payload: {} }), { code: OutboxErrorCode.JobInvalid })
        assert.deepEqual(await outbox.claim(), [])
        assert.deepEqual(await outbox.parked(), [])
        assert.equal(await outbox.purge(new Date()), 0)
        assert.deepEqual(await outbox.stats(), [])
        assert.equal((await outbox.enqueue(database, { scope: null, queue: "q", name: "n", payload: {}, onceKey: "a:b" })).id, null)
    })

    it("reports a failing tick to onError and keeps ticking; a warning on the process without onError", async () => {
        const failing: OutboxDatabase = {
            query: () => Promise.reject(new Error("connection refused")),
            transaction: () => Promise.reject(new Error("connection refused")),
        }
        const pending: (() => void)[] = []
        const schedule: Schedule = (work) => {
            pending.push(work)
            return () => undefined
        }
        const events: string[] = []
        const outbox = new Outbox({ database: failing, schedule, onError: (event) => events.push(event) })
        outbox.start()
        pending.shift()?.()
        await new Promise((resolve) => setImmediate(resolve))
        await new Promise((resolve) => setImmediate(resolve))
        assert.deepEqual(events, ["tick"])
        assert.ok(pending.length > 0, "the next tick is scheduled")
        await outbox.stop(1)
        const warnings: string[] = []
        const listen = (warning: Error): void => {
            warnings.push(warning.message)
        }
        process.on("warning", listen)
        const quiet = new Outbox({ database: failing, buildId: "b", schedule: (work, ms) => {
            const timer = setTimeout(work, ms)
            return () => {
                clearTimeout(timer)
            }
        } })
        quiet.start()
        await new Promise((resolve) => setTimeout(resolve, 30))
        await quiet.stop(1)
        process.off("warning", listen)
        assert.ok(warnings.some((warning) => warning.startsWith("@starci/outbox resume-build")), warnings.join("|"))
    })
})

describe("OutboxModule", () => {
    it("registers the Outbox under its token, runs a handler that registers itself, and starts and stops the loop with the app", async () => {
        const database = emptyDatabase()
        class Job implements OnModuleInit {
            readonly name = "job"
            private readonly outbox: Outbox
            constructor(outbox: Outbox) {
                this.outbox = outbox
            }
            onModuleInit(): void {
                this.outbox.handle({ name: this.name, handle: () => Promise.resolve() })
            }
        }
        class Feature {
            readonly kind = "feature"
        }
        const feature = { module: Feature, providers: [{ provide: Job, inject: [OUTBOX], useFactory: (outbox: Outbox) => new Job(outbox) }] }
        Module({})(feature.module)
        const app = await Test.createTestingModule({
            imports: [OutboxModule.registerAsync({ isGlobal: true, useFactory: () => ({ database, autoStart: true, pollMs: 60_000, timerSweepMs: 60_000 }) }), feature],
        }).compile()
        await app.init()
        const outbox = app.get<Outbox>(OUTBOX)
        assert.throws(() => {
            outbox.handle({ name: "job", handle: () => Promise.resolve() })
        }, { code: OutboxErrorCode.HandlerDuplicate })
        await new Promise((resolve) => setTimeout(resolve, 30))
        assert.ok(database.statements.length > 0, "the loop ran a tick")
        await app.close()
        const plain = await Test.createTestingModule({ imports: [OutboxModule.register({ database, isGlobal: false })] }).compile()
        await plain.init()
        assert.ok(plain.get<Queryable>(OUTBOX) instanceof Outbox)
        await plain.close()
    })
})
