import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, join, relative, sep } from "node:path"
import { captureGit, git, isAncestor, mainCheckout, nulPaths, samePath } from "../shared/git.js"
import { pruneVerifyWorktrees } from "./clean-verify.js"
import { opWorktreeOf, removeOpWorktree, removeTracked } from "./land.js"
import { now, openExistingLedger, openMachine, projectDir } from "./ledger.js"
import { readMachine } from "./machine.js"
import { inOrder } from "./sequential.js"
import { getTask, isTerminal, lastEvent, listTasks, recordEvent } from "./tasks.js"
import { busyDue, busyRecordOf, openBusyRecords } from "./worktree-busy.js"
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
    /** True when the folder was left busy (something holds it) for a later gc to retry with backoff (harness/worktree-busy.ts). */
    readonly busy?: boolean
}

const ENDED_WORKFLOW = new Set(["done", "stopped"])

export interface Listed {
    readonly path: string
    readonly branch: string | null
}

/** The linked worktrees git lists for a repository (its main checkout aside). */
export const listWorktrees = async (root: string): Promise<Listed[]> => {
    const out = await git(root, ["worktree", "list", "--porcelain"])
    const main = await mainCheckout(root)
    return out
        .split(/\r?\n\r?\n/)
        .map((block) => ({ path: /^worktree (.+)$/m.exec(block)?.[1]?.trim() ?? "", branch: /^branch refs\/heads\/(.+)$/m.exec(block)?.[1]?.trim() ?? null }))
        .filter((entry) => entry.path !== "" && !samePath(entry.path, main))
}

