import { appendFileSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { hostname, uptime } from "node:os"
import { basename, join, resolve } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"
import { captureToolSync, pidAlive } from "../shared/exec.js"
import { hostFreeMb } from "./heavy.js"
import { sharedStateBase } from "./ledger.js"
import { locateOps } from "./ops.js"

/**
 * Machine-wide slots (ops/slots.yaml): a bounded number of lock files per kind (`npm`, `gate`, `shoot`, `stack`) in one slot root,
 * shared by every checkout, lane and agent of a host. The heavy-command governor (harness/heavy.ts) admits by RAM inside one harness
 * state; a CLI installed in an app's node_modules has a state of its own, so the slot files are what bounds work across worktrees.
 *
 * A slot file holds one line, `<holder> <taken> pid=<pid> start=<pid start> boot=<host boot> host=<host>`, which the lane scripts of
 * a lanes folder read as "<lane> <time>" too. It is taken whole and alone (a hard link of a written file, so nobody reads it half
 * written) and released only by the holder it names. It is reclaimed only on evidence that its holder is gone (`judgeHolder`): the
 * host booted after it was taken, its pid is not alive, or its pid now runs a process started at another time. Age is a warning,
 * never a reclaim. A reclaim renames the file aside first, so two reclaimers never both win, and logs its evidence.
 *
 * One slot per lane per kind: a take for a lane that already holds a slot of the kind returns it (re-entrant), whatever format wrote it,
 * so retried gates never pile up. A slot the old helper wrote (`<lane> <iso>`, no pid, no boot) has no process to probe: it is reclaimable
 * once its lane's worktree is gone (`laneGoneProbe`), or taken before this boot. A lane's slots are also released when it lands, is
 * rejected or its worktree is removed (`releaseLaneSlots`).
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

/** The line a holder writes: `<holder> <taken> [pid=<pid> [start=<iso>]] boot=<iso> host=<host>`. */
export const slotLine = (holder: string, pid?: number): string => {
    const start = pid === undefined ? null : processStartMs(pid)
    const owner = pid === undefined ? "" : ` pid=${String(pid)}${start === null ? "" : ` start=${new Date(start).toISOString()}`}`
    return `${holder} ${new Date().toISOString()}${owner} boot=${new Date(bootMs()).toISOString()} host=${hostname()}`
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
 * `rebooted` (the host booted after it was taken, so every process of that session is gone), `gone` (a lock of the old helper, which
 * records no pid, whose lane has no worktree any more).
 */
export type SlotState = "free" | "held" | "old" | "dead" | "reused" | "rebooted" | "gone"

/** The states a take, or `slot release --stale`, reclaims. */
export const RECLAIMABLE: ReadonlySet<SlotState> = new Set<SlotState>(["dead", "reused", "rebooted", "gone"])

/** One slot as `slot list` shows it. */
export interface SlotView {
    readonly kind: string
    readonly n: number
    readonly file: string
    readonly state: SlotState
    readonly burst: boolean
    readonly holder?: string
    readonly at?: string
    readonly ageMinutes?: number
    readonly pid?: number | null
    /** Why the state is what it is: the evidence a reclaim logs. */
    readonly evidence?: string
    /** Whether the holder process is alive: unknown when the lock records no pid or sits on another host. */
    readonly alive?: "yes" | "no" | "unknown"
    /** A take or `slot release --stale` would reclaim it now. */
    readonly reclaimable?: boolean
}

/** What the judgement reads from the host. */
export interface HostProbe {
    readonly nowMs: number
    readonly bootMs: number
    readonly hostname: string
    readonly alive: (pid: number) => boolean
    readonly startMs: (pid: number) => number | null
    /** Evidence that a lane has no worktree left; undefined when it has one or that cannot be known. */
    readonly laneGone?: (lane: string) => string | undefined
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

/**
 * Evidence that a lane has no worktree: no registered worktree of the repositories under `root` that exists on disk ends in `/<lane>`
 * or has `lane/<lane>` checked out. Where no repository is found there, the lane's `_land-status/<lane>.json` saying landed or rejected
 * stands in. The scan runs once, on the first lane asked about.
 */
export const laneGoneProbe = (root: string): ((lane: string) => string | undefined) => {
    let scan: ReturnType<typeof worktreesUnder> | "unread" = "unread"
    return (lane) => {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(lane)) return undefined
        if (scan === "unread") scan = worktreesUnder(root)
        if (scan !== undefined) {
            const present = scan.worktrees.some((entry) => existsSync(entry.path) && (basename(entry.path) === lane || entry.branch === `lane/${lane}`))
            return present ? undefined : `no worktree of the ${String(scan.repos)} repositor${scan.repos === 1 ? "y" : "ies"} under ${root} ends in /${lane} or holds lane/${lane}`
        }
        try {
            const state = (JSON.parse(readFileSync(join(root, "_land-status", `${lane}.json`), "utf8")) as { state?: unknown }).state
            return state === "landed" || state === "rejected" ? `no repository is known under ${root}; _land-status/${lane}.json says ${state}` : undefined
        } catch {
            return undefined
        }
    }
}

/** The live host; `root` (the slot root) lets a lock that records no pid be judged by its lane's worktree. */
export const liveProbe = (root?: string): HostProbe => ({ nowMs: Date.now(), bootMs: bootMs(), hostname: hostname(), alive: pidAlive, startMs: processStartMs, ...(root === undefined ? {} : { laneGone: laneGoneProbe(root) }) })

const isoOf = (ms: number): string => new Date(ms).toISOString()

/**
 * Judges a holder on evidence alone. A slot of another host is held. A recorded pid that is not alive is `dead`; one alive whose start
 * differs from the recorded start is `reused`; one alive with the recorded start is held whatever the boot reading says. Without that
 * proof (no pid, or no recorded start), a slot taken before this boot, or recording another boot, is `rebooted`. A slot of the old helper
 * (no pid and no boot recorded) whose lane has no worktree is `gone`. Otherwise it is held, `old` past warnMinutes.
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
    if (holder.pid === null && holder.bootMs === null) {
        const gone = probe.laneGone?.(holder.holder)
        if (gone !== undefined) return { state: "gone", evidence: `taken ${holder.at} by the old helper (no pid, no boot recorded); ${gone}` }
    }
    return aged(holder.pid === null ? "no pid recorded" : `pid ${String(holder.pid)} alive, its start unknown`)
}

/** Whether the holder is alive, as far as the judgement knows. */
const aliveOf = (holder: SlotHolder, state: SlotState, probe: HostProbe): "yes" | "no" | "unknown" => {
    if (holder.host !== null && holder.host !== probe.hostname) return "unknown"
    if (state === "dead" || state === "reused" || state === "rebooted") return "no"
    return holder.pid === null ? "unknown" : "yes"
}

const reclaimLog = (root: string, line: string): void => {
    try {
        appendFileSync(join(root, "_slots.log"), `${new Date().toISOString()} ${line}\n`)
    } catch {
        // the log is a courtesy; a reclaim never fails on it
    }
}

/**
 * Reclaims a slot judged reclaimable from `judged` (its content when judged): the file is renamed aside, atomically, so one reclaimer
 * wins; when the renamed content is not what was judged (it was released and taken again in between) it is linked back. True when
 * the slot was freed.
 */
export const reclaimSlot = (root: string, file: string, judged: SlotHolder, by: string, evidence: string): boolean => {
    const aside = `${file}.reclaim.${String(process.pid)}.${String(Date.now())}`
    try {
        renameSync(file, aside)
    } catch {
        return false
    }
    let content = ""
    try {
        content = readFileSync(aside, "utf8")
    } catch {
        // gone already: nothing to put back
    }
    if (content !== judged.content) {
        try {
            linkSync(aside, file)
        } catch {
            reclaimLog(root, `${by}: ${file} changed while reclaimed and could not be put back (${content.trim()})`)
        }
        unlinkSync(aside)
        return false
    }
    unlinkSync(aside)
    reclaimLog(root, `${by} reclaimed ${file} from "${judged.content.trim()}": ${evidence}`)
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

/** What a take did. */
export interface Taken {
    readonly kind: string
    readonly n: number
    readonly file: string
    readonly holder: string
    readonly pid: number | null
    /** The holder already held this slot: a take is idempotent for its holder. */
    readonly already: boolean
    /** The holders proven gone it reclaimed on the way, with the evidence. */
    readonly reclaimed: readonly string[]
    readonly waitedSeconds: number
}

/** How a take waits and whom it records. */
export interface TakeOptions {
    /** The process the slot lives as long as; without it the slot is reclaimed only by age. */
    readonly pid?: number
    /** Seconds to wait for a free slot; undefined waits until one frees. */
    readonly waitSeconds?: number | undefined
    /** Return the slot the holder already holds instead of taking a second one (the default; false takes a further one). */
    readonly reuse?: boolean
    readonly say?: (line: string) => void
    readonly freeMb?: () => number
}

/** The slot of a kind `holder` holds now, if any. */
export const heldBy = (root: string, kind: SlotKind, holder: string): { readonly n: number; readonly file: string; readonly holder: SlotHolder } | undefined => {
    for (const n of allNumbers(kind)) {
        const file = slotFile(root, kind, n)
        const read = readHolder(file)
        if (read?.holder === holder) return { n, file, holder: read }
    }
    return undefined
}

/** One pass over the open slots: takes the first free one, reclaiming a holder proven gone first. */
const takeOnce = (root: string, name: string, kind: SlotKind, holder: string, options: TakeOptions, reclaimed: string[]): { readonly n: number; readonly file: string } | undefined => {
    const probe = liveProbe(root)
    for (const n of openNumbers(kind, options.freeMb ?? hostFreeMb)) {
        const file = slotFile(root, kind, n)
        if (takeLockFile(file, slotLine(holder, options.pid))) return { n, file }
        const read = readHolder(file)
        if (read === undefined) {
            if (takeLockFile(file, slotLine(holder, options.pid))) return { n, file }
            continue
        }
        const judged = judgeHolder(kind, read, probe)
        if (RECLAIMABLE.has(judged.state) && reclaimSlot(root, file, read, `${holder} (pid ${String(process.pid)})`, `${judged.state}: ${judged.evidence}`)) {
            reclaimed.push(`${String(n)}: ${read.content.trim()} (${judged.state}: ${judged.evidence})`)
            options.say?.(`reclaimed ${name} slot ${String(n)} from ${read.holder}: ${judged.state}, ${judged.evidence}`)
            if (takeLockFile(file, slotLine(holder, options.pid))) return { n, file }
        }
    }
    return undefined
}

/**
 * Takes a slot of `name` for `holder`, waiting every `pollSeconds` for one to free and for the kind's `minFreeMb`; a holder
 * proven gone is reclaimed on the way. Refused SLOT_BUSY once `waitSeconds` pass.
 */
export const takeSlot = async (root: string, rules: SlotRules, name: string, holder: string, options: TakeOptions = {}): Promise<Taken> => {
    const kind = slotKind(rules, name)
    checkHolder(holder)
    const started = Date.now()
    const waited = (): number => Math.round((Date.now() - started) / 1000)
    const reclaimed: string[] = []
    // One slot per lane per kind: the lane's own slot is returned (any format), never a second one. One proven gone is reclaimed first.
    const held = options.reuse === false ? undefined : heldBy(root, kind, holder)
    if (held !== undefined) {
        const judged = judgeHolder(kind, held.holder, liveProbe(root))
        if (RECLAIMABLE.has(judged.state)) {
            if (reclaimSlot(root, held.file, held.holder, `${holder} (pid ${String(process.pid)})`, `${judged.state}: ${judged.evidence}`)) {
                reclaimed.push(`${String(held.n)}: ${held.holder.content.trim()} (${judged.state}: ${judged.evidence})`)
                options.say?.(`reclaimed ${name} slot ${String(held.n)} from ${holder}: ${judged.state}, ${judged.evidence}`)
            }
        } else {
            let pid = held.holder.pid
            // A slot with no pid (the old helper, or a take without --pid) is stamped with the pid that now holds it for the lane.
            if (options.pid !== undefined && pid === null && releaseIfSame(held.file, held.holder) && takeLockFile(held.file, slotLine(holder, options.pid))) pid = options.pid
            const duplicates = releaseOldDuplicates(root, kind, holder, held.n, options.say)
            return { kind: name, n: held.n, file: held.file, holder, pid, already: true, reclaimed: duplicates, waitedSeconds: 0 }
        }
    }
    let told = false
    for (;;) {
        const freeMb = (options.freeMb ?? hostFreeMb)()
        const roomy = kind.minFreeMb === undefined || freeMb >= kind.minFreeMb
        const got = roomy ? takeOnce(root, name, kind, holder, options, reclaimed) : undefined
        if (got !== undefined) return { kind: name, n: got.n, file: got.file, holder, pid: options.pid ?? null, already: false, reclaimed, waitedSeconds: waited() }
        if (options.waitSeconds !== undefined && waited() >= options.waitSeconds) {
            const why = roomy ? `every ${name} slot is held` : `the host has ${String(freeMb)} MB free, under the ${String(kind.minFreeMb)} MB a ${name} slot needs`
            throw new Refusal("SLOT_BUSY", `${why} after ${String(waited())} s: starci slot list ${name}`)
        }
        if (!told) options.say?.(roomy ? `waiting for a ${name} slot (every one is held)` : `waiting for ${String(kind.minFreeMb)} MB free before a ${name} slot (${String(freeMb)} MB now)`)
        told = true
        await sleep(kind.pollSeconds * 1000)
    }
}

/** What a release did: the files it removed and the ones it left, with why. */
export interface Released {
    readonly released: readonly string[]
    readonly kept: readonly string[]
}

/**
 * Releases the slots of a kind `holder` holds (only slot `n` when given; only the one recording `pid` when given). A slot is removed
 * only once read and found to name the holder, through the same rename-aside a reclaim uses, so a slot taken again in between stays.
 */
export const releaseSlots = (root: string, rules: SlotRules, name: string, holder: string, only: { readonly n?: number; readonly pid?: number } = {}): Released => {
    const kind = slotKind(rules, name)
    const released: string[] = []
    const kept: string[] = []
    for (const n of allNumbers(kind)) {
        if (only.n !== undefined && n !== only.n) continue
        const file = slotFile(root, kind, n)
        const read = readHolder(file)
        if (read === undefined) continue
        if (read.holder !== holder || (only.pid !== undefined && read.pid !== only.pid)) {
            if (only.n !== undefined) kept.push(`${file}: held by ${read.content.trim()}, not ${holder}`)
            continue
        }
        if (releaseIfSame(file, read)) released.push(file)
        else kept.push(`${file}: changed while released`)
    }
    return { released, kept }
}

/** Removes a slot file whose content is still `read`'s; false when it changed under the release. */
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
            // a new holder took the slot meanwhile; the aside copy is the old holder's and goes
        }
        unlinkSync(aside)
        return false
    }
    unlinkSync(aside)
    return true
}

