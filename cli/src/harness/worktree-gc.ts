import { existsSync, readdirSync, realpathSync, statSync } from "node:fs"
import { join, relative, resolve, sep } from "node:path"
import { captureGit, git, gitCommonDir, isAncestor, mainCheckout, samePath } from "../shared/git.js"
import { Refusal } from "../shared/errors.js"
import { pruneVerifyWorktrees } from "./clean-verify.js"
import { opWorktreeOf, removeOpWorktree, removeTracked } from "./land.js"
import { openExistingLedger, openMachine, projectDir } from "./ledger.js"
import { readMachine } from "./machine.js"
import { pruneUnkeptPrior, settlePending } from "./prior.js"
import { inOrder } from "./sequential.js"
import { getTask, isTerminal, lastEvent, listTasks, recordEvent } from "./tasks.js"
import { busyDue, busyRecordOf, openBusyRecords } from "./worktree-busy.js"
import { getWorkflow } from "./workflow.js"
import { listProcesses, type HostProcess } from "./process-table.js"
import { inspectRemnant, preserveCheckout, quarantineRemnant } from "./worktree-preserve.js"

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
    /** A selected path failed a scope or liveness guard; no removal is attempted. */
    readonly blocked?: boolean
    /** An explicitly selected Git-less remnant was retained whole under verified project custody. */
    readonly quarantine?: "complete" | "held" | "changed"
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

/** A worker's worktree: due once the Supervisor ended the worker. */
const judgeWorker = (entry: Listed, first: string): Judged | undefined => {
    const machine = openMachine()
    try {
        const workers = machine.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'supervisor_workers'").get()
        const worker = workers === undefined ? undefined : machine.prepare("SELECT id, ended_at, ended_by FROM supervisor_workers WHERE id = ?").get(first)
        if (worker !== undefined) {
            const ended = worker.ended_at !== null
            return { path: entry.path, kind: "worker", owner: first, due: ended, reason: ended ? `worker ${first} was ${String(worker.ended_by ?? "ended")}` : `worker ${first} is live` }
        }
    } finally {
        machine.close()
    }
    return undefined
}

/** A workflow's worktree: due once the workflow ended and its Kernel is gone. */
const judgeWorkflow = (db: NonNullable<ReturnType<typeof openExistingLedger>>, entry: Listed, first: string): Judged => {
    const workflow = getWorkflow(db, first)
    const ended = ENDED_WORKFLOW.has(workflow.status) && (workflow.header.runner !== "orca" || workflow.kernel.closedAt !== null || workflow.kernel.terminal === null)
    return { path: entry.path, kind: "workflow", owner: first, due: ended, reason: ended ? `workflow ${first} is ${workflow.status}; its branch ${entry.branch ?? "-"} keeps its commits` : `workflow ${first} is ${workflow.status}` }
}

/** What a gc judges of one worktree before it is removed. */
type Judged = Omit<GcEntry, "preserved" | "removed" | "detail">

/** An Op worktree: due once its task ended and its Kernel settled it; an unknown task makes it an orphan. */
const judgeOp = (db: ReturnType<typeof openExistingLedger>, entry: Listed, second: string): Judged => {
    const task = db === undefined ? undefined : (() => { try { return getTask(db, second) } catch { return undefined } })()
    if (task === undefined) return { path: entry.path, kind: "orphan", owner: null, due: true, reason: `no task ${second} in the ledger` }
    const ended = isTerminal(task.status) && task.status !== "awaiting_owner" && task.intent === null
    // An ended attempt whose Kernel has not decided keeps its worktree: nothing is removed before its settle (harness/prior.ts).
    const pending = ended && db !== undefined && settlePending(db, task)
    const settled = ended && !pending
    let reason: string
    if (settled) reason = `task ${task.id} is ${task.status}`
    else if (pending) reason = `task ${task.id} is ${task.status}; its Kernel has not settled it (merge, discard or repair)`
    else reason = `task ${task.id} is ${task.status}${task.intent === null ? "" : " (" + task.intent + ")"}`
    return { path: entry.path, kind: "op", owner: task.id, due: settled, reason }
}