/** `path` relative to `folder` with forward slashes, or undefined when it lies outside it. */
export const inside = (folder: string, path: string): string | undefined => {
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
    // A folder without its .git is no checkout of its own: git run there would read whatever repository encloses it.
    if (!existsSync(join(path, ".git"))) return null
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
 * Removes one worktree (harness/land.ts removeTracked: its Orca terminals closed, links unlinked, then `orca worktree rm` for a
 * worktree Orca lists, else git, under the folder's busy record in the ledger of `root`) from its own repository's main checkout
 * (a package edit worktree is the harness's), then prunes; its branch stays. A held folder is left busy for a later gc.
 */
const removeWorktree = async (root: string, entry: Pick<GcEntry, "path" | "kind" | "owner">, viaOrca: boolean, repo?: string): Promise<{ readonly removed: boolean; readonly busy: boolean; readonly detail: string }> => {
    const from = repo ?? (existsSync(join(entry.path, ".git")) ? await mainCheckout(entry.path).catch(() => root) : root)
    const removal = await removeTracked(root, { path: entry.path, repo: from, owner: entry.owner, kind: entry.kind, viaOrca })
    await captureGit(["worktree", "prune"], from)
    if (removal.removed) return { removed: true, busy: false, detail: `${removal.detail}; its branch keeps its commits` }
    return { removed: false, busy: removal.busy, detail: removal.busy ? removal.detail : `worktree remove failed: ${removal.detail}` }
}

/**
 * The Op worktrees git no longer lists whose folder stayed (a removal git emptied and deregistered but whose rmdir the host
 * refused): every settled task of the ledger with an Op worktree that was never recorded removed and whose folder still exists.
 */
const unlistedOpLeftovers = (root: string, listed: readonly Listed[]): GcEntry[] => {
    const db = openExistingLedger(root)
    if (db === undefined) return []
    try {
        return listTasks(db)
            .filter((task) => isTerminal(task.status) && task.status !== "awaiting_owner" && task.intent === null && lastEvent(db, "op-worktree-removed", task.id) === undefined)
            .flatMap((task): GcEntry[] => {
                const made = opWorktreeOf(db, task.id)
                if (made === undefined || !existsSync(made.path) || listed.some((entry) => samePath(entry.path, made.path))) return []
                return [{ path: made.path, kind: "op", owner: task.id, due: true, reason: `task ${task.id} is ${task.status}; git no longer lists its worktree but the folder stayed`, preserved: null, removed: false, detail: "" }]
            })
    } finally {
        db.close()
    }
}

/** The busy records of the ledger (harness/worktree-busy.ts) no other entry covers, each due once its backoff ran out. */
const busyLeftovers = (root: string, judged: readonly GcEntry[]): (GcEntry & { readonly repo: string })[] => {
    const db = openExistingLedger(root)
    if (db === undefined) return []
    try {
        return openBusyRecords(db)
            .filter((record) => !judged.some((entry) => samePath(entry.path, record.path)))
            .map((record) => {
                const due = busyDue(record) || !existsSync(record.path)
                const reason = `left busy at attempt ${String(record.attempt)}${due ? "" : `; retried from ${record.nextAt}`}`
                return { path: record.path, kind: (WORKTREE_KINDS.includes(record.kind as WorktreeKind) ? record.kind : "orphan") as WorktreeKind, owner: record.owner, due, reason, preserved: null, removed: false, busy: true, detail: "", repo: record.repo }
            })
    } finally {
        db.close()
    }
}

const WORKTREE_KINDS: readonly WorktreeKind[] = ["op", "workflow", "worker", "package", "orphan"]

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
 * Removes every worktree the harness made for a repository whose project is retired (`project retire`): each one under its state
 * folder is due whatever its owner's state, since no sweep or tick reaches a retired ledger again. Its uncommitted work is
 * preserved first, links are unlinked as links, removal goes through Orca and git, and branches stay.
 */
export const retireWorktrees = async (root: string): Promise<GcEntry[]> => {
    const stateWorktrees = join(projectDir(root), "worktrees")
    const listed = (await listWorktrees(root)).filter((entry) => inside(stateWorktrees, entry.path) !== undefined)
    return inOrder(listed, async (entry): Promise<GcEntry> => {
        const owned = judge(root, entry, stateWorktrees)
        const kind = owned?.kind ?? "orphan"
        const owner = owned?.owner ?? null
        const preserved = await preserveCheckout(root, entry.path)
        const removal = await removeWorktree(root, { path: entry.path, kind, owner }, true, root)
        return { path: entry.path, kind, owner, due: true, reason: "its project is retired", preserved, ...removal }
    })
}

/**
 * The harness worktrees still left for every retired project of the host (a project retired before `project retire` removed
 * them, or whose removal was refused): no tick reaches a retired ledger, so each collector run removes them as `project retire`
 * does. `dryRun` lists them and changes nothing.
 */
const retiredLeftovers = async (dryRun: boolean): Promise<GcEntry[]> => {
    const repos = readMachine((db) => db.prepare("SELECT repo_root FROM ledgers WHERE state = 'retired'").all(), []).map((row) => String(row.repo_root))
    const found = await inOrder(repos, async (repo): Promise<GcEntry[]> => {
        if (!existsSync(join(repo, ".git"))) return []
        const stateWorktrees = join(projectDir(repo), "worktrees")
        const left = (await listWorktrees(repo).catch(() => [])).filter((entry) => inside(stateWorktrees, entry.path) !== undefined)
        if (left.length === 0) return []
        if (!dryRun) return retireWorktrees(repo)
        return left.map((entry) => ({ path: entry.path, kind: judge(repo, entry, stateWorktrees)?.kind ?? "orphan", owner: null, due: true, reason: "its project is retired", preserved: null, removed: false, detail: "" }))
    })
    return found.flat()
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
    const owned = [
        ...listed.flatMap((entry) => {
            const one = judge(root, entry, stateWorktrees)
            return one === undefined ? [] : [{ ...one, preserved: null, removed: false, detail: "" }]
        }),
        ...unlistedOpLeftovers(root, listed),
        ...(await landedPackages()),
    ]
    const judged: (GcEntry & { readonly repo?: string })[] = [...owned, ...busyLeftovers(root, owned)]
    const verify = dryRun ? [] : (await pruneVerifyWorktrees(root)).map((path): GcEntry => ({ path, kind: "orphan", owner: null, due: true, reason: "a clean-verify checkout whose verifier is gone", preserved: null, removed: true, detail: "pruned" }))
    const retired = await retiredLeftovers(dryRun)
    if (dryRun) return [...judged, ...retired]
    const done = await inOrder(judged, async ({ repo, ...entry }): Promise<GcEntry> => {
        if (!entry.due) return entry
        // A folder left busy waits for its backoff: nothing is preserved again or tried before then.
        const busy = (() => {
            const db = openExistingLedger(root)
            try {
                return db === undefined ? undefined : busyRecordOf(db, entry.path)
            } finally {
                db?.close()
            }
        })()
        if (busy !== undefined && !busyDue(busy) && existsSync(entry.path)) return { ...entry, due: false, busy: true, detail: `left busy (attempt ${String(busy.attempt)}); retried from ${busy.nextAt}` }
        const preserved = await preserveCheckout(root, entry.path)
        const removal =
            entry.kind === "op" && entry.owner !== null
                ? await removeOpWorktree(root, entry.owner).then((made) => (made === undefined ? removeWorktree(root, entry, true, repo) : { removed: made.removed, busy: made.busy === true, detail: made.detail }))
                : await removeWorktree(root, entry, entry.kind !== "package", repo)
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
    return [...done, ...verify, ...retired]
}
