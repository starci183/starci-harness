import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { hostname, uptime } from "node:os"
import { basename, join, resolve } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"
import { captureToolSync, killPidTree, pidAlive } from "../shared/exec.js"
import { hostFreeMb } from "./heavy.js"
import { listProcesses } from "./process-table.js"
import type { HostProcess } from "./process-table.js"
import { registerRun } from "./runs.js"
import { deleteRow, insertRow, logEvent, recordEvent, rememberLockFolders, selfStartMs, slotRows, withSlotStore } from "./slot-store.js"
import type { SlotRow } from "./slot-store.js"
import { sharedStateBase } from "./ledger.js"
import { locateOps } from "./ops.js"

/**
 * Machine-wide lane slots (ops/slots.yaml): a bounded number per kind (`npm`, `gate`, `shoot`, `stack`), each a row of `lane_slots` in the host
 * store (machine.sqlite, ledger.ts `machinePath`: one file per host that every checkout, installed CLI and working folder resolves alike;
 * harness/slot-store.ts). The heavy-command governor (harness/heavy.ts) keeps its rows in the same store.
 *
 * A row maps 1-1 to the process doing the work: it names the lane, the ONE process it lives as long as (pid and its OS start, required: SLOT_PID_REQUIRED,
 * SLOT_START_UNKNOWN), the command and, once spawned, the child running it. It is taken inside one transaction (no two takers get one number), deleted
 * the moment that process lets it go (`withSlot`: on its end, an error and a signal), and reclaimed only on evidence that the process is gone
 * (`judgeHolder`): its pid is not alive, its pid now runs a process started at another time, or the host booted after it was taken. Age is a warning,
 * never a reclaim. `killSlot` is the last resort: it kills the holder's process tree, refusing a pid it cannot prove is still the holder. Every take,
 * release, reclaim and kill is logged in `slot_events`.
 *
 * A lock FILE (`<root>/<kind.file>`, written by a CLI copy that predates the store or by a script of an app) is foreign: never written, honoured as
 * holding its number while its holder is not proven gone (a line with no pid once its lane is proven gone, `proveLaneGone`), and reclaimed (renamed
 * aside first, so two reclaimers never both win) on that proof.
 *
 * One slot per lane per kind: a take for a lane that already holds a slot of the kind returns it when its process is the taker or one the taker runs
 * under, so retried gates never pile up. A lane's slots are also released when it lands or its worktree is removed (`releaseLaneSlots`).
 */

const kindSchema = z.strictObject({
    count: z.number().int().positive(),
    file: z.string().min(1),
    burst: z.strictObject({ count: z.number().int().positive(), minFreeMb: z.number().int().positive() }).optional(),
    minFreeMb: z.number().int().positive().optional(),
    warnMinutes: z.number().positive(),
    pollSeconds: z.number().positive(),
    heavy: z.enum(["tsc", "eslint", "test", "build", "install", "uat"]).optional(),
})

const slotsSchema = z
    .strictObject({
        schema: z.literal("starci/slots@1"),
        root: z.string().min(1).nullable(),
        kinds: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), kindSchema),
        reap: z.strictObject({ graceMinutes: z.number().positive() }).optional(),
        janitor: z.strictObject({ idleHours: z.number().positive(), touchedMinutes: z.number().nonnegative().optional(), dirs: z.array(z.string().regex(/^[A-Za-z0-9._-]+$/)).min(1) }).optional(),
    })
    .superRefine((rules, issues) => {
        for (const [name, kind] of Object.entries(rules.kinds)) {
            if (kind.count + (kind.burst?.count ?? 0) > 1 && !kind.file.includes("{n}")) issues.addIssue({ code: "custom", message: `kinds.${name}.file must hold {n}: the kind has more than one slot` })
        }
    })

/** ops/slots.yaml, validated. */
export type SlotRules = z.infer<typeof slotsSchema>

/** One kind of slot. */
export type SlotKind = z.infer<typeof kindSchema>

/** The schema of ops/slots.yaml. */
export const SLOTS_SCHEMA = "starci/slots@1"

/** Loads and validates ops/slots.yaml from the ops folder (STARCI_OPS_DIR honoured). */
export const loadSlotRules = (dir: string = locateOps()): SlotRules => {
    const file = join(dir, "slots.yaml")
    let raw: unknown
    try {
        raw = parse(readFileSync(file, "utf8"))
    } catch (error: unknown) {
        throw new Refusal("OPS_INVALID", `${file} is not readable yaml: ${error instanceof Error ? error.message : String(error)}`)
    }
    const parsed = slotsSchema.safeParse(raw)
    if (!parsed.success) throw new Refusal("OPS_INVALID", `${file} is invalid: ${z.prettifyError(parsed.error)}`)
    return parsed.data
}

/** The configured root alone: STARCI_LANES_DIR, else `root` of ops/slots.yaml; undefined when neither names one. */
export const configuredSlotRoot = (rules?: SlotRules): string | undefined => {
    const env = process.env.STARCI_LANES_DIR
    if (env !== undefined && env !== "") return resolve(env)
    const root = (rules ?? loadSlotRules()).root
    return root === null ? undefined : resolve(root)
}

/** The slot root: the flag, else STARCI_LANES_DIR, else `root` of ops/slots.yaml, else `<shared harness state>/slots`. */
export const slotRoot = (flag: string | undefined, rules?: SlotRules): string =>
    flag !== undefined && flag !== "" ? resolve(flag) : (configuredSlotRoot(rules) ?? join(sharedStateBase(), "slots"))

/** A kind of ops/slots.yaml, refused with the known kinds when it is not one. */
export const slotKind = (rules: SlotRules, name: string): SlotKind => {
    const kind = rules.kinds[name]
    if (kind === undefined) throw new Refusal("SLOT_KIND_UNKNOWN", `no slot kind "${name}" (ops/slots.yaml kinds: ${Object.keys(rules.kinds).join(", ")})`)
    return kind
}

/** The file of slot `n` of a kind. */
export const slotFile = (root: string, kind: SlotKind, n: number): string => join(root, kind.file.replaceAll("{n}", String(n)))

/** A holder name the files can carry: no blank, since the first word of the line is the holder. */
export const checkHolder = (holder: string): string => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(holder)) throw new Refusal("SLOT_HOLDER_INVALID", `"${holder}" is not a holder name (letters, digits, dot, dash, underscore)`)
    return holder
}

/**
 * Takes a lock file whole and alone: the content goes to a temporary file that is hard-linked into place, and a link fails when the
 * lock exists, so only one taker wins and nobody reads an empty lock.
 */
