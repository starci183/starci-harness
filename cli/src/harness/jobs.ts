import type { DatabaseSync } from "node:sqlite"
import { hostname } from "node:os"
import { pidAlive } from "../shared/exec.js"
import { now } from "./ledger.js"
import { settleLockHolder, verifyLockKey } from "./settle.js"
import { recordEvent } from "./tasks.js"

/**
 * A detached settle job a coordinator's step starts instead of running heavy work in its own turn (core/workflow/engine.ts): its
 * job row (a ledger meta row: who started it and when), the settle lock the job takes once it runs (none for a job that takes
 * none), the event its start records and its subject, and what it is, for the line a caller that finds it busy reads.
 */
export interface SettleJob {
    readonly key: string
    readonly lock: string | null
    readonly started: string
    readonly subject: string
    readonly what: string
}

/** The wave of a workflow (`starci workflow wave <id>`), which takes the wave lock. */
export const waveJob = (workflow: string, lock: string): SettleJob => ({ key: `wave-job:${workflow}`, lock, started: "wave-started", subject: workflow, what: `the wave of workflow ${workflow}` })

/** The verify of one reported task (`starci task verify <id>`), which takes the task's verifier lock. */
export const verifyJob = (task: string): SettleJob => ({ key: `verify-job:${task}`, lock: verifyLockKey(task), started: "verify-job-started", subject: task, what: `the verify of task ${task}` })

/** The final verify of a workflow (`starci workflow wave <id> --final`), which takes no lock: its job row holds it while its process lives. */
export const finalJob = (workflow: string): SettleJob => ({ key: `final-job:${workflow}`, lock: null, started: "final-verify-started", subject: workflow, what: `the final verify of workflow ${workflow}` })

/** How long a started job may take to reach its lock before another caller may start one again. */
const JOB_START_MS = 120_000

interface JobRow {
    readonly pid: number
    readonly host: string
    readonly at: string
}

const jobRow = (db: DatabaseSync, job: SettleJob): JobRow | undefined => {
    const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(job.key)
    return row === undefined ? undefined : (JSON.parse(String(row.value)) as JobRow)
}

/**
 * Whether a recorded job still stands: on this host while its process lives (and, for a job that takes a lock, only until
 * JOB_START_MS, after which its lock speaks for it); on another host until JOB_START_MS.
 */
const stands = (job: SettleJob, row: JobRow | undefined): boolean => {
    if (row === undefined) return false
    const young = Date.now() - Date.parse(row.at) < JOB_START_MS
    if (row.host !== hostname()) return young
    return pidAlive(row.pid) && (job.lock === null || young)
}

/** Why the job may not start now (its lock is held, or a started job stands), else undefined. */
export const jobBusy = (db: DatabaseSync, job: SettleJob): string | undefined => {
    const holder = job.lock === null ? undefined : settleLockHolder(db, job.lock)
    if (holder !== undefined) return `${job.what} runs in pid ${String(holder.pid)} on ${holder.host} since ${holder.at}; its verdict is read on the next step`
    const row = jobRow(db, job)
    return stands(job, row) && row !== undefined ? `${job.what} was started as a job (pid ${String(row.pid)}) at ${row.at}; its verdict is read on the next step` : undefined
}

/**
 * Claims the start of a detached job for this process, under BEGIN IMMEDIATE so concurrent callers start one job: undefined
 * when this caller claimed it (it then starts the job and records its pid with recordJob), else why it must not (`jobBusy`).
 */
export const claimJob = (db: DatabaseSync, job: SettleJob): string | undefined => {
    const locked = job.lock === null ? undefined : settleLockHolder(db, job.lock)
    if (locked !== undefined) return jobBusy(db, job)
    db.exec("BEGIN IMMEDIATE")
    try {
        const busy = jobBusy(db, job)
        if (busy === undefined) db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(job.key, JSON.stringify({ pid: process.pid, host: hostname(), at: now() }))
        db.exec("COMMIT")
        return busy
    } catch (error: unknown) {
        db.exec("ROLLBACK")
        throw error
    }
}

/** Records the pid of the job a claim started (or, with null, gives a failed start's claim back). */
export const recordJob = (db: DatabaseSync, job: SettleJob, pid: number | null): void => {
    if (pid === null) {
        db.prepare("DELETE FROM meta WHERE key = ?").run(job.key)
        return
    }
    db.prepare("UPDATE meta SET value = json_set(value, '$.pid', ?) WHERE key = ?").run(pid, job.key)
    recordEvent(db, job.started, job.subject, { pid })
}
