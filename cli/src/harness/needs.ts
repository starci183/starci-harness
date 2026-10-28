import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"
import { now } from "./ledger.js"
import { readMachine, textOf, withMachine } from "./machine.js"
import { locateOps } from "./ops.js"

/**
 * Shared needs (cli/README.md "Shared needs"): a worker that finds a shared capability, package or configuration missing never
 * builds it; it files `blocked` with a normalized need key. The host store keeps one row per (project, key) in `shared_needs`
 * and one waiter row per reporting task in `shared_need_waiters` (machine.ts), so two reports of one need open it once. This
 * module owns the key grammar, the shared roots of ops/needs.yaml, the owner deadline of ops/liveness.yaml and the store; the
 * router that raises the decisions and releases the waiters is core/needs/tend.ts.
 */

/** The kinds a need key names. */
export const NEED_KINDS = ["capability", "package", "config"] as const

/** One kind of need. */
export type NeedKind = (typeof NEED_KINDS)[number]

const SEGMENT = "[a-z0-9][a-z0-9-]*"
const DOTTED = new RegExp(String.raw`^${SEGMENT}(?:\.${SEGMENT})*$`)
const PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/

/** The key grammar in one line, for every refusal that names a key. */
export const NEED_KEY_GRAMMAR = "a need key is <kind>:<target>: capability:<dotted name> (capability:platform.http), package:<npm name> (package:@starci/grammar) or config:<dotted name> (config:root-eslint); lowercase letters, digits and hyphens, segments joined by dots"

/** The package scope whose needs are package edits (a Supervisor worker's `pkg branch` and `pkg handoff`), never the owner's. */
export const PACKAGE_SCOPE = "@starci/"

/**
 * Normalizes a need key: kind and target lowercased and trimmed; a capability or config target takes `/`, `\` and `.` as
 * separators (`platform/http` is `platform.http`) and turns spaces and underscores into hyphens. NEED_KEY_INVALID names the grammar.
 */
export const normalizeNeedKey = (raw: string): string => {
    const text = raw.trim()
    const colon = text.indexOf(":")
    const invalid = (why: string): Refusal => new Refusal("NEED_KEY_INVALID", `"${raw}" ${why}; ${NEED_KEY_GRAMMAR}`)
    if (colon <= 0) throw invalid("names no kind")
    const kind = text.slice(0, colon).trim().toLowerCase()
    if (!(NEED_KINDS as readonly string[]).includes(kind)) throw invalid(`has kind "${kind}"`)
    const target = text.slice(colon + 1).trim().toLowerCase()
    if (kind === "package") {
        if (!PACKAGE.test(target)) throw invalid("is no npm package name")
        return `package:${target}`
    }
    const dotted = target
        .replaceAll(/[\\/]+/g, ".")
        .replaceAll(/[\s_]+/g, "-")
        .replaceAll(/\.+/g, ".")
        .replace(/^\.+|\.+$/g, "")
    if (!DOTTED.test(dotted)) throw invalid("has a target outside the grammar")
    return `${kind}:${dotted}`
}

/** The kind of a normalized key. */
export const kindOf = (key: string): NeedKind => key.slice(0, key.indexOf(":")) as NeedKind

/** True for a key that a package edit resolves: a `@starci` package. */
export const isPackageNeed = (key: string): boolean => key.startsWith(`package:${PACKAGE_SCOPE}`)

/** The package folder (packages/<folder>) a `@starci` package need names. */
export const packageFolderOf = (key: string): string => key.slice(`package:${PACKAGE_SCOPE}`.length)

/** A repository path as needs compare it: forward slashes, no leading `./` or `/`. */
export const needPath = (path: string): string => path.trim().replaceAll("\\", "/").replace(/^(?:\.\/)+/, "").replace(/^\/+/, "")

const rootSchema = z.strictObject({ glob: z.string().min(1), key: z.string().min(1) })
const needsFileSchema = z.strictObject({ schema: z.literal("starci/needs@1"), sharedRoots: z.array(rootSchema).min(1) })

