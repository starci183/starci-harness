import { existsSync, globSync, readFileSync, statSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import { fileURLToPath } from "node:url"
import { captureCommand, captureTool } from "../shared/exec.js"
import type { ToolRun } from "../shared/exec.js"
import { changedFiles } from "../shared/git.js"
import { RESULT_FILE, isRuleId, ruleIdsIn, underPaths } from "./contract.js"
import type { Contract, ResolvedCheck } from "./contract.js"
import { now, openExistingLedger } from "./ledger.js"
import type { OutputType } from "./ops.js"
import { TERMINAL_STATUSES } from "./tasks.js"
import { judgeUatResult, parseUatRecord, runFiles } from "./work.js"

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
 * json checks, and `taskId` and `since` scope the files check of the work tree. `source` is the work tree a clean checkout
 * was built from (default `root`): a uat run folder is git-ignored, so it is read there and never from the candidate.
 */
export interface CheckPlace {
    readonly root: string
    readonly cwd: string
    readonly diffBase?: string
    readonly timeoutMs?: number
    readonly result?: ResultSource
    readonly taskId?: string
    readonly since?: string
    readonly source?: string
}

const DETAIL_LINES = 30

const PROBE_TIMEOUT_MS = 10_000

/** The `starci check` verbs that take `--base` and answer with scope steps. */
const SCOPED_CHECK_VERBS: ReadonlySet<string> = new Set(["run", "lint", "typecheck"])

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

const listed = (files: readonly string[]): string => {
    const more = files.length > LIST_SHOWN ? " and " + String(files.length - LIST_SHOWN) + " more" : ""
    return `${files.slice(0, LIST_SHOWN).join(", ")}${more}`
}

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

const hasType = (value: unknown, type: OutputType): boolean => {
    switch (type) {
        case "string":
        case "number":
        case "boolean":
            return typeof value === type
        case "object":
            return typeof value === "object" && value !== null && !Array.isArray(value)
        case "array":
            return Array.isArray(value)
        case "string[]":
            return Array.isArray(value) && value.every((item) => typeof item === "string")
    }
}

const runJsonCheck = (check: ResolvedCheck & { readonly check: { readonly kind: "json" } }, place: CheckPlace): CheckOutcome => {
    const document = readJsonDocument(check.check.file, place)
    if ("problem" in document) return outcome(check, [document.problem], "")
    const record = typeof document.value === "object" && document.value !== null ? (document.value as Record<string, unknown>) : {}
    const missing = check.check.requiredKeys.filter((key) => !(key in record))
    const mistyped = Object.entries(check.check.types ?? {})
        .filter(([key, type]) => key in record && !hasType(record[key], type))
        .map(([key, type]) => `${key} is ${Array.isArray(record[key]) ? "an array" : typeof record[key]}, expected ${type}`)
    const expected = Object.entries(check.check.expect ?? {})
    const wrong = expected.filter(([key, value]) => record[key] !== value).map(([key, value]) => `${key} is ${JSON.stringify(record[key])}, expected ${JSON.stringify(value)}`)
    const problems = [...(missing.length === 0 ? [] : [`${document.from} lacks keys: ${missing.join(", ")}`]), ...[...mistyped, ...wrong].map((line) => `${document.from}: ${line}`)]
    const andExpected = expected.length === 0 ? "" : " and " + String(expected.length) + " expected value(s)"
    return outcome(check, problems, `${document.from} carries ${String(check.check.requiredKeys.length)} required key(s)${andExpected}`)
}

/** The ids a file names, or every yaml file under a folder (a Work scope the task wrote); a path the checkout lacks names none. */
const idsAt = (path: string): Set<string> => {
    if (!existsSync(path)) return new Set<string>()
    if (!statSync(path).isDirectory()) return ruleIdsIn(readFileSync(path, "utf8"))
    return new Set(globSync("**/*.yaml", { cwd: path }).flatMap((file) => [...ruleIdsIn(readFileSync(join(path, file), "utf8"))]))
}

/** The ids each traced file or folder names, read once per check. */
const idsOfFiles = (files: readonly string[], place: CheckPlace): Map<string, Set<string>> =>
    new Map(files.map((file) => [file, idsAt(isAbsolute(file) ? file : join(place.root, file))]))

/**
 * The read trace: every id the filed result cites under a traced key (rulesApplied, workRecords) is named by one of the task's
 * context files (for a Work key, also a record under the task's own Work allowPaths), literally as a heading token or a yaml `id:`, and the key cites at least as many ids as its op requires.
 */
const runCitedCheck = (check: ResolvedCheck & { readonly check: { readonly kind: "cited" } }, place: CheckPlace): CheckOutcome => {
    const document = readJsonDocument(RESULT_FILE, place)
    if ("problem" in document) return outcome(check, [document.problem], "")
    const record = typeof document.value === "object" && document.value !== null ? (document.value as Record<string, unknown>) : {}
    const problems: string[] = []
    const found: string[] = []
    for (const trace of check.check.trace ?? []) {
        const traced = traceProblems(trace, record[trace.key] ?? [], place)
        problems.push(...traced.problems)
        found.push(...traced.found)
    }
    return outcome(check, problems, found.length === 0 ? "no id cited, none required" : `cited: ${listed(found)}`)
}

interface CitedTrace {
    readonly key: string
    readonly minItems: number
    readonly files: readonly string[]
}

/** What one traced key cites: the ids found in a context file, and the problems of the ones that are not. */
const traceProblems = (trace: CitedTrace, value: unknown, place: CheckPlace): { readonly problems: string[]; readonly found: string[] } => {
    const problems: string[] = []
    const found: string[] = []
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return { problems: [`${trace.key} is not a list of ids`], found }
    if (value.length < trace.minItems) problems.push(`${trace.key} cites ${String(value.length)} id(s); the op requires at least ${String(trace.minItems)}`)
    const files = idsOfFiles(trace.files, place)
    const context = trace.files.length === 0 ? "none" : listed(trace.files)
    for (const id of value) {
        const owner = [...files].find(([, ids]) => ids.has(id))?.[0]
        if (owner !== undefined) found.push(`${id} in ${owner}`)
        else if (!isRuleId(id)) problems.push(`${trace.key}: "${id}" is not a rule id`)
        else problems.push(`${trace.key}: ${id} is named by none of the context files (${context})`)
    }
    return { problems, found }
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

/**
 * A uat walk: the filed result judged against the Work record of the candidate and the files of the run folder in the source
 * work tree (harness/work.ts judgeUatResult); red names every mismatch, the first failing step first.
 */
const runUatFlowCheck = (check: ResolvedCheck & { readonly check: { readonly kind: "uat-flow" } }, place: CheckPlace): CheckOutcome => {
    const { record: recordPath, run } = check.check
    const file = join(place.root, recordPath)
    if (!existsSync(file)) return outcome(check, [`missing: ${recordPath}`], "")
    const document = readJsonDocument(RESULT_FILE, place)
    if ("problem" in document) return outcome(check, [document.problem], "")
    let judged
    try {
        judged = judgeUatResult(parseUatRecord(readFileSync(file, "utf8"), recordPath), document.value, new Set(runFiles(join(place.source ?? place.root, run))))
    } catch (error: unknown) {
        return outcome(check, [error instanceof Error ? error.message : String(error)], "")
    }
    const problems = judged.problems.map((problem) => problem.text)
    return outcome(check, judged.failingStep === undefined ? problems : [`first failing step: ${String(judged.failingStep)}`, ...problems], `${document.from} walks every step of ${recordPath} with its screenshots in ${run}`)
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
        ...steps.map((step) => `${step.status} ${step.step} ${step.package}${step.reason === "" ? "" : " (" + step.reason + ")"}`),
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
            if (group === "check" && verb !== undefined && SCOPED_CHECK_VERBS.has(verb)) return runScopedCheck(check, primitive.args, place)
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
        case "uat-flow":
            return runUatFlowCheck({ ...check, check: primitive }, place)
        case "cited":
            return runCitedCheck({ ...check, check: primitive }, place)
    }
}
