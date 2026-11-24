import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { CHECK_CACHE_DIR, mainCheckout, samePath } from "../shared/git.js"
import { laneTrees, liveContext, liveReasons } from "./install-janitor.js"
import type { LaneTree, LiveContext } from "./install-janitor.js"
import { loadSlotRules, releaseLaneSlots } from "./slots.js"
import type { SlotRules } from "./slots.js"
import { planRemoval, removeWorktree } from "./worktree-remove.js"
import type { RemovePlan, Removed } from "./worktree-remove.js"

/**
 * The cleanup after a landing (`lane gate --push --land`, contexts/authority/lanes.md "Gate and land" step 5; owner 2026-11-24): once the push of dev
 * succeeded, the lane's worktree is removed to save disk, the branch kept, local and remote. It is the same removal as `starci lane remove`
 * (harness/worktree-remove.ts: the removal lock, every link unlinked as a link, a lstat-checked delete) behind the install janitor's in-use guard
 * (harness/install-janitor.ts `liveReasons`, told the lane just landed): a removal lock, a slot of the lane, a git operation, a process working
 * inside the worktree, uncommitted work, commits after the landed sha keep it. The check-cache records under `.starcistacks/cache/` are no work and
 * are discarded with the worktree.
 *
 * The command runs inside the worktree, and Windows cannot delete a folder a live process stands in. So the process leaves it first (`process.chdir`
 * to the repository's main checkout) and removes in-process, which lets the one line the command prints be true. A node_modules delete can still hit
 * EBUSY, EPERM or ENOTEMPTY while an antivirus scans (or a shell of the caller stands in the folder): the removal is retried with backoff, and when
 * it still fails a marker is left in `<lanes>/_land-cleanup/<lane>.json` for the next `starci lane remove` (which clears it) or the next
 * `starci lane prune-installs --execute` (the janitor, `sweepCleanupMarkers`), never failing the landing. This module never throws.
 */

/** What the cleanup did: the one line printed, and the data of it. */
export interface LandCleanup {
    readonly removed: boolean
    /** `worktree removed` or `kept: <reason>`. */
    readonly line: string
    /** The marker left for a later removal, when the worktree was busy. */
    readonly marker?: string
}

/** What a marker says. */
export interface CleanupMarker {
    readonly lane: string
    readonly worktree: string
    readonly branch: string
    /** The lane's own sha at the landing: the janitor guard keeps the worktree when its branch moved past it. */
    readonly laneSha: string
    readonly at: string
    readonly reason: string
}

/** The seams of a cleanup, real by default; the specs hand in their own. */
export interface CleanupDeps {
    /** Leaves the worktree: the process's working folder becomes `folder`. */
    readonly leave: (folder: string) => void
    readonly sleep: (ms: number) => Promise<void>
    readonly remove: (plan: RemovePlan, lane: string) => Promise<Removed>
    /** The live context the in-use guard reads (the process table, the slots). */
    readonly live: (dir: string, rules: SlotRules) => Promise<LiveContext>
    readonly attempts: number
    readonly baseMs: number
    readonly capMs: number
}