export const takeLockFile = (file: string, content: string): boolean => {
    mkdirSync(join(file, ".."), { recursive: true })
    const temporary = `${file}.${String(process.pid)}.${String(Date.now())}.tmp`
    writeFileSync(temporary, content)
    try {
        linkSync(temporary, file)
        return true
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "EEXIST") return false
        throw error
    } finally {
        unlinkSync(temporary)
    }
}

/** How far two readings of one boot time, or of one process start, may differ and still be the same (clock steps, rounding). */
const BOOT_TOLERANCE_MS = 300_000
const START_TOLERANCE_MS = 2000

/**
 * The host's boot time, epoch ms rounded to the second: now less the uptime. It names the boot session, whose processes are all gone
 * once the host boots again. A suspend that pauses the uptime clock moves the reading, so a boot difference never outweighs a pid
 * proven alive with its recorded start (`judgeHolder`).
 */
export const bootMs = (): number => Math.round((Date.now() - uptime() * 1000) / 1000) * 1000

/** When process `pid` started, epoch ms, read from the OS; null when it is not running or the host does not say. */
export const processStartMs = (pid: number): number | null => {
    if (process.platform === "win32") {
        const shell = join(process.env.SystemRoot ?? String.raw`C:\Windows`, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
        const script = `$p = Get-Process -Id ${String(pid)} -ErrorAction SilentlyContinue; if ($p -and $p.StartTime) { [Console]::Out.Write([long]($p.StartTime.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds) }`
        const run = captureToolSync(shell, ["-NoProfile", "-NonInteractive", "-Command", script], process.cwd(), 15_000)
        const ms = Number(run.stdout)
        return run.exitCode === 0 && run.stdout !== "" && Number.isFinite(ms) ? ms : null
    }
    const run = captureToolSync("ps", ["-o", "lstart=", "-p", String(pid)], process.cwd(), 15_000)
    const ms = Date.parse(run.stdout)
    return run.exitCode === 0 && Number.isFinite(ms) ? ms : null
}

/**
 * The line a holder writes: `<holder> <taken> pid=<pid> start=<iso> boot=<iso> host=<host>`. Refused without a live pid whose start the OS
 * reports: a line without them cannot be judged later, and a lock nobody can judge is held until the host reboots.
 */
export const slotLine = (holder: string, pid: number | undefined, startOf: (pid: number) => number | null = processStartMs): string => {
    if (pid === undefined) throw new Refusal("SLOT_PID_REQUIRED", `a slot lock records its holder's pid, start and the host boot; none was given for ${holder} (pass --pid, or use slot run, which records its own)`)
    const start = startOf(pid) ?? startOf(pid)
    if (start === null) throw new Refusal("SLOT_START_UNKNOWN", `pid ${String(pid)} is not running or the host does not report its start time: a slot lock must record it (a pid reused later is told apart by it)`)
    return `${holder} ${new Date().toISOString()} pid=${String(pid)} start=${new Date(start).toISOString()} boot=${new Date(bootMs()).toISOString()} host=${hostname()}`
}

/** What a slot file says about its holder. */
export interface SlotHolder {
    readonly holder: string
    readonly at: string
    readonly pid: number | null
    /** When the holder's process started, epoch ms, as recorded at the take. */
    readonly startMs: number | null
    /** The host's boot time when the slot was taken, epoch ms. */
    readonly bootMs: number | null
    readonly host: string | null
    readonly content: string
}

/** Reads a slot line, whichever writer wrote it (`<lane> <iso>`, `... pid=N`, `... pid N ...`); undefined when the file is gone. */
export const readHolder = (file: string): SlotHolder | undefined => {
    let content: string
    let mtime: Date
    try {
        content = readFileSync(file, "utf8")
        mtime = statSync(file).mtime
    } catch {
        return undefined
    }
    const words = content.trim().split(/\s+/)
    const holder = words[0] ?? ""
    const iso = words.find((word) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(word) && !Number.isNaN(Date.parse(word)))
    const pid = Number(/\bpid[= ](\d+)/.exec(content)?.[1] ?? "0")
    const host = /\bhost=(\S+)/.exec(content)?.[1] ?? null
    const stamp = (name: "start" | "boot"): number | null => {
        const ms = Date.parse((name === "start" ? /\bstart=(\S+)/ : /\bboot=(\S+)/).exec(content)?.[1] ?? "")
        return Number.isFinite(ms) ? ms : null
    }
    return { holder, at: iso ?? mtime.toISOString(), pid: pid > 0 ? pid : null, startMs: stamp("start"), bootMs: stamp("boot"), host, content }
}

/**
 * How a slot stands. `held`: its holder may be alive. `old`: held, and older than the kind's warnMinutes (a warning, never a reclaim).
 * Reclaimable, each on evidence: `dead` (its pid is not alive), `reused` (its pid runs a process started at another time),
 * `rebooted` (the host booted after it was taken, so every process of that session is gone), `gone` (a lock with no pid whose lane has no
 * worktree, or one with no live process in it, and no process names the holder).
 */
export type SlotState = "free" | "held" | "old" | "dead" | "reused" | "rebooted" | "gone"

/** The states a take, or `slot release --stale`, reclaims. */
export const RECLAIMABLE: ReadonlySet<SlotState> = new Set<SlotState>(["dead", "reused", "rebooted", "gone"])

/** What the judgement reads from the host. */
export interface HostProbe {
    readonly nowMs: number
    readonly bootMs: number
    readonly hostname: string
    readonly alive: (pid: number) => boolean
    readonly startMs: (pid: number) => number | null
    /** Whether a lane (a holder name) is proven gone; absent where nothing was read about lanes (the judgement then never says `gone`). */
    readonly laneGone?: (holder: string) => LaneProof
}

/** What is known of a lane: gone (with the evidence), or not proven gone (with what keeps it). */
export interface LaneProof {
    readonly gone: boolean
    readonly evidence: string
}

/** What a lane proof reads: the registered worktrees under the slot root (undefined: no repository there) and the process table (or why it could not be read). */
export interface LaneFacts {
    readonly worktrees: readonly KnownWorktree[] | undefined
    readonly processes: readonly HostProcess[] | string
    /** The lanes whose status file says `landed` or `rejected`: stands in for worktrees where the slot root holds no repository. */
    readonly finished: (lane: string) => boolean
    /** This process, never counted as working in a worktree. */
    readonly self: number
}

/** A registered worktree of a repository found under the slot root. */
interface KnownWorktree {
    readonly path: string
    readonly branch: string | undefined
}

/**
 * The worktrees of every repository that has a checkout directly under `root` (`git worktree list --porcelain` once per repository),
 * without entering a link; undefined when no repository is found there, so nothing can be said about a lane.
 */
export const worktreesUnder = (root: string): { readonly repos: number; readonly worktrees: readonly KnownWorktree[] } | undefined => {
    let folders: string[]
    try {
        folders = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => join(root, entry.name))
    } catch {
        return undefined
    }
    const caseless = (path: string): string => (process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path))
    const seen = new Set<string>()
    const worktrees: KnownWorktree[] = []
    let repos = 0
    for (const folder of folders) {
        if (seen.has(caseless(folder)) || !existsSync(join(folder, ".git"))) continue
        const run = captureToolSync("git", ["worktree", "list", "--porcelain"], folder, 15_000)
        if (run.exitCode !== 0) continue
        repos += 1
        for (const block of run.stdout.split(/\r?\n\r?\n/)) {
            const lines = block.split(/\r?\n/)
            const path = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length)
            if (path === undefined || path === "") continue
            const branch = lines.find((line) => line.startsWith("branch "))?.slice("branch ".length).replace(/^refs\/heads\//, "")
            seen.add(caseless(path))
            worktrees.push({ path: resolve(path), branch })
        }
    }
    return repos === 0 ? undefined : { repos, worktrees }
}

