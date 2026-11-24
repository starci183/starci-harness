import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from "node:fs"
import { basename, isAbsolute, join, relative, resolve } from "node:path"
import { CHECK_CACHE_DIR, captureGitSync } from "../shared/git.js"
import { freeDiskMb } from "./host-floors.js"
import { listProcesses } from "./process-table.js"
import type { HostProcess } from "./process-table.js"
import { readStatuses } from "./land-queue.js"
import { releaseRemoveLock, removeLockOf, takeRemoveLock } from "./remove-lock.js"
import { RECLAIMABLE, judgeHolder, liveProbe, slotKind, slotsOfLane, readHolder, worktreesUnder } from "./slots.js"
import type { SlotRules } from "./slots.js"
import { busySubject } from "./worktree-busy.js"
import { deleteTree, findLinks, unlinkLinks } from "./worktree-remove.js"
import type { FoundLink } from "./worktree-remove.js"

/**
 * The install janitor: a lane worktree that landed, or sat idle, keeps a full install (node_modules, a Next build, package builds) of several
 * GB, and some sixty of them filled the lanes drive twice (ENOSPC in the next gate's npm ci). The janitor deletes the reinstallable folders of
 * such a worktree, the ignored folders named in `janitor.dirs` of ops/slots.yaml and the leftovers of a failed safe install (`.starci-trash-`),
 * and keeps everything git tracks, the branch and the worktree itself; the next `lane gate` installs again (it installs whenever node_modules is
 * missing). It runs on the batch lander's land step for each landed lane and as `starci lane prune-installs` for idle worktrees.
 *
 * Every deletion is link-safe, as `lane remove` is (harness/worktree-remove.ts): under the worktree's removal lock (so no install links
 * meanwhile), a folder that is itself a link is unlinked, never entered; a real folder has every link in it unlinked first, a second walk must
 * find none, it is moved aside into `<lanes>/_prune-trash/` (a folder in use refuses the move, so a half-deleted install is never left in place)
 * and deleted there with lstat on every entry. A worktree is never touched while it is live: a removal lock on it, a slot of its lane not proven
 * gone, a git operation under way (index.lock), a running process whose working folder or command line lies inside it, uncommitted work in it,
 * commits on its branch after the landed sha (the lane moved on to a follow-up), or a touch within `janitor.touchedMinutes` (default 60).
 */

/** One folder the janitor would delete. */
export interface InstallTarget {
    readonly path: string
    /** Relative to the worktree, slash-separated. */
    readonly relative: string
    /** The folder is itself a link (a junction to an install cache): it is unlinked, never entered. */
    readonly link: boolean
}

/** A lane worktree of the lanes folder as the janitor sees it. */
export interface LaneTree {
    readonly path: string
    readonly lane: string
    readonly branch: string
}

const slashed = (path: string): string => path.replaceAll("\\", "/")

const inside = (outer: string, inner: string): boolean => {
    const rel = relative(resolve(outer), resolve(inner))
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)
}

/**
 * The lane worktrees under the lanes folder `root`: registered worktrees of the repositories there, inside `root`, on a `lane/<lane>` branch,
 * whose folder does not start with `_` (the lander's worktree, the CLI builds and other harness-owned checkouts keep their installs).
 */
export const laneTrees = (root: string): LaneTree[] =>
    (worktreesUnder(root)?.worktrees ?? []).flatMap((entry) => {
        if (entry.branch?.startsWith("lane/") !== true || !inside(root, entry.path) || basename(entry.path).startsWith("_") || !existsSync(entry.path)) return []
        return [{ path: entry.path, lane: entry.branch.slice("lane/".length), branch: entry.branch }]
    })

/** Whether an ignored entry `git ls-files --directory` lists is a janitor folder: its last segment one of `dirs`, or a safe install's trash. Pure. */
export const isInstallEntry = (entry: string, dirs: readonly string[]): boolean => {
    const last = entry.replace(/\/$/u, "").split("/").at(-1) ?? ""
    return dirs.includes(last) || last.includes(".starci-trash-")
}

/** The janitor folders of a worktree, from git's own listing of what it ignores (and untracked safe-install trash); never a tracked path. */
export const installTargets = (worktree: string, dirs: readonly string[]): InstallTarget[] => {
    const listed = new Set<string>()
    for (const args of [["ls-files", "--others", "--ignored", "--exclude-standard", "--directory"], ["ls-files", "--others", "--exclude-standard", "--directory"]]) {
        const run = captureGitSync(args, worktree)
        if (run.exitCode !== 0) continue
        for (const line of run.stdout.split(/\r?\n/)) {
            const entry = line.trim().replace(/\/$/u, "")
            if (entry !== "" && isInstallEntry(entry, dirs)) listed.add(entry)
        }
    }
    return [...listed].sort((left, right) => left.localeCompare(right)).flatMap((entry) => {
        const path = join(worktree, entry)
        const stat = lstatSync(path, { throwIfNoEntry: false })
        if (stat === undefined) return []
        if (!stat.isSymbolicLink() && !stat.isDirectory()) return []
        return [{ path, relative: entry, link: stat.isSymbolicLink() }]
    })
}

