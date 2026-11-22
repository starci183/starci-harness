import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Refusal } from "../shared/errors.js"
import { pidAlive } from "../shared/exec.js"
import { configuredSlotRoot, takeLockFile } from "./slots.js"

/**
 * The batch lander of an app's `dev` branch (contexts/project/branches.md PROJECT-BRANCH-2). A lane whose full gate ran green on its
 * own tree registers ready; one lander merges every ready lane in its own worktree, runs one gate and pushes `dev`; each lane reads
 * its outcome from a status file. Every file lives in one lanes folder shared by the lanes of a machine.
 */

/** The committed cache folder of an app; a conflict in it alone is no conflict between lanes. */
export const CACHE_DIR = ".starcistacks/cache/"
/** The name the lander writes into every lock and slot it holds. */
export const LANDER = "batch-lander"
/** The gate runs a batch takes at most: the batch, then the batch without the lanes the first run's findings named. Never more: no bisect. */
export const GATE_ROUNDS = 2

/** How long a live lander may go without touching its lock before `lane status` calls it stuck: ten idle polls. */
export const LANDER_HEARTBEAT_MS = 5 * 60_000

/** What `lane status` knows about the lander: who holds the lock, whether that pid runs, and how long since its last loop. */
export type LanderLiveness =
    | { readonly state: "none" }
    | { readonly state: "alive" | "dead" | "stuck"; readonly held: string; readonly pid: number; readonly idleMs: number }

/**
 * Read the lander lock: "dead" when its pid no longer runs (the next `lane land` reclaims it), "stuck" when the pid runs but has not
 * touched the lock for LANDER_HEARTBEAT_MS (a batch may still be gating: read _batch-land.log before acting), else "alive".
 */
export const landerLiveness = (file: string, now = Date.now(), alive: (pid: number) => boolean = pidAlive): LanderLiveness => {
    let held: string
    let touched: number
    try {
        held = readFileSync(file, "utf8").trim()
        touched = statSync(file).mtimeMs
    } catch {
        return { state: "none" }
    }
    const pid = Number(/pid=(\d+)/.exec(held)?.[1] ?? "0")
    const idleMs = Math.max(0, now - touched)
    const state = pid <= 0 || !alive(pid) ? "dead" : idleMs > LANDER_HEARTBEAT_MS ? "stuck" : "alive"
    return { state, held, pid, idleMs }
}

/** The lander's heartbeat: touch its lock at each loop so `lane status` can tell a live idle lander from a hung one. */
export const touchLander = (file: string): void => {
    try {
        const at = new Date()
        utimesSync(file, at, at)
    } catch {
        // the lock is gone: the finally of `lane land` or a reclaim removed it; nothing to touch
    }
}

/** The states a lane's status file holds. */
export type LaneState = "queued" | "landed" | "conflict" | "rejected" | "parked" | "withdrawn"

/** One blocking finding of the batch gate, as a lane reads it. */
export interface LaneFinding {
    readonly code: string
    readonly path: string
    readonly message: string
}

/** A registration: the pushed sha a lane asks to land. */
export interface ReadyEntry {
    readonly lane: string
    readonly branch: string
    readonly sha: string
    readonly at: string
}

/** What a lane monitors: `<lanes>/_land-status/<lane>.json`. */
export interface LaneStatus {
    readonly lane: string
    readonly state: LaneState
    /** The dev commit that carries the lane once landed; the lane's own sha otherwise. */
    readonly sha: string
    readonly laneSha: string
    readonly branch: string
    readonly at: string
    readonly batch?: string
    readonly reason?: string
    readonly findings?: readonly LaneFinding[]
    /** Conflicted paths. */
    readonly files?: readonly string[]
    /** A conflict with a batch-mate only: the lane stays ready for the next batch. */
    readonly requeued?: boolean
    /** Migration files the lane added, to apply once landed. */
    readonly migrations?: readonly string[]
    /** A withdrawn lane only: the batch it was in (queued or gating) when it was withdrawn; absent when it was only waiting. */
    readonly fromBatch?: string
    /** A lane whose batch was aborted because a batch-mate was withdrawn: that batch. The lane stays ready and is gated again in the next one. */
    readonly reformedFrom?: string
    /** The newer sha of the lane whose push or registration cancelled the run this status described (harness/supersede.ts). */
    readonly supersededBy?: string
}

/** The folders and files of a lanes folder. */
export interface LandPaths {
    readonly ready: string
    readonly status: string
    readonly batches: string
    readonly lander: string
    readonly devLock: string
    readonly slot: (kind: "gate" | "npm", n: number) => string
}

/** The folders and files of a lanes folder. */
export const landPaths = (dir: string): LandPaths => ({
    ready: join(dir, "_land-ready"),
    status: join(dir, "_land-status"),
    batches: join(dir, "_land-status", "_batches"),
    lander: join(dir, "_batch-lander.lock"),
    devLock: join(dir, "_dev-push.lock"),
    slot: (kind: "gate" | "npm", n: number) => join(dir, `_${kind}-slot-${String(n)}.lock`),
})