/** A harness worktree of one repository's state folder, with the owner whose end makes it due. */
const judge = (root: string, entry: Listed, stateWorktrees: string): Judged | undefined => {
    const rel = inside(stateWorktrees, entry.path)
    if (rel === undefined) return undefined
    const db = openExistingLedger(root)
    try {
        const [first = "", second] = rel.split("/")
        if (first.endsWith(".ops") && second !== undefined) {
            return judgeOp(db, entry, second)
        }
        if (db?.prepare("SELECT 1 FROM workflows WHERE id = ?").get(first) !== undefined) {
            return judgeWorkflow(db, entry, first)
        }
        const worker = judgeWorker(entry, first)
        if (worker !== undefined) return worker
        return { path: entry.path, kind: "orphan", owner: null, due: true, reason: `no task, workflow or worker of this project owns ${rel}` }
    } finally {
        db?.close()
    }
}

/** Canonical Git identity, including when a caller reaches a repository through a directory link. */
export const sameRepository = async (left: string, right: string): Promise<boolean> => {
    try {
        return samePath(realpathSync(await gitCommonDir(left)), realpathSync(await gitCommonDir(right)))
    } catch {
        return false
    }
}

/**
 * Removes one worktree (harness/land.ts removeTracked: reaped by harness/reap.ts, links unlinked, then `orca worktree rm` for a
 * worktree Orca lists, else git, under the folder's busy record in the ledger of `root`) from its own repository's main checkout
 * (a package edit worktree is the harness's), then prunes; its branch stays. A held folder is left busy for a later gc; `now`
 * tries one left busy whatever its backoff.
 */
const removeWorktree = async (root: string, entry: Pick<GcEntry, "path" | "kind" | "owner">, viaOrca: boolean, repo?: string, remnant = false, now = false): Promise<{ readonly removed: boolean; readonly busy: boolean; readonly detail: string }> => {
    const from = repo ?? (existsSync(join(entry.path, ".git")) ? await mainCheckout(entry.path).catch(() => root) : root)
    const removal = await removeTracked(root, { path: entry.path, repo: from, owner: entry.owner, kind: entry.kind, viaOrca, remnant, now })
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
            .filter((task) => isTerminal(task.status) && task.status !== "awaiting_owner" && task.intent === null && !settlePending(db, task) && lastEvent(db, "op-worktree-removed", task.id) === undefined)
            .flatMap((task): GcEntry[] => {
                const made = opWorktreeOf(db, task.id)
                if (made === undefined || !existsSync(made.path) || listed.some((entry) => samePath(entry.path, made.path))) return []
                return [{ path: made.path, kind: "op", owner: task.id, due: true, reason: `task ${task.id} is ${task.status}; git no longer lists its worktree but the folder stayed`, preserved: null, removed: false, detail: "" }]
            })
    } finally {
        db.close()
    }
}

/** How long an unlisted folder under the state worktrees folder must be untouched to count as a remnant: one git is still making is listed within moments. */
const REMNANT_QUIET_MS = 10 * 60_000

/** A collector entry, with the repository it is removed from when that is not the collected one, and whether it is a remnant. */
type Collected = GcEntry & { readonly repo?: string; readonly remnant?: boolean }

/** The entry a collector run reports, without the routing fields it was collected with. */
const reported = (entry: Collected): GcEntry => ({
    path: entry.path,
    kind: entry.kind,
    owner: entry.owner,
    due: entry.due,
    reason: entry.reason,
    preserved: entry.preserved,
    removed: entry.removed,
    detail: entry.detail,
    ...(entry.busy === undefined ? {} : { busy: entry.busy }),
    ...(entry.blocked === undefined ? {} : { blocked: entry.blocked }),
    ...(entry.quarantine === undefined ? {} : { quarantine: entry.quarantine }),
})

/**
 * The folders under a repository's state worktrees folder that git does not list and that hold no `.git`, quiet for
 * REMNANT_QUIET_MS (any age with `now`, the operator's word that nothing is being made there): a removal that deregistered the
 * worktree but stopped half way (a held folder, a file Windows would not let git delete). A `<workflow>.ops` folder is a
 * container, never a remnant; a link is never one either.
 */
const remnantsUnder = (repo: string, listed: readonly Listed[], now = false): Collected[] => {
    const state = join(projectDir(repo), "worktrees")
    if (!existsSync(state)) return []
    const folders = (at: string): string[] => readdirSync(at, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => join(at, entry.name))
    return folders(state)
        .flatMap((folder) => (folder.endsWith(".ops") ? folders(folder) : [folder]))
        .filter((path) => !existsSync(join(path, ".git")) && !listed.some((entry) => samePath(entry.path, path)) && (now || Date.now() - statSync(path).mtimeMs > REMNANT_QUIET_MS))
        .map((path) => ({ path, kind: "orphan", owner: null, due: true, reason: "git no longer lists it: a removal stopped half way", preserved: null, removed: false, detail: "", remnant: true }))
}