/** The MB a folder holds, read with lstat on every entry and never through a link. */
export const sizeMb = (path: string): number => {
    let bytes = 0
    const walk = (at: string): void => {
        let entries
        try {
            entries = readdirSync(at, { withFileTypes: true })
        } catch {
            return
        }
        for (const entry of entries) {
            const full = join(at, entry.name)
            if (entry.isSymbolicLink()) continue
            if (entry.isDirectory()) walk(full)
            else bytes += lstatSync(full, { throwIfNoEntry: false })?.size ?? 0
        }
    }
    if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink() !== true) walk(path)
    return Math.round(bytes / 1_048_576)
}

/** The git folder of a worktree (the `.git` file's gitdir), or undefined. */
const gitDirOf = (worktree: string): string | undefined => {
    const dotGit = join(worktree, ".git")
    try {
        if (statSync(dotGit).isDirectory()) return dotGit
        const gitdir = /^gitdir:\s*(\S.*)$/m.exec(readFileSync(dotGit, "utf8"))?.[1]?.trim()
        return gitdir === undefined ? undefined : resolve(worktree, gitdir)
    } catch {
        return undefined
    }
}

/** When the worktree last moved, epoch ms: the newest of its git index, HEAD and HEAD log, and of the entries at its top level (lstat). */
export const lastActivityMs = (worktree: string): number => {
    const gitdir = gitDirOf(worktree)
    const files = [...(gitdir === undefined ? [] : [join(gitdir, "index"), join(gitdir, "HEAD"), join(gitdir, "logs", "HEAD")])]
    try {
        for (const name of readdirSync(worktree)) files.push(join(worktree, name))
    } catch {
        // an unreadable worktree reads as old as its git files
    }
    return Math.max(0, ...files.map((file) => lstatSync(file, { throwIfNoEntry: false })?.mtimeMs ?? 0))
}

/** What the live checks read once for many worktrees: the lanes folder, its slot rules and the process table (with working folders). */
export interface LiveContext {
    readonly root: string
    readonly rules: SlotRules
    /** The process table, or why it could not be read (then every worktree is held: nothing proves it idle). */
    readonly processes: readonly HostProcess[] | string
    /** This process and its ancestors, never counted as working in a worktree. */
    readonly spared: ReadonlySet<number>
}

/** Reads the live context once. */
export const liveContext = async (root: string, rules: SlotRules): Promise<LiveContext> => {
    const processes = await listProcesses(true)
    const spared = new Set<number>([process.pid])
    if (typeof processes !== "string") {
        const table = new Map(processes.map((item) => [item.pid, item]))
        let at = table.get(process.pid)
        for (let hops = 0; hops < 64 && at !== undefined && !spared.has(at.ppid); hops += 1) {
            spared.add(at.ppid)
            at = table.get(at.ppid)
        }
    }
    return { root, rules, processes, spared }
}

/** The minutes a worktree counts as in use after its last touch, when ops/slots.yaml names none. */
export const TOUCHED_MINUTES = 60

/** The uncommitted work of a worktree: what `git status` lists outside the janitor's own folders (a safe install's trash is not work). Empty when clean or unreadable. */
export const uncommittedWork = (worktree: string, dirs: readonly string[], cacheIsNotWork = false): string[] => {
    const run = captureGitSync(["status", "--porcelain", "--untracked-files=normal"], worktree)
    if (run.exitCode !== 0) return []
    return run.stdout.split(/\r?\n/).flatMap((line) => {
        const path = line.trim().replace(/^[^ ]+ +/u, "").replace(/^"|"$/gu, "")
        return path === "" || isInstallEntry(path, dirs) || (cacheIsNotWork && path.startsWith(CHECK_CACHE_DIR)) ? [] : [path]
    })
}

/** The commits the worktree's HEAD holds after `landed` (the sha the lane landed at); 0 when it is the landed sha or behind it, or either is unknown. */
export const commitsAfter = (worktree: string, landed: string): number => {
    const run = captureGitSync(["rev-list", "--count", `${landed}..HEAD`], worktree)
    return run.exitCode === 0 ? Number(run.stdout.trim()) || 0 : 0
}