/** Reclaims every slot of the given kinds whose holder is proven gone (`RECLAIMABLE`); an `old` one is reported, never removed. */
export const reclaimStale = (root: string, rules: SlotRules, names: readonly string[], by: string): Released => {
    const released: string[] = []
    const kept: string[] = []
    for (const view of listSlots(root, rules, names)) {
        if (view.state === "old") kept.push(`${view.file}: ${String(view.holder)} is old (${String(view.evidence)}); ask its holder`)
        if (!RECLAIMABLE.has(view.state)) continue
        const read = readHolder(view.file)
        if (read !== undefined && reclaimSlot(root, view.file, read, by, `${view.state}: ${String(view.evidence)}`)) released.push(`${view.file} (${view.state}: ${String(view.evidence)})`)
    }
    return { released, kept }
}

/** Every slot of the given kinds (all kinds when none), free ones included. */
export const listSlots = (root: string, rules: SlotRules, names: readonly string[] = []): SlotView[] => {
    const kinds = names.length === 0 ? Object.keys(rules.kinds) : names
    const probe = liveProbe(root)
    return kinds.flatMap((name) => {
        const kind = slotKind(rules, name)
        return allNumbers(kind).map((n): SlotView => {
            const file = slotFile(root, kind, n)
            const burst = n > kind.count
            const read = readHolder(file)
            if (read === undefined) return { kind: name, n, file, state: "free", burst }
            const ageMinutes = Math.round((probe.nowMs - Date.parse(read.at)) / 60_000)
            const judged = judgeHolder(kind, read, probe)
            return { kind: name, n, file, state: judged.state, burst, holder: read.holder, at: read.at, ageMinutes, pid: read.pid, evidence: judged.evidence, alive: aliveOf(read, judged.state, probe), reclaimable: RECLAIMABLE.has(judged.state) }
        })
    })
}

