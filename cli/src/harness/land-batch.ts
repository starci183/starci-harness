import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { freemem } from "node:os"
import { join } from "node:path"
import { captureGit } from "../shared/git.js"
import { captureNpm, captureTool, killPidTree } from "../shared/exec.js"
import { withHeavySlot } from "./heavy.js"
import {
    CACHE_DIR, GATE_ROUNDS, LANDER, OOM_FREE_MB, OOM_RETRIES, dropReady, holderLine, isOutOfMemory, judgeRound, landPaths, notReadyAny, readyEntries, releaseLockFile, takeLockFile, writeJsonWhole, writeStatus,
} from "./land-queue.js"
import type { LaneFinding, LaneStatus, ReadyEntry, RoundVerdict } from "./land-queue.js"
import { loadSlotRules, releaseLaneSlots, slotKind, takeSlot as takeSlotFile } from "./slots.js"
import { APP_PROFILE, LANDER_GATE_ARGS, lockScope, takesEntry } from "./land-profile.js"
import type { LandProfile } from "./land-profile.js"

export { LANDER_GATE_ARGS }

/** The fields of a status a batch sets; the lane, its sha, branch and batch come from the entry. */
type StatusFields = Omit<LaneStatus, "lane" | "laneSha" | "branch" | "at" | "batch">

/** Where and how a lander runs one batch. */
export interface BatchOptions {
    /** The lanes folder. */
    readonly dir: string
    /** The app's main checkout, whose repository the lander's worktree belongs to. */
    readonly repo: string
    /** The lander's own worktree, reset to the base before each batch; node_modules stays between batches. */
    readonly worktree: string
    /** The folder under `db/migrations/`-like paths a landed lane is told to apply. */
    readonly migrations: string
    readonly gateSlots: number
    readonly npmSlots: number
    /** Merge only: report what would conflict, no gate, no push, no status. */
    readonly dryRun: boolean
    readonly say: (line: string) => void
    /** How the tree is prepared, gated and pushed (harness/land-profile.ts); default the app's. */
    readonly profile?: LandProfile
    /** The origin URL of the repository: the lander takes only the ready lanes that name it (an app lander also takes the lanes that name none). */
    readonly ownRemote?: string
}

const profileOf = (options: BatchOptions): LandProfile => options.profile ?? APP_PROFILE
const scopeOf = (options: BatchOptions): string => lockScope(profileOf(options).name)

/** What one batch did, kept as `_land-status/_batches/<batch>/batch.json`. */
export interface BatchRecord {
    readonly batch: string
    readonly base: string
    readonly lanes: readonly string[]
    readonly merged: readonly string[]
    readonly conflicts: readonly { readonly lane: string; readonly with: readonly string[]; readonly files: readonly string[] }[]
    readonly rounds: readonly { readonly round: number; readonly lanes: readonly string[]; readonly exitCode: number; readonly verdict: string; readonly oomRuns?: number }[]
    readonly landed?: string
    readonly landedLanes: readonly string[]
    readonly rejected: readonly string[]
    readonly outcome: string
}

interface Conflict {
    readonly lane: ReadyEntry
    readonly files: readonly string[]
    readonly with: readonly string[]
}

const sleep = (ms: number): Promise<void> => new Promise((settle) => setTimeout(settle, ms))

const gitIn = async (cwd: string, args: readonly string[]): Promise<{ readonly ok: boolean; readonly out: string; readonly err: string }> => {
    const run = await captureGit(args, cwd)
    return { ok: run.exitCode === 0, out: run.stdout.trim(), err: run.stderr.trim() }
}

/**
 * Waits for a free slot of `kind` (ops/slots.yaml, its count capped at `count`) and holds it under the lander's name and pid; a slot
 * whose holder died is reclaimed on the way (harness/slots.ts).
 */
const takeSlot = async (dir: string, kind: "gate" | "npm", count: number): Promise<string> => {
    const rules = loadSlotRules()
    const own = slotKind(rules, kind)
    const capped = { ...rules, kinds: { ...rules.kinds, [kind]: { ...own, count: Math.min(own.count, count), burst: undefined } } }
    return (await takeSlotFile(dir, capped, kind, LANDER, { pid: process.pid })).file
}