/** The live host, without any reading about lanes (a lock with no pid is then never `gone`). */
export const liveProbe = (): HostProbe => ({ nowMs: Date.now(), bootMs: bootMs(), hostname: hostname(), alive: pidAlive, startMs: processStartMs })

const slashedLower = (path: string): string => path.replaceAll("\\", "/").toLowerCase()
const escapeRegex = (text: string): string => text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)

/**
 * Whether a lane is proven gone, for a lock that records no pid. Not proven while the process table cannot be read, while a process
 * (not this one) works inside the lane's worktree (its working folder or command line lies in it) or names the holder in its command line.
 * Gone when the lane has no worktree on disk (no registered worktree of the repositories under the slot root whose folder is named
 * `<lane>` or has `lane/<lane>` checked out; where the slot root holds no repository its `_land-status/<lane>.json` says landed) or the
 * worktree has no live process in it. Never age. Pure over `facts`.
 */
export const proveLaneGone = (root: string, lane: string, facts: LaneFacts): LaneProof => {
    if (typeof facts.processes === "string") return { gone: false, evidence: `the process table could not be read (${facts.processes})` }
    if (facts.worktrees === undefined && !facts.finished(lane)) {
        return { gone: false, evidence: `no repository under ${root} to say whether lane ${lane} still has a worktree, and no landed status for it` }
    }
    const name = lane.toLowerCase()
    const tree = facts.worktrees?.find((entry) => existsSync(entry.path) && (basename(entry.path).toLowerCase() === name || entry.branch === `lane/${lane}`))
    const key = tree === undefined ? undefined : slashedLower(tree.path)
    const named = new RegExp(`(^|[^a-z0-9._-])${escapeRegex(name)}($|[^a-z0-9._-])`)
    for (const item of facts.processes) {
        if (item.pid === facts.self) continue
        const line = slashedLower(item.commandLine)
        const cwd = item.cwd === null ? "" : slashedLower(item.cwd)
        if (key !== undefined && (cwd === key || cwd.startsWith(`${key}/`) || line.includes(`${key}/`) || line.endsWith(key))) {
            return { gone: false, evidence: `pid ${String(item.pid)} ${item.name} works in the worktree ${String(tree?.path)}` }
        }
        if (named.test(line)) return { gone: false, evidence: `pid ${String(item.pid)} ${item.name} names ${lane} in its command line` }
    }
    return {
        gone: true,
        evidence: tree === undefined ? `lane ${lane} has no worktree and no live process names it` : `lane ${lane} has the worktree ${tree.path} but no live process works in it or names the lane`,
    }
}

/** Whether `_land-status/<lane>.json` says the lane landed. */
const landedLane = (root: string, lane: string): boolean => {
    try {
        const status: unknown = JSON.parse(readFileSync(join(root, "_land-status", `${lane}.json`), "utf8"))
        return typeof status === "object" && status !== null && "state" in status && status.state === "landed"
    } catch {
        return false
    }
}

/** The live host plus what it takes to prove a lane gone: the worktrees under `root` and the process table (with working folders), read once. */
export const laneProbe = async (root: string): Promise<HostProbe> => {
    const processes = await listProcesses(true)
    const worktrees = worktreesUnder(root)?.worktrees
    const facts: LaneFacts = { worktrees, processes, finished: (lane) => landedLane(root, lane), self: process.pid }
    return { ...liveProbe(), laneGone: (holder) => proveLaneGone(root, holder, facts) }
}

const isoOf = (ms: number): string => new Date(ms).toISOString()

/**
 * Judges a holder on evidence alone. A slot of another host is held. A recorded pid that is not alive is `dead`; one alive whose start
 * differs from the recorded start is `reused`; one alive with the recorded start is held whatever the boot reading says. Without that
 * proof (no pid, or no recorded start), a slot taken before this boot, or recording another boot, is `rebooted`. Otherwise it is held, `old` past warnMinutes.
 */
export const judgeHolder = (kind: SlotKind, holder: SlotHolder, probe: HostProbe = liveProbe()): { readonly state: SlotState; readonly evidence: string } => {
    const takenMs = Date.parse(holder.at)
    const ageMinutes = Math.round((probe.nowMs - takenMs) / 60_000)
    const aged = (why: string): { readonly state: SlotState; readonly evidence: string } =>
        ageMinutes > kind.warnMinutes ? { state: "old", evidence: `${why}; ${String(ageMinutes)} min old (a warning: age never reclaims)` } : { state: "held", evidence: why }
    if (holder.host !== null && holder.host !== probe.hostname) return { state: "held", evidence: `held on host ${holder.host}` }
    if (holder.pid !== null) {
        if (!probe.alive(holder.pid)) return { state: "dead", evidence: `pid ${String(holder.pid)} is not alive` }
        if (holder.startMs !== null) {
            const started = probe.startMs(holder.pid)
            if (started !== null && Math.abs(started - holder.startMs) > START_TOLERANCE_MS) {
                return { state: "reused", evidence: `pid ${String(holder.pid)} now runs a process started ${isoOf(started)}, not the holder started ${isoOf(holder.startMs)}` }
            }
            if (started !== null) return aged(`pid ${String(holder.pid)} alive since ${isoOf(started)}`)
        }
    }
    const takenBeforeBoot = takenMs < probe.bootMs - BOOT_TOLERANCE_MS
    const otherBoot = holder.bootMs !== null && Math.abs(holder.bootMs - probe.bootMs) > BOOT_TOLERANCE_MS
    if (takenBeforeBoot || otherBoot) {
        return { state: "rebooted", evidence: `taken ${holder.at}${holder.bootMs === null ? "" : ` in the boot of ${isoOf(holder.bootMs)}`}; this host booted ${isoOf(probe.bootMs)}` }
    }
    if (holder.pid !== null) return aged(`pid ${String(holder.pid)} alive, its start unknown`)
    return judgePidless(holder, probe, aged)
}

