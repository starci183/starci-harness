import { hostname } from "node:os"
import type { DatabaseSync } from "node:sqlite"
import { setTimeout as sleep } from "node:timers/promises"
import { Refusal } from "../shared/errors.js"
import { captureTool, headline, pidAlive } from "../shared/exec.js"
import { currentBranch, resolveSha } from "../shared/git.js"
import type { CleanVerify } from "./clean-verify.js"
import type { Contract } from "./contract.js"
import { now } from "./ledger.js"

/** What a settle did: the branch it moved and the commit it now points at; `committed` is false when the task changed nothing. */
export interface Settlement {
    readonly branch: string
    readonly commit: string
    readonly committed: boolean
    readonly warnings: readonly string[]
}

/** Who verifies a task now: the process, its host and when it began; a dead pid on this host means nobody does. */
export interface Verifier {
    readonly task: string
    readonly pid: number
    readonly host: string
    readonly at: string
}

/** The message of a task's harness commit: `<label>: <summary>` and the task trailer. */
export const settleMessage = (contract: Contract, taskId: string): string => `${contract.label}: ${contract.input.summary}\n\nStarci-Task: ${taskId}`

/** The branch a settle will move; a detached HEAD has none, so nothing can be settled. */
export const settleBranch = async (root: string): Promise<string> => {
    const branch = await currentBranch(root)
    if (branch === undefined) throw new Refusal("HEAD_DETACHED", `${root} is on a detached HEAD; check out the branch the task lands on, then verify again`)
    return branch
}

/** This process as a verifier of `task`. */
export const thisVerifier = (task: string): Verifier => ({ task, pid: process.pid, host: hostname(), at: now() })

/** True when the verifier is a process still running on this host; one on another host is assumed alive. */
export const verifierAlive = (verifier: Verifier): boolean => verifier.host !== hostname() || pidAlive(verifier.pid)

/** Reads a verifier back from stored json, or undefined when it is not one. */
export const asVerifier = (value: unknown): Verifier | undefined => {
    if (typeof value !== "object" || value === null) return undefined
    const record = value as Record<string, unknown>
    const { task, pid, host, at } = record
    return typeof task === "string" && typeof pid === "number" && typeof host === "string" && typeof at === "string" ? { task, pid, host, at } : undefined
}

const LOCK_KEY = "settle-lock"

const LOCK_POLL_MS = 500

/** Takes the lock row if it is free or its holder died; one statement pair under BEGIN IMMEDIATE, so two verifiers never both win. */
const tryLock = (db: DatabaseSync, me: Verifier): Verifier | undefined => {
    db.exec("BEGIN IMMEDIATE")
    try {
        const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(LOCK_KEY)
        const holder = row === undefined ? undefined : asVerifier(JSON.parse(String(row.value)))
        if (holder !== undefined && verifierAlive(holder)) {
            db.exec("COMMIT")
            return holder
        }
        db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(LOCK_KEY, JSON.stringify(me))
        db.exec("COMMIT")
        return undefined
    } catch (error: unknown) {
        db.exec("ROLLBACK")
        throw error
    }
}

/**
 * Runs `work` while this process holds the project's settle lock (a ledger row), so verifies that settle run one at a time
 * (STARCI §10 #3, side serialisation): each builds its candidate on the HEAD the previous one left. A holder whose process
 * died is taken over; waiting longer than `waitMs` refuses with SETTLE_BUSY and changes nothing.
 */
export const withSettleLock = async <T>(db: DatabaseSync, me: Verifier, waitMs: number, work: () => Promise<T>): Promise<T> => {
    const deadline = Date.now() + waitMs
    for (;;) {
        const holder = tryLock(db, me)
        if (holder === undefined) break
        if (Date.now() >= deadline) {
            throw new Refusal("SETTLE_BUSY", `task ${holder.task} has been verifying since ${holder.at} (pid ${String(holder.pid)} on ${holder.host}); nothing changed, verify again when it ends`)
        }
        await sleep(LOCK_POLL_MS)
    }
    try {
        return await work()
    } finally {
        db.prepare("DELETE FROM meta WHERE key = ? AND value = ?").run(LOCK_KEY, JSON.stringify(me))
    }
}

const INDEX_TRIES = 5

const INDEX_RETRY_MS = 400

/** Refreshes the user's index for the settled paths; best effort, since the branch already moved: a held index.lock is retried, then reported. */
const refreshIndex = async (root: string, paths: readonly string[]): Promise<string[]> => {
    if (paths.length === 0) return []
    let last = ""
    for (let attempt = 1; attempt <= INDEX_TRIES; attempt++) {
        const run = await captureTool("git", ["reset", "-q", "--", ...paths.map((path) => `:(top,literal)${path}`)], root)
        if (run.exitCode === 0) return []
        last = headline(run.stderr)
        if (!last.includes("index.lock")) break
        await sleep(INDEX_RETRY_MS * attempt)
    }
    return [`the branch moved, but the index of the settled paths was not refreshed (${last}); \`git status\` may show them changed until \`git reset -q -- <paths>\` runs`]
}

/**
 * Lands exactly the candidate the checks saw: the branch moves to that commit only while it still points at the candidate's
 * parent. Once the ref moved the settle stands: refreshing the index of the settled paths is best effort and only warns.
 * The work tree is never written and nothing is pushed.
 */
export const settle = async (root: string, built: CleanVerify): Promise<Settlement> => {
    const branch = await settleBranch(root)
    const moved = (head: string): Refusal =>
        new Refusal("HEAD_MOVED", `${branch} moved from ${built.parent.slice(0, 12)} to ${head.slice(0, 12)} after the candidate was built; the work tree is untouched and no try is spent, verify again`)
    const head = await resolveSha(root, "HEAD")
    if (head !== built.parent) throw moved(head)
    if (built.changed.length === 0) return { branch, commit: head, committed: false, warnings: [] }
    const update = await captureTool("git", ["update-ref", "-m", "starci settle", `refs/heads/${branch}`, built.candidate, built.parent], root)
    if (update.exitCode !== 0) {
        const after = await resolveSha(root, "HEAD")
        if (after !== built.parent) throw moved(after)
        throw new Refusal("SETTLE_REF_FAILED", `git update-ref of ${branch} failed: ${headline(update.stderr)}; the work tree is untouched and no try is spent, verify again`)
    }
    return { branch, commit: built.candidate, committed: true, warnings: await refreshIndex(root, built.paths) }
}