/** Releases every slot a landed or rejected lane holds in the lanes folder; it never fails a batch, and never touches the lander's own slots. */
export const releaseLaneSlotsOf = (dir: string, lane: string, state: string, say: (line: string) => void): void => {
    if (lane === LANDER) return
    try {
        const done = releaseLaneSlots(dir, loadSlotRules(), lane, `${LANDER} (${state})`)
        if (done.released.length > 0) say(`released ${String(done.released.length)} slot(s) of ${state} lane ${lane}: ${done.released.join(", ")}`)
    } catch (error) {
        say(`could not release the slots of ${lane}: ${error instanceof Error ? error.message : String(error)}`)
    }
}

/** Waits for the dev lock (of the lander's scope) and holds it for the batch. */
const takeDevLock = async (dir: string, say: (line: string) => void, scope = ""): Promise<void> => {
    let waited = false
    while (!takeLockFile(landPaths(dir, scope).devLock, holderLine())) {
        if (!waited) say(`waiting for ${landPaths(dir, scope).devLock}`)
        waited = true
        await sleep(5000)
    }
}

/** The lander's worktree exists, detached at origin/dev the first time. */
const ensureWorktree = async (options: BatchOptions): Promise<void> => {
    if (existsSync(join(options.worktree, ".git"))) return
    const added = await gitIn(options.repo, ["worktree", "add", "--detach", options.worktree, "origin/dev"])
    if (!added.ok) throw new Error(`worktree add ${options.worktree}: ${added.err}`)
    options.say(`created the lander worktree ${options.worktree}`)
}

const mergeMessage = (lane: ReadyEntry, batch: string, note = ""): string => `land lane ${lane.lane} (${lane.branch} ${lane.sha.slice(0, 10)}) in batch ${batch}${note}`

/**
 * Resets the worktree to `base` and merges `lanes` in order. A lane whose merge conflicts is left out and named with the batch-mates
 * whose changes it met (or origin/dev). A conflict in cache records alone is no conflict: the merge is redone keeping the batch's
 * side of those hunks, since the batch gate rewrites every record it re-checks.
 */
const buildTree = async (wt: string, base: string, lanes: readonly ReadyEntry[], batch: string, changed: ReadonlyMap<string, readonly string[]>) => {
    await gitIn(wt, ["merge", "--abort"])
    const reset = await gitIn(wt, ["checkout", "--detach", "--force", base])
    if (!reset.ok) throw new Error(`checkout ${base}: ${reset.err}`)
    await gitIn(wt, ["clean", "-fd", "-q"])
    const merged: ReadyEntry[] = []
    const conflicts: Conflict[] = []
    for (const lane of lanes) {
        if ((await gitIn(wt, ["merge", "--no-ff", "--no-edit", "-m", mergeMessage(lane, batch), lane.sha])).ok) {
            merged.push(lane)
            continue
        }
        const files = (await gitIn(wt, ["diff", "--name-only", "--diff-filter=U"])).out.split("\n").filter((file) => file !== "")
        await gitIn(wt, ["merge", "--abort"])
        if (files.length > 0 && files.every((file) => file.startsWith(CACHE_DIR))) {
            if ((await gitIn(wt, ["merge", "--no-ff", "--no-edit", "-X", "ours", "-m", mergeMessage(lane, batch, ", cache records kept from the batch"), lane.sha])).ok) {
                merged.push(lane)
                continue
            }
            await gitIn(wt, ["merge", "--abort"])
        }
        const mates = merged.filter((mate) => (changed.get(mate.lane) ?? []).some((file) => files.includes(file))).map((mate) => mate.lane)
        conflicts.push({ lane, files, with: mates.length > 0 ? mates : ["origin/dev"] })
    }
    return { merged, conflicts }
}

/** npm ci when the lockfile is not the one node_modules was installed from (under an npm slot), then codegen and build:modules. */
const prepare = async (options: BatchOptions, log: string[]): Promise<void> => {
    const wt = options.worktree
    const mark = join(wt, "node_modules", ".batch-lander-lock")
    const hash = (await gitIn(wt, ["hash-object", "package-lock.json"])).out
    const installed = existsSync(mark) ? readFileSync(mark, "utf8").trim() : ""
    if (!existsSync(join(wt, "node_modules")) || installed !== hash) {
        const slot = await takeSlot(options.dir, "npm", options.npmSlots)
        try {
            options.say(`npm ci (${slot})`)
            const run = await withHeavySlot("install", "lane land: npm ci", wt, {}, (held) => captureNpm(["ci", "--no-audit", "--no-fund"], wt, held.options))
            log.push(run.stdout, run.stderr)
            if (run.exitCode !== 0) throw new Error(`npm ci exited ${String(run.exitCode)}`)
        } finally {
            releaseLockFile(slot, process.pid)
        }
        writeFileSync(mark, hash)
    }
    for (const script of ["codegen", "build:modules"]) {
        const run = await withHeavySlot("build", `lane land: npm run ${script}`, wt, {}, (held) => captureNpm(["run", script, "--silent", "--if-present"], wt, held.options))
        log.push(run.stdout, run.stderr)
        if (run.exitCode !== 0) throw new Error(`npm run ${script} exited ${String(run.exitCode)}`)
    }
}