/**
 * A lock with no pid (a legacy line `<lane> <iso>` that a script of an app wrote itself). A pid the holder's name ends in (`<name>-<pid>`) that
 * runs a process started before the lock was taken keeps it held; that name proves nothing when its pid is dead (a lane may be named `h-x-390`).
 * Otherwise it is `gone` once the lane is proven gone (`proveLaneGone`) and held, with what keeps it, when not.
 */
const judgePidless = (
    holder: SlotHolder,
    probe: HostProbe,
    aged: (why: string) => { readonly state: SlotState; readonly evidence: string },
): { readonly state: SlotState; readonly evidence: string } => {
    const suffix = /-(\d+)$/.exec(holder.holder)?.[1]
    const named = suffix === undefined ? undefined : Number(suffix)
    if (named !== undefined && probe.alive(named)) {
        const started = probe.startMs(named)
        if (started === null || started <= Date.parse(holder.at) + START_TOLERANCE_MS) return aged(`no pid recorded; the holder name ends in pid ${String(named)}, which is alive`)
    }
    if (probe.laneGone === undefined) return aged("no pid recorded and nothing was read about its lane")
    const proof = probe.laneGone(holder.holder)
    return proof.gone ? { state: "gone", evidence: `no pid recorded; ${proof.evidence}` } : aged(`no pid recorded; ${proof.evidence}`)
}

/** Whether the holder is alive, as far as the judgement knows. */
const aliveOf = (holder: SlotHolder, state: SlotState, probe: HostProbe): "yes" | "no" | "unknown" => {
    if (holder.host !== null && holder.host !== probe.hostname) return "unknown"
    if (state === "dead" || state === "reused" || state === "rebooted" || state === "gone") return "no"
    return holder.pid === null ? "unknown" : "yes"
}


/**
 * Reclaims a foreign lock file judged reclaimable from `judged` (its content when judged): the file is renamed aside, atomically, so one reclaimer
 * wins; when the renamed content is not what was judged (it was released and taken again in between) it is linked back. True when the slot was
 * freed; the reclaim is logged in slot_events with its evidence.
 */
export const reclaimSlot = (file: string, judged: SlotHolder, by: string, evidence: string): boolean => {
    if (!releaseIfSame(file, judged)) return false
    recordEvent({ action: "reclaimed", slot: file, holder: judged.holder, pid: judged.pid, by, evidence })
    return true
}

/** The slot numbers of a kind open now: its count, and its burst while the host has the burst's free memory. */
const openNumbers = (kind: SlotKind, freeMb: () => number): number[] => {
    const base = Array.from({ length: kind.count }, (_, index) => index + 1)
    if (kind.burst === undefined || freeMb() < kind.burst.minFreeMb) return base
    return [...base, ...Array.from({ length: kind.burst.count }, (_, index) => kind.count + index + 1)]
}

/** Every slot number a kind has, burst included. */
const allNumbers = (kind: SlotKind): number[] => Array.from({ length: kind.count + (kind.burst?.count ?? 0) }, (_, index) => index + 1)

/** Removes a lock file whose content is still `read`'s; false when it changed under the release. */
const releaseIfSame = (file: string, read: SlotHolder): boolean => {
    const aside = `${file}.release.${String(process.pid)}.${String(Date.now())}`
    try {
        renameSync(file, aside)
    } catch {
        return false
    }
    const content = existsSync(aside) ? readFileSync(aside, "utf8") : ""
    if (content !== read.content) {
        try {
            linkSync(aside, file)
        } catch {
            // a new holder took the lock meanwhile; the aside copy is the old holder's and goes
        }
        unlinkSync(aside)
        return false
    }
    unlinkSync(aside)
    return true
}

/**
 * Takes a pid lock (the dev push's `_dev-push*.lock`): a lock whose pid does not run on this machine
 * is stale, so it is taken over and `say` gets one line naming the dead pid; a live pid, a lock with no pid or one written on another
 * host keeps it held (false). A lock that changed between the read and the takeover is left to its new holder.
 */
export const takeLiveLock = (file: string, content: string, say: (line: string) => void, alive: (pid: number) => boolean = pidAlive): boolean => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        if (takeLockFile(file, content)) return true
        const held = readHolder(file)
        if (held === undefined) continue
        if (held.pid === null || (held.host !== null && held.host !== hostname()) || alive(held.pid)) return false
        if (releaseIfSame(file, held)) say(`${file}: its holder pid ${String(held.pid)} is not alive on this machine; taking the stale lock over`)
    }
    return takeLockFile(file, content)
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The slots themselves: rows of lane_slots in the host store (harness/slot-store.ts), plus the foreign lock files older copies and scripts wrote.
// ---------------------------------------------------------------------------------------------------------------------------------------------

/**
 * The folders a foreign lock file of a slot may lie in (a CLI copy before the store wrote `<root>/<kind.file>`, a script of an app wrote one by hand):
 * the lanes folder named, the configured one, `<shared harness state>/slots`, and every lanes folder any CLI copy of the host was named before
 * (`rememberLockFolders`), so a take from any folder honours the same foreign files. Foreign files are never written; each one not proven gone keeps its
 * number busy for every taker, and one proven gone is reclaimed with its evidence.
 */
export const foreignRoots = (root: string, rules: SlotRules): string[] => {
    const seen = new Set<string>()
    const roots: string[] = []
    const given = [root, configuredSlotRoot(rules)].filter((path): path is string => path !== undefined).map((path) => resolve(path))
    for (const candidate of [...given, join(sharedStateBase(), "slots"), ...rememberLockFolders(given)]) {
        const at = resolve(candidate)
        const key = process.platform === "win32" ? at.toLowerCase() : at
        if (seen.has(key)) continue
        seen.add(key)
        roots.push(at)
    }
    return roots
}

/** A foreign lock file of a slot. */
interface Foreign {
    readonly kind: string
    readonly n: number
    readonly root: string
    readonly file: string
    readonly read: SlotHolder
}

const foreignLocks = (root: string, rules: SlotRules, names: readonly string[]): Foreign[] =>
    foreignRoots(root, rules).flatMap((at) =>
        names.flatMap((name) => {
            const kind = slotKind(rules, name)
            return allNumbers(kind).flatMap((n) => {
                const file = slotFile(at, kind, n)
                const read = readHolder(file)
                return read === undefined ? [] : [{ kind: name, n, root: at, file, read }]
            })
        }),
    )

