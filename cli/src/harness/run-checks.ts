import { existsSync, globSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { captureCommand, captureTool } from "../shared/exec.js"
import type { ToolRun } from "../shared/exec.js"
import { changedFiles } from "../shared/git.js"
import { RESULT_FILE, underPaths } from "./contract.js"
import type { Contract, ResolvedCheck } from "./contract.js"
import { now, openExistingLedger } from "./ledger.js"
import { TERMINAL_STATUSES } from "./tasks.js"

/** The verdict of one check. */
export interface CheckOutcome {
    readonly name: string
    readonly kind: string
    readonly status: "green" | "red"
    readonly exitCode: number | null
    readonly detail: string
}

/** What a `@result` json check reads: the worker's output, or why there is none to read. */
export type ResultSource = { readonly output: unknown; readonly from: string } | { readonly missing: string }

/**
 * Where the checks of one contract run and what they compare against: `diffBase` is the base a `starci check` verb diffs
 * (the candidate's parent in a clean verify), `timeoutMs` bounds every process a check starts, `result` feeds `@result`
 * json checks, and `taskId` and `since` scope the files check of the work tree.
 */
export interface CheckPlace {
    readonly root: string
    readonly cwd: string
    readonly diffBase?: string
    readonly timeoutMs?: number
    readonly result?: ResultSource
    readonly taskId?: string
    readonly since?: string
}

const DETAIL_LINES = 30

const PROBE_TIMEOUT_MS = 10_000

/** The `starci check` verbs that take `--base` and answer with scope steps. */
const SCOPED_CHECK_VERBS = ["run", "lint", "typecheck"]

const tailOf = (run: ToolRun): string => [run.stdout, run.stderr].filter((text) => text !== "").join("\n").split("\n").slice(-DETAIL_LINES).join("\n")

/** This CLI's own entry, so a `starci` check runs the same build that verifies. */
const selfEntry = (): string => fileURLToPath(new URL("../main.js", import.meta.url))

const fromRun = (check: ResolvedCheck, run: ToolRun): CheckOutcome => ({
    name: check.name,
    kind: check.check.kind,
    status: run.exitCode === 0 ? "green" : "red",
    exitCode: run.exitCode,
    detail: tailOf(run),
})

const outcome = (check: ResolvedCheck, problems: readonly string[], greenDetail: string): CheckOutcome => ({
    name: check.name,
    kind: check.check.kind,
    status: problems.length === 0 ? "green" : "red",
    exitCode: null,
    detail: problems.length === 0 ? greenDetail : problems.join("\n"),
})

const LIST_SHOWN = 20

const listed = (files: readonly string[]): string => `${files.slice(0, LIST_SHOWN).join(", ")}${files.length > LIST_SHOWN ? ` and ${String(files.length - LIST_SHOWN)} more` : ""}`

/** The paths leased by other live tasks (read straight from the ledger, which this never creates); their writers are someone else. */
const otherLeasedPaths = (root: string, taskId: string | undefined): string[] => {
    const db = openExistingLedger(root)
    if (db === undefined) return []
    try {
        const terminal = TERMINAL_STATUSES.map(() => "?").join(", ")
        return db
            .prepare(`SELECT leases.path FROM leases JOIN tasks ON tasks.id = leases.task_id WHERE leases.expires_at > ? AND leases.task_id <> ? AND tasks.status NOT IN (${terminal})`)
            .all(now(), taskId ?? "", ...TERMINAL_STATUSES)
            .map((row) => String(row.path))
    } finally {
        db.close()
    }
}

/** Work-tree files outside a task's allowPaths: `written` could be the task's (changed since it began, or undatable), `older` predate it. */
export interface StrayFiles {
    readonly written: readonly string[]
    readonly older: readonly string[]
}

/**
 * Dirty and untracked files of the work tree at `root` (against HEAD) that lie outside `allowPaths` and outside the paths
 * other live tasks lease. With `since`, a file last written before it is not the task's.
 */
export const strayFiles = async (root: string, allowPaths: readonly string[], scope: { readonly taskId?: string; readonly since?: string }): Promise<StrayFiles> => {
    const leased = otherLeasedPaths(root, scope.taskId)
    const outside = (await changedFiles(root, "HEAD")).filter((file) => !underPaths(file, allowPaths) && !underPaths(file, leased))
    const sinceMs = scope.since === undefined ? undefined : Date.parse(scope.since)
    const written: string[] = []
    const older: string[] = []
    for (const file of outside) {
        const path = join(root, file)
        // A deleted file has no date, so the task cannot be cleared of it.
        const mtime = existsSync(path) ? statSync(path).mtimeMs : undefined
        if (sinceMs !== undefined && mtime !== undefined && mtime < sinceMs) older.push(file)
        else written.push(file)
    }
    return { written, older }
}

/** The files check of the work tree as it is (the dry replay): what the task may have written outside its allowPaths, plus mustExist. */
const runFilesCheck = async (check: ResolvedCheck & { readonly check: { readonly kind: "files" } }, contract: Contract, place: CheckPlace): Promise<CheckOutcome> => {
    const problems: string[] = []
    const notes: string[] = []
    if (check.check.onlyAllowPaths === true) {
        const stray = await strayFiles(place.root, contract.context.allowPaths, { ...(place.taskId === undefined ? {} : { taskId: place.taskId }), ...(place.since === undefined ? {} : { since: place.since }) })
        if (stray.written.length > 0) problems.push(`changed outside allowPaths: ${listed(stray.written)}`)
        if (stray.older.length > 0) notes.push(`outside allowPaths but older than the task, not judged: ${listed(stray.older)}`)
    }
    for (const pattern of check.check.mustExist ?? []) {
        const present = /[*?[\]{}]/.test(pattern) ? globSync(pattern, { cwd: place.cwd }).length > 0 : existsSync(join(place.cwd, pattern))
        if (!present) problems.push(`missing: ${pattern}`)
    }
    return { ...outcome(check, problems, ""), detail: [...(problems.length === 0 ? ["files as expected"] : problems), ...notes].join("\n") }
}

const readJsonDocument = (file: string, place: CheckPlace): { readonly value: unknown; readonly from: string } | { readonly problem: string } => {
    if (file === RESULT_FILE) {
        const source = place.result
        if (source === undefined) return { problem: `${RESULT_FILE} has no task result to read here; verify the task, or name it: starci task verify <task> --contract <file>` }
        if ("missing" in source) return { problem: source.missing }
        return { value: source.output, from: source.from }
    }
    const path = join(place.cwd, file)
    if (!existsSync(path)) return { problem: `missing: ${file}` }
    try {
        return { value: JSON.parse(readFileSync(path, "utf8")), from: file }
    } catch (error: unknown) {
        return { problem: `${file} is not json: ${error instanceof Error ? error.message : String(error)}` }
    }
}

const runJsonCheck = (check: ResolvedCheck & { readonly check: { readonly kind: "json" } }, place: CheckPlace): CheckOutcome => {
    const document = readJsonDocument(check.check.file, place)
    if ("problem" in document) return outcome(check, [document.problem], "")
    const record = typeof document.value === "object" && document.value !== null ? (document.value as Record<string, unknown>) : {}
    const missing = check.check.requiredKeys.filter((key) => !(key in record))
    return outcome(check, missing.length === 0 ? [] : [`${document.from} lacks keys: ${missing.join(", ")}`], `${document.from} carries ${String(check.check.requiredKeys.length)} required key(s)`)
}

const runProbeCheck = async (check: ResolvedCheck & { readonly check: { readonly kind: "probe" } }): Promise<CheckOutcome> => {
    try {
        const response = await fetch(check.check.url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
        const expected = check.check.status
        return outcome(check, response.status === expected ? [] : [`${check.check.url} answered ${String(response.status)}, expected ${String(expected)}`], `${check.check.url} answered ${String(expected)}`)
    } catch (error: unknown) {
        return outcome(check, [`${check.check.url} unreachable: ${error instanceof Error ? error.message : String(error)}`], "")
    }
}

interface ScopeStep {
    readonly package: string
    readonly step: string
    readonly status: string
    readonly reason: string
    readonly output: string
}

const asRecord = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {})

const textOf = (value: unknown): string => (typeof value === "string" ? value : "")

const stepsOf =(data: Record<string, unknown>): ScopeStep[] =>
    (Array.isArray(data.steps) ? (data.steps as unknown[]) : []).map((raw) => {
        const step = asRecord(raw)
        return { package: textOf(step.package), step: textOf(step.step), status: textOf(step.status), reason: textOf(step.reason), output: textOf(step.output) }
    })

/**
 * A scoped `starci check` verb, run with --json so its steps can be read: a step that only skipped proves nothing, so the
 * check is red when no step ran at all (no changed package, or every package lacks its tsconfig and ESLint config).
 */
const runScopedCheck = async (check: ResolvedCheck, args: readonly string[], place: CheckPlace): Promise<CheckOutcome> => {
    const withBase = place.diffBase === undefined || args.includes("--base") ? args : [...args, "--base", place.diffBase]
    const run = await captureTool(process.execPath, [selfEntry(), "--json", "--cwd", place.cwd, ...withBase], place.cwd, place.timeoutMs === undefined ? {} : { timeoutMs: place.timeoutMs })
    let envelope: Record<string, unknown>
    try {
        envelope = asRecord(JSON.parse(run.stdout))
    } catch {
        return fromRun(check, run)
    }
    if (envelope.ok !== true) return { ...fromRun(check, run), status: "red", detail: `${String(envelope.code)}: ${String(envelope.message)}` }
    const data = asRecord(envelope.data)
    const scope = asRecord(data.scope)
    const steps = stepsOf(data)
    const ran = steps.filter((step) => step.status !== "skipped")
    const lines = [
        `scope vs ${String(scope.base)}: ${String(Array.isArray(scope.changed) ? scope.changed.length : 0)} changed file(s), ${String(Array.isArray(scope.targets) ? scope.targets.length : 0)} package(s)`,
        ...steps.map((step) => `${step.status} ${step.step} ${step.package}${step.reason === "" ? "" : ` (${step.reason})`}`),
        ...(ran.length === 0 ? ["no step ran: nothing was typechecked or linted, so this check proves nothing"] : []),
        ...steps.filter((step) => step.status === "red").map((step) => `--- ${step.package} ${step.step}\n${step.output}`),
    ]
    return { name: check.name, kind: check.check.kind, status: run.exitCode === 0 && ran.length > 0 ? "green" : "red", exitCode: run.exitCode, detail: lines.join("\n") }
}

/** Runs one primitive check of a contract. A missing tool or file is a red check, never a crash of the verify. */
export const runCheck = async (check: ResolvedCheck, contract: Contract, place: CheckPlace): Promise<CheckOutcome> => {
    const primitive = check.check
    const options = place.timeoutMs === undefined ? {} : { timeoutMs: place.timeoutMs }
    switch (primitive.kind) {
        case "starci": {
            const [group, verb] = primitive.args
            if (group === "check" && verb !== undefined && SCOPED_CHECK_VERBS.includes(verb)) return runScopedCheck(check, primitive.args, place)
            return fromRun(check, await captureTool(process.execPath, [selfEntry(), "--cwd", place.cwd, ...primitive.args], place.cwd, options))
        }
        case "command": {
            const argv = Array.isArray(primitive.run) ? primitive.run : primitive.run.split(/\s+/).filter((part) => part !== "")
            try {
                return fromRun(check, await captureCommand(argv, place.cwd, options))
            } catch (error: unknown) {
                return outcome(check, [error instanceof Error ? error.message : String(error)], "")
            }
        }
        case "files":
            return runFilesCheck({ ...check, check: primitive }, contract, place)
        case "json":
            return runJsonCheck({ ...check, check: primitive }, place)
        case "probe":
            return runProbeCheck({ ...check, check: primitive })
    }
}
