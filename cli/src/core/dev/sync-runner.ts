import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync } from "node:fs"
import { dirname, join, resolve, win32 } from "node:path"
import { fileURLToPath } from "node:url"
import { setTimeout as sleep } from "node:timers/promises"
import { captureGit, repositoryRoot } from "../../shared/git.js"
import { captureTool, killPidTree } from "../../shared/exec.js"
import { declaredProcesses } from "./declared.js"
import { startRelayed } from "../../shared/relay.js"
import { WRITERS, defineVerb } from "../../shared/verb.js"
import type { VerbResult } from "../../shared/verb.js"
import { writeJsonWhole } from "../../harness/lane-state.js"
import { loadLocalSettings } from "../../harness/local-settings.js"
import type { DevSyncSettings } from "../../harness/local-settings.js"
import { listProcesses } from "../../harness/process-table.js"
import type { HostProcess } from "../../harness/process-table.js"
import { takeLiveLock } from "../../harness/slots.js"
import { devSync, markResyncWhole } from "./sync.js"
import { appCli, readStackProcesses } from "./stack-stop.js"

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

/** The edge of a dev web (@starci/hfs stack/edge-server.mjs): the stack's own, never a stray. */
const EDGE = /edge-server\.m?js/iu

/**
 * The stray dev servers of a checkout: processes run from inside the checkout (its path on their command line) that are a dev server, or that listen
 * on a port the environment declares (`listeners`), and that its dev stack does not record: neither a recorded pid nor one of their descendants, nor
 * a web's edge (an earlier hand run, a copy a moved checkout left, which blocks `stack up` with STACK_LOCAL_SECOND_COPY). Only
 * these are ever stopped by the runner. Pure.
 */
export const strayDevServers = (table: readonly HostProcess[], checkout: string, recorded: ReadonlySet<number>, self: number = process.pid, listeners: ReadonlySet<number> = new Set()): HostProcess[] => {
    // A checkout is matched against Windows command lines: a drive path (`D:/...`) is already absolute, though `resolve` on a POSIX host would prefix the cwd to it.
    const inside = (win32.isAbsolute(checkout) ? checkout : resolve(checkout)).replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase()
    const owned = new Set(recorded)
    for (let grew = true; grew; ) {
        grew = false
        for (const row of table) {
            if (!owned.has(row.pid) && owned.has(row.ppid)) {
                owned.add(row.pid)
                grew = true
            }
        }
    }
    return table.filter((row) => row.pid !== self && !owned.has(row.pid) && !EDGE.test(row.commandLine) && (DEV_SERVER.test(row.commandLine) || listeners.has(row.pid)) && row.commandLine.replaceAll("\\", "/").toLowerCase().includes(inside))
}