/** The holder a row stands for, so the one judgement (`judgeHolder`) reads rows and files alike. */
const holderOfRow = (row: SlotRow): SlotHolder => {
    const stamp = (iso: string): number | null => {
        const ms = Date.parse(iso)
        return Number.isFinite(ms) ? ms : null
    }
    return { holder: row.lane, at: row.takenAt, pid: row.pid, startMs: stamp(row.pidStart), bootMs: stamp(row.boot), host: row.host, content: describeRow(row) }
}

/** A row as one line: its lane, time, pid and start, child and command. */
export const describeRow = (row: SlotRow): string =>
    `${row.lane} ${row.takenAt} pid=${String(row.pid)} start=${row.pidStart}${row.childPid === null ? "" : ` child=${String(row.childPid)}`} command=${JSON.stringify(row.command)}`

/** Where a row lives, as a message names it. */
const whereOfRow = (kind: string, n: number): string => `machine.sqlite lane_slots ${kind} ${String(n)}`

/**
 * The live host with every process start read once from the process table (one query, not one per pid); the plain probe when the table cannot be
 * read. What a take that found every number held, a list, a reclaim and a kill judge on.
 */
export const tableProbe = async (): Promise<HostProbe> => {
    const table = await listProcesses(false)
    if (typeof table === "string") return liveProbe()
    const starts = new Map(table.map((item) => [item.pid, item.startedMs]))
    return { ...liveProbe(), startMs: (pid) => starts.get(pid) ?? null }
}

/** The probe a list, a reclaim or a kill of these kinds needs: process starts from the table, and lane proof when a foreign lock records no pid. */
export const slotProbe = async (root: string, rules: SlotRules, names: readonly string[] = []): Promise<HostProbe> => {
    const kinds = names.length === 0 ? Object.keys(rules.kinds) : names
    const pidless = foreignLocks(root, rules, kinds).find((lock) => lock.read.pid === null)
    const base = await tableProbe()
    if (pidless === undefined) return base
    const lanes = await laneProbe(pidless.root)
    return lanes.laneGone === undefined ? base : { ...base, laneGone: lanes.laneGone }
}

/** One slot as `slot list` shows it: a row of the store, a foreign lock file, or free. */
export interface SlotView {
    readonly kind: string
    readonly n: number
    /** Where it is held: the store row (`machine.sqlite lane_slots <kind> <n>`) or the foreign lock file's path; empty when free. */
    readonly where: string
    readonly source: "store" | "foreign" | "free"
    readonly state: SlotState
    readonly burst: boolean
    readonly holder?: string
    readonly at?: string
    readonly ageMinutes?: number
    readonly pid?: number | null
    /** The child doing the work, once spawned (a store row only). */
    readonly childPid?: number | null
    /** The command it runs (a store row only). */
    readonly command?: string
    /** Why the state is what it is: the evidence a reclaim logs. */
    readonly evidence?: string
    /** Whether the holder process is alive: unknown when the lock records no pid or sits on another host. */
    readonly alive?: "yes" | "no" | "unknown"
    /** A take or `slot release --stale` would reclaim it now. */
    readonly reclaimable?: boolean
    /** For a held or old slot: what would make it reclaimable, so nobody has to guess or delete it by hand. */
    readonly why?: string
}

const viewOf = (name: string, kind: SlotKind, n: number, read: SlotHolder, probe: HostProbe, at: { readonly where: string; readonly source: "store" | "foreign"; readonly row?: SlotRow }): SlotView => {
    const judged = judgeHolder(kind, read, probe)
    const reclaimable = RECLAIMABLE.has(judged.state)
    return {
        kind: name,
        n,
        where: at.where,
        source: at.source,
        state: judged.state,
        burst: n > kind.count,
        holder: read.holder,
        at: read.at,
        ageMinutes: Math.round((probe.nowMs - Date.parse(read.at)) / 60_000),
        pid: read.pid,
        ...(at.row === undefined ? {} : { childPid: at.row.childPid, command: at.row.command }),
        evidence: judged.evidence,
        alive: aliveOf(read, judged.state, probe),
        reclaimable,
        ...(reclaimable ? {} : { why: judged.evidence }),
    }
}

/**
 * Every slot of the given kinds (all kinds when none), free ones included: each number's store row, else a foreign lock file of it (`foreignRoots`),
 * else free. A foreign file on a number a row holds is listed after it. `probe` judges them (`slotProbe` for process starts and lane proof).
 */
export const listSlots = (root: string, rules: SlotRules, names: readonly string[] = [], probe: HostProbe = liveProbe()): SlotView[] => {
    const kinds = names.length === 0 ? Object.keys(rules.kinds) : names
    for (const name of kinds) slotKind(rules, name)
    const rows = withSlotStore((db) => slotRows(db, kinds))
    const foreign = foreignLocks(root, rules, kinds)
    return kinds.flatMap((name) => {
        const kind = slotKind(rules, name)
        return allNumbers(kind).flatMap((n): SlotView[] => {
            const row = rows.find((each) => each.kind === name && each.n === n)
            const files = foreign.filter((lock) => lock.kind === name && lock.n === n)
            const fileViews = files.map((lock) => viewOf(name, kind, n, lock.read, probe, { where: lock.file, source: "foreign" }))
            if (row !== undefined) return [viewOf(name, kind, n, holderOfRow(row), probe, { where: whereOfRow(name, n), source: "store", row }), ...fileViews]
            return fileViews.length > 0 ? fileViews : [{ kind: name, n, where: "", source: "free", state: "free", burst: n > kind.count }]
        })
    })
}

/** What a take did. */
export interface Taken {
    readonly kind: string
    readonly n: number
    /** The store row it holds (`machine.sqlite lane_slots <kind> <n>`). */
    readonly where: string
    readonly holder: string
    readonly pid: number
    /** The holder already held this slot (the same process, or one it runs under): a take is idempotent for its holder. */
    readonly already: boolean
    /** The holders proven gone it reclaimed on the way, with the evidence. */
    readonly reclaimed: readonly string[]
    readonly waitedSeconds: number
}

/** How a take waits and whom it records. */
export interface TakeOptions {
    /** The ONE process the slot lives as long as (required: a take without it is refused SLOT_PID_REQUIRED). */
    readonly pid?: number
    /** The command the slot is taken for, as `slot list` shows it (default: the holder process's own). */
    readonly command?: string
    /** Seconds to wait for a free slot; undefined waits until one frees. */
    readonly waitSeconds?: number | undefined
    /** Return the slot the holder already holds instead of taking a second one (the default; false takes a further one). */
    readonly reuse?: boolean
    readonly say?: (line: string) => void
    readonly freeMb?: () => number
    /** How a pid's start is read (a seam for the specs); this process's own start is known without asking. */
    readonly startOf?: (pid: number) => number | null
}

