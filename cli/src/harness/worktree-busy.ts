import { basename, resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { captureTool } from "../shared/exec.js"
import { findLedgerId, openExistingLedger } from "./ledger.js"
import { recordEvent } from "./tasks.js"
import { openTicket } from "./tickets.js"

/**
 * A worktree removal the host refused because something holds the folder (EBUSY, EPERM, EACCES: a process working in it, a file
 * held open). The removal is left, recorded here and retried by `worktree gc` with backoff; it never fails or blocks the settle
 * of the task that asked for it. At the attempt cap a `harness-defect` ticket names the folder and, when the host can tell, the
 * process that holds it; retries go on at the longest interval, so the folder goes once the lock does.
 */
export const BUSY_EVENT = "worktree-remove-busy"

/** The event that ends a busy record: the folder was removed, or is gone. */
export const BUSY_CLEARED_EVENT = "worktree-remove-busy-cleared"

/** The event of the ticket a busy record opened at the cap. */
export const BUSY_TICKETED_EVENT = "worktree-remove-busy-ticketed"

/** The first retry waits this long; each later one twice the previous, up to BUSY_BACKOFF_MAX_MS. */
const BUSY_BACKOFF_BASE_MS = 60_000

const BUSY_BACKOFF_MAX_MS = 60 * 60_000

/** The attempt at which a still-busy folder is ticketed for Debug. */
export const BUSY_ATTEMPT_CAP = 6

/** What the host says when a folder or a file in it is held: Node's and git's words on Windows and POSIX. */
const BUSY = /\bEBUSY\b|\bEPERM\b|\bEACCES\b|resource busy|device or resource busy|permission denied|being used by another process|access is denied/i

/** True when a removal failure reads as the folder being held, not as a missing or invalid worktree. */
export const isBusyFailure = (detail: string): boolean => BUSY.test(detail)

/** One left removal: the folder, the repository it is removed from, its owner and kind, the attempt it is at and when it is next due. */
export interface BusyRecord {
    readonly path: string
    readonly repo: string
    readonly owner: string | null
    readonly kind: string
    readonly attempt: number
    readonly nextAt: string
    readonly detail: string
    readonly terminals: readonly string[]
}

/** The subject a folder's busy events are kept under: one spelling of the path, whatever slashes or case a caller used. */
export const busySubject = (path: string): string => {
    const slashed = resolve(path).replaceAll("\\", "/").replace(/\/+$/, "")
    return process.platform === "win32" ? slashed.toLowerCase() : slashed
}

const BUSY_KINDS = [BUSY_EVENT, BUSY_CLEARED_EVENT]

const asRecord = (data: unknown): BusyRecord | undefined => {
    if (typeof data !== "object" || data === null) return undefined
    const row = data as Record<string, unknown>
    if (typeof row.path !== "string" || typeof row.repo !== "string" || typeof row.nextAt !== "string") return undefined
    return {
        path: row.path,
        repo: row.repo,
        owner: typeof row.owner === "string" ? row.owner : null,
        kind: typeof row.kind === "string" ? row.kind : "orphan",
        attempt: typeof row.attempt === "number" ? row.attempt : 1,
        nextAt: row.nextAt,
        detail: typeof row.detail === "string" ? row.detail : "",
        terminals: Array.isArray(row.terminals) ? row.terminals.filter((one): one is string => typeof one === "string") : [],
    }
}

/** The open busy record of a folder: its newest busy event, unless a clear came after it. */
export const busyRecordOf = (db: DatabaseSync, path: string): BusyRecord | undefined => {
    const row = db.prepare(`SELECT kind, data_json FROM events WHERE subject = ? AND kind IN (?, ?) ORDER BY id DESC LIMIT 1`).get(busySubject(path), ...BUSY_KINDS)
    return row?.kind === BUSY_EVENT ? asRecord(JSON.parse(String(row.data_json))) : undefined
}

/** Every open busy record of a ledger. */
export const openBusyRecords = (db: DatabaseSync): BusyRecord[] =>
    db
        .prepare(`SELECT e.data_json FROM events e WHERE e.kind = ? AND e.id = (SELECT MAX(id) FROM events l WHERE l.subject = e.subject AND l.kind IN (?, ?))`)
        .all(BUSY_EVENT, ...BUSY_KINDS)
        .flatMap((row) => {
            const record = asRecord(JSON.parse(String(row.data_json)))
            return record === undefined ? [] : [record]
        })

/** True when a busy record's backoff has run out, so a retry is due. */
export const busyDue = (record: BusyRecord, at: number = Date.now()): boolean => Date.parse(record.nextAt) <= at

const backoffMs = (attempt: number): number => Math.min(BUSY_BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1), BUSY_BACKOFF_MAX_MS)