/** One shared root: its glob as a regex whose groups are its `*` segments, and the key template it gives a need. */
export interface SharedRoot {
    readonly glob: string
    readonly pattern: RegExp
    readonly key: string
}

const escape = (text: string): string => text.replaceAll(/[.+^${}()|[\]\\]/g, String.raw`\$&`)

/** A glob as a regex: `**` any depth (a trailing `/**` also matches the folder itself), `*` one segment's text (a group), `?` one character. */
export const globPattern = (glob: string): RegExp => {
    let body = ""
    for (let index = 0; index < glob.length; index += 1) {
        const rest = glob.slice(index)
        if (rest === "/**") {
            body += "(?:/.*)?"
            break
        }
        if (rest.startsWith("**/")) {
            body += "(?:.*/)?"
            index += 2
        } else if (rest.startsWith("**")) {
            body += ".*"
            index += 1
        } else if (rest.startsWith("*")) body += "([^/]*)"
        else if (rest.startsWith("?")) body += "[^/]"
        else body += escape(rest.charAt(0))
    }
    return new RegExp(`^${body}$`)
}

const loadedRoots = new Map<string, readonly SharedRoot[]>()

/** Loads the shared roots of ops/needs.yaml (STARCI_OPS_DIR honoured); a template whose key leaves the grammar is OPS_INVALID. */
export const loadSharedRoots = (dir: string = locateOps()): readonly SharedRoot[] => {
    const known = loadedRoots.get(dir)
    if (known !== undefined) return known
    const file = join(dir, "needs.yaml")
    let raw: unknown
    try {
        raw = parse(readFileSync(file, "utf8"))
    } catch (error: unknown) {
        throw new Refusal("OPS_INVALID", `${file} is not readable yaml: ${error instanceof Error ? error.message : String(error)}`)
    }
    const parsed = needsFileSchema.safeParse(raw)
    if (!parsed.success) throw new Refusal("OPS_INVALID", `${file} is invalid: ${z.prettifyError(parsed.error)}`)
    const roots = parsed.data.sharedRoots.map((root) => {
        try {
            normalizeNeedKey(root.key.replaceAll(/\$\d/g, "x"))
        } catch (error: unknown) {
            throw new Refusal("OPS_INVALID", `${file}: root ${root.glob} gives key ${root.key}: ${error instanceof Error ? error.message : String(error)}`)
        }
        return { glob: root.glob, pattern: globPattern(root.glob), key: root.key }
    })
    loadedRoots.set(dir, roots)
    return roots
}

/** The key a path names through the first shared root it matches, or undefined for a path under no shared root. */
export const slotKeyOf = (path: string, roots: readonly SharedRoot[] = loadSharedRoots()): string | undefined => {
    const normal = needPath(path)
    for (const root of roots) {
        const match = root.pattern.exec(normal)
        if (match === null) continue
        return normalizeNeedKey(root.key.replaceAll(/\$(\d)/g, (_, digit: string) => match[Number(digit)] ?? ""))
    }
    return undefined
}

/**
 * The canonical key of a reported need: a package key stands as given; any other key is named by the first reported path that
 * lies under a shared root (ops/needs.yaml), so two workers who spell one need differently land on one key.
 */
export const canonicalKey = (key: string, paths: readonly string[], roots: readonly SharedRoot[] = loadSharedRoots()): string => {
    if (kindOf(key) === "package") return key
    for (const path of paths) {
        const slot = slotKeyOf(path, roots)
        if (slot !== undefined) return slot
    }
    return key
}

/** True when a path lies under a shared root. */
export const isSharedPath = (path: string, roots: readonly SharedRoot[] = loadSharedRoots()): boolean => slotKeyOf(path, roots) !== undefined

/** One need as a worker reported it: its canonical key, the key it gave, the rule it applied, the paths it would touch and a note. */
export interface NeedReport {
    readonly key: string
    readonly given: string
    readonly rules: readonly string[]
    readonly paths: readonly string[]
    readonly note: string | null
}