/** The OS start of `pid`, which the row records so a pid reused later is told apart; refused when the OS does not say. */
const startOfHolder = (pid: number, startOf: (pid: number) => number | null = processStartMs): number => {
    if (pid === process.pid) return selfStartMs()
    const start = startOf(pid) ?? startOf(pid)
    if (start === null) throw new Refusal("SLOT_START_UNKNOWN", `pid ${String(pid)} is not running or the host does not report its start time: a slot records it (a pid reused later is told apart by it)`)
    return start
}

/** Whether `pid` is this process or one of its ancestors (read from the process table): the slot it holds covers this process's work. */
const runsUnder = async (pid: number): Promise<boolean> => {
    if (pid === process.pid) return true
    const table = await listProcesses(false)
    if (typeof table === "string") return false
    const parents = new Map(table.map((item) => [item.pid, item.ppid]))
    let at: number | undefined = process.pid
    for (let depth = 0; depth < 32 && at !== undefined && at > 0; depth += 1) {
        at = parents.get(at)
        if (at === pid) return true
    }
    return false
}

/** Deletes a row judged reclaimable, exactly as judged, and logs the evidence; true when it went. */
const reclaimRow = (row: SlotRow, by: string, evidence: string): boolean =>
    withSlotStore((db) => {
        if (!deleteRow(db, row)) return false
        logEvent(db, { action: "reclaimed", slot: `${row.kind} ${String(row.n)}`, holder: row.lane, pid: row.pid, childPid: row.childPid, command: row.command, by, evidence })
        return true
    })

/** The numbers of a kind the foreign files hold (not proven gone); each one proven gone is reclaimed on the way. */
const foreignBusy = async (root: string, rules: SlotRules, name: string, by: string, reclaimed: string[], say?: (line: string) => void): Promise<Set<number>> => {
    const kind = slotKind(rules, name)
    const busy = new Set<number>()
    const locks = foreignLocks(root, rules, [name])
    if (locks.length === 0) return busy
    const probe = await slotProbe(root, rules, [name])
    for (const lock of locks) {
        const judged = judgeHolder(kind, lock.read, probe)
        if (RECLAIMABLE.has(judged.state) && reclaimSlot(lock.file, lock.read, by, `${judged.state}: ${judged.evidence}`)) {
            reclaimed.push(`${lock.file}: ${lock.read.content.trim()} (${judged.state}: ${judged.evidence})`)
            say?.(`reclaimed the foreign ${name} lock ${lock.file} of ${lock.read.holder}: ${judged.state}, ${judged.evidence}`)
            continue
        }
        if (!RECLAIMABLE.has(judged.state)) busy.add(lock.n)
    }
    return busy
}

/**
 * One pass over the open numbers: inserts a row on the first number no row and no foreign file holds. A row whose pid is not alive is reclaimed in the
 * same transaction; when every number is held, the rows are judged in full (a reused pid, a boot since) and the pass tried once more.
 */
const takeOnce = async (root: string, rules: SlotRules, name: string, base: Omit<SlotRow, "n" | "takenAt">, options: TakeOptions, reclaimed: string[], by: string): Promise<SlotRow | undefined> => {
    const kind = slotKind(rules, name)
    const open = openNumbers(kind, options.freeMb ?? hostFreeMb)
    const foreign = await foreignBusy(root, rules, name, by, reclaimed, options.say)
    const insert = (): SlotRow | undefined =>
        withSlotStore((db) => {
            for (const row of slotRows(db, [name])) {
                if (row.host !== hostname() || pidAlive(row.pid) || !deleteRow(db, row)) continue
                const evidence = `dead: pid ${String(row.pid)} is not alive`
                logEvent(db, { action: "reclaimed", slot: `${name} ${String(row.n)}`, holder: row.lane, pid: row.pid, childPid: row.childPid, command: row.command, by, evidence })
                reclaimed.push(`${String(row.n)}: ${describeRow(row)} (${evidence})`)
                options.say?.(`reclaimed ${name} slot ${String(row.n)} from ${row.lane}: ${evidence}`)
            }
            const held = new Set(slotRows(db, [name]).map((row) => row.n))
            const n = open.find((number) => !held.has(number) && !foreign.has(number))
            if (n === undefined) return undefined
            const row: SlotRow = { ...base, n, takenAt: new Date().toISOString() }
            if (!insertRow(db, row)) return undefined
            logEvent(db, { action: "taken", slot: `${name} ${String(n)}`, holder: row.lane, pid: row.pid, command: row.command, by, evidence: `pid ${String(row.pid)} started ${row.pidStart}` })
            return row
        })
    const first = insert()
    if (first !== undefined) return first
    const probe = await tableProbe()
    let freed = false
    for (const row of withSlotStore((db) => slotRows(db, [name])).filter((each) => open.includes(each.n))) {
        const judged = judgeHolder(kind, holderOfRow(row), probe)
        if (!RECLAIMABLE.has(judged.state) || !reclaimRow(row, by, `${judged.state}: ${judged.evidence}`)) continue
        freed = true
        reclaimed.push(`${String(row.n)}: ${describeRow(row)} (${judged.state}: ${judged.evidence})`)
        options.say?.(`reclaimed ${name} slot ${String(row.n)} from ${row.lane}: ${judged.state}, ${judged.evidence}`)
    }
    return freed ? insert() : undefined
}

/**
 * Takes a slot of `name` for `holder`, as a row of the host store naming the ONE process it lives as long as (`options.pid`, required, with its OS
 * start), waiting every `pollSeconds` for one to free and for the kind's `minFreeMb`; a holder proven gone is reclaimed on the way. One slot per lane
 * and kind: the lane's own slot is returned when its process is this one or one this process runs under; held by another live process of the lane, the
 * take waits for it. Refused SLOT_BUSY once `waitSeconds` pass.
 */