/** One gate run as the batch reads it. */
export interface GateRun {
    readonly exitCode: number
    readonly stdout: string
    readonly stderr: string
    /** The run was cancelled because a lane of the batch was registered again or withdrawn while it ran: it has no verdict. */
    readonly cancelled?: boolean
}

/** How often a running batch gate looks whether a lane of its batch was registered again (superseded) or withdrawn. */
export const SUPERSEDE_POLL_MS = 15_000

/**
 * Runs `start` and, every `pollMs` while it runs, asks `superseded`: once it says yes the run's process tree is killed (`kill`) and the run
 * comes back `cancelled` (owner: "nếu push commit mới thì cancel lun commit cũ"). The seam of the batch gate and of its spec.
 */
export const cancellableRun = async (
    start: (onSpawn: (pid: number) => void) => Promise<Omit<GateRun, "cancelled">>,
    superseded: () => boolean,
    kill: (pid: number) => boolean = killPidTree,
    pollMs = SUPERSEDE_POLL_MS,
): Promise<GateRun> => {
    const state: { pid: number | undefined; cancelled: boolean } = { pid: undefined, cancelled: false }
    const timer = setInterval(() => {
        if (state.cancelled || state.pid === undefined || !superseded()) return
        state.cancelled = true
        kill(state.pid)
    }, pollMs)
    try {
        const run = await start((spawned) => {
            state.pid = spawned
        })
        const result = { exitCode: run.exitCode, stdout: run.stdout, stderr: run.stderr }
        return state.cancelled ? { ...result, cancelled: true } : result
    } finally {
        clearInterval(timer)
    }
}

/**
 * One `app check --env prod --level dev --json` under a gate slot (the FAST level: a batch lands on dev, the full gate runs once at the main cut); `attempt`
 * numbers a run repeated after it ran out of memory. `superseded` says whether a lane of the batch was registered again or withdrawn: the run is then cancelled.
 */
const gate = async (options: BatchOptions, folder: string, round: number, attempt: number, base: string, superseded: () => boolean = () => false): Promise<GateRun> => {
    const slot = await takeSlot(options.dir, "gate", options.gateSlots)
    try {
        const name = attempt === 0 ? String(round) : `${String(round)}-retry${String(attempt)}`
        options.say(`gate round ${name} (${slot})`)
        const command = profileOf(options).gate(options.worktree, base)
        const run = await cancellableRun((onSpawn) => captureTool(command.file, command.args, options.worktree, { onSpawn }), superseded)
        writeFileSync(join(folder, `check-${name}.json`), run.stdout)
        writeFileSync(join(folder, `check-${name}.log`), run.stderr)
        if (run.cancelled === true) options.say(`gate round ${name}: cancelled, a lane of the batch was registered again or withdrawn`)
        return run
    } finally {
        releaseLockFile(slot, process.pid)
    }
}

/** The host's free RAM in MB, the reading the out-of-memory wait polls. */
const freeRamMb = (): number => Math.floor(freemem() / (1024 * 1024))

/** Waits until the host has `mb` free, polling every `pollMs`, telling `say` once while it waits. */
export const waitForFreeRam = async (mb: number, say: (line: string) => void, read: () => number = freeRamMb, pollMs = 15_000): Promise<void> => {
    let told = false
    for (let free = read(); free < mb; free = read()) {
        if (!told) say(`out of memory: waiting for ${String(mb)} MB free RAM (now ${String(free)} MB)`)
        told = true
        await sleep(pollMs)
    }
}

/** What a gate round came to once out-of-memory runs were repeated: its last verdict, the run that gave it, and how many runs ran out of memory. */
export interface JudgedRound {
    readonly verdict: RoundVerdict
    readonly run: GateRun
    readonly oomRuns: number
}