/** The lanes folder of this machine: the flag, else STARCI_LANES_DIR, else `root` of ops/slots.yaml; refused when none names one. */
export const lanesDir = (flag: string | undefined): string => {
    const dir = flag !== undefined && flag !== "" ? flag : configuredSlotRoot()
    if (dir === undefined || dir === "") throw new Refusal("LANE_DIR_UNSET", "name the lanes folder with --dir, STARCI_LANES_DIR or starci config set slots.root <dir> (the folder that holds _land-ready, _land-status and _dev-push.lock)")
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

const isReady = (value: unknown): value is ReadyEntry =>
    typeof value === "object" && value !== null && "lane" in value && "sha" in value && "branch" in value && "at" in value &&
    typeof value.lane === "string" && typeof value.sha === "string" && typeof value.branch === "string" && typeof value.at === "string"

/** Every registration, oldest first. */
export const readyEntries = (dir: string): ReadyEntry[] => {
    const folder = landPaths(dir).ready
    if (!existsSync(folder)) return []
    return readdirSync(folder).filter((name) => name.endsWith(".json")).map((name) => readJson(join(folder, name))).filter(isReady).sort((left, right) => left.at.localeCompare(right.at))
}

/** Registers one lane (replacing its earlier entry) and marks it queued. */
export const writeReady = (dir: string, entry: ReadyEntry): void => {
    writeJsonWhole(join(landPaths(dir).ready, `${entry.lane}.json`), entry)
    writeStatus(dir, { lane: entry.lane, state: "queued", sha: entry.sha, laneSha: entry.sha, branch: entry.branch, at: entry.at })
}

/** Drops a registration when it still names `sha` (a lane that registered again mid-batch keeps its newer entry). */
export const dropReady = (dir: string, lane: string, sha?: string): boolean => {
    const file = join(landPaths(dir).ready, `${lane}.json`)
    const current = readJson(file)
    if (!isReady(current) || (sha !== undefined && current.sha !== sha)) return false
    unlinkSync(file)
    return true
}

/**
 * The lanes of a batch that are no longer ready as the batch took them: `withdrawn` (no registration left: `lane withdraw`) and
 * `replaced` (registered again with another sha, which belongs to the next batch). The lander asks this before each gate run, after
 * it and right before the push, so a lane withdrawn mid-gate is never landed.
 */
export const notReadyAny = (dir: string, lanes: readonly ReadyEntry[]): { readonly withdrawn: readonly ReadyEntry[]; readonly replaced: readonly ReadyEntry[] } => {
    const now = new Map(readyEntries(dir).map((entry) => [entry.lane, entry]))
    const withdrawn: ReadyEntry[] = []
    const replaced: ReadyEntry[] = []
    for (const lane of lanes) {
        const current = now.get(lane.lane)
        if (current === undefined) withdrawn.push(lane)
        else if (current.sha !== lane.sha) replaced.push(lane)
    }
    return { withdrawn, replaced }
}

/** The status a lane monitors. */
export const writeStatus = (dir: string, status: Omit<LaneStatus, "at"> & { readonly at?: string }): void => {
    writeJsonWhole(join(landPaths(dir).status, `${status.lane}.json`), { ...status, at: status.at ?? new Date().toISOString() })
}

/** Every status file, by lane. */
export const readStatuses = (dir: string): LaneStatus[] => {
    const folder = landPaths(dir).status
    if (!existsSync(folder)) return []
    return readdirSync(folder).filter((name) => name.endsWith(".json")).map((name) => readJson(join(folder, name))).filter((value): value is LaneStatus => typeof value === "object" && value !== null && "lane" in value && "state" in value)
}

/** Takes a lock file whole and alone (harness/slots.ts owns it; the lander and every slot share it). */
export { takeLockFile }

/** Releases a lock or slot only when it names the lander (and, given a pid, that process). */
export const releaseLockFile = (file: string, pid?: number): void => {
    try {
        const content = readFileSync(file, "utf8")
        if (content.startsWith(`${LANDER} `) && (pid === undefined || content.includes(`pid=${String(pid)}`))) unlinkSync(file)
    } catch {
        // already gone
    }
}

/** The content the lander writes into what it holds. */
export const holderLine = (): string => `${LANDER} ${new Date().toISOString()} pid=${String(process.pid)}`

/** One lander per lanes folder: refused while a live lander holds it; the file of a lander whose process is gone is replaced. */
export const holdLander = (dir: string): void => {
    const file = landPaths(dir).lander
    for (let attempt = 0; attempt < 3; attempt += 1) {
        if (takeLockFile(file, holderLine())) return
        let held: string
        try {
            held = readFileSync(file, "utf8")
        } catch {
            continue
        }
        const pid = Number(/pid=(\d+)/.exec(held)?.[1] ?? "0")
        if (pid > 0 && pidAlive(pid)) throw new Refusal("LANE_LANDER_RUNNING", `a lander already runs (${held.trim()}); one lander per lanes folder`)
        if (!held.startsWith(`${LANDER} `)) throw new Refusal("LANE_LANDER_LOCK_FOREIGN", `${file} holds "${held.trim()}", not a lander: report it, it is never removed here`)
        unlinkSync(file)
    }
    throw new Refusal("LANE_LANDER_RUNNING", `${file} could not be taken`)
}

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
                message: typeof finding.message === "string" ? finding.message.slice(0, 600) : "",
            }))
    } catch {
        return undefined
    }
}