export const takeSlot = async (root: string, rules: SlotRules, name: string, holder: string, options: TakeOptions = {}): Promise<Taken> => {
    const kind = slotKind(rules, name)
    checkHolder(holder)
    const { pid } = options
    if (pid === undefined) throw new Refusal("SLOT_PID_REQUIRED", `a slot records the ONE process it lives as long as, with its start; none was given for ${holder} (pass --pid, or use slot run, which records its own)`)
    const pidStart = new Date(startOfHolder(pid, options.startOf)).toISOString()
    const base: Omit<SlotRow, "n" | "takenAt"> = {
        kind: name,
        lane: holder,
        pid,
        pidStart,
        childPid: null,
        childStart: null,
        command: options.command ?? (pid === process.pid ? process.argv.slice(1).join(" ").slice(0, 300) : `pid ${String(pid)}`),
        cwd: process.cwd(),
        boot: new Date(bootMs()).toISOString(),
        host: hostname(),
    }
    const by = `${holder} (pid ${String(process.pid)})`
    const started = Date.now()
    const waited = (): number => Math.round((Date.now() - started) / 1000)
    const reclaimed: string[] = []
    let told = ""
    for (;;) {
        let why: string | undefined
        const own = options.reuse === false ? undefined : withSlotStore((db) => slotRows(db, [name]).find((row) => row.lane === holder))
        if (own !== undefined) {
            const judged = judgeHolder(kind, holderOfRow(own), own.pid === pid ? liveProbe() : await tableProbe())
            if (RECLAIMABLE.has(judged.state)) {
                if (reclaimRow(own, by, `${judged.state}: ${judged.evidence}`)) reclaimed.push(`${String(own.n)}: ${describeRow(own)} (${judged.state}: ${judged.evidence})`)
            } else if (await runsUnder(own.pid)) return { kind: name, n: own.n, where: whereOfRow(name, own.n), holder, pid: own.pid, already: true, reclaimed, waitedSeconds: waited() }
            else why = `lane ${holder} holds ${name} slot ${String(own.n)} under pid ${String(own.pid)} (${own.command}); one slot per lane and kind`
        }
        const freeMb = (options.freeMb ?? hostFreeMb)()
        const roomy = kind.minFreeMb === undefined || freeMb >= kind.minFreeMb
        if (why === undefined && !roomy) why = `the host has ${String(freeMb)} MB free, under the ${String(kind.minFreeMb)} MB a ${name} slot needs`
        if (why === undefined) {
            const got = await takeOnce(root, rules, name, base, options, reclaimed, by)
            if (got !== undefined) return { kind: name, n: got.n, where: whereOfRow(name, got.n), holder, pid, already: false, reclaimed, waitedSeconds: waited() }
            why = `every ${name} slot is held`
        }
        if (options.waitSeconds !== undefined && waited() >= options.waitSeconds) throw new Refusal("SLOT_BUSY", `${why} after ${String(waited())} s: starci slot list ${name}`)
        if (told !== why) options.say?.(`waiting for a ${name} slot: ${why}`)
        told = why
        await sleep(kind.pollSeconds * 1000)
    }
}

/** Records the child that does a slot's work, once spawned: `slot list` shows it and `slot kill` reaches it. */
export const recordSlotChild = (name: string, n: number, pid: number, child: number): void => {
    withSlotStore((db) => db.prepare("UPDATE lane_slots SET child_pid = ?, child_start = ? WHERE kind = ? AND n = ? AND pid = ?").run(child, new Date().toISOString(), name, n, pid))
}

/** What a release did: the slots it removed and the ones it left, with why. */
export interface Released {
    readonly released: readonly string[]
    readonly kept: readonly string[]
}

/**
 * Releases the slots of a kind `holder` holds (only slot `n` when given; only the row recording `pid` when given): each row of the lane, deleted
 * exactly as read, and (unless a pid is named) each foreign lock file naming the lane. Each release is logged in slot_events.
 */
export const releaseSlots = (root: string, rules: SlotRules, name: string, holder: string, only: { readonly n?: number; readonly pid?: number } = {}, by = `${holder} (pid ${String(process.pid)})`): Released => {
    slotKind(rules, name)
    const released: string[] = []
    const kept: string[] = []
    withSlotStore((db) => {
        for (const row of slotRows(db, [name])) {
            if (only.n !== undefined && row.n !== only.n) continue
            if (row.lane !== holder || (only.pid !== undefined && row.pid !== only.pid)) {
                if (only.n !== undefined) kept.push(`${whereOfRow(name, row.n)}: held by ${describeRow(row)}, not ${holder}`)
                continue
            }
            if (!deleteRow(db, row)) continue
            logEvent(db, { action: "released", slot: `${name} ${String(row.n)}`, holder, pid: row.pid, childPid: row.childPid, command: row.command, by, evidence: "its holder let it go" })
            released.push(whereOfRow(name, row.n))
        }
    })
    if (only.pid !== undefined) return { released, kept }
    for (const lock of foreignLocks(root, rules, [name])) {
        if (lock.read.holder !== holder || (only.n !== undefined && lock.n !== only.n)) continue
        if (!releaseIfSame(lock.file, lock.read)) {
            kept.push(`${lock.file}: changed while released`)
            continue
        }
        recordEvent({ action: "released", slot: lock.file, holder, pid: lock.read.pid, by, evidence: "the foreign lock of the lane, released by the lane" })
        released.push(lock.file)
    }
    return { released, kept }
}

/** Frees one slot view (its row exactly as listed, or its foreign file exactly as read); true when it went. */
export const freeView = (root: string, rules: SlotRules, view: SlotView, by: string, evidence: string): boolean => {
    if (view.source === "store") {
        const row = withSlotStore((db) => slotRows(db, [view.kind]).find((each) => each.n === view.n && each.lane === view.holder && each.pid === view.pid))
        return row !== undefined && reclaimRow(row, by, evidence)
    }
    const lock = foreignLocks(root, rules, [view.kind]).find((each) => each.file === view.where)
    return lock !== undefined && reclaimSlot(lock.file, lock.read, by, evidence)
}

/** Reclaims every slot of the given kinds whose holder is proven gone (`RECLAIMABLE`); an `old` one is reported, never removed. */
export const reclaimStale = async (root: string, rules: SlotRules, names: readonly string[], by: string): Promise<Released> => {
    const released: string[] = []
    const kept: string[] = []
    for (const view of listSlots(root, rules, names, await slotProbe(root, rules, names))) {
        if (view.state === "old") kept.push(`${view.where}: ${String(view.holder)} is old (${String(view.evidence)}); ask its holder`)
        else if (view.state === "held" && view.pid === null) kept.push(`${view.where}: ${String(view.holder)} not reclaimable: ${String(view.why)}`)
        if (!RECLAIMABLE.has(view.state)) continue
        if (freeView(root, rules, view, by, `${view.state}: ${String(view.evidence)}`)) released.push(`${view.where} (${view.state}: ${String(view.evidence)})`)
    }
    return { released, kept }
}

/** What a `slot kill` found or did. */
export interface SlotKill {
    readonly slot: string
    readonly holder: string
    readonly pid: number
    readonly childPid: number | null
    readonly command: string
    /** The process whose tree is (or would be) killed: the slot's holder. */
    readonly target: number
    readonly evidence: string
    readonly killed: boolean
    /** The holder was already gone: the slot was only reclaimed. */
    readonly reclaimedOnly: boolean
}