export const realCleanupDeps: CleanupDeps = {
    leave: (folder) => {
        process.chdir(folder)
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    remove: (plan, lane) => removeWorktree(plan, lane, () => undefined),
    live: liveContext,
    attempts: 6,
    baseMs: 500,
    capMs: 8000,
}

/** The folder of the markers. */
export const markerFolder = (dir: string): string => join(dir, "_land-cleanup")

const markerFile = (dir: string, lane: string): string => join(markerFolder(dir), `${lane}.json`)

/** Errors a host throws while it still holds a file: an antivirus scan, a shell standing in the folder. */
const TRANSIENT = new Set(["EBUSY", "EPERM", "ENOTEMPTY", "EACCES", "EMFILE"])

/** The code of an error when it is a busy host, else undefined. */
export const transientCode = (error: unknown): string | undefined => {
    const code = error instanceof Error && "code" in error ? String(error.code) : undefined
    if (code !== undefined && TRANSIENT.has(code)) return code
    const found = /\b(EBUSY|EPERM|ENOTEMPTY|EACCES)\b/.exec(error instanceof Error ? error.message : String(error))
    return found?.[1]
}

/** The first line of an error, short enough for the one line printed. */
const firstLine = (error: unknown): string => ((error instanceof Error ? error.message : String(error)).split(/\r?\n/)[0] ?? "").slice(0, 300)

/** Writes the marker of a worktree that could not be removed yet. */
const leaveMarker = (dir: string, marker: CleanupMarker): string => {
    mkdirSync(markerFolder(dir), { recursive: true })
    const file = markerFile(dir, marker.lane)
    writeFileSync(file, `${JSON.stringify(marker, null, 2)}\n`)
    return file
}

/** The markers of the lanes folder, unreadable files skipped. */
export const readMarkers = (dir: string): CleanupMarker[] => {
    let names: string[]
    try {
        names = readdirSync(markerFolder(dir))
    } catch {
        return []
    }
    return names.flatMap((name) => {
        try {
            const marker = JSON.parse(readFileSync(join(markerFolder(dir), name), "utf8")) as Partial<CleanupMarker>
            return typeof marker.lane === "string" && typeof marker.worktree === "string" ? [{ lane: marker.lane, worktree: marker.worktree, branch: marker.branch ?? "", laneSha: marker.laneSha ?? "", at: marker.at ?? "", reason: marker.reason ?? "" }] : []
        } catch {
            return []
        }
    })
}

/** Deletes the marker of a lane (its worktree is gone, or `lane remove` took it). */
export const clearMarker = (dir: string, lane: string): void => {
    rmSync(markerFile(dir, lane), { force: true })
}

/** Deletes the markers that name `worktree` (`lane remove` took it): the folder is gone, nothing is left to retry. */
export const clearMarkersOf = (dir: string, worktree: string): void => {
    for (const marker of readMarkers(dir)) if (samePath(marker.worktree, worktree)) clearMarker(dir, marker.lane)
}

/** The lane worktree at `path` as the janitor sees it, or undefined when it is none (the main checkout, a `_` folder, a folder outside the lanes folder, a non-lane branch). */
const treeAt = (dir: string, path: string): LaneTree | undefined => laneTrees(dir).find((tree) => samePath(tree.path, path))

/** The path of a `git status --porcelain` line, whether or not its leading space survived the capture. */
const pathOf = (line: string): string => line.replace(/^\s*\S+\s+/u, "").replace(/^"|"$/gu, "")

/** True for a change of the check-cache records, the one kind of tracked change a landed worktree may lose. */

const isCacheChange = (line: string): boolean => pathOf(line).startsWith(CHECK_CACHE_DIR)

/** The result of one removal attempt chain: removed, kept for a reason, or busy past the retries. */
type Attempt = { readonly state: "removed" } | { readonly state: "kept"; readonly reason: string } | { readonly state: "busy"; readonly reason: string }

/**
 * Judges and removes the worktree of `tree` from `main`: the in-use guard first, then the plan (refusing a non-cache tracked change that appeared since),
 * then the removal retried with backoff on a busy host, then the lane's slots released. `main` is where this process stands (never inside the worktree).
 * Never throws.
 */
const attempt = async (tree: LaneTree, given: { readonly dir: string; readonly main: string; readonly laneSha: string; readonly rules: SlotRules }, deps: CleanupDeps): Promise<Attempt> => {
    try {
        const reasons = liveReasons(tree, await deps.live(given.dir, given.rules), given.laneSha === "" ? undefined : given.laneSha, Date.now(), true)
        if (reasons.length > 0) return { state: "kept", reason: reasons.join("; ") }
        const plan = await planRemoval(tree.path, given.main, true)
        const work = plan.dirty.filter((line) => !isCacheChange(line))
        if (work.length > 0) return { state: "kept", reason: `uncommitted work (${work.slice(0, 3).map(pathOf).join(", ")})` }
        let last = ""
        for (let tried = 1; tried <= deps.attempts; tried += 1) {
            try {
                await deps.remove(plan, tree.lane)
                last = ""
                break
            } catch (error) {
                const code = transientCode(error)
                if (code === undefined) return { state: "kept", reason: firstLine(error) }
                last = `${code} after ${String(tried)} attempt(s): ${firstLine(error)}`
                if (tried < deps.attempts) await deps.sleep(Math.min(deps.capMs, deps.baseMs * 2 ** (tried - 1)))
            }
        }
        if (last !== "") return { state: "busy", reason: last }
        releaseLaneSlots(given.dir, given.rules, tree.lane, `land cleanup (pid ${String(process.pid)})`)
        return { state: "removed" }
    } catch (error) {
        return { state: "kept", reason: firstLine(error) }
    }
}

/**
 * The cleanup of a landed lane: remove `root` (the worktree the command runs in) unless `keep` or the guard holds it. Returns the line to print.
 * `laneSha` is the lane's own sha at the landing, `dir` the lanes folder.
 */
export const cleanupLanded = async (given: { readonly root: string; readonly lane: string; readonly branch: string; readonly laneSha: string; readonly dir: string; readonly keep: boolean }, deps: CleanupDeps = realCleanupDeps): Promise<LandCleanup> => {
    if (given.keep) return { removed: false, line: "kept: --keep given" }
    try {
        const tree = treeAt(given.dir, given.root)
        if (tree === undefined) return { removed: false, line: `kept: ${given.root} is not a lane worktree under the lanes folder ${given.dir}` }
        // The folder this process stands in cannot be deleted on Windows: stand in the main checkout, and read it before leaving.
        const main = await mainCheckout(given.root)
        deps.leave(main)
        const rules = loadSlotRules()
        const done = await attempt(tree, { dir: given.dir, main, laneSha: given.laneSha, rules }, deps)
        if (done.state === "removed") {
            clearMarker(given.dir, tree.lane)
            return { removed: true, line: "worktree removed" }
        }
        if (done.state === "kept") return { removed: false, line: `kept: ${done.reason}` }
        try {
            const marker = leaveMarker(given.dir, { lane: tree.lane, worktree: tree.path, branch: given.branch, laneSha: given.laneSha, at: new Date().toISOString(), reason: done.reason })
            return { removed: false, line: `kept: busy (${done.reason}); marked for the next lane remove or janitor run`, marker }
        } catch (error) {
            return { removed: false, line: `kept: busy (${done.reason}); the marker could not be written (${firstLine(error)}): run starci lane remove ${tree.path} --execute` }
        }
    } catch (error) {
        return { removed: false, line: `kept: ${firstLine(error)}` }
    }
}

/** What a sweep of the markers did to one. */
export interface SweptMarker {
    readonly lane: string
    readonly worktree: string
    /** `gone` (nothing there any more), `removed`, or `kept` with why. */
    readonly state: "gone" | "removed" | "kept"
    readonly reason?: string
}

/**
 * The janitor's side of a marker (`starci lane prune-installs --execute`): each marked worktree is judged and removed as the cleanup did, from `main`; one that
 * is gone only loses its marker, one still busy or live keeps it for the next sweep. Never throws.
 */
export const sweepCleanupMarkers = async (dir: string, main: string, rules: SlotRules, deps: CleanupDeps = realCleanupDeps): Promise<SweptMarker[]> => {
    const swept: SweptMarker[] = []
    for (const marker of readMarkers(dir)) {
        const tree = existsSync(marker.worktree) ? treeAt(dir, marker.worktree) : undefined
        if (tree === undefined) {
            clearMarker(dir, marker.lane)
            swept.push({ lane: marker.lane, worktree: marker.worktree, state: "gone" })
            continue
        }
        const done = await attempt(tree, { dir, main, laneSha: marker.laneSha, rules }, deps)
        if (done.state === "removed") clearMarker(dir, marker.lane)
        swept.push({ lane: marker.lane, worktree: marker.worktree, state: done.state === "removed" ? "removed" : "kept", ...(done.state === "removed" ? {} : { reason: done.reason }) })
    }
    return swept
}
