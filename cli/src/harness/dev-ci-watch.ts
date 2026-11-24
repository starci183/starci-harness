import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { setTimeout as sleep } from "node:timers/promises"
import { captureTool } from "../shared/exec.js"
import type { ToolRun } from "../shared/exec.js"
import { startRelayed } from "../shared/relay.js"
import { landPaths, writeJsonWhole, writeStatus } from "./lane-state.js"
import type { LaneStatus } from "./lane-state.js"
import { loadLocalSettings } from "./local-settings.js"

/**
 * The CI verdict of a commit a landing pushed to dev. After a landing (`lane gate --push --land`) one detached watcher
 * (`starci lane ci-watch`, started through the relay so the landing never waits for it) follows the GitHub runs of that sha: every run of a push
 * of the sha, read with `gh run list --commit`. The verdict is written into each landed lane's status file (`ci`) and into
 * `<lanes>/_land-status/_dev-ci/<sha>.json`; a red one is said loudly in the watcher's log and sent to the coordinator session the local settings
 * name (`ciWatch.notifySession`). The watcher never blocks, reverts or pushes dev: a red dev is fixed by a lane.
 */
export type DevCiState = "green" | "red" | "superseded" | "pending" | "none" | "unreadable"

/** One GitHub run of the sha, as `gh run list --json` gives it. */
export interface DevCiRun {
    readonly databaseId: number
    readonly workflowName: string
    readonly event: string
    readonly status: string
    readonly conclusion: string
    readonly url: string
}

export interface DevCiVerdict {
    readonly sha: string
    readonly state: DevCiState
    /** What the state means in one line: the run ids and their conclusions, or why nothing could be read. */
    readonly reason: string
    readonly runs: readonly { readonly id: number; readonly workflow: string; readonly conclusion: string; readonly url: string }[]
    readonly at: string
}

const RED = new Set(["failure", "timed_out", "startup_failure", "action_required"])

/**
 * The verdict of the runs of one sha, pure. Only push runs count (a pull request or a dispatch of the same sha is another question). No run yet is
 * `none`; a run still going is `pending`; any red conclusion is `red`; a run cancelled with none red is `superseded` (a newer push cancels the run of
 * the commit it replaces, cicd.md "CI"); every run success, skipped or neutral is `green`.
 */
export const devCiVerdict = (sha: string, runs: readonly DevCiRun[], at: string = new Date().toISOString()): DevCiVerdict => {
    const pushed = runs.filter((run) => run.event === "push")
    const listed = pushed.map((run) => ({ id: run.databaseId, workflow: run.workflowName, conclusion: run.status === "completed" ? run.conclusion : run.status, url: run.url }))
    const said = listed.map((run) => `${run.workflow} ${String(run.id)}: ${run.conclusion}`).join(", ")
    if (pushed.length === 0) return { sha, state: "none", reason: "no push run of this sha yet", runs: listed, at }
    const red = pushed.filter((run) => run.status === "completed" && RED.has(run.conclusion))
    if (red.length > 0) return { sha, state: "red", reason: said, runs: listed, at }
    if (pushed.some((run) => run.status !== "completed")) return { sha, state: "pending", reason: said, runs: listed, at }
    if (pushed.some((run) => run.conclusion === "cancelled")) return { sha, state: "superseded", reason: said, runs: listed, at }
    return { sha, state: "green", reason: said, runs: listed, at }
}

/** The seams of the watch: the real ones ask gh, sleep and notify; the specs hand in their own. */
export interface CiWatchDeps {
    readonly listRuns: (root: string, sha: string) => Promise<readonly DevCiRun[]>
    readonly pause: (ms: number) => Promise<void>
    readonly now: () => number
    readonly notify: (session: string, message: string) => Promise<ToolRun>
}

const realListRuns = async (root: string, sha: string): Promise<readonly DevCiRun[]> => {
    const run = await captureTool("gh", ["run", "list", "--commit", sha, "--limit", "50", "--json", "databaseId,workflowName,event,status,conclusion,url"], root, { timeoutMs: 60_000 })
    if (run.exitCode !== 0) throw new Error(`gh run list --commit ${sha.slice(0, 10)} exited ${String(run.exitCode)}: ${run.stderr.trim().split("\n")[0] ?? ""}`)
    const parsed: unknown = JSON.parse(run.stdout)
    if (!Array.isArray(parsed)) throw new Error("gh run list did not answer a list")
    return parsed as DevCiRun[]
}

/**
 * Tells the coordinator session: a headless `claude -p --resume <session>` with the message, one turn, no tool allowed beyond the defaults of print mode.
 * Whether a resumed print turn reaches a session that is open in a desktop window is the host's; the loud log line is the verdict's record either way.
 */
const realNotify = (session: string, message: string): Promise<ToolRun> => captureTool("claude", ["-p", "--resume", session, "--max-turns", "1", message], process.cwd(), { timeoutMs: 120_000 })

export const realCiWatchDeps: CiWatchDeps = { listRuns: realListRuns, pause: (ms) => sleep(ms).then(() => undefined), now: Date.now, notify: realNotify }

export interface CiWatchGiven {
    readonly root: string
    readonly dir: string
    readonly sha: string
    readonly lanes: readonly string[]
    /** Give up after this long and write `pending` (default `ciWatch.minutes`, 45). */
    readonly limitMs: number
    readonly pollMs?: number
    readonly notifySession?: string
    readonly say: (line: string) => void
}