/**
 * The last resort on a lane slot (`starci slot kill <kind> <n>`): kills the process tree of the ONE process the slot names and frees the slot, logged
 * in slot_events with what was killed. Refused SLOT_KILL_FREE for a free slot, SLOT_KILL_REUSED when the pid now runs another program (or the host
 * booted since), and SLOT_KILL_UNPROVEN when the holder cannot be proven to be the process that took the slot (no recorded or readable start, a lock
 * with no pid, another host). A holder already dead is not killed: its slot is reclaimed. Dry unless `execute`; `kill` and `probe` are seams.
 */
export const killSlot = (root: string, rules: SlotRules, name: string, n: number, given: { readonly execute: boolean; readonly by: string; readonly probe: HostProbe; readonly kill?: (pid: number) => boolean }): SlotKill => {
    const view = listSlots(root, rules, [name], given.probe).find((each) => each.n === n)
    if (view === undefined || view.source === "free") throw new Refusal("SLOT_KILL_FREE", `${name} slot ${String(n)} is free: nothing to kill`)
    if (view.pid === null || view.pid === undefined) throw new Refusal("SLOT_KILL_UNPROVEN", `${view.where} records no pid (${String(view.holder)}): no process can be proven to hold it; slot release --stale reclaims it once its lane is proven gone`)
    const base = { slot: view.where, holder: String(view.holder), pid: view.pid, childPid: view.childPid ?? null, command: view.command ?? "", target: view.pid, evidence: String(view.evidence) }
    if (view.state === "dead") {
        const freed = given.execute && freeView(root, rules, view, given.by, `dead: ${String(view.evidence)} (slot kill: nothing left to kill)`)
        return { ...base, killed: false, reclaimedOnly: freed }
    }
    if (view.state === "reused" || view.state === "rebooted" || view.state === "gone") {
        throw new Refusal("SLOT_KILL_REUSED", `${view.where}: ${String(view.evidence)}; pid ${String(view.pid)} is not the slot's holder any more, so nothing is killed (slot release --stale reclaims the slot)`)
    }
    if (!String(view.evidence).includes("alive since")) {
        throw new Refusal("SLOT_KILL_UNPROVEN", `${view.where}: ${String(view.evidence)}; the holder's start cannot be matched, so pid ${String(view.pid)} is not proven to be the process that took the slot`)
    }
    if (!given.execute) return { ...base, killed: false, reclaimedOnly: false }
    ;(given.kill ?? killPidTree)(view.pid)
    const by = given.by
    if (view.source === "store") {
        withSlotStore((db) => {
            const row = slotRows(db, [name]).find((each) => each.n === n && each.pid === view.pid)
            if (row !== undefined) deleteRow(db, row)
            logEvent(db, { action: "killed", slot: `${name} ${String(n)}`, holder: view.holder ?? null, pid: view.pid ?? null, childPid: view.childPid ?? null, command: view.command ?? null, by, evidence: `killed the process tree of pid ${String(view.pid)}: ${String(view.evidence)}` })
        })
    } else {
        const lock = foreignLocks(root, rules, [name]).find((each) => each.file === view.where)
        if (lock !== undefined) releaseIfSame(lock.file, lock.read)
        recordEvent({ action: "killed", slot: view.where, holder: view.holder ?? null, pid: view.pid, by, evidence: `killed the process tree of pid ${String(view.pid)}: ${String(view.evidence)}` })
    }
    return { ...base, killed: true, reclaimedOnly: false }
}

/** A slot handed to the work it is held for: its child, once spawned, is recorded on it (`spawned`), so the slot names the process doing the work. */
export interface HeldSlot extends Taken {
    readonly spawned: (child: number) => void
}

/**
 * Holds a slot while `work` runs, released the moment it ends (thrown, signalled or not); the slot records this process's pid and start, and the
 * child `work` reports through `spawned`. A slot this process (or one it runs under) already held is left to that holder.
 */
export const withSlot = async <T>(root: string, rules: SlotRules, name: string, holder: string, options: Omit<TakeOptions, "pid" | "reuse" | "startOf">, work: (taken: HeldSlot) => Promise<T>): Promise<T> => {
    const taken = await takeSlot(root, rules, name, holder, { ...options, pid: process.pid })
    // The run is recorded with its launchers, so the reaper (harness/runs.ts) stops it once its caller is gone.
    const run = await registerRun(root, `${name} slot of ${holder}`, process.cwd())
    let done = false
    const release = (): void => {
        if (done) return
        done = true
        try {
            if (!taken.already) releaseSlots(root, rules, name, holder, { n: taken.n, pid: process.pid })
        } finally {
            run.done()
        }
    }
    const onSignal = (): void => {
        release()
        process.exit(130)
    }
    // Windows delivers SIGINT (Ctrl+C), SIGBREAK (Ctrl+Break) and SIGHUP (console closed) and never SIGTERM; a process killed outright
    // (taskkill /F, a dead parent) runs nothing, and the pid recorded in the row lets the next take reclaim it at once. `exit` is the last
    // resort for process.exit and uncaught errors; release is idempotent.
    const signals: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP", ...(process.platform === "win32" ? (["SIGBREAK"] as const) : [])]
    for (const signal of signals) process.once(signal, onSignal)
    process.once("exit", release)
    const spawned = (child: number): void => {
        try {
            recordSlotChild(name, taken.n, taken.pid, child)
        } catch {
            // the child is a record for slot list and slot kill; the work goes on without it
        }
    }
    try {
        return await work({ ...taken, spawned })
    } finally {
        for (const signal of signals) process.off(signal, onSignal)
        process.off("exit", release)
        release()
    }
}

/** A slot of a lane: a store row or a foreign lock file naming it. */
export interface LaneSlot {
    readonly kind: string
    readonly n: number
    readonly where: string
    readonly content: string
}

/** Every slot of every kind the lane holds, burst included: its rows and the foreign files naming it. */
export const slotsOfLane = (root: string, rules: SlotRules, lane: string): LaneSlot[] => {
    const kinds = Object.keys(rules.kinds)
    const rows = withSlotStore((db) => slotRows(db, kinds)).filter((row) => row.lane === lane)
    return [
        ...rows.map((row) => ({ kind: row.kind, n: row.n, where: whereOfRow(row.kind, row.n), content: describeRow(row) })),
        ...foreignLocks(root, rules, kinds)
            .filter((lock) => lock.read.holder === lane)
            .map((lock) => ({ kind: lock.kind, n: lock.n, where: lock.file, content: lock.read.content.trim() })),
    ]
}

/** Releases every slot of every kind a lane holds (it landed, was rejected, or its worktree is removed); each one logged. */
export const releaseLaneSlots = (root: string, rules: SlotRules, lane: string, by: string): Released => {
    const released: string[] = []
    const kept: string[] = []
    for (const name of Object.keys(rules.kinds)) {
        const done = releaseSlots(root, rules, name, lane, {}, by)
        released.push(...done.released)
        kept.push(...done.kept)
    }
    return { released, kept }
}