/** Holds a slot while `work` runs, released when it ends (thrown, signalled or not); the slot records this process's pid. */
export const withSlot = async <T>(root: string, rules: SlotRules, name: string, holder: string, options: Omit<TakeOptions, "pid" | "reuse">, work: (taken: Taken) => Promise<T>): Promise<T> => {
    const taken = await takeSlot(root, rules, name, holder, { ...options, pid: process.pid })
    const release = (): void => {
        releaseSlots(root, rules, name, holder, { n: taken.n, pid: process.pid })
    }
    const onSignal = (): void => {
        release()
        process.exit(130)
    }
    // Windows delivers SIGINT (Ctrl+C), SIGBREAK (Ctrl+Break) and SIGHUP (console closed) and never SIGTERM; a process killed outright
    // (taskkill /F, a dead parent) runs nothing, and the pid recorded in the slot lets the next take reclaim it. `exit` is the last
    // resort for process.exit and uncaught errors; release is idempotent.
    const signals: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP", ...(process.platform === "win32" ? (["SIGBREAK"] as const) : [])]
    for (const signal of signals) process.once(signal, onSignal)
    process.once("exit", release)
    try {
        return await work(taken)
    } finally {
        for (const signal of signals) process.off(signal, onSignal)
        process.off("exit", release)
        release()
    }
}