/**
 * The lanes whose diff names a finding's file, most precise first: the finding's path is a file a lane changed; else its message
 * cites a file a lane changed; else its path is a folder holding a file a lane changed. Cache records never count.
 */
export const lanesNamedBy = (finding: LaneFinding, changed: ReadonlyMap<string, readonly string[]>): string[] => {
    const path = finding.path.replaceAll("\\", "/").replace(/:\d+(:\d+)?$/, "").replace(/\/$/, "")
    const pick = (test: (file: string) => boolean): string[] =>
        [...changed].filter(([, files]) => files.some((file) => !file.startsWith(CACHE_DIR) && test(file))).map(([lane]) => lane)
    const exact = path === "" ? [] : pick((file) => file === path)
    if (exact.length > 0) return exact
    const cited = pick((file) => file.length > 4 && finding.message.includes(file))
    if (cited.length > 0) return cited
    return path === "" || path === "." ? [] : pick((file) => file.startsWith(`${path}/`))
}

/** The gate runs a batch makes again when its gate ran out of memory, each once the host has OOM_FREE_MB free; then it parks. */
export const OOM_RETRIES = 2
/** The free RAM, in MB, a gate run that ran out of memory waits for before it runs again. */
export const OOM_FREE_MB = 6144

/**
 * The marks of a process that ran out of memory rather than failing a check: Node's abort (exit 134) or a kill (exit 137), Windows'
 * fast-fail of a heap abort (0xC0000409), the V8 heap messages, the harness's heap-cap note and ENOMEM.
 */
const OOM_TEXT = /\bexit(?:ed)?:? \(?(?:134|137|3221226505)\b|heap out of memory|reached heap limit|heap cap \d+ MB reached|allocation failed - javascript heap|\bENOMEM\b/i
const OOM_EXIT_CODES: ReadonlySet<number> = new Set([134, 137, 3221226505])

/** Whether a process's exit code or its printed text says it ran out of memory. */
export const isOutOfMemory = (exitCode: number | undefined, text = ""): boolean => (exitCode !== undefined && OOM_EXIT_CODES.has(exitCode)) || OOM_TEXT.test(text)

/** How one gate round of a batch ended. */
export type RoundVerdict =
    | { readonly kind: "green" }
    | { readonly kind: "no-verdict" }
    /** The gate, or a check inside it, ran out of memory: no lane is to blame; the batch waits for RAM and runs again. */
    | { readonly kind: "oom"; readonly evidence: string }
    | { readonly kind: "drop"; readonly blamed: ReadonlyMap<string, readonly LaneFinding[]> }
    | { readonly kind: "stop"; readonly why: string; readonly blamed: ReadonlyMap<string, readonly LaneFinding[]>; readonly findings: readonly LaneFinding[] }

/**
 * Judges one gate round. A gate that ran out of memory, itself (its exit code or its log) or in any check a blocking finding reports, is
 * `oom`: nothing is blamed. Green lands (the push commits the cache records the gate wrote, contexts/project/check-cache.md). No report, or a red exit with no finding at all, is no verdict (nothing is
 * blamed). Otherwise every finding is mapped to the lanes whose diff names it: on the first round with every finding mapped and some
 * lane left, those lanes drop and the rest run once more; a second red round, an unmapped finding or a batch where every lane is named
 * stops the batch, landing nothing.
 */
export const judgeRound = (round: number, exitCode: number, stdout: string, changed: ReadonlyMap<string, readonly string[]>, stderr = ""): RoundVerdict => {
    const all = blockingFindings(stdout)
    const crashed = (all ?? []).find((finding) => isOutOfMemory(undefined, finding.message))
    if (crashed !== undefined) return { kind: "oom", evidence: `${crashed.code} ${crashed.path}: ${crashed.message.slice(0, 200)}` }
    if (all === undefined && isOutOfMemory(exitCode, stderr)) return { kind: "oom", evidence: `the gate itself exited ${String(exitCode)} with no report` }
    if (all === undefined || (exitCode !== 0 && all.length === 0)) return { kind: "no-verdict" }
    if (all.length === 0) return { kind: "green" }
    const blamed = new Map<string, LaneFinding[]>()
    const unmapped: LaneFinding[] = []
    for (const finding of all) {
        const lanes = lanesNamedBy(finding, changed)
        if (lanes.length === 0) unmapped.push(finding)
        for (const lane of lanes) blamed.set(lane, [...(blamed.get(lane) ?? []), finding])
    }
    if (unmapped.length > 0) return { kind: "stop", why: `the gate is red on ${String(unmapped.length)} finding(s) no lane's diff names`, blamed, findings: all }
    if (round >= GATE_ROUNDS) return { kind: "stop", why: "the gate is still red on the second run", blamed, findings: all }
    if (blamed.size >= changed.size) return { kind: "stop", why: "every lane in the batch is named by a finding", blamed, findings: all }
    return { kind: "drop", blamed }
}