const reportEntrySchema = z.union([
    z.string().min(1),
    z.strictObject({ key: z.string().min(1), rule: z.string().min(1).optional(), rules: z.array(z.string().min(1)).optional(), paths: z.array(z.string().min(1)).optional(), note: z.string().nullable().optional(), given: z.string().min(1).optional() }),
])

/** The `needs` an output json carries, as given (strings or entries); undefined when it carries none. */
const outputNeeds = (output: unknown): unknown => (typeof output === "object" && output !== null && "needs" in output ? output.needs : undefined)

/** True when a filed result's output carries needs: its task waits on a shared need, never a question for its Kernel. */
export const carriesNeeds = (output: unknown): boolean => {
    const needs = outputNeeds(output)
    return Array.isArray(needs) && needs.length > 0
}

/**
 * The needs of one `task result`: each `--needs` key with the `--rule`, `--paths` and `--note` given beside it, and every entry
 * of the output's `needs` (a key, or {key, rule|rules, paths, note}); each key normalized and made canonical, one report per key.
 * NEED_REPORT_INVALID when the output's `needs` is malformed.
 */
export const parseNeeds = (flags: { readonly needs: readonly string[]; readonly rule: string | undefined; readonly paths: readonly string[]; readonly note: string | undefined }, output: unknown): NeedReport[] => {
    const given: { key: string; as: string; rules: string[]; paths: string[]; note: string | null }[] = flags.needs.map((key) => ({ key, as: key, rules: flags.rule === undefined ? [] : [flags.rule], paths: [...flags.paths], note: flags.note ?? null }))
    const listed = outputNeeds(output)
    if (listed !== undefined) {
        const parsed = z.array(reportEntrySchema).safeParse(listed)
        if (!parsed.success) throw new Refusal("NEED_REPORT_INVALID", `the output's needs is a list of keys or {key, rule, paths, note}: ${z.prettifyError(parsed.error)}`)
        for (const entry of parsed.data) {
            if (typeof entry === "string") given.push({ key: entry, as: entry, rules: [], paths: [], note: null })
            else given.push({ key: entry.key, rules: [...(entry.rules ?? []), ...(entry.rule === undefined ? [] : [entry.rule])], paths: entry.paths ?? [], note: entry.note ?? null, as: entry.given ?? entry.key })
        }
    }
    const byKey = new Map<string, NeedReport>()
    for (const entry of given) {
        const paths = entry.paths.map(needPath)
        const key = canonicalKey(normalizeNeedKey(entry.key), paths)
        const known = byKey.get(key)
        byKey.set(key, {
            key,
            given: known?.given ?? entry.as,
            rules: [...new Set([...(known?.rules ?? []), ...entry.rules])],
            paths: [...new Set([...(known?.paths ?? []), ...paths])],
            note: [known?.note, entry.note].filter((part): part is string => part !== null && part !== undefined && part !== "").join("; ") || null,
        })
    }
    return [...byKey.values()]
}

/** The needs a filed output carries, read back as reports (normalized again; an entry that no longer parses is left out). */
export const needsOfOutput = (output: unknown): NeedReport[] => {
    try {
        return parseNeeds({ needs: [], rule: undefined, paths: [], note: undefined }, output)
    } catch {
        return []
    }
}

/** The owner deadline of ops/liveness.yaml's `needs` block, in minutes. */
export const loadNeedDeadline = (dir: string = locateOps()): number => {
    const file = join(dir, "liveness.yaml")
    const parsed = z.looseObject({ needs: z.strictObject({ ownerDeadlineMinutes: z.number().positive() }) }).safeParse(parse(readFileSync(file, "utf8")))
    if (!parsed.success) throw new Refusal("OPS_INVALID", `${file} needs block is invalid: ${z.prettifyError(parsed.error)}`)
    return parsed.data.needs.ownerDeadlineMinutes
}

/** Who routes a need: a workflow's Kernel, the project's Supervisor, or past both the owner (Debug for a package need). */
export type NeedLevel = "kernel" | "supervisor" | "owner"

