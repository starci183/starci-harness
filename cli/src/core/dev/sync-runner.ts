import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { setTimeout as sleep } from "node:timers/promises"
import { captureGit, repositoryRoot } from "../../shared/git.js"
import { killPidTree } from "../../shared/exec.js"
import { startRelayed } from "../../shared/relay.js"
import { WRITERS, defineVerb } from "../../shared/verb.js"
import type { VerbResult } from "../../shared/verb.js"
import { writeJsonWhole } from "../../harness/land-queue.js"
import { loadLocalSettings } from "../../harness/local-settings.js"
import type { DevSyncSettings } from "../../harness/local-settings.js"
import { listProcesses } from "../../harness/process-table.js"
import type { HostProcess } from "../../harness/process-table.js"
import { takeLiveLock } from "../../harness/slots.js"
import { devSync } from "./sync.js"
import { readStackProcesses } from "./stack-stop.js"

/**
 * The debounced dev sync of an app's dev checkout (contexts/project/cicd.md "Dev and prod"): a landing on dev only marks the checkout as wanting a sync
 * (`requestDevSync`, written by `lane gate --land`) and makes sure its one runner runs. The runner waits until no landing marked it for the debounce
 * window (devSync.debounceSeconds, 120 s by default), syncs ONCE to the newest origin/dev (`dev sync --execute`: the new tree is built in a staging
 * worktree first, the api and web are swapped last), writes its status with the reason of a failure, and syncs again only when a landing marked the
 * checkout during the sync. One runner per checkout (a lock with its pid), and `dev sync` takes the checkout's sync lock besides, so two syncs never run
 * at once. It is started through a relay, so no terminal tab or agent owns it. Its files live in the checkout's git folder, which every CLI copy of the
 * machine finds the same way: `<git common dir>/starci-dev-sync/{wanted.json,status.json,runner.lock,runner.log}`.
 */

/** A landing's mark: the checkout wants a sync to the dev that holds it. */
export interface SyncWanted {
    readonly at: string
    readonly reason: string
}

/** Where the runner of a checkout stands. */
export interface SyncRunnerStatus {
    readonly state: "waiting" | "syncing" | "synced" | "failed"
    readonly at: string
    readonly reason: string
    /** The dev commit the checkout was synced to. */
    readonly to?: string
    readonly pid: number
}

/** The runner's files of a checkout. */
export interface RunnerPaths {
    readonly dir: string
    readonly wanted: string
    readonly status: string
    readonly lock: string
    readonly log: string
}

/** The runner's files of `checkout`, in its git common dir. */
export const runnerPaths = async (checkout: string): Promise<RunnerPaths> => {
    const root = await repositoryRoot(checkout)
    const common = (await captureGit(["rev-parse", "--path-format=absolute", "--git-common-dir"], root)).stdout.trim()
    const dir = join(common === "" ? join(root, ".git") : common, "starci-dev-sync")
    return { dir, wanted: join(dir, "wanted.json"), status: join(dir, "status.json"), lock: join(dir, "runner.lock"), log: join(dir, "runner.log") }
}

const readJson = (file: string): unknown => {
    try {
        return JSON.parse(readFileSync(file, "utf8")) as unknown
    } catch {
        return undefined
    }
}

/** The mark of a checkout, or undefined. */
export const readWanted = (paths: RunnerPaths): SyncWanted | undefined => readJson(paths.wanted) as SyncWanted | undefined

/** The runner's last status of a checkout, or undefined. */
export const readRunnerStatus = (paths: RunnerPaths): SyncRunnerStatus | undefined => readJson(paths.status) as SyncRunnerStatus | undefined

const lockLine = (): string => `dev-sync-runner ${new Date().toISOString()} pid=${String(process.pid)}`

const releaseLock = (file: string): void => {
    try {
        if (readFileSync(file, "utf8").includes(`pid=${String(process.pid)}`)) unlinkSync(file)
    } catch {
        // already gone
    }
}

/** This CLI's entry, which the relayed runner runs. */
const mainScript = (): string => join(dirname(fileURLToPath(import.meta.url)), "..", "..", "main.js")

/**
 * Marks `checkout` as wanting a sync and makes sure its runner runs: when a live runner holds the lock it picks the mark up, else one is started through
 * the relay (`start`). Returns the runner's pid when it started one.
 */