/** A slot of a lane found in the slot root, whatever kind or writer. */
export interface LaneSlot {
    readonly kind: string
    readonly n: number
    readonly file: string
    readonly content: string
}

/** Every slot of every kind the lane holds, burst included, read by the lane name whoever wrote the file. */
export const slotsOfLane = (root: string, rules: SlotRules, lane: string): LaneSlot[] =>
    Object.keys(rules.kinds).flatMap((name) => {
        const kind = slotKind(rules, name)
        return allNumbers(kind).flatMap((n) => {
            const file = slotFile(root, kind, n)
            const read = readHolder(file)
            return read?.holder === lane ? [{ kind: name, n, file, content: read.content.trim() }] : []
        })
    })

/** Releases every slot of every kind a lane holds (it landed, was rejected, or its worktree is removed); each one logged. */
export const releaseLaneSlots = (root: string, rules: SlotRules, lane: string, by: string): Released => {
    const released: string[] = []
    const kept: string[] = []
    for (const name of Object.keys(rules.kinds)) {
        const done = releaseSlots(root, rules, name, lane)
        for (const file of done.released) {
            released.push(file)
            reclaimLog(root, `${by} released ${file} of lane ${lane}`)
        }
        kept.push(...done.kept)
    }
    return { released, kept }
}

/** Releases the lane's other slots of a kind that the old helper wrote (no pid, no boot): the leaked slots of earlier retries. */
const releaseOldDuplicates = (root: string, kind: SlotKind, holder: string, keep: number, say?: (line: string) => void): string[] => {
    const done: string[] = []
    for (const n of allNumbers(kind)) {
        if (n === keep) continue
        const file = slotFile(root, kind, n)
        const read = readHolder(file)
        if (read?.holder !== holder || read.pid !== null || read.bootMs !== null || !releaseIfSame(file, read)) continue
        reclaimLog(root, `${holder} released ${file} ("${read.content.trim()}"): a second slot of the same lane and kind written by the old helper`)
        say?.(`released a leaked old-format slot ${String(n)} of ${holder}`)
        done.push(`${String(n)}: ${read.content.trim()} (duplicate of the lane's slot ${String(keep)}, old format)`)
    }
    return done
}