/**
 * A need's state: open (no router has it yet), routed (a decision waits), owned (the Supervisor gave it to a workflow whose
 * Kernel names its resolver), resolving (a resolver works on it), resolved, rejected (not shared: its waiters went back to
 * their Ops), merged (folded into another key by `needs merge`).
 */
export type NeedState = "open" | "routed" | "owned" | "resolving" | "resolved" | "rejected" | "merged"

/** The scope a need's waiters and paths give it (core/needs/tend.ts routes by it). */
export type NeedScope = "workflow" | "shared" | "package"

/** The decision a need waits on, in the ledger of `repo`. */
export interface NeedDecisionRef {
    readonly repo: string
    readonly workflow: string
    readonly id: string
    readonly scope: "kernel" | "supervisor"
}

/** Who owns a need: a workflow (its Kernel names the resolver) or a `[Worker]` the Supervisor dispatched. */
export type NeedOwner = { readonly kind: "workflow"; readonly repo: string; readonly workflow: string } | { readonly kind: "worker"; readonly worker: string; readonly repo: string; readonly task: string }

/** What resolves a need: a task (a node of a workflow by key, or a worker's task by id), or a package edit and its handoff. */
export type NeedResolver =
    | { readonly kind: "task"; readonly repo: string; readonly workflow: string | null; readonly key: string | null; readonly task: string | null; readonly keys?: readonly string[]; readonly commits?: readonly string[] }
    | { readonly kind: "package"; readonly package: string; readonly worker: string | null; readonly repo: string | null; readonly task: string | null; readonly handoff: { readonly branch: string; readonly head: string; readonly harness: string } | null }

/** One shared need of a project. */
export interface NeedRow {
    readonly project: string
    readonly key: string
    readonly scope: NeedScope
    readonly level: NeedLevel | null
    readonly state: NeedState
    readonly round: number
    readonly decision: NeedDecisionRef | null
    readonly owner: NeedOwner | null
    readonly resolver: NeedResolver | null
    readonly reason: string | null
    readonly mergedInto: string | null
    readonly openedAt: string
    readonly routedAt: string | null
    readonly updatedAt: string
    readonly resolvedAt: string | null
}

/** One task waiting on a need: where it lives, what it reported, and when it was parked and released. */
export interface WaiterRow {
    readonly project: string
    readonly key: string
    readonly repo: string
    readonly workflow: string | null
    readonly task: string
    readonly taskKey: string | null
    readonly given: string
    readonly rules: readonly string[]
    readonly paths: readonly string[]
    readonly note: string | null
    readonly reportedAt: string
    readonly parkedAt: string | null
    readonly releasedAt: string | null
    readonly release: unknown
}

const json = (value: unknown): unknown => (typeof value === "string" ? JSON.parse(value) : null)

const toNeed = (row: Record<string, unknown>): NeedRow => ({
    project: String(row.project),
    key: String(row.key),
    scope: String(row.scope) as NeedScope,
    level: textOf(row.level) as NeedLevel | null,
    state: String(row.state) as NeedState,
    round: Number(row.round),
    decision: json(row.decision_json) as NeedDecisionRef | null,
    owner: json(row.owner_json) as NeedOwner | null,
    resolver: json(row.resolver_json) as NeedResolver | null,
    reason: textOf(row.reason),
    mergedInto: textOf(row.merged_into),
    openedAt: String(row.opened_at),
    routedAt: textOf(row.routed_at),
    updatedAt: String(row.updated_at),
    resolvedAt: textOf(row.resolved_at),
})

const toWaiter = (row: Record<string, unknown>): WaiterRow => ({
    project: String(row.project),
    key: String(row.key),
    repo: String(row.repo),
    workflow: textOf(row.workflow_id),
    task: String(row.task_id),
    taskKey: textOf(row.task_key),
    given: String(row.given_key),
    rules: (json(row.rules_json) ?? []) as string[],
    paths: (json(row.paths_json) ?? []) as string[],
    note: textOf(row.note),
    reportedAt: String(row.reported_at),
    parkedAt: textOf(row.parked_at),
    releasedAt: textOf(row.released_at),
    release: json(row.release_json),
})