/** The sha a lane landed with (the lane's own sha its status file records), or undefined. */
export const landedShaOf = (root: string, lane: string): string | undefined => readStatuses(root).find((status) => status.lane === lane && status.state === "landed")?.laneSha

/**
 * Why a worktree is live and must keep its install, each reason one clause; empty when nothing holds it: a removal lock on it, a slot of its lane
 * not proven gone, a git operation under way (index.lock), a process (not this one or its ancestors) whose working folder or command line lies
 * inside it, a process table that could not be read, uncommitted work, commits after `landedSha` (the lane's branch moved on), or a touch within
 * `janitor.touchedMinutes` of ops/slots.yaml (default 60). `now` is the clock (epoch ms). `afterLanding` is the land cleanup's question
 * (harness/land-cleanup.ts): the lane has just landed, so its own touch says nothing (that rule is skipped) and the check-cache records under
 * `.starcistacks/cache/` are no work (they may be discarded); every other reason stands.
 */
export const liveReasons = (tree: LaneTree, context: LiveContext, landedSha?: string, now: number = Date.now(), afterLanding = false): string[] => {
    const reasons: string[] = []
    const lock = removeLockOf(tree.path, context.root)
    if (lock !== undefined) reasons.push(`being removed by ${lock.lane} (pid ${String(lock.pid)})`)
    const probe = liveProbe(context.root)
    for (const slot of slotsOfLane(context.root, context.rules, tree.lane)) {
        const read = readHolder(slot.file)
        if (read !== undefined && !RECLAIMABLE.has(judgeHolder(slotKind(context.rules, slot.kind), read, probe).state)) reasons.push(`lane ${tree.lane} holds ${slot.kind} slot ${String(slot.n)}`)
    }
    const gitdir = gitDirOf(tree.path)
    if (gitdir !== undefined && existsSync(join(gitdir, "index.lock"))) reasons.push("a git operation is under way (index.lock)")
    if (typeof context.processes === "string") reasons.push(`the process table could not be read (${context.processes})`)
    else {
        const key = busySubject(tree.path)
        const within = (path: string): boolean => {
            const at = busySubject(path)
            return at === key || at.startsWith(`${key}/`)
        }
        const inLine = (line: string): boolean => slashed(line).toLowerCase().includes(`${key.toLowerCase()}/`) || slashed(line).toLowerCase().endsWith(key.toLowerCase())
        for (const item of context.processes) {
            if (context.spared.has(item.pid)) continue
            if ((item.cwd !== null && within(item.cwd)) || inLine(item.commandLine)) reasons.push(`pid ${String(item.pid)} ${item.name} works there`)
        }
    }
    const dirs = context.rules.janitor?.dirs ?? []
    const work = uncommittedWork(tree.path, dirs, afterLanding)
    if (work.length > 0) reasons.push(`uncommitted work (${work.slice(0, 3).join(", ")}${work.length > 3 ? ", ..." : ""})`)
    const ahead = landedSha === undefined ? 0 : commitsAfter(tree.path, landedSha)
    if (ahead > 0) reasons.push(`its branch has ${String(ahead)} commit(s) after the landed sha ${String(landedSha).slice(0, 10)}`)
    const touched = context.rules.janitor?.touchedMinutes ?? TOUCHED_MINUTES
    const sinceMinutes = Math.round((now - lastActivityMs(tree.path)) / 60_000)
    if (!afterLanding && sinceMinutes < touched) reasons.push(`touched ${String(Math.max(0, sinceMinutes))} min ago, under ${String(touched)} min`)
    return reasons
}

/** What deleting one target did. */
export interface PrunedTarget {
    readonly target: InstallTarget
    readonly unlinked: number
    readonly entries: number
    /** Why it was kept, when it was. */
    readonly kept?: string
}

/** Moves a folder aside into the trash of the lanes folder; the folder itself when the move fails across drives, undefined when it is in use. */
const moveAside = (path: string, trash: string, lane: string, index: number): string | undefined => {
    mkdirSync(trash, { recursive: true })
    const aside = join(trash, `${lane}-${String(Date.now())}-${String(process.pid)}-${String(index)}`)
    try {
        renameSync(path, aside)
        return aside
    } catch (error) {
        const code = error instanceof Error && "code" in error ? error.code : undefined
        return code === "EXDEV" ? path : undefined
    }
}

