import { readFileSync } from "node:fs"
import { EVERYONE, defineVerb } from "../../shared/verb.js"
import { captureGitSync } from "../../shared/git.js"
import { checkLaneName, landedLanesOf, landPaths, lanesDir, readStatuses } from "../../harness/lane-state.js"
import type { LandedLane } from "../../harness/lane-state.js"
import { devSyncForRepo, loadLocalSettings } from "../../harness/local-settings.js"

const held = (file: string): string | null => {
    try {
        return readFileSync(file, "utf8").trim()
    } catch {
        return null
    }
}

/** The lanes one repository's integration branch holds that its dev lacks, as of the last fetch. */
export interface WaitingForDev {
    readonly repo: string
    readonly into: string
    /** The lanes (Landed-lane trailers) of origin/<into> that origin/dev lacks, oldest first; empty when dev holds the branch. */
    readonly lanes: readonly LandedLane[]
    /** Why nothing could be read (no such branch, not a repository). */
    readonly unreadable?: string
}

/**
 * The lanes on each integration branch of this machine's settings (the `devSync.repos` entries whose landInto is not dev) that are not on dev yet: the
 * Landed-lane trailers of `origin/dev..origin/<into>` in that repository, read from its remote-tracking refs as they stand (no fetch).
 */
export const waitingForDev = (repos: Readonly<Record<string, { readonly landInto?: string | undefined }>>, into: (repo: string) => string): WaitingForDev[] =>
    Object.keys(repos)
        .map((repo) => ({ repo, into: into(repo) }))
        .filter((entry) => entry.into !== "dev")
        .map(({ repo, into: branch }) => {
            const log = captureGitSync(["log", "--format=%B", `origin/dev..origin/${branch}`], repo)
            if (log.exitCode !== 0) return { repo, into: branch, lanes: [], unreadable: log.stderr.trim().split("\n")[0] ?? `git log exited ${String(log.exitCode)}` }
            return { repo, into: branch, lanes: landedLanesOf(log.stdout) }
        })

/** `starci lane status [lane]`: who holds the dev lock, each landed lane's status (or one lane's) and the lanes an integration branch holds that dev lacks. */
export const laneStatusVerb = defineVerb({
    path: ["lane", "status"],
    summary: "print who holds the dev lock, each lane's landing status (the commit that carries it, the branch it landed on and its CI verdict) and, per repository whose lanes land into an integration branch (landInto), the lanes on that branch that are not on dev yet (as of the last fetch; starci dev promote brings them)",
    effect: "read",
    roles: EVERYONE,
    schema: "starci/lane-status@1",
    flags: {
        lane: { kind: "string", summary: "only this lane", positional: true },
        dir: { kind: "string", summary: "the lanes folder (default: STARCI_LANES_DIR)" },
    },
    run: (_context, flags) => {
        const dir = lanesDir(flags.dir)
        const only = flags.lane === undefined ? undefined : checkLaneName(flags.lane)
        const statuses = readStatuses(dir).filter((status) => only === undefined || status.lane === only).sort((left, right) => left.lane.localeCompare(right.lane))
        const settings = loadLocalSettings().devSync
        const waiting = waitingForDev(settings.repos, (repo) => devSyncForRepo(settings, repo).landInto)
        const notOnDev = new Set(waiting.flatMap((entry) => entry.lanes.map((lane) => `${lane.lane} ${lane.sha}`)))
        const data = { devLock: held(landPaths(dir).devLock), statuses, waitingForDev: waiting }
        const lines = [
            `dev lock: ${data.devLock ?? "free"}`,
            ...statuses.map((status) => {
                const into = status.into === undefined ? "" : ` on ${status.into}${notOnDev.has(`${status.lane} ${status.laneSha}`) ? " (not on dev yet)" : ""}`
                return `${status.lane}: ${status.state}${into} ${status.sha.slice(0, 10)}${status.reason === undefined ? "" : ` (${status.reason})`}${status.ci === undefined ? "" : `, CI ${status.ci.state}`}`
            }),
            ...waiting.filter(() => only === undefined).flatMap((entry) => [
                entry.unreadable !== undefined
                    ? `${entry.repo}: lanes land into ${entry.into}; unreadable (${entry.unreadable})`
                    : `${entry.repo}: lanes land into ${entry.into}; ${entry.lanes.length === 0 ? "dev holds all of it" : `${String(entry.lanes.length)} lane(s) on ${entry.into}, not on dev yet (starci dev promote --dir ${entry.repo} --from ${entry.into}):`}`,
                ...entry.lanes.map((lane) => `  ${lane.lane} ${lane.sha.slice(0, 10)}`),
            ]),
        ]
        return Promise.resolve({ data, message: lines.join("\n") })
    },
})