/** The states a need ends in: nothing routes it any more. */
export const ENDED_NEED_STATES: readonly NeedState[] = ["resolved", "rejected", "merged"]

/** One need, if the store holds it. */
export const needOf = (db: DatabaseSync, project: string, key: string): NeedRow | undefined => {
    const row = db.prepare("SELECT * FROM shared_needs WHERE project = ? AND key = ?").get(project, key)
    return row === undefined ? undefined : toNeed(row)
}

/** Reads one need from the host store. */
export const readNeed = (project: string, key: string): NeedRow | undefined => readMachine((db) => needOf(db, project, key), undefined)

/** The needs of a project, open ones first (`all` false: only those not ended). */
export const needsOf = (project: string, all: boolean): NeedRow[] =>
    readMachine((db) => db.prepare("SELECT * FROM shared_needs WHERE project = ? ORDER BY opened_at, key").all(project), [])
        .map(toNeed)
        .filter((need) => all || !ENDED_NEED_STATES.includes(need.state))

/** The waiters of one need, oldest first. */
export const waitersOf = (db: DatabaseSync, project: string, key: string): WaiterRow[] => db.prepare("SELECT * FROM shared_need_waiters WHERE project = ? AND key = ? ORDER BY reported_at, task_id").all(project, key).map(toWaiter)

/** Reads the waiters of one need from the host store. */
export const readWaiters = (project: string, key: string): WaiterRow[] => readMachine((db) => waitersOf(db, project, key), [])

/** Every waiter row of one task (one per key it reported). */
export const waiterRowsOfTask = (db: DatabaseSync, project: string, repo: string, task: string): WaiterRow[] => db.prepare("SELECT * FROM shared_need_waiters WHERE project = ? AND repo = ? AND task_id = ?").all(project, needRepo(repo), task).map(toWaiter)

/** The waiter rows of one plan key of a workflow, newest first: the brief of its next attempt reads them. */
export const waitersOfPlanKey = (workflow: string, planKey: string): WaiterRow[] =>
    readMachine((db) => db.prepare("SELECT * FROM shared_need_waiters WHERE workflow_id = ? AND task_key = ? ORDER BY reported_at DESC").all(workflow, planKey), []).map(toWaiter)

/** The needs with a waiter in one workflow, or owned or resolved by it, that a step of that workflow tends. */
export const needsOfWorkflow = (db: DatabaseSync, project: string, repo: string, workflow: string): NeedRow[] =>
    db
        .prepare(
            "SELECT * FROM shared_needs n WHERE n.project = ? AND (EXISTS (SELECT 1 FROM shared_need_waiters w WHERE w.project = n.project AND w.key = n.key AND w.repo = ? AND w.workflow_id = ?) " +
                "OR json_extract(n.owner_json, '$.workflow') = ? OR json_extract(n.resolver_json, '$.workflow') = ? OR json_extract(n.decision_json, '$.workflow') = ?) ORDER BY n.opened_at, n.key",
        )
        .all(project, needRepo(repo), workflow, workflow, workflow, workflow)
        .map(toNeed)

/** The fields of a need a change writes. */
export interface NeedPatch {
    readonly scope?: NeedScope
    readonly level?: NeedLevel | null
    readonly state?: NeedState
    readonly round?: number
    readonly decision?: NeedDecisionRef | null
    readonly owner?: NeedOwner | null
    readonly resolver?: NeedResolver | null
    readonly reason?: string | null
    readonly mergedInto?: string | null
    readonly routedAt?: string | null
    readonly resolvedAt?: string | null
}

const COLUMNS: Readonly<Record<keyof NeedPatch, string>> = {
    scope: "scope",
    level: "level",
    state: "state",
    round: "round",
    decision: "decision_json",
    owner: "owner_json",
    resolver: "resolver_json",
    reason: "reason",
    mergedInto: "merged_into",
    routedAt: "routed_at",
    resolvedAt: "resolved_at",
}