export const requestDevSync = async (checkout: string, reason: string, say: (line: string) => void, start: (paths: RunnerPaths, checkout: string) => Promise<number> = startRunner): Promise<{ readonly paths: RunnerPaths; readonly started?: number }> => {
    const paths = await runnerPaths(checkout)
    mkdirSync(paths.dir, { recursive: true })
    writeJsonWhole(paths.wanted, { at: new Date().toISOString(), reason } satisfies SyncWanted)
    const held = existsSync(paths.lock) ? readFileSync(paths.lock, "utf8") : ""
    const pid = Number(/\bpid=(\d+)/.exec(held)?.[1] ?? "0")
    if (pid > 0 && pidLive(pid)) {
        say(`dev sync of ${checkout}: marked (${reason}); its runner (pid ${String(pid)}) syncs once no landing marked it for the debounce window`)
        return { paths }
    }
    const started = await start(paths, checkout)
    say(`dev sync of ${checkout}: marked (${reason}); started its runner (pid ${String(started)}, log ${paths.log})`)
    return { paths, started }
}

const pidLive = (pid: number): boolean => {
    try {
        process.kill(pid, 0)
        return true
    } catch (error) {
        return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM"
    }
}

const startRunner = (paths: RunnerPaths, checkout: string): Promise<number> =>
    startRelayed([process.execPath, mainScript(), "dev", "sync-runner", "--dir", resolve(checkout)], resolve(checkout), paths.log)

/** The settings of the checkout: its devSync.repos entry (the one whose checkout it is, else whose key it is) over the machine-wide ones. Pure. */
export const settingsForCheckout = (settings: DevSyncSettings, checkout: string): DevSyncSettings => {
    const key = (path: string): string => path.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()
    const own = Object.entries(settings.repos).find(([repo, entry]) => key(entry.checkout ?? repo) === key(checkout))?.[1]
    if (own === undefined) return settings
    return { ...settings, checkout: own.checkout, env: own.env ?? settings.env, debounceSeconds: own.debounceSeconds ?? settings.debounceSeconds, processes: own.processes ?? settings.processes }
}