/**
 * Runs one gate round, repeating a run that ran out of memory up to OOM_RETRIES times, each once `waitRam` returns (free RAM above
 * OOM_FREE_MB). A run that does not run out of memory gives the round its verdict; a round whose every run ran out of memory ends `oom`,
 * and the batch parks: an out-of-memory crash never rejects a lane.
 */
export const judgeWithOomRetry = async (
    runGate: (attempt: number) => Promise<GateRun>,
    judge: (run: GateRun) => RoundVerdict,
    waitRam: () => Promise<void>,
    say: (line: string) => void,
): Promise<JudgedRound> => {
    let oomRuns = 0
    for (let attempt = 0; ; attempt += 1) {
        const run = await runGate(attempt)
        // A cancelled run (a lane superseded or withdrawn) has no verdict, and is never an out-of-memory run whatever its kill's exit code.
        if (run.cancelled === true) return { verdict: { kind: "no-verdict" }, run, oomRuns }
        const verdict = judge(run)
        if (verdict.kind !== "oom") return { verdict, run, oomRuns }
        oomRuns += 1
        say(`gate ran out of memory (${verdict.evidence}); no lane is blamed`)
        if (attempt >= OOM_RETRIES) return { verdict, run, oomRuns }
        await waitRam()
    }
}

/** The trailer the batch commit carries for each lane it lands: how a later batch knows the lane's sha is on dev although its commits are not. */
export const LANDED_TRAILER = "Landed-lane"

/** The message of a batch's one commit: the lanes and their shas, and one `Landed-lane: <lane> <sha>` trailer per lane. */
export const squashMessage = (batch: string, lanes: readonly ReadyEntry[]): string =>
    [
        `land batch ${batch}: ${String(lanes.length)} lane(s) onto dev (${lanes.map((lane) => lane.lane).join(", ")})`,
        "",
        ...lanes.map((lane) => `- ${lane.lane} (${lane.branch} ${lane.sha})`),
        "",
        ...lanes.map((lane) => `${LANDED_TRAILER}: ${lane.lane} ${lane.sha}`),
    ].join("\n")

/** The git port of the squash: a spec drives it without a repository. */
export type GitPort = (cwd: string, args: readonly string[]) => Promise<{ readonly ok: boolean; readonly out: string; readonly err: string }>

/**
 * Squashes the batch's merges into ONE commit on `base` with the tree the gate judged (owner: "dồn!!! nhiều changes thì gộp 1 commit duy nhất"): `git commit-tree`
 * of HEAD's tree with `base` as its only parent, then HEAD moves there (the work tree already is that tree). Returns the new commit.
 */
export const squashBatch = async (wt: string, base: string, batch: string, lanes: readonly ReadyEntry[], run: GitPort = gitIn): Promise<string> => {
    const made = await run(wt, ["commit-tree", "HEAD^{tree}", "-p", base, "-m", squashMessage(batch, lanes)])
    if (!made.ok || made.out === "") throw new Error(`squash: git commit-tree: ${made.err}`)
    const moved = await run(wt, ["reset", "--soft", made.out])
    if (!moved.ok) throw new Error(`squash: git reset --soft ${made.out}: ${moved.err}`)
    return made.out
}

/** Whether `base` already carries the lane at `sha`: an ancestor (a merge landed it), or a batch commit whose trailer names it (a squash landed it). */
export const onBase = async (wt: string, base: string, lane: ReadyEntry, run: GitPort = gitIn): Promise<boolean> => {
    if ((await run(wt, ["merge-base", "--is-ancestor", lane.sha, base])).ok) return true
    const found = await run(wt, ["log", "-1", "--format=%H", "--fixed-strings", `--grep=${LANDED_TRAILER}: ${lane.lane} ${lane.sha}`, base])
    return found.ok && found.out !== ""
}

/**
 * `app push origin HEAD:dev` with the app's CLI, once the batch is squashed: a landing on dev, so it runs no check of its own and the pre-push hook runs
 * the fast level once (the tree the batch gate judged green is not judged again). `oom` when the hook's check ran out of memory.
 */