/** Ends a folder's busy record, if it has one. */
export const clearBusy = (db: DatabaseSync, path: string, how: string): void => {
    if (busyRecordOf(db, path) !== undefined) recordEvent(db, BUSY_CLEARED_EVENT, busySubject(path), { path, how })
}

/**
 * The process that holds a folder, as far as the host can tell: Sysinternals `handle` (or `openfiles`, which needs its global
 * flag) on Windows, `lsof` elsewhere. Null with the reason when no such tool answers.
 */
export const lockersOf = async (path: string): Promise<{ readonly lockers: string | null; readonly how: string }> => {
    const tools: readonly (readonly [string, readonly string[], (out: string) => string])[] =
        process.platform === "win32"
            ? [
                  ["handle", ["-accepteula", "-nobanner", path], (out) => out],
                  ["handle64", ["-accepteula", "-nobanner", path], (out) => out],
                  ["openfiles", ["/query", "/fo", "csv", "/v"], (out) => out.split(/\r?\n/).filter((line) => line.toLowerCase().includes(path.toLowerCase().replaceAll("/", "\\"))).join("\n")],
              ]
            : [["lsof", ["+D", path], (out) => out]]
    const tried: string[] = []
    for (const [tool, args, pick] of tools) {
        const run = await captureTool(tool, args, resolve(path, ".."), { timeoutMs: 30_000 }).catch(() => undefined)
        const found = run?.exitCode === 0 ? pick(run.stdout).trim() : ""
        if (found !== "") return { lockers: found.split(/\r?\n/).slice(0, 20).join("\n"), how: tool }
        tried.push(run === undefined ? `${tool} (missing)` : `${tool} (exit ${String(run.exitCode)}, named nothing)`)
    }
    return { lockers: null, how: `no tool named it: ${tried.join(", ")}` }
}

const ticketBusy = async (repo: string, record: BusyRecord): Promise<string> => {
    const { lockers, how } = await lockersOf(record.path)
    const named = lockers === null ? `the locking process is unknown (${how})` : `held by (${how}):\n${lockers}`
    const { ticket } = openTicket({
        kind: "harness-defect",
        severity: "normal",
        title: `worktree ${record.path} stays locked after ${String(record.attempt)} removal attempts`,
        evidence: { ...(record.owner === null ? {} : { task: record.owner }), tail: `${record.detail}\n${named}` },
        tried: `closed its Orca terminals (${record.terminals.join(", ") || "none listed"}) and retried with backoff ${String(record.attempt)} times; worktree gc keeps retrying hourly`,
        proposedDefault: null,
        options: [],
        project: { root: repo, key: findLedgerId(repo) ?? "", name: basename(repo) },
        workflow: null,
        by: "worktree-gc",
        waiters: [],
    })
    return ticket.id
}

/**
 * Records a removal the host refused as busy: the attempt after the folder's previous one, due again after the backoff. At the
 * cap it opens the `harness-defect` ticket once. Returns the record written.
 */
export const recordBusy = async (root: string, removal: Omit<BusyRecord, "attempt" | "nextAt">): Promise<BusyRecord> => {
    const db = openExistingLedger(root)
    const previous = db === undefined ? undefined : busyRecordOf(db, removal.path)
    const attempt = (previous?.attempt ?? 0) + 1
    const record: BusyRecord = { ...removal, attempt, nextAt: new Date(Date.now() + backoffMs(attempt)).toISOString() }
    if (db === undefined) return record
    try {
        recordEvent(db, BUSY_EVENT, busySubject(removal.path), record)
        if (attempt === BUSY_ATTEMPT_CAP) {
            const ticket = await ticketBusy(removal.repo, record).catch((error: unknown) => `not opened: ${error instanceof Error ? error.message : String(error)}`)
            recordEvent(db, BUSY_TICKETED_EVENT, busySubject(removal.path), { path: removal.path, ticket })
        }
    } finally {
        db.close()
    }
    return record
}
