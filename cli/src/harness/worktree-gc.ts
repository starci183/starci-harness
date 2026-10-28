import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, join, relative, sep } from "node:path"
import { captureGit, git, isAncestor, mainCheckout, nulPaths, samePath } from "../shared/git.js"
import { pruneVerifyWorktrees } from "./clean-verify.js"
import { removeOpWorktree, removeWorktreeFolder } from "./land.js"
import { now, openExistingLedger, openMachine, projectDir } from "./ledger.js"
import { inOrder } from "./sequential.js"
import { getTask, isTerminal, recordEvent } from "./tasks.js"
import { getWorkflow } from "./workflow.js"

/** The kinds of worktree the harness makes, each removed when its owner's work ends. */
export type WorktreeKind = "op" | "workflow" | "worker" | "package" | "orphan"

/** One worktree the collector judged: whose it is, why it is due (or why it stays), and what a gc did to it. */
export interface GcEntry {
    readonly path: string
    readonly kind: WorktreeKind
    readonly owner: string | null
    readonly due: boolean
    readonly reason: string
    readonly preserved: string | null
    readonly removed: boolean
    readonly detail: string
}

const ENDED_WORKFLOW = new Set(["done", "stopped"])

interface Listed {
    readonly path: string
    readonly branch: string | null
}

/** The linked worktrees git lists for a repository (its main checkout aside). */
const listWorktrees = async (root: string): Promise<Listed[]> => {
    const out = await git(root, ["worktree", "list", "--porcelain"])
    const main = await mainCheckout(root)
    return out
        .split(/\r?\n\r?\n/)
        .map((block) => ({ path: /^worktree (.+)$/m.exec(block)?.[1]?.trim() ?? "", branch: /^branch refs\/heads\/(.+)$/m.exec(block)?.[1]?.trim() ?? null }))
        .filter((entry) => entry.path !== "" && !samePath(entry.path, main))
}

const inside = (folder: string, path: string): string | undefined => {
    const rel = relative(folder, path)
    return rel === "" || rel.startsWith("..") || rel.includes(":") ? undefined : rel.split(sep).join("/")
}

/** A harness worktree of one repository's state folder, with the owner whose end makes it due. */
const judge = (root: string, entry: Listed, stateWorktrees: string): Omit<GcEntry, "preserved" | "removed" | "detail"> | undefined => {
    const rel = inside(stateWorktrees, entry.path)
    if (rel === undefined) return undefined
    const db = openExistingLedger(root)
    try {
        const [first = "", second] = rel.split("/")
        if (first.endsWith(".ops") && second !== undefined) {
            const task = db === undefined ? undefined : (() => { try { return getTask(db, second) } catch { return undefined } })()
            if (task === undefined) return { path: entry.path, kind: "orphan", owner: null, due: true, reason: `no task ${second} in the ledger` }
            const settled = isTerminal(task.status) && task.status !== "awaiting_owner" && task.intent === null
            return { path: entry.path, kind: "op", owner: task.id, due: settled, reason: settled ? `task ${task.id} is ${task.status}` : `task ${task.id} is ${task.status}${task.intent === null ? "" : " (" + task.intent + ")"}` }
        }
        if (db?.prepare("SELECT 1 FROM workflows WHERE id = ?").get(first) !== undefined) {
            const workflow = getWorkflow(db, first)
            const ended = ENDED_WORKFLOW.has(workflow.status) && (workflow.header.runner !== "orca" || workflow.kernel.closedAt !== null || workflow.kernel.terminal === null)
            return { path: entry.path, kind: "workflow", owner: first, due: ended, reason: ended ? `workflow ${first} is ${workflow.status}; its branch ${entry.branch ?? "-"} keeps its commits` : `workflow ${first} is ${workflow.status}` }
        }
        const machine = openMachine()
        try {
            const worker = machine.prepare("SELECT id, ended_at, ended_by FROM supervisor_workers WHERE id = ?").get(first)
            if (worker !== undefined) {
                const ended = worker.ended_at !== null
                return { path: entry.path, kind: "worker", owner: first, due: ended, reason: ended ? `worker ${first} was ${String(worker.ended_by ?? "ended")}` : `worker ${first} is live` }
            }
        } finally {
            machine.close()
        }
        return { path: entry.path, kind: "orphan", owner: null, due: true, reason: `no task, workflow or worker of this project owns ${rel}` }
    } finally {
        db?.close()
    }
}

/**
 * Saves a worktree's uncommitted work as a red verify does: a binary patch of its tracked changes against HEAD and copies of
 * its untracked files (ignored ones aside), into `preserved/gc-<name>` of the project's state folder. Null when it is clean.
 */