const push = async (options: BatchOptions, folder: string, stillReady: () => boolean, squash: () => Promise<unknown> = () => Promise.resolve()): Promise<{ readonly pushed: boolean; readonly oom: boolean; readonly aborted?: true }> => {
    const slot = await takeSlot(options.dir, "gate", options.gateSlots)
    try {
        // The land-time check: after the wait for the slot, the last moment before dev moves.
        if (!stillReady()) return { pushed: false, oom: false, aborted: true }
        await squash()
        const command = profileOf(options).push(options.worktree, "dev")
        const run = await captureTool(command.file, command.args, options.worktree)
        writeFileSync(join(folder, "push.log"), `${run.stdout}\n${run.stderr}`)
        return { pushed: run.exitCode === 0, oom: run.exitCode !== 0 && isOutOfMemory(run.exitCode, `${run.stdout}\n${run.stderr}`) }
    } finally {
        releaseLockFile(slot, process.pid)
    }
}

/**
 * The re-check a batch makes before each gate run, after it and right before the push: whether every lane of the tree is still ready
 * as the batch took it. When one is not (withdrawn mid-batch, or registered again) the batch is aborted, never pushed: the others stay
 * ready with a status that says so, and the next batch forms from the ready set and gates it again (the gate that ran covered a tree
 * holding a lane nobody wants landed). The withdrawn lane's status is its own (`lane withdraw` wrote it); only lanes that kept their
 * registration are told. Returns the batch outcome when aborted, undefined when every lane is still ready.
 */
export const abortIfNotReady = (dir: string, batch: string, tree: readonly ReadyEntry[], say: (line: string) => void, dryRun = false): string | undefined => {
    const gone = notReadyAny(dir, tree)
    if (gone.withdrawn.length === 0 && gone.replaced.length === 0) return undefined
    const out = new Set([...gone.withdrawn, ...gone.replaced].map((lane) => lane.lane))
    const newer = new Map(readyEntries(dir).map((entry) => [entry.lane, entry]))
    const superseded = gone.replaced.map((lane) => `${lane.lane} superseded by ${(newer.get(lane.lane)?.sha ?? "").slice(0, 10)}`)
    const why = `${[...out].join(", ")} ${gone.withdrawn.length > 0 ? "withdrawn" : "registered again"} from batch ${batch}${superseded.length > 0 ? ` (${superseded.join(", ")})` : ""}`
    say(`${why}: the batch is aborted, nothing is pushed; the others stay ready and are gated again in the next batch`)
    for (const lane of tree.filter((entry) => !out.has(entry.lane))) {
        if (!dryRun) writeStatus(dir, { lane: lane.lane, laneSha: lane.sha, branch: lane.branch, state: "queued", sha: lane.sha, reason: `re-formed: ${why}; gated again in the next batch`, reformedFrom: batch })
    }
    // The lane registered again: its old sha's batch gate is cancelled and the newer sha is queued for the next batch.
    for (const lane of gone.replaced) {
        const now = newer.get(lane.lane)
        if (now === undefined || dryRun) continue
        writeStatus(dir, { lane: lane.lane, laneSha: now.sha, branch: now.branch, state: "queued", sha: now.sha, reason: `superseded by ${now.sha}: the gate of batch ${batch} (with ${lane.sha.slice(0, 10)}) is cancelled and re-formed; the new sha is gated in the next batch`, supersededBy: now.sha, reformedFrom: batch })
    }
    return `aborted, re-formed: ${why}; ${String(tree.length - out.size)} lane(s) stay ready`
}

/**
 * Runs one batch over every ready lane: merge, one gate, push or drop and re-gate once, and a status for every lane. Returns undefined
 * when no lane is ready. Never bisects: a batch takes at most GATE_ROUNDS gate runs.
 */