const JSON_FIELDS: ReadonlySet<string> = new Set(["decision", "owner", "resolver"])

/** Records a host event about a need (`need-<what>`, subject `<project>|<key>`): every move of a need has its evidence. */
export const recordNeedEvent = (db: DatabaseSync, what: string, project: string, key: string, data: unknown): void => {
    db.prepare("INSERT INTO host_events (at, kind, subject, data_json) VALUES (?, ?, ?, ?)").run(now(), `need-${what}`, `${project}|${key}`, JSON.stringify(data))
}

/** Writes a change to a need and records it as a `need-<what>` event; returns the need as it now stands. */
export const patchNeed = (db: DatabaseSync, project: string, key: string, patch: NeedPatch, what: string): NeedRow => {
    const entries = Object.entries(patch) as [keyof NeedPatch, unknown][]
    const sets = entries.map(([field]) => `${COLUMNS[field]} = ?`)
    const values = entries.map(([field, value]) => (JSON_FIELDS.has(field) ? (value === null ? null : JSON.stringify(value)) : (value as string | number | null)))
    db.prepare(`UPDATE shared_needs SET ${[...sets, "updated_at = ?"].join(", ")} WHERE project = ? AND key = ?`).run(...values, now(), project, key)
    const need = needOf(db, project, key)
    if (need === undefined) throw new Refusal("NEED_UNKNOWN", `no need ${key} in project ${project}`)
    recordNeedEvent(db, what, project, key, { ...patch, state: need.state, round: need.round })
    return need
}

/**
 * Reopens a need: a new round with no decision, owner or resolver, routed again at `level` (its router) by the next step. A
 * resolver that failed, a cycle, or a report of a need that ended all reopen it.
 */
export const reopenNeed = (db: DatabaseSync, need: NeedRow, reason: string, level: NeedLevel | null = need.level): NeedRow =>
    patchNeed(db, need.project, need.key, { state: "open", round: need.round + 1, decision: null, owner: null, resolver: null, reason, level, routedAt: null, resolvedAt: null }, "reopened")

/** Where a reporting task lives. */
export interface WaiterPlace {
    readonly project: string
    readonly repo: string
    readonly workflow: string | null
    readonly task: string
    readonly taskKey: string | null
}

/** What attaching a report did: the need it joined (after any merge), whether it opened the need, and whether the task was new to it. */
export interface Attached {
    readonly need: NeedRow
    readonly opened: boolean
    readonly attached: boolean
}

/**
 * Attaches one reporting task to its need, opening the need once per (project, key): every later report of the key adds a waiter
 * row and nothing else. A key merged into another attaches to that one; a need that ended (resolved or rejected) and is reported
 * by a task new to it opens again in a new round, since the report says the resolution did not hold.
 */
export const attachWaiter = (db: DatabaseSync, report: NeedReport, place: WaiterPlace): Attached => {
    let key = report.key
    let need = needOf(db, place.project, key)
    if (need?.state === "merged" && need.mergedInto !== null) {
        key = need.mergedInto
        need = needOf(db, place.project, key)
    }
    const at = now()
    let opened = false
    if (need === undefined) {
        db.prepare("INSERT INTO shared_needs (project, key, scope, level, state, round, opened_at, updated_at) VALUES (?, ?, 'workflow', NULL, 'open', 1, ?, ?)").run(place.project, key, at, at)
        opened = true
    }
    const inserted = db
        .prepare(
            "INSERT INTO shared_need_waiters (project, key, repo, workflow_id, task_id, task_key, given_key, rules_json, paths_json, note, reported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
        )
        .run(place.project, key, needRepo(place.repo), place.workflow, place.task, place.taskKey, report.given, JSON.stringify(report.rules), JSON.stringify(report.paths), report.note, at)
    const attached = inserted.changes > 0
    let current = needOf(db, place.project, key)
    if (current === undefined) throw new Refusal("NEED_UNKNOWN", `need ${key} vanished from the host store`)
    if (opened) recordNeedEvent(db, "opened", place.project, key, { task: place.task, workflow: place.workflow, repo: place.repo })
    if (attached && !opened) {
        recordNeedEvent(db, "attached", place.project, key, { task: place.task, workflow: place.workflow, repo: place.repo })
        if (current.state === "resolved" || current.state === "rejected") current = reopenNeed(db, current, `task ${place.task} reported ${key} again after it was ${current.state}`)
    }
    return { need: current, opened, attached }
}