/** A dev server's command line: next dev or start, a watcher (ts-node-dev, nodemon, tsx watch), nest start, vite. */
const DEV_SERVER = /\bnext(?:\.js)?["']?\s+(?:dev|start)\b|ts-node-dev|nodemon|\btsx\s+watch\b|\bnest\s+start\b|\bvite(?:\.js)?["']?(?:\s|$)/iu

/**
 * The stray dev servers of a checkout: processes whose command line runs a dev server from inside the checkout and that its dev stack does not record
 * (an earlier hand run, a duplicate the stack lost track of). Only these are ever stopped by the runner. Pure.
 */
export const strayDevServers = (table: readonly HostProcess[], checkout: string, recorded: ReadonlySet<number>, self: number = process.pid): HostProcess[] => {
    const inside = resolve(checkout).replaceAll("\\", "/").toLowerCase()
    return table.filter((row) => row.pid !== self && !recorded.has(row.pid) && DEV_SERVER.test(row.commandLine) && row.commandLine.replaceAll("\\", "/").toLowerCase().includes(inside))
}

/** The seams of the runner: the real ones sync and stop processes; the specs hand in their own. */
export interface RunnerDeps {
    readonly now: () => number
    readonly sleep: (ms: number) => Promise<void>
    /** Stops the stray dev servers of the checkout; the lines saying which. */
    readonly strays: (checkout: string, settings: DevSyncSettings) => Promise<readonly string[]>
    readonly sync: (checkout: string, settings: DevSyncSettings) => Promise<{ readonly exitCode?: number; readonly data: { readonly to: string; readonly restart: string } }>
    readonly settings: () => DevSyncSettings
}

const realStrays = async (checkout: string, settings: DevSyncSettings): Promise<readonly string[]> => {
    const recorded = await readStackProcesses(checkout, settings.env)
    // Without the stack's own record no process can be told stray: none is stopped.
    if (recorded === undefined || typeof recorded === "string") return []
    const table = await listProcesses()
    if (typeof table === "string") return []
    const pids = new Set(Object.values(recorded).map((entry) => entry.pid))
    return strayDevServers(table, checkout, pids).map((row) => `${killPidTree(row.pid) ? "stopped" : "could not stop"} stray dev server pid ${String(row.pid)} (${row.commandLine.slice(0, 120)})`)
}

export const realRunnerDeps: RunnerDeps = {
    now: Date.now,
    sleep: (ms) => sleep(ms),
    strays: realStrays,
    sync: (checkout, settings) => devSync({ checkout, local: settings.local, env: settings.env, execute: true, restart: true, processes: settings.processes, say: (line) => { process.stdout.write(`${new Date().toISOString()} ${line}\n`) } }),
    settings: () => loadLocalSettings().devSync,
}

/** How long a waiting runner sleeps before it reads the mark again, at most. */
const WAIT_STEP_MS = 15_000

/**
 * The runner's loop, under the checkout's runner lock: wait out the debounce window of the newest mark, stop the checkout's stray dev servers, sync once,
 * write the status (a failure with its reason), and clear the mark when no landing marked it meanwhile; loop while one did. Returns every status written.
 */
export const runDevSyncRunner = async (checkout: string, paths: RunnerPaths, deps: RunnerDeps = realRunnerDeps, say: (line: string) => void = () => undefined): Promise<SyncRunnerStatus[]> => {
    mkdirSync(paths.dir, { recursive: true })
    if (!takeLiveLock(paths.lock, lockLine(), say)) {
        say(`a runner already holds ${paths.lock}: it syncs ${checkout}`)
        return []
    }
    const written: SyncRunnerStatus[] = []
    const write = (status: Omit<SyncRunnerStatus, "at" | "pid">): void => {
        const full = { ...status, at: new Date(deps.now()).toISOString(), pid: process.pid }
        writeJsonWhole(paths.status, full)
        if (status.state === "synced" || status.state === "failed") written.push(full)
        say(`${full.state}: ${full.reason}`)
    }
    try {
        let waitingFor = ""
        for (;;) {
            const wanted = readWanted(paths)
            if (wanted === undefined) return written
            const settings = settingsForCheckout(deps.settings(), checkout)
            const due = Date.parse(wanted.at) + settings.debounceSeconds * 1000
            if (deps.now() < due) {
                if (waitingFor !== wanted.at) write({ state: "waiting", reason: `${wanted.reason}; syncs once no landing marked it for ${String(settings.debounceSeconds)} s` })
                waitingFor = wanted.at
                await deps.sleep(Math.min(due - deps.now(), WAIT_STEP_MS))
                continue
            }
            write({ state: "syncing", reason: wanted.reason })
            let failed = false
            try {
                const strays = await deps.strays(checkout, settings)
                for (const line of strays) say(line)
                const done = await deps.sync(checkout, settings)
                failed = (done.exitCode ?? 0) !== 0
                write(failed ? { state: "failed", reason: `${wanted.reason}; dev sync moved to ${done.data.to.slice(0, 10)} but the restart failed (read the stack log)`, to: done.data.to } : { state: "synced", reason: `${wanted.reason}; restart ${done.data.restart}`, to: done.data.to })
            } catch (error) {
                failed = true
                const code = typeof error === "object" && error !== null && "code" in error ? `${String(error.code)}: ` : ""
                write({ state: "failed", reason: `${wanted.reason}; dev sync refused: ${code}${(error instanceof Error ? error.message : String(error)).split("\n")[0] ?? ""}` })
            }
            const after = readWanted(paths)
            if (after?.at === wanted.at) {
                rmSync(paths.wanted, { force: true })
                return written
            }
            // A landing marked the checkout during the sync: sync again for it (a failure too: the new commit may be its fix).
            if (failed) say("a newer landing arrived during the failed sync: syncing again for it")
        }
    } finally {
        releaseLock(paths.lock)
    }
}

/** `starci dev sync-runner`: the debounced dev sync of a checkout (run in the foreground, as the relay starts it), its status, or a mark that starts it. */
export const devSyncRunnerVerb = defineVerb({
    path: ["dev", "sync-runner"],
    summary: "the debounced dev sync of an app's dev checkout: --request marks the checkout as wanting a sync and starts its one runner detached (lane gate --land does this after a landing); the runner waits devSync.debounceSeconds (120 s) with no newer landing, stops the checkout's stray dev servers, syncs once to the newest origin/dev (dev sync --execute: the new tree built first, the api and web swapped last) and writes its status, a failure with its reason; --status prints it",
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/dev-sync-runner@1",
    flags: {
        dir: { kind: "string", summary: "the app's dev checkout (default: the current one)" },
        request: { kind: "boolean", summary: "mark the checkout as wanting a sync and start its runner detached when none runs" },
        status: { kind: "boolean", summary: "print the runner's last status and the pending mark; changes nothing" },
    },
    run: async (context, flags): Promise<VerbResult<unknown>> => {
        const checkout = resolve(flags.dir ?? context.cwd)
        const paths = await runnerPaths(checkout)
        if (flags.status) {
            const status = readRunnerStatus(paths)
            const wanted = readWanted(paths)
            const message = `${status === undefined ? "no sync ran yet" : `${status.state} at ${status.at}: ${status.reason}`}${wanted === undefined ? "" : `\npending: marked ${wanted.at} (${wanted.reason})`}`
            return { data: { checkout, status: status ?? null, wanted: wanted ?? null }, message }
        }
        if (flags.request) {
            const requested = await requestDevSync(checkout, "requested by hand", context.progress)
            return { data: { checkout, started: requested.started ?? null }, message: `dev sync of ${checkout} requested` }
        }
        const written = await runDevSyncRunner(checkout, paths, realRunnerDeps, context.progress)
        const failed = written.some((status) => status.state === "failed")
        return { data: { checkout, statuses: written }, message: written.length === 0 ? "nothing to sync" : written.map((status) => `${status.state}: ${status.reason}`).join("\n"), ...(failed ? { exitCode: 1 } : {}) }
    },
})
