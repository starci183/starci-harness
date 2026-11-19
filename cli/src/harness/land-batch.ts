import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { freemem } from "node:os"
import { join } from "node:path"
import { captureGit } from "../shared/git.js"
import { captureNpm, captureTool } from "../shared/exec.js"
import { withHeavySlot } from "./heavy.js"
import {
    CACHE_DIR, GATE_ROUNDS, OOM_FREE_MB, OOM_RETRIES, dropReady, holderLine, isOutOfMemory, judgeRound, landPaths, readyEntries, releaseLockFile, takeLockFile, writeJsonWhole, writeStatus,
} from "./land-queue.js"
import type { LaneFinding, LaneStatus, ReadyEntry, RoundVerdict } from "./land-queue.js"

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
}

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

/** Waits for a free slot file of `kind` (1..count) and holds it under the lander's name. */
const takeSlot = async (dir: string, kind: "gate" | "npm", count: number): Promise<string> => {
    for (;;) {
        for (let n = 1; n <= count; n += 1) {
            const file = landPaths(dir).slot(kind, n)
            if (takeLockFile(file, holderLine())) return file
        }
        await sleep(5000)
    }
}

/** Waits for the dev lock and holds it for the batch. */
const takeDevLock = async (dir: string, say: (line: string) => void): Promise<void> => {
    let waited = false
    while (!takeLockFile(landPaths(dir).devLock, holderLine())) {
        if (!waited) say(`waiting for ${landPaths(dir).devLock}`)
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

/** The app's own pinned CLI: a lander judges with the harness the app pins, never this one. */
const appCli = (wt: string): string => join(wt, "node_modules", "starci-harness", "dist", "main.js")

/** One gate run as the batch reads it. */
export interface GateRun {
    readonly exitCode: number
    readonly stdout: string
    readonly stderr: string
}

/** One `app check --env prod --json` under a gate slot; `attempt` numbers a run repeated after it ran out of memory. */
const gate = async (options: BatchOptions, folder: string, round: number, attempt: number): Promise<GateRun> => {
    const slot = await takeSlot(options.dir, "gate", options.gateSlots)
    try {
        const name = attempt === 0 ? String(round) : `${String(round)}-retry${String(attempt)}`
        options.say(`gate round ${name} (${slot})`)
        const run = await captureTool(process.execPath, [appCli(options.worktree), "app", "check", "--env", "prod", "--json"], options.worktree)
        writeFileSync(join(folder, `check-${name}.json`), run.stdout)
        writeFileSync(join(folder, `check-${name}.log`), run.stderr)
        return { exitCode: run.exitCode, stdout: run.stdout, stderr: run.stderr }
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
        const verdict = judge(run)
        if (verdict.kind !== "oom") return { verdict, run, oomRuns }
        oomRuns += 1
        say(`gate ran out of memory (${verdict.evidence}); no lane is blamed`)
        if (attempt >= OOM_RETRIES) return { verdict, run, oomRuns }
        await waitRam()
    }
}

/**
 * `app push origin HEAD:dev` with the app's CLI: it commits the cache records the run writes, then pushes once through the hook.
 * `oom` when the push's own check ran out of memory.
 */
const push = async (options: BatchOptions, folder: string): Promise<{ readonly pushed: boolean; readonly oom: boolean }> => {
    const slot = await takeSlot(options.dir, "gate", options.gateSlots)
    try {
        const run = await captureTool(process.execPath, [appCli(options.worktree), "app", "push", "origin", "HEAD:dev"], options.worktree)
        writeFileSync(join(folder, "push.log"), `${run.stdout}\n${run.stderr}`)
        return { pushed: run.exitCode === 0, oom: run.exitCode !== 0 && isOutOfMemory(run.exitCode, `${run.stdout}\n${run.stderr}`) }
    } finally {
        releaseLockFile(slot, process.pid)
    }
}

/**
 * Runs one batch over every ready lane: merge, one gate, push or drop and re-gate once, and a status for every lane. Returns undefined
 * when no lane is ready. Never bisects: a batch takes at most GATE_ROUNDS gate runs.
 */
export const runBatch = async (options: BatchOptions): Promise<BatchRecord | undefined> => {
    const ready = readyEntries(options.dir)
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
        if (!options.dryRun) writeStatus(dir, { lane: lane.lane, laneSha: lane.sha, branch: lane.branch, batch, ...rest })
    }
    const reject = (lane: ReadyEntry, reason: string, findings: readonly LaneFinding[]): void => {
        rejected.push(lane.lane)
        if (options.dryRun) return
        dropReady(dir, lane.lane, lane.sha)
        status(lane, { state: "rejected", sha: lane.sha, reason, findings })
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
            else if ((await gitIn(options.worktree, ["merge-base", "--is-ancestor", lane.sha, base])).ok) {
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
            await prepare(options, log)
            const inBatch = new Map([...changed].filter(([lane]) => merged.some((entry) => entry.lane === lane)))
            const waitRam = (): Promise<void> => waitForFreeRam(OOM_FREE_MB, say)
            const judged = await judgeWithOomRetry(
                (attempt) => gate(options, folder, round, attempt),
                (run) => judgeRound(round, run.exitCode, run.stdout, inBatch, run.stderr),
                waitRam,
                say,
            )
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
                const pushed = await push(options, folder)
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
    if (!options.dryRun) await takeDevLock(dir, say)
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
        if (!options.dryRun) releaseLockFile(landPaths(dir).devLock, process.pid)
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