/** Records the reports of a task in the host store, each in its own transaction; returns what each attach did. */
export const reportNeeds = (reports: readonly NeedReport[], place: WaiterPlace): Attached[] => reports.map((report) => withMachine((db) => attachWaiter(db, report, place)))

/**
 * Folds need `from` into need `into`: its waiters move to `into` (a task waiting on both keeps one row), `from` ends `merged`
 * and names `into`, and a later report of `from` attaches to `into`. Both must exist and differ; NEED_UNKNOWN otherwise.
 */
export const mergeNeeds = (db: DatabaseSync, project: string, into: string, from: string, by: string): { readonly into: NeedRow; readonly from: NeedRow; readonly moved: number } => {
    if (into === from) throw new Refusal("NEED_MERGE_SAME", `${into} is one need; name two keys`)
    const target = needOf(db, project, into)
    const source = needOf(db, project, from)
    if (target === undefined || source === undefined) throw new Refusal("NEED_UNKNOWN", `no need ${target === undefined ? into : from} in this project; starci needs list names them`)
    if (target.state === "merged") throw new Refusal("NEED_MERGED", `${into} was merged into ${target.mergedInto ?? "?"}; merge into that key`)
    const moved = db.prepare("UPDATE OR IGNORE shared_need_waiters SET key = ? WHERE project = ? AND key = ?").run(into, project, from).changes
    db.prepare("DELETE FROM shared_need_waiters WHERE project = ? AND key = ?").run(project, from)
    const merged = patchNeed(db, project, from, { state: "merged", mergedInto: into, reason: `merged into ${into} by ${by}` }, "merged")
    db.prepare("UPDATE shared_needs SET merged_into = ? WHERE project = ? AND merged_into = ?").run(into, project, from)
    // Waiters that joined a need which ended get it routed again: their report says what they still miss.
    const joined = target.state === "resolved" || target.state === "rejected" ? reopenNeed(db, target, `${from} was merged into it after it was ${target.state}`) : (needOf(db, project, into) ?? target)
    return { into: joined, from: merged, moved: Number(moved) }
}

/** One cross-branch relay of a need's resolving commits onto a waiting workflow's branch, as its host event recorded it. */
export interface RelayRecord {
    readonly at: string
    readonly workflow: string
    readonly round: number
    readonly branch: string
    readonly status: string
    readonly relayed: readonly { readonly from: string; readonly to: string }[]
    readonly files: readonly string[]
}

/** The relays of a need, oldest first (core/needs/tend.ts records them as `need-relayed` and `need-relay-conflict`). */
export const relaysOf = (project: string, key: string): RelayRecord[] =>
    readMachine((db) => db.prepare("SELECT at, data_json FROM host_events WHERE kind IN ('need-relayed', 'need-relay-conflict') AND subject = ? ORDER BY id").all(`${project}|${key}`), []).map((row) => {
        const data = JSON.parse(String(row.data_json)) as { readonly workflow: string; readonly round: number; readonly branch: string; readonly relay: { readonly status: string; readonly relayed: RelayRecord["relayed"]; readonly files: readonly string[] } }
        return { at: String(row.at), workflow: data.workflow, round: data.round, branch: data.branch, status: data.relay.status, relayed: data.relay.relayed, files: data.relay.files }
    })

/** A repository path as the needs store keeps and compares it: absolute, with forward slashes. */
export const needRepo = (path: string): string => resolve(path).replaceAll("\\", "/")

/** True when two repository paths name one checkout (case-insensitive, as Windows paths are). */
export const sameRepo = (left: string, right: string): boolean => resolve(left).toLowerCase() === resolve(right).toLowerCase()