/** The busy records of the ledger (harness/worktree-busy.ts) no other entry covers, each due once its backoff ran out (or `now`). */
const busyLeftovers = (root: string, judged: readonly GcEntry[], now: boolean): (GcEntry & { readonly repo: string })[] => {
    const db = openExistingLedger(root)
    if (db === undefined) return []
    try {
        return openBusyRecords(db)
            .filter((record) => !judged.some((entry) => samePath(entry.path, record.path)))
            .map((record) => {
                const due = now || busyDue(record) || !existsSync(record.path)
                const holdersSuffix = record.holders === "" ? "" : ` (${record.holders})`
                const dueSuffix = due ? "" : `; retried from ${record.nextAt}`
                const reason = `left busy at attempt ${String(record.attempt)}${holdersSuffix}${dueSuffix}`
                return { path: record.path, kind: (WORKTREE_KINDS.has(record.kind as WorktreeKind) ? record.kind : "orphan") as WorktreeKind, owner: record.owner, due, reason, preserved: null, removed: false, busy: true, detail: "", repo: record.repo }
            })
    } finally {
        db.close()
    }
}

const WORKTREE_KINDS: ReadonlySet<WorktreeKind> = new Set<WorktreeKind>(["op", "workflow", "worker", "package", "orphan"])

/** The package edit worktrees of this Git repository whose handed-off head is on main. */
const landedPackages = async (root: string): Promise<GcEntry[]> => {
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
        if (!existsSync(worktree) || !(await sameRepository(root, harness)) || !(await sameRepository(root, worktree))) return undefined
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
        const snapshot = await preserveCheckout(root, entry.path)
        await snapshot?.verify()
        const removal = await removeWorktree(root, { path: entry.path, kind, owner }, true, root)
        return { path: entry.path, kind, owner, due: true, reason: "its project is retired", preserved: snapshot?.directory ?? null, ...removal }
    })
}

/**
 * The harness worktrees still left for a retired project of this Git repository (a project retired before `project retire` removed
 * them, or whose removal was refused): no tick reaches a retired ledger, so each collector run removes them as `project retire`
 * does. `dryRun` lists them and changes nothing.
 */
const retiredLeftovers = async (root: string, dryRun: boolean): Promise<GcEntry[]> => {
    const repos = readMachine((db) => db.prepare("SELECT repo_root FROM ledgers WHERE state = 'retired'").all(), []).map((row) => String(row.repo_root))
    const found = await inOrder(repos, async (repo): Promise<GcEntry[]> => {
        if (!existsSync(join(repo, ".git")) || !(await sameRepository(root, repo))) return []
        const stateWorktrees = join(projectDir(repo), "worktrees")
        const listed = await listWorktrees(repo).catch((): Listed[] => [])
        const left = listed.filter((entry) => inside(stateWorktrees, entry.path) !== undefined)
        const remnants = remnantsUnder(repo, listed).map((entry) => ({ ...reported(entry), reason: `its project is retired; ${entry.reason}` }))
        if (dryRun) return [...left.map((entry) => ({ path: entry.path, kind: judge(repo, entry, stateWorktrees)?.kind ?? "orphan", owner: null, due: true, reason: "its project is retired", preserved: null, removed: false, detail: "" })), ...remnants]
        const removed = left.length === 0 ? [] : await retireWorktrees(repo)
        const cleared = await inOrder(remnants, async (entry) => {
            const snapshot = await preserveCheckout(repo, entry.path)
            await snapshot?.verify()
            return { ...entry, preserved: snapshot?.directory ?? null, ...(await removeWorktree(repo, entry, false, repo, true)) }
        })
        return [...removed, ...cleared]
    })
    return found.flat()
}

/** Explicit legacy paths are an exclusive selection; caller identifies the directory invoking the verb. */
export interface GcSelection {
    readonly paths?: readonly string[]
    readonly caller?: string
}

const canonical = (path: string): string => realpathSync(resolve(path))
const contains = (folder: string, path: string): boolean => samePath(folder, path) || inside(folder, path) !== undefined