/** Deletes one target link-safely (see the module): a link is unlinked; a folder is unlinked inside, checked link-free, moved aside and deleted. */
const pruneTarget = (target: InstallTarget, trash: string, lane: string, index: number): PrunedTarget => {
    if (target.link) {
        const link: FoundLink = { path: target.path, relative: target.relative, target: "", directory: true, targetExists: false }
        unlinkLinks([link])
        return { target, unlinked: 1, entries: 0 }
    }
    const links = findLinks(target.path)
    unlinkLinks(links)
    const left = findLinks(target.path)
    if (left.length > 0) return { target, unlinked: links.length, entries: 0, kept: `a link remains after unlinking: ${left.map((link) => link.relative).join(", ")}` }
    const aside = moveAside(target.path, trash, lane, index)
    if (aside === undefined) return { target, unlinked: links.length, entries: 0, kept: "in use (the folder could not be moved aside): nothing deleted" }
    return { target, unlinked: links.length, entries: deleteTree(aside) }
}

/** What a prune of one worktree did. */
export interface PrunedTree {
    readonly tree: LaneTree
    readonly targets: readonly PrunedTarget[]
    /** The MB the drive gained over the prune. */
    readonly freedMb: number | null
}

/** Prunes the install of one worktree under its removal lock (taken in the lanes folder `root`); each target is pruned or kept with why. */
export const pruneTree = (tree: LaneTree, targets: readonly InstallTarget[], root: string): PrunedTree => {
    const before = freeDiskMb(root)
    const lock = takeRemoveLock(tree.path, tree.lane, root)
    const done: PrunedTarget[] = []
    try {
        targets.forEach((target, index) => {
            try {
                done.push(pruneTarget(target, join(root, "_prune-trash"), tree.lane, index))
            } catch (error) {
                done.push({ target, unlinked: 0, entries: 0, kept: error instanceof Error ? error.message : String(error) })
            }
        })
    } finally {
        releaseRemoveLock(lock)
    }
    const after = freeDiskMb(root)
    return { tree, targets: done, freedMb: before === null || after === null ? null : after - before }
}

/** Deletes what an earlier prune left in `<root>/_prune-trash/` (a delete that stopped half way), link-safely; the entries removed. */
export const emptyTrash = (root: string): number => {
    const trash = join(root, "_prune-trash")
    let names: string[]
    try {
        names = readdirSync(trash)
    } catch {
        return 0
    }
    let count = 0
    for (const name of names) {
        const path = join(trash, name)
        try {
            if (lstatSync(path).isSymbolicLink()) {
                unlinkLinks([{ path, relative: name, target: "", directory: true, targetExists: false }])
                continue
            }
            unlinkLinks(findLinks(path))
            if (findLinks(path).length === 0) count += deleteTree(path)
        } catch {
            // left for the next prune
        }
    }
    return count
}

/** The lane worktree of `lane` under the lanes folder, if it has one the janitor may take. */
export const laneTreeOf = (root: string, lane: string): LaneTree | undefined => laneTrees(root).find((tree) => tree.lane === lane || basename(tree.path) === lane)

/**
 * The land step of the janitor: prunes the install of a landed lane's worktree unless it is live (`liveReasons`), saying what it did or why
 * not. It never fails the lander.
 */
export const pruneLanded = async (root: string, rules: SlotRules, lane: string, say: (line: string) => void): Promise<PrunedTree | undefined> => {
    try {
        const janitor = rules.janitor
        if (janitor === undefined) return undefined
        const tree = laneTreeOf(root, lane)
        if (tree === undefined) return undefined
        const reasons = liveReasons(tree, await liveContext(root, rules), landedShaOf(root, lane))
        if (reasons.length > 0) {
            say(`janitor: kept the install of landed lane ${lane} (${tree.path}): ${reasons.join("; ")}; starci lane prune-installs takes it once idle`)
            return undefined
        }
        const targets = installTargets(tree.path, janitor.dirs)
        if (targets.length === 0) return undefined
        const pruned = pruneTree(tree, targets, root)
        say(`janitor: ${pruneLine(pruned)}`)
        return pruned
    } catch (error) {
        say(`janitor: could not prune the install of ${lane}: ${error instanceof Error ? error.message : String(error)}`)
        return undefined
    }
}

/** One line of a pruned worktree. Pure. */
export const pruneLine = (pruned: PrunedTree): string => {
    const gone = pruned.targets.filter((target) => target.kept === undefined)
    const kept = pruned.targets.filter((target) => target.kept !== undefined)
    return `${pruned.tree.lane} (${pruned.tree.path}): deleted ${gone.map((target) => target.target.relative).join(", ") || "nothing"}${pruned.freedMb === null ? "" : `, ${String(Math.max(0, pruned.freedMb))} MB freed`}${kept.length === 0 ? "" : `; kept ${kept.map((target) => `${target.target.relative} (${String(target.kept)})`).join(", ")}`}`
}