/** Where the verdict of a dev sha is kept. */
export const devCiFile = (dir: string, sha: string): string => join(landPaths(dir).status, "_dev-ci", `${sha}.json`)

const readLaneStatus = (dir: string, lane: string): LaneStatus | undefined => {
    const file = join(landPaths(dir).status, `${lane}.json`)
    if (!existsSync(file)) return undefined
    try {
        return JSON.parse(readFileSync(file, "utf8")) as LaneStatus
    } catch {
        return undefined
    }
}

/** Writes the verdict: its own file, and the `ci` of each lane whose status still says it landed as this sha (a lane registered again keeps its new status). */
export const writeDevCiVerdict = (dir: string, lanes: readonly string[], verdict: DevCiVerdict): void => {
    writeJsonWhole(devCiFile(dir, verdict.sha), { ...verdict, lanes })
    for (const lane of lanes) {
        const status = readLaneStatus(dir, lane)
        if (status?.state === "landed" && status.sha === verdict.sha) writeStatus(dir, { ...status, ci: verdict })
    }
}

/** The loud lines of a red dev, for the log and the landing's output. */
export const redBanner = (verdict: DevCiVerdict, lanes: readonly string[]): string[] => {
    const bar = "!".repeat(78)
    return [bar, `!!! DEV CI IS RED at ${verdict.sha.slice(0, 10)} (landed: ${lanes.join(", ")})`, ...verdict.runs.filter((run) => RED.has(run.conclusion)).map((run) => `!!! ${run.workflow} ${String(run.id)}: ${run.conclusion} ${run.url}`), "!!! dev is not reverted or blocked: fix it in a lane (gh run view <id> --log-failed)", bar]
}

/**
 * Follows the runs of `sha` until they settle or `limitMs` passes, then writes the verdict (pending when the limit came first, unreadable when gh
 * could not answer the last time it was asked). A red verdict is said loudly and sent to `notifySession` when one is set; a failed send is said, never
 * thrown. Never touches dev.
 */
export const watchDevCi = async (given: CiWatchGiven, deps: CiWatchDeps = realCiWatchDeps): Promise<DevCiVerdict> => {
    const { root, dir, sha, lanes, limitMs, say } = given
    const pollMs = given.pollMs ?? 30_000
    const until = deps.now() + limitMs
    let verdict: DevCiVerdict
    for (;;) {
        try {
            verdict = devCiVerdict(sha, await deps.listRuns(root, sha), new Date(deps.now()).toISOString())
        } catch (error) {
            verdict = { sha, state: "unreadable", reason: error instanceof Error ? error.message : String(error), runs: [], at: new Date(deps.now()).toISOString() }
        }
        if (verdict.state === "red" || verdict.state === "green" || verdict.state === "superseded") break
        if (deps.now() + pollMs > until) {
            if (verdict.state === "none") verdict = { ...verdict, reason: `no push run of ${sha.slice(0, 10)} within ${String(Math.round(limitMs / 60_000))} min` }
            else if (verdict.state === "pending") verdict = { ...verdict, reason: `still running after ${String(Math.round(limitMs / 60_000))} min: ${verdict.reason}` }
            break
        }
        await deps.pause(pollMs)
    }
    writeDevCiVerdict(dir, lanes, verdict)
    say(`dev CI of ${sha.slice(0, 10)}: ${verdict.state} (${verdict.reason})`)
    if (verdict.state === "red") {
        for (const line of redBanner(verdict, lanes)) say(line)
        if (given.notifySession === undefined) say("no ciWatch.notifySession in the local settings: the red verdict is in this log and the lanes' status files only")
        else {
            const message = `[lane ci-watch] dev CI is RED at ${sha} after landing ${lanes.join(", ")}: ${verdict.reason}. Dev was not reverted; fix it in a lane.`
            try {
                const sent = await deps.notify(given.notifySession, message)
                say(sent.exitCode === 0 ? `told session ${given.notifySession}` : `could not tell session ${given.notifySession} (claude exited ${String(sent.exitCode)}): ${sent.stderr.trim().split("\n")[0] ?? ""}`)
            } catch (error) {
                say(`could not tell session ${given.notifySession}: ${error instanceof Error ? error.message : String(error)}`)
            }
        }
    }
    return verdict
}

const mainScript = (): string => join(dirname(fileURLToPath(import.meta.url)), "..", "main.js")

/**
 * Starts the watch of a landed sha detached (the relay), so the landing returns at once; its output goes to `<lanes>/_land-status/_dev-ci/<sha>.log`.
 * A failure to start is said, never thrown: the landing stands.
 */
export const startDevCiWatch = async (root: string, dir: string, sha: string, lanes: readonly string[], say: (line: string) => void, start: typeof startRelayed = startRelayed): Promise<void> => {
    const log = join(landPaths(dir).status, "_dev-ci", `${sha}.log`)
    try {
        const pid = await start([process.execPath, mainScript(), "lane", "ci-watch", sha, "--dir", dir, "--lanes", lanes.join(",")], root, log)
        say(`dev CI of ${sha.slice(0, 10)}: watched in the background (pid ${String(pid)}, ${String(loadLocalSettings().ciWatch.minutes)} min limit); verdict in ${devCiFile(dir, sha)} and the lanes' status, log ${log}`)
    } catch (error) {
        say(`dev CI of ${sha.slice(0, 10)}: the watcher did not start (${error instanceof Error ? error.message : String(error)}); check it with gh run list --commit ${sha}`)
    }
}