export const runBatch = async (options: BatchOptions): Promise<BatchRecord | undefined> => {
    const profile = profileOf(options)
    const ready = readyEntries(options.dir).filter((entry) => takesEntry(entry, options.ownRemote, profile.name))
    if (ready.length === 0) return undefined
    const { dir, say } = options
    const batch = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "")
    const folder = join(landPaths(dir).batches, batch)
    mkdirSync(folder, { recursive: true })
    say(`batch ${batch}: ${ready.map((lane) => lane.lane).join(", ")}${options.dryRun ? " (dry run)" : ""}`)
    const log: string[] = []
    const rounds: { round: number; lanes: string[]; exitCode: number; verdict: string; oomRuns?: number }[] = []
    const rejected: string[] = []
    const landedLanes: string[] = []
    let base = ""
    let merged: ReadyEntry[] = []
    let conflicts: Conflict[] = []
    let landed: string | undefined
    let outcome = "nothing to merge"
    const status = (lane: ReadyEntry, rest: StatusFields): void => {
        if (options.dryRun) return
        writeStatus(dir, { lane: lane.lane, laneSha: lane.sha, branch: lane.branch, batch, ...rest })
        // A lane that landed or was rejected is done with its gate: every slot it holds goes, whatever the kind or writer (never the lander's own).
        if (rest.state === "landed" || rest.state === "rejected") releaseLaneSlotsOf(dir, lane.lane, rest.state, say)
    }
    const reject = (lane: ReadyEntry, reason: string, findings: readonly LaneFinding[]): void => {
        rejected.push(lane.lane)
        if (options.dryRun) return
        dropReady(dir, lane.lane, lane.sha)
        status(lane, { state: "rejected", sha: lane.sha, reason, findings })
    }
    const reformed = (): boolean => {
        const aborted = abortIfNotReady(dir, batch, merged, say, options.dryRun)
        if (aborted === undefined) return false
        outcome = aborted
        return true
    }
    const body = async (): Promise<void> => {
        await ensureWorktree(options)
        const fetched = await gitIn(options.worktree, ["fetch", "-q", "origin"])
        if (!fetched.ok) throw new Error(`fetch: ${fetched.err}`)
        base = (await gitIn(options.worktree, ["rev-parse", "origin/dev"])).out
        const lanes: ReadyEntry[] = []
        for (const lane of ready) {
            const has = async (): Promise<boolean> => (await gitIn(options.worktree, ["cat-file", "-e", `${lane.sha}^{commit}`])).ok
            if (!(await has())) await gitIn(options.worktree, ["fetch", "-q", "origin", lane.branch])
            if (!(await has())) reject(lane, `sha ${lane.sha.slice(0, 10)} is not on origin`, [])
            else if (await onBase(options.worktree, base, lane)) {
                landedLanes.push(lane.lane)
                if (!options.dryRun) dropReady(dir, lane.lane, lane.sha)
                status(lane, { state: "landed", sha: base, reason: "already on dev", migrations: [] })
            } else lanes.push(lane)
        }
        const changed = new Map<string, readonly string[]>()
        // A lane's own files: what it changed since its merge-base with dev AND still differs from dev. A lane that took another lane's
        // commits directly (not through dev) would otherwise be named for that lane's files and migrations once they landed.
        const names = async (range: string): Promise<string[]> => (await gitIn(options.worktree, ["diff", "--name-only", range])).out.split("\n").filter((file) => file !== "")
        for (const lane of lanes) {
            const differs = new Set(await names(`${base}..${lane.sha}`))
            changed.set(lane.lane, (await names(`${base}...${lane.sha}`)).filter((file) => differs.has(file)))
        }
        ;({ merged, conflicts } = await buildTree(options.worktree, base, lanes, batch, changed))
        for (const conflict of conflicts) {
            const requeued = !conflict.with.includes("origin/dev")
            say(`conflict: ${conflict.lane.lane} with ${conflict.with.join(", ")} (${conflict.files.join(", ")})${requeued ? ", stays ready for the next batch" : ""}`)
            if (!requeued && !options.dryRun) dropReady(dir, conflict.lane.lane, conflict.lane.sha)
            status(conflict.lane, { state: "conflict", sha: conflict.lane.sha, reason: `conflict with ${conflict.with.join(", ")}`, files: conflict.files, requeued })
        }
        if (options.dryRun) {
            outcome = "dry run: merged only"
            return
        }
        for (let round = 1; round <= GATE_ROUNDS && merged.length > 0; round += 1) {
            if (round > 1) {
                const again = await buildTree(options.worktree, base, merged, batch, changed)
                for (const conflict of again.conflicts) status(conflict.lane, { state: "conflict", sha: conflict.lane.sha, reason: `conflict with ${conflict.with.join(", ")} once the batch dropped lanes`, files: conflict.files, requeued: true })
                merged = again.merged
                if (merged.length === 0) break
            }
            for (const lane of merged) status(lane, { state: "queued", sha: lane.sha, reason: `in batch ${batch}, gate round ${String(round)}` })
            if (profile.prepares) await prepare(options, log)
            if (reformed()) return
            const inBatch = new Map([...changed].filter(([lane]) => merged.some((entry) => entry.lane === lane)))
            const waitRam = (): Promise<void> => waitForFreeRam(OOM_FREE_MB, say)
            const judged = await judgeWithOomRetry(
                (attempt) => gate(options, folder, round, attempt, base, () => { const gone = notReadyAny(dir, merged); return gone.withdrawn.length > 0 || gone.replaced.length > 0 }),
                (run) => judgeRound(round, run.exitCode, run.stdout, inBatch, run.stderr),
                waitRam,
                say,
            )
            // A lane withdrawn while the gate ran: no verdict of this run counts, no push, nobody is rejected for it.
            if (reformed()) return
            const { verdict, run } = judged
            rounds.push({ round, lanes: merged.map((lane) => lane.lane), exitCode: run.exitCode, verdict: verdict.kind, ...(judged.oomRuns > 0 ? { oomRuns: judged.oomRuns } : {}) })
            say(`gate round ${String(round)}: exit ${String(run.exitCode)}, ${verdict.kind}`)
            if (verdict.kind === "oom") {
                const reason = `parked: the gate ran out of memory ${String(judged.oomRuns)} times (${verdict.evidence}); no lane is blamed: register again once the host has RAM`
                for (const lane of merged) {
                    dropReady(dir, lane.lane, lane.sha)
                    status(lane, { state: "parked", sha: lane.sha, reason })
                }
                outcome = `parked ${String(merged.length)} lane(s): the gate ran out of memory ${String(judged.oomRuns)} times`
                return
            }
            if (verdict.kind === "no-verdict") {
                outcome = `gate round ${String(round)} gave no verdict; every lane stays ready`
                return
            }
            if (verdict.kind === "green") {
                // ONE commit per batch: the merges the gate judged become one commit on base with the same tree, listing the lanes and their shas.
                const pushed = await push(options, folder, () => !reformed(), () => squashBatch(options.worktree, base, batch, merged))
                if (pushed.aborted) return
                if (!pushed.pushed) {
                    // Every lane stays ready; a push whose check ran out of memory waits for RAM first, so the next batch does not crash the same way.
                    if (pushed.oom) await waitRam()
                    outcome = `app push failed${pushed.oom ? " (out of memory)" : ""} (push.log); every lane stays ready`
                    return
                }
                landed = (await gitIn(options.worktree, ["rev-parse", "HEAD"])).out
                for (const lane of merged) {
                    landedLanes.push(lane.lane)
                    dropReady(dir, lane.lane, lane.sha)
                    status(lane, { state: "landed", sha: landed, migrations: (changed.get(lane.lane) ?? []).filter((file) => file.startsWith(options.migrations)) })
                }
                outcome = `landed ${String(merged.length)} lane(s) as ${landed.slice(0, 10)}`
                return
            }
            if (verdict.kind === "stop") {
                for (const lane of merged) reject(lane, `nothing landed: ${verdict.why}`, verdict.blamed.get(lane.lane) ?? verdict.findings)
                outcome = `nothing landed: ${verdict.why}`
                return
            }
            for (const lane of merged.filter((entry) => verdict.blamed.has(entry.lane))) reject(lane, "the batch gate names your files", verdict.blamed.get(lane.lane) ?? [])
            merged = merged.filter((entry) => !verdict.blamed.has(entry.lane))
        }
        outcome = "no lane left in the batch"
    }
    if (!options.dryRun) await takeDevLock(dir, say, scopeOf(options))
    // A batch that failed because a step ran out of memory (npm ci, codegen, build:modules) waits for RAM once the dev lock is released,
    // so the next batch does not start into the same shortage a second later.
    let waitForRam = false
    try {
        await body()
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        waitForRam = isOutOfMemory(undefined, `${message}\n${log.slice(-4).join("\n")}`)
        outcome = `batch failed (${message})${waitForRam ? " (out of memory)" : ""}; every lane not yet judged stays ready`
    } finally {
        if (!options.dryRun) releaseLockFile(landPaths(dir, scopeOf(options)).devLock, process.pid)
        writeFileSync(join(folder, "lander.log"), log.join("\n"))
    }
    if (waitForRam) await waitForFreeRam(OOM_FREE_MB, say)
    const record: BatchRecord = {
        batch, base, lanes: ready.map((lane) => lane.lane), merged: merged.map((lane) => lane.lane),
        conflicts: conflicts.map((conflict) => ({ lane: conflict.lane.lane, with: conflict.with, files: conflict.files })),
        rounds, ...(landed === undefined ? {} : { landed }), landedLanes, rejected, outcome,
    }
    writeJsonWhole(join(folder, "batch.json"), record)
    say(`batch ${batch}: ${outcome}`)
    return record
}