/** The pids listening on `ports` of this host (Windows: Get-NetTCPConnection); empty when none is asked or the host cannot tell. */
const listenersOn = async (ports: readonly number[]): Promise<Set<number>> => {
    if (ports.length === 0 || process.platform !== "win32") return new Set()
    const run = await captureTool("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Get-NetTCPConnection -State Listen -LocalPort ${ports.map((port) => String(Math.trunc(port))).join(",")} -ErrorAction SilentlyContinue | ForEach-Object { $_.OwningProcess }`], process.cwd(), { timeoutMs: 30_000 })
    return new Set(run.stdout.split(/\s+/u).map(Number).filter((pid) => Number.isInteger(pid) && pid > 0))
}

/** The seams of the runner: the real ones sync and stop processes; the specs hand in their own. */
export interface RunnerDeps {
    readonly now: () => number
    readonly sleep: (ms: number) => Promise<void>
    /** Stops the stray dev servers of the checkout; the lines saying which. */
    readonly strays: (checkout: string, settings: DevSyncSettings) => Promise<readonly string[]>
    /** One `dev sync --execute`; `watch` hears each line it says and when it holds stack processes stopped (the watchdog's window). */
    readonly sync: (checkout: string, settings: DevSyncSettings, watch: SyncWatch) => Promise<{ readonly exitCode?: number; readonly data: { readonly to: string; readonly restart: string } }>
    /** Ends this runner after a stalled sync, so the stalled steps never go on beside the next sync (process.exit by default). */
    readonly exit?: (code: number) => void
    /** Marks the checkout so the next sync redoes the install, the migration and the restart whole (core/dev/sync.ts markResyncWhole). */
    readonly markWhole?: (checkout: string, why: string) => Promise<void>
    /** How often the watchdog looks (default 30 s). */
    readonly watchEveryMs?: number
    readonly settings: () => DevSyncSettings
    /** After a sync, green or failed: the declared processes nothing listens for (a stack a moved checkout left down) are brought up; the lines saying what. */
    readonly ensureUp?: (checkout: string, settings: DevSyncSettings) => Promise<readonly string[]>
}

const realEnsureUp = async (checkout: string, settings: DevSyncSettings): Promise<readonly string[]> => {
    const declared = (declaredProcesses(checkout, settings.env) ?? []).filter((one) => one.port !== undefined)
    if (declared.length === 0 || process.platform !== "win32") return []
    const down: string[] = []
    for (const one of declared) if ((await listenersOn([one.port ?? 0])).size === 0) down.push(one.name)
    if (down.length === 0) return []
    const up = await captureTool(process.execPath, [appCli(checkout), "app", "stack", "up", "--env", settings.env, "--execute"], checkout, { timeoutMs: 30 * 60_000 })
    return [`nothing listened for ${down.join(", ")}: app stack up --env ${settings.env} --execute exited ${String(up.exitCode)}`]
}

const realStrays = async (checkout: string, settings: DevSyncSettings): Promise<readonly string[]> => {
    const recorded = await readStackProcesses(checkout, settings.env)
    // Without the stack's own record no process can be told stray: none is stopped.
    if (recorded === undefined || typeof recorded === "string") return []
    const table = await listProcesses()
    if (typeof table === "string") return []
    const pids = new Set(Object.values(recorded).map((entry) => entry.pid))
    const ports = (declaredProcesses(checkout, settings.env) ?? []).flatMap((one) => (one.port === undefined ? [] : [one.port]))
    return strayDevServers(table, checkout, pids, process.pid, await listenersOn(ports)).map((row) => `${killPidTree(row.pid) ? "stopped" : "could not stop"} stray dev server pid ${String(row.pid)} (${row.commandLine.slice(0, 120)})`)
}

/** What a sync tells the runner's watchdog: each line it says, and when it holds stack processes stopped. */
export interface SyncWatch {
    readonly progress: (line: string) => void
    readonly onStack: (state: "stopped" | "running") => void
}

export const realRunnerDeps: RunnerDeps = {
    now: Date.now,
    sleep: (ms) => sleep(ms),
    strays: realStrays,
    sync: (checkout, settings, watch) =>
        devSync({
            checkout,
            local: settings.local,
            env: settings.env,
            execute: true,
            restart: true,
            processes: settings.processes,
            say: (line) => {
                watch.progress(line)
                process.stdout.write(`${new Date().toISOString()} ${line}\n`)
            },
            onStack: watch.onStack,
        }),
    exit: (code) => process.exit(code),
    markWhole: markResyncWhole,
    settings: () => loadLocalSettings().devSync,
    ensureUp: realEnsureUp,
}

/**
 * The one line of a refusal a status keeps: its first line, joined with the next line that says something when the first only opens a list (it ends with a
 * colon, as `... npm ci in <checkout> failed:` did and lost its reason). At most 600 characters. Pure.
 */
export const reasonLine = (message: string): string => {
    const lines = message.split("\n").map((line) => line.trim()).filter((line) => line !== "")
    const first = lines[0] ?? ""
    const line = first.endsWith(":") && lines.length > 1 ? `${first} ${lines[1] ?? ""}` : first
    return line.length > 600 ? `${line.slice(0, 597)}...` : line
}

/** How long the runner waits before its one retry of a refused swap. */
const SWAP_RETRY_MS = 20_000
/** How long a waiting runner sleeps before it reads the mark again, at most. */
const WAIT_STEP_MS = 15_000

/** The refusal of a sync the watchdog ended: stack processes stopped and no step said anything for devSync.stallMinutes. */
export const DEV_SYNC_STALLED = "DEV_SYNC_STALLED"

/**
 * Runs one sync under the watchdog: while the sync holds stack processes stopped, a look every `everyMs` that finds no line said for `stallMs` ends the
 * wait with DEV_SYNC_STALLED, naming the last line (the step that stalled). Outside that window nothing is judged: a sync may wait in the heavy queue as
 * long as the host is busy while the stack keeps serving.
 */
export const watchedSync = async <T>(run: (watch: SyncWatch) => Promise<T>, now: () => number, stallMs: number, everyMs: number): Promise<T> => {
    let last = now()
    let lastLine = "the sync started"
    let stopped = false
    let timer: ReturnType<typeof setInterval> | undefined
    const stalled = new Promise<never>((_, reject) => {
        timer = setInterval(() => {
            if (stopped && now() - last >= stallMs) reject(Object.assign(new Error(`no step progressed for ${String(Math.round((now() - last) / 60_000))} min with stack processes stopped; the last step said: ${lastLine.slice(0, 300)}`), { code: DEV_SYNC_STALLED }))
        }, everyMs)
    })
    const watch: SyncWatch = {
        progress: (line) => {
            last = now()
            lastLine = line
        },
        onStack: (state) => {
            stopped = state === "stopped"
            last = now()
        },
    }
    const running = run(watch)
    // A sync the watchdog gave up on may still settle later: its outcome is no longer anyone's.
    running.catch(() => undefined)
    try {
        return await Promise.race([running, stalled])
    } finally {
        clearInterval(timer)
    }
}

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
        let retriedSwap = false
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
            let swapRefused = false
            let stalledSync = false
            try {
                const strays = await deps.strays(checkout, settings)
                for (const line of strays) say(line)
                const done = await watchedSync((watch) => deps.sync(checkout, settings, watch), deps.now, settings.stallMinutes * 60_000, deps.watchEveryMs ?? 30_000)
                failed = (done.exitCode ?? 0) !== 0
                if (!failed) for (const line of (await deps.ensureUp?.(checkout, settings)) ?? []) say(line)
                write(failed ? { state: "failed", reason: `${wanted.reason}; dev sync moved to ${done.data.to.slice(0, 10)} but the restart failed (read the stack log)`, to: done.data.to } : { state: "synced", reason: `${wanted.reason}; restart ${done.data.restart}`, to: done.data.to })
            } catch (error) {
                failed = true
                swapRefused = typeof error === "object" && error !== null && "code" in error && error.code === "DEV_SYNC_SWAP"
                stalledSync = typeof error === "object" && error !== null && "code" in error && error.code === DEV_SYNC_STALLED
                const code = typeof error === "object" && error !== null && "code" in error ? `${String(error.code)}: ` : ""
                const message = error instanceof Error ? error.message : String(error)
                write({ state: "failed", reason: `${wanted.reason}; dev sync refused: ${code}${reasonLine(message)}` })
                // The status keeps one line; the log keeps the whole refusal (npm's exit, its output's tail, its log's error lines), redacted where it was made.
                for (const line of message.split("\n").slice(1).filter((one) => one.trim() !== "")) say(`  ${line}`)
            }
            // After ANY failed sync every declared process must listen again: a swap put back, a stop that never came back is not left for the next landing. `stack up` starts only what does not run.
            if (failed) {
                try {
                    for (const line of (await deps.ensureUp?.(checkout, settings)) ?? []) say(line)
                } catch (error) {
                    say(`after the failed sync the stack could not be checked: ${error instanceof Error ? error.message : String(error)}`)
                }
            }
            // A stalled sync may still be stuck inside a step: the checkout is marked to be redone whole and this runner ends, so the stuck step never runs on
            // beside the next sync, which the standing mark (dev sync-runner --request) or the next landing starts.
            if (stalledSync) {
                await deps.markWhole?.(checkout, "stalled")
                say(`the watchdog ended the stalled sync: the stack was brought up again and the checkout is marked to sync whole; this runner exits (starci dev sync-runner --request --dir ${checkout} starts the next one)`)
                releaseLock(paths.lock)
                deps.exit?.(1)
                return written
            }
            // A refused swap (a file held while the staged build moved in) leaves the checkout on the new commit with the old install; the sync marks that
            // itself (core/dev/sync.ts UNSWAPPED), so one more sync, after the holder had a moment to let go, redoes the install whole. Once per mark.
            if (swapRefused && !retriedSwap) {
                retriedSwap = true
                say(`the swap was refused: syncing once more in ${String(SWAP_RETRY_MS / 1000)} s to install the new tree whole`)
                await deps.sleep(SWAP_RETRY_MS)
                continue
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
