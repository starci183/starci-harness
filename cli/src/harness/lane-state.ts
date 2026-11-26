import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Refusal } from "../shared/errors.js"
import { configuredSlotRoot, takeLiveLock } from "./slots.js"
import type { DevCiVerdict } from "./dev-ci-watch.js"

/**
 * The state of a machine's lanes folder (contexts/project/branches.md PROJECT-BRANCH-2): the dev lock a landing holds while it pushes dev, the
 * status a landed lane leaves, the slots. Every file lives in one lanes folder shared by the lanes of a machine.
 */

/** The name a landing writes into the dev lock it holds. */
export const DEV_LOCK_HOLDER = "dev-lock"

/** One blocking finding of a gate report, as a lane reads it. */
export interface LaneFinding {
    readonly code: string
    readonly path: string
    readonly message: string
}

/** What a landed lane leaves: `<lanes>/_land-status/<lane>.json`. */
export interface LaneStatus {
    readonly lane: string
    readonly state: "landed"
    /** The dev commit that carries the lane. */
    readonly sha: string
    readonly laneSha: string
    readonly branch: string
    readonly at: string
    readonly reason?: string
    /** Migration files the lane added, to apply once landed. */
    readonly migrations?: readonly string[]
    /** The GitHub CI verdict of the dev commit that carries it, written by the watcher the landing started (harness/dev-ci-watch.ts). */
    readonly ci?: DevCiVerdict
}

/** The folders and files of a lanes folder. */
export interface LandPaths {
    readonly status: string
    readonly devLock: string
}

/** The folders and files of a lanes folder; `scope` (harness/land-profile.ts lockScope) gives another repository of the folder its own dev lock. */
export const landPaths = (dir: string, scope = ""): LandPaths => ({
    status: join(dir, "_land-status"),
    devLock: join(dir, scope === "" ? "_dev-push.lock" : `_dev-push-${scope}.lock`),
})

/** The lanes folder of this machine: the flag, else STARCI_LANES_DIR, else `root` of ops/slots.yaml; refused when none names one. */
export const lanesDir = (flag: string | undefined): string => {
    const dir = flag !== undefined && flag !== "" ? flag : configuredSlotRoot()
    if (dir === undefined || dir === "") throw new Refusal("LANE_DIR_UNSET", "name the lanes folder with --dir, STARCI_LANES_DIR or starci config set slots.root <dir> (the folder that holds _land-status and _dev-push.lock)")
    return dir
}

/** A lane name the files can carry. */
export const checkLaneName = (lane: string): string => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(lane)) throw new Refusal("LANE_NAME_INVALID", `"${lane}" is not a lane name (letters, digits, dot, dash, underscore)`)
    return lane
}