/** A live holder blocks collection; process arguments are inspected internally and are never included in the result. */
export const processBlockReason = (path: string, processes: readonly HostProcess[], callerPid = process.pid): string | undefined => {
    const table = new Map(processes.map((one) => [one.pid, one]))
    const own = new Set<number>([callerPid])
    let at = table.get(callerPid)
    while (at !== undefined && !own.has(at.ppid)) {
        own.add(at.ppid)
        at = table.get(at.ppid)
    }
    const spelling = (value: string): string => value.replaceAll("\\", "/").toLowerCase()
    const holder = processes.find((one) => {
        if (own.has(one.pid)) return false
        if (one.cwd !== null) {
            try {
                if (contains(path, existsSync(one.cwd) ? canonical(one.cwd) : resolve(one.cwd))) return true
            } catch {
                return true
            }
        }
        return spelling(one.commandLine).includes(spelling(path))
    })
    return holder === undefined ? undefined : `live or ambiguous holder pid ${String(holder.pid)}; finish its work before collecting`
}

const liveWorkerReason = (path: string): string | undefined => {
    const machine = openMachine()
    try {
        if (machine.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'supervisor_workers'").get() === undefined) return undefined
        const worker = machine.prepare("SELECT id, worktree FROM supervisor_workers WHERE ended_at IS NULL").all().find((row) => {
            const directory = String(row.worktree)
            const actual = existsSync(directory) ? canonical(directory) : resolve(directory)
            return contains(path, actual) || contains(actual, path)
        })
        return worker === undefined ? undefined : `worker ${String(worker.id)} is live`
    } finally {
        machine.close()
    }
}

/** Why a selected path is neither a listed linked worktree of this repository nor a proven project remnant; undefined when it is one. */
const provenanceGap = async (root: string, path: string, actual: string, entry: Listed | undefined): Promise<string | undefined> => {
    if (entry !== undefined) return (await sameRepository(root, actual)) ? undefined : "selected path is not a listed linked worktree of this repository"
    try {
        inspectRemnant(root, path)
        return undefined
    } catch (error: unknown) {
        return `selected path is not a listed linked worktree or a proven project remnant: ${error instanceof Error ? error.message : "provenance unavailable"}`
    }
}

/** Why a selected path still has a live holder: a live worker, a process working in it, or an unreadable process inventory. */
const liveReason = (actual: string, processes: Awaited<ReturnType<typeof listProcesses>>): string | undefined =>
    liveWorkerReason(actual) ?? (typeof processes === "string" ? "process inventory unavailable; liveness cannot be proved" : processBlockReason(actual, processes))

/** One explicitly selected path: blocked when it is protected or live, else due with its owner's judgement or as a project remnant. */
const selectOne = async (requested: string, found: { readonly root: string; readonly listed: readonly Listed[]; readonly known: readonly Collected[]; readonly selection: GcSelection; readonly main: string; readonly callers: readonly string[]; readonly processes: Awaited<ReturnType<typeof listProcesses>> }): Promise<Collected> => {
    const { root, listed, known, selection, main, callers, processes } = found
    const path = resolve(selection.caller ?? process.cwd(), requested)
    const base: Collected = { path, kind: "orphan", owner: null, due: false, reason: "", preserved: null, removed: false, detail: "" }
    const blocked = (reason: string): Collected => ({ ...base, reason, blocked: true })
    if (!existsSync(path)) return blocked("selected path does not exist")
    const actual = canonical(path)
    if (samePath(main, actual)) return blocked("the primary checkout is protected")
    if (callers.some((caller) => contains(actual, caller))) return blocked("the caller's checkout is protected")
    const entry = listed.find((one) => existsSync(one.path) && samePath(canonical(one.path), actual))
    const unprovable = await provenanceGap(root, path, actual, entry)
    if (unprovable !== undefined) return blocked(unprovable)
    const owner = entry === undefined ? judge(root, { path, branch: null }, join(projectDir(root), "worktrees")) : known.find((one) => samePath(one.path, entry.path))
    if (owner !== undefined && !owner.due) return blocked(owner.reason)
    const held = liveReason(actual, processes)
    if (held !== undefined) return blocked(held)
    return { ...base, ...owner, path: entry?.path ?? path, due: true, reason: entry === undefined ? "explicitly selected project remnant; quarantine all bytes and unlink dependency links without deleting" : "explicitly selected linked worktree; preserve its work and references before removal", ...(entry === undefined ? { remnant: true } : {}) }
}

const selectedPaths = async (root: string, listed: readonly Listed[], known: readonly Collected[], selection: GcSelection): Promise<Collected[]> => {
    const main = canonical(await mainCheckout(root))
    const callers = [canonical(process.cwd()), canonical(selection.caller ?? process.cwd())]
    const processes = await listProcesses(true)
    return inOrder([...new Set(selection.paths ?? [])], async (requested): Promise<Collected> => {
        return selectOne(requested, { root, listed, known, selection, main, callers, processes })
    })
}

/** Every worktree the harness made for the repository that is judged, the unlisted Op leftovers, the landed packages and the project remnants. */
const knownWorktrees = async (root: string, listed: readonly Listed[], stateWorktrees: string, now: boolean): Promise<Collected[]> => {
    const owned = [
        ...listed.flatMap((entry) => {
            const one = judge(root, entry, stateWorktrees)
            return one === undefined ? [] : [{ ...one, preserved: null, removed: false, detail: "" }]
        }),
        ...unlistedOpLeftovers(root, listed),
        ...(await landedPackages(root)),
    ]
    const remnants = remnantsUnder(root, listed, now).filter((remnant) => !owned.some((entry) => samePath(entry.path, remnant.path)))
    const known: Collected[] = [...owned, ...remnants]
    return known
}

/** The busy record of a worktree folder in the ledger of `root`, if one is held. */
const busyOf = (root: string, path: string): ReturnType<typeof busyRecordOf> => {
    const db = openExistingLedger(root)
    try {
        return db === undefined ? undefined : busyRecordOf(db, path)
    } finally {
        db?.close()
    }
}

/** The entry when its folder and its repository are this project's; nothing otherwise. */
const sameRepositoryEntry = async (root: string, stateWorktrees: string, entry: Collected): Promise<Collected[]> => {
    const repo = entry.repo ?? (existsSync(join(entry.path, ".git")) ? entry.path : root)
    const pathOwned = existsSync(join(entry.path, ".git")) ? await sameRepository(root, entry.path) : inside(stateWorktrees, entry.path) !== undefined
    return pathOwned && (await sameRepository(root, repo)) ? [entry] : []
}

/** An explicitly selected project remnant: every byte quarantined (re-judged first), recorded as a gc event. */
const quarantineSelected = async (root: string, found: { readonly collected: Collected; readonly entry: GcEntry; readonly selection: GcSelection }): Promise<GcEntry> => {
    const { collected, entry, selection } = found
        const custody = await quarantineRemnant(root, entry.path, async () => {
            const fresh = (await selectedPaths(root, await listWorktrees(root), [collected], { paths: [entry.path], caller: selection.caller ?? process.cwd() }))[0]
            if (fresh === undefined || fresh.blocked === true || !fresh.due) throw new Refusal("WORKTREE_GC_BLOCKED", fresh?.reason ?? "selected remnant scope cannot be proved; nothing moved")
        })
        const result = { ...entry, preserved: custody.directory, removed: custody.removed, quarantine: custody.quarantine, detail: custody.detail }
        const db = openExistingLedger(root)
        try {
            if (db !== undefined) recordEvent(db, "worktree-gc", entry.owner, result)
        } finally {
            db?.close()
        }
        return result
}

/** The selected path as it stands now, when it became blocked since it was judged; undefined while it still may go. */
const blockedNow = async (root: string, collected: Collected, selection: GcSelection): Promise<GcEntry | undefined> => {
    const [fresh] = await selectedPaths(root, await listWorktrees(root), [collected], { paths: [collected.path], caller: selection.caller ?? process.cwd() })
    return fresh?.blocked === true ? reported(fresh) : undefined
}

/** Removes the worktree: an Op through its owner's removal, any other directly. */
const removeFor = async (root: string, entry: GcEntry, how: { readonly explicit: boolean; readonly now: boolean; readonly repo: string | undefined; readonly remnant: boolean | undefined }): Promise<Awaited<ReturnType<typeof removeWorktree>>> => {
    const { explicit, now, repo, remnant } = how
    const removal =
        !explicit && entry.kind === "op" && entry.owner !== null
            ? await removeOpWorktree(root, entry.owner, now).then((made) => (made === undefined ? removeWorktree(root, entry, true, repo, false, now) : { removed: made.removed, busy: made.busy === true, detail: made.detail }))
            : await removeWorktree(root, entry, entry.kind !== "package" && remnant !== true, repo, remnant === true, now)
    return removal
}

/** A folder left busy waits for its backoff: the entry says so, and nothing is preserved again or tried before then. */
const busyHold = (root: string, entry: GcEntry, now: boolean): GcEntry | undefined => {
    const busy = busyOf(root, entry.path)
    if (busy !== undefined && !now && !busyDue(busy) && existsSync(entry.path)) {
        const holdersSuffix = busy.holders === "" ? "" : `; ${busy.holders}`
        return { ...entry, due: false, busy: true, detail: `left busy (attempt ${String(busy.attempt)}${holdersSuffix}); retried from ${busy.nextAt}` }
    }
    return undefined
}

/** One due worktree: preserved, re-judged when it was selected, then removed, and recorded as a gc event. */
const removeCollected = async (root: string, collected: Collected, run: { readonly explicit: boolean; readonly now: boolean; readonly selection: GcSelection }): Promise<GcEntry> => {
    const { explicit, now, selection } = run
    const { repo, remnant } = collected
    const entry = reported(collected)
    if (!entry.due) return entry
    // A folder left busy waits for its backoff: nothing is preserved again or tried before then.
    const waiting = busyHold(root, entry, now)
    if (waiting !== undefined) return waiting
    if (explicit) {
        const blocked = await blockedNow(root, collected, selection)
        if (blocked !== undefined) return blocked
    }
    if (explicit && remnant === true) {
        return await quarantineSelected(root, { collected, entry, selection })
    }
    const snapshot = await preserveCheckout(root, entry.path)
    await snapshot?.verify()
    if (explicit) {
        const blocked = await blockedNow(root, collected, selection)
        if (blocked !== undefined) return { ...blocked, preserved: snapshot?.directory ?? null }
        await snapshot?.verify()
    }
    const removal = await removeFor(root, entry, { explicit, now, repo, remnant })
    const db = openExistingLedger(root)
    if (db !== undefined) {
        try {
            recordEvent(db, "worktree-gc", entry.owner, { path: entry.path, kind: entry.kind, reason: entry.reason, preserved: snapshot?.directory ?? null, ...removal })
        } finally {
            db.close()
        }
    }
    return { ...entry, preserved: snapshot?.directory ?? null, ...removal }
}

/**
 * The worktree collector: every worktree the harness made for a repository is judged by its owner (an Op's task settled, a
 * workflow done or stopped with its Kernel closed, a Supervisor's worker accepted or rejected, a package edit landed on main)
 * or found an orphan no ledger row owns; clean-verify checkouts whose verifier is gone are pruned. A due worktree's uncommitted
 * work is preserved first, it is reaped (harness/reap.ts: its Orca terminals closed, the processes the harness started in it or
 * that work inside it ended), its install links are unlinked (link only, never a recursive delete through one), then it is
 * removed, git prunes and Orca drops it; branches stay, so nothing committed is lost. A folder still held names its holder and is
 * retried with backoff, or at once with `now`. `dryRun` judges and changes nothing.
 */
export const worktreeGc = async (root: string, dryRun: boolean, now = false, selection: GcSelection = {}): Promise<GcEntry[]> => {
    const stateWorktrees = join(projectDir(root), "worktrees")
    const listed = await listWorktrees(root)
    const known = await knownWorktrees(root, listed, stateWorktrees, now)
    const candidates: Collected[] = [...known, ...busyLeftovers(root, known, now)]
    const scoped = await inOrder(candidates, async (entry): Promise<Collected[]> => {
        return sameRepositoryEntry(root, stateWorktrees, entry)
    })
    const explicit = (selection.paths?.length ?? 0) > 0
    const judged = explicit ? await selectedPaths(root, listed, scoped.flat(), selection) : scoped.flat()
    // Explicit selection has no incidental sweep or prior pruning outside those paths.
    const verify = dryRun || explicit ? [] : (await pruneVerifyWorktrees(root, true)).map((path): GcEntry => ({ path, kind: "orphan", owner: null, due: true, reason: "a clean-verify checkout whose verifier is gone", preserved: null, removed: true, detail: "pruned" }))
    const retired = explicit ? [] : await retiredLeftovers(root, dryRun)
    if (dryRun) return [...judged.map(reported), ...retired]
    if (explicit && judged.some((entry) => entry.blocked === true)) return judged.map(reported)
    // The prior-work store keeps one patch per key, of a kept kind only; each other row is dropped with a prior-dropped event.
    if (!explicit) pruneUnkeptPrior(root)
    const done = await inOrder(judged, async (collected): Promise<GcEntry> => {
        return removeCollected(root, collected, { explicit, now, selection })
    })
    return [...done, ...verify, ...retired]
}