const preserveCheckout = async (root: string, path: string): Promise<string | null> => {
    const tracked = nulPaths(await git(path, ["diff", "--name-only", "-z", "HEAD"]).catch(() => ""))
    const untracked = nulPaths(await git(path, ["ls-files", "--others", "--exclude-standard", "-z"]).catch(() => ""))
    if (tracked.length === 0 && untracked.length === 0) return null
    let dir = join(projectDir(root), "preserved", `gc-${basename(path)}`)
    for (let n = 2; existsSync(dir); n += 1) dir = join(projectDir(root), "preserved", `gc-${basename(path)}.${String(n)}`)
    mkdirSync(dir, { recursive: true })
    if (tracked.length > 0) await git(path, ["diff", "--binary", `--output=${join(dir, "changes.patch")}`, "HEAD"])
    for (const file of untracked) {
        const from = join(path, file)
        if (!existsSync(from) || !statSync(from).isFile()) continue
        mkdirSync(dirname(join(dir, "untracked", file)), { recursive: true })
        copyFileSync(from, join(dir, "untracked", file))
    }
    writeFileSync(join(dir, "manifest.json"), `${JSON.stringify({ worktree: path, head: await git(path, ["rev-parse", "HEAD"]), tracked, untracked, at: now() }, null, 2)}\n`)
    return dir
}

/**
 * Removes one worktree (harness/land.ts removeWorktreeFolder: links unlinked, then `orca worktree rm` for a worktree Orca lists,
 * else git) from its own repository's main checkout (a package edit worktree is the harness's), then prunes; its branch stays.
 */
const removeWorktree = async (fallback: string, path: string, viaOrca: boolean): Promise<{ readonly removed: boolean; readonly detail: string }> => {
    const root = existsSync(path) ? await mainCheckout(path).catch(() => fallback) : fallback
    const failed = await removeWorktreeFolder(root, path, viaOrca)
    await captureGit(["worktree", "prune"], root)
    return failed === undefined ? { removed: true, detail: "removed; its branch keeps its commits" } : { removed: false, detail: `worktree remove failed: ${failed}` }
}

/** The package edit worktrees of the host (`pkg branch`) whose handed-off head is on the harness's main: Debug landed them. */
const landedPackages = async (): Promise<GcEntry[]> => {
    const machine = openMachine()
    let rows: Record<string, unknown>[]
    try {
        rows = machine.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'package_handoffs'").get() === undefined ? [] : machine.prepare("SELECT branch, head, harness, worktree FROM package_handoffs").all()
    } finally {
        machine.close()
    }
    const found = await inOrder(rows, async (row): Promise<GcEntry | undefined> => {
        const harness = String(row.harness)
        const worktree = String(row.worktree)
        if (!existsSync(worktree)) return undefined
        const landed = await isAncestor(harness, String(row.head), "main")
        return { path: worktree, kind: "package", owner: String(row.branch), due: landed, reason: landed ? `${String(row.branch)} is on main` : `${String(row.branch)} is not landed yet`, preserved: null, removed: false, detail: "" }
    })
    return found.filter((entry): entry is GcEntry => entry !== undefined)
}

/**
 * The worktree collector: every worktree the harness made for a repository is judged by its owner (an Op's task settled, a
 * workflow done or stopped with its Kernel closed, a Supervisor's worker accepted or rejected, a package edit landed on main)
 * or found an orphan no ledger row owns; clean-verify checkouts whose verifier is gone are pruned. A due worktree's uncommitted
 * work is preserved first, its install links are unlinked (link only, never a recursive delete through one), then it is removed
 * and git prunes; branches stay, so nothing committed is lost. `dryRun` judges and changes nothing.
 */
export const worktreeGc = async (root: string, dryRun: boolean): Promise<GcEntry[]> => {
    const stateWorktrees = join(projectDir(root), "worktrees")
    const listed = await listWorktrees(root)
    const judged = [
        ...listed.flatMap((entry) => {
            const one = judge(root, entry, stateWorktrees)
            return one === undefined ? [] : [{ ...one, preserved: null, removed: false, detail: "" }]
        }),
        ...(await landedPackages()),
    ]
    const verify = dryRun ? [] : (await pruneVerifyWorktrees(root)).map((path): GcEntry => ({ path, kind: "orphan", owner: null, due: true, reason: "a clean-verify checkout whose verifier is gone", preserved: null, removed: true, detail: "pruned" }))
    if (dryRun) return judged
    const done = await inOrder(judged, async (entry): Promise<GcEntry> => {
        if (!entry.due) return entry
        const preserved = await preserveCheckout(root, entry.path)
        const removal =
            entry.kind === "op" && entry.owner !== null
                ? await removeOpWorktree(root, entry.owner).then((made) => (made === undefined ? removeWorktree(root, entry.path, entry.kind !== "package") : { removed: made.removed, detail: made.detail }))
                : await removeWorktree(root, entry.path, entry.kind !== "package")
        const db = openExistingLedger(root)
        if (db !== undefined) {
            try {
                recordEvent(db, "worktree-gc", entry.owner, { path: entry.path, kind: entry.kind, reason: entry.reason, preserved, ...removal })
            } finally {
                db.close()
            }
        }
        return { ...entry, preserved, ...removal }
    })
    return [...done, ...verify]
}