/** Writes JSON whole: a temporary file renamed into place, so a reader never sees half a file. */
export const writeJsonWhole = (file: string, data: unknown): void => {
    mkdirSync(join(file, ".."), { recursive: true })
    const temporary = `${file}.${String(process.pid)}.tmp`
    writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`)
    renameSync(temporary, file)
}

const readJson = (file: string): unknown => {
    try {
        return JSON.parse(readFileSync(file, "utf8")) as unknown
    } catch {
        return undefined
    }
}

/** The status a landed lane leaves. */
export const writeStatus = (dir: string, status: Omit<LaneStatus, "at"> & { readonly at?: string }): void => {
    writeJsonWhole(join(landPaths(dir).status, `${status.lane}.json`), { ...status, at: status.at ?? new Date().toISOString() })
}

/** Every status file, by lane. */
export const readStatuses = (dir: string): LaneStatus[] => {
    const folder = landPaths(dir).status
    if (!existsSync(folder)) return []
    return readdirSync(folder).filter((name) => name.endsWith(".json")).map((name) => readJson(join(folder, name))).filter((value): value is LaneStatus => typeof value === "object" && value !== null && "lane" in value && "state" in value)
}

/** The content a landing writes into the dev lock it holds. */
export const holderLine = (): string => `${DEV_LOCK_HOLDER} ${new Date().toISOString()} pid=${String(process.pid)}`

/** Releases a dev lock only when this landing holds it (and, given a pid, that process). */
export const releaseLockFile = (file: string, pid?: number): void => {
    try {
        const content = readFileSync(file, "utf8")
        if (content.startsWith(`${DEV_LOCK_HOLDER} `) && (pid === undefined || content.includes(`pid=${String(pid)}`))) unlinkSync(file)
    } catch {
        // already gone
    }
}

/** Waits for the dev lock (of the repository's scope) and holds it; a lock whose pid is not alive is taken over at once (`takeLiveLock`). */
export const takeDevLock = async (dir: string, say: (line: string) => void, scope = "", pollMs = 5000): Promise<void> => {
    let waited = false
    while (!takeLiveLock(landPaths(dir, scope).devLock, holderLine(), say)) {
        if (!waited) say(`waiting for ${landPaths(dir, scope).devLock}`)
        waited = true
        await new Promise((settle) => setTimeout(settle, pollMs))
    }
}

/** The trailer a landing commit carries for its lane: how a later landing knows the lane's sha is on dev although its commits are not. */
export const LANDED_TRAILER = "Landed-lane"

/** The message of a lane's one commit on dev: the lane, its branch and sha, and one `Landed-lane: <lane> <sha>` trailer. */
export const squashMessage = (stamp: string, lane: { readonly lane: string; readonly branch: string; readonly sha: string }): string =>
    [`land lane ${lane.lane} onto dev (${stamp})`, "", `- ${lane.lane} (${lane.branch} ${lane.sha})`, "", `${LANDED_TRAILER}: ${lane.lane} ${lane.sha}`].join("\n")

interface RawFinding {
    readonly code?: unknown
    readonly level?: unknown
    readonly report?: unknown
    readonly path?: unknown
    readonly message?: unknown
}

/** The blocking findings of an `app check --json` report (an error outside a report profile); undefined when it is not a report. */
export const blockingFindings = (stdout: string): LaneFinding[] | undefined => {
    try {
        const found: RawFinding[] = []
        const walk = (value: unknown, depth: number): void => {
            if (depth > 6 || typeof value !== "object" || value === null) return
            if (Array.isArray(value)) {
                for (const item of value) walk(item, depth + 1)
                return
            }
            const record = value as Record<string, unknown>
            if (Array.isArray(record.findings)) found.push(...(record.findings as RawFinding[]))
            else for (const inner of Object.values(record)) walk(inner, depth + 1)
        }
        walk(JSON.parse(stdout) as unknown, 0)
        return found
            .filter((finding) => finding.level === "error" && finding.report !== true)
            .map((finding) => ({
                code: typeof finding.code === "string" ? finding.code : "",
                path: typeof finding.path === "string" ? finding.path : "",
                message: typeof finding.message === "string" ? finding.message.slice(0, 2400) : "",
            }))
    } catch {
        return undefined
    }
}

/**
 * The marks of a process that ran out of memory rather than failing a check: Node's abort (exit 134) or a kill (exit 137), Windows'
 * fast-fail of a heap abort (0xC0000409), the V8 heap messages, the harness's heap-cap note and ENOMEM.
 */
const OOM_TEXT = /\bexit(?:ed)?:? \(?(?:134|137|3221226505)\b|heap out of memory|reached heap limit|heap cap \d+ MB reached|allocation failed - javascript heap|\bENOMEM\b/i
const OOM_EXIT_CODES: ReadonlySet<number> = new Set([134, 137, 3221226505])

/** Whether a process's exit code or its printed text says it ran out of memory. */
export const isOutOfMemory = (exitCode: number | undefined, text = ""): boolean => (exitCode !== undefined && OOM_EXIT_CODES.has(exitCode)) || OOM_TEXT.test(text)
