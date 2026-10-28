import { existsSync, globSync, readFileSync, statSync } from "node:fs"
import { isAbsolute, join, posix } from "node:path"
import { fileURLToPath } from "node:url"
import { captureCommand, captureTool } from "../shared/exec.js"
import type { ToolRun } from "../shared/exec.js"
import { changedFiles } from "../shared/git.js"
import { evidenceTail } from "../shared/output.js"
import { ownChanges } from "./baseline.js"
import { judgeCites } from "./cite.js"
import { testWorkerArgs, withHeavySlot } from "./heavy.js"
import { changedCoverageScope, runsJest, withCoverageArgs } from "./coverage-scope.js"
import { RESULT_FILE, isRuleId, ruleIdsIn, underPaths, workNamesIn } from "./contract.js"
import type { Contract, ResolvedCheck } from "./contract.js"
import type { OutputType } from "./ops.js"
import { ruleOwnerOf } from "./rule-pages.js"
import { WORK_DIR, judgeUatWalk, parseUatRecord, recordFileOfId } from "./work.js"

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
    /** A scoped `starci check` judges only the changed files under the paths it is handed (`--within`): a wave's landed union. */
    readonly within?: boolean
    /** The wave's tasks a scoped `starci check run` judges for (`--wave`): their composition deferrals and obligations. */
    readonly wave?: readonly string[]
}

const PROBE_TIMEOUT_MS = 10_000

/** The `starci check` verbs that take `--base` and answer with scope steps. */
const SCOPED_CHECK_VERBS: ReadonlySet<string> = new Set(["run", "lint", "typecheck"])

const tailOf = (run: ToolRun): string => evidenceTail(run.stdout, run.stderr)

/** A command check's argv (a test runner, a suite, a build) runs under a host heavy-command slot, a test runner at its worker count (harness/heavy.ts). */
const heavyCommand = (argv: readonly string[], cwd: string, options: { readonly timeoutMs?: number }): Promise<ToolRun> =>
    withHeavySlot("test", argv.slice(0, 3).join(" "), cwd, options, (held) => captureCommand(testWorkerArgs(argv, held), cwd, held.options))

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

/** Work-tree files outside a task's allowPaths: `written` are the task's (changed since its work began, or undatable), `older` were there before it. */
export interface StrayFiles {
    readonly written: readonly string[]
    readonly older: readonly string[]
}

/** The note naming the stray files a task is cleared of. */
export const olderNote = (older: readonly string[]): string => `outside allowPaths but there before the task's work began, not judged: ${listed(older)}`

/**
 * Dirty and untracked files of the work tree at `root` (against HEAD) that lie outside `allowPaths`, split by whose they are
 * (an Op worktree holds only its own task's work): a task with a baseline (harness/baseline.ts) owns only the files changed
 * since its work began; one without owns the files written since `since`, and every file without a date.
 */
export const strayFiles = async (root: string, allowPaths: readonly string[], scope: { readonly taskId?: string; readonly since?: string }): Promise<StrayFiles> => {
    const outside = (await changedFiles(root, "HEAD")).filter((file) => !underPaths(file, allowPaths))
    const own = scope.taskId === undefined ? undefined : await ownChanges(root, scope.taskId)
    if (own !== undefined) return { written: outside.filter((file) => own.has(file)), older: outside.filter((file) => !own.has(file)) }
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
        if (stray.older.length > 0) notes.push(olderNote(stray.older))
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
 * context files, literally as a heading token or a yaml `id:`, and the key cites at least as many ids as its op requires. A Work
 * key reads its Work context files and the records under its own Work allowPaths, and also a record of the checkout that one
 * of those context files or the contract's inputs points at (readableWork).
 */
const runCitedCheck = (check: ResolvedCheck & { readonly check: { readonly kind: "cited" } }, place: CheckPlace): CheckOutcome => {
    const document = readJsonDocument(RESULT_FILE, place)
    if ("problem" in document) return outcome(check, [document.problem], "")
    const record = typeof document.value === "object" && document.value !== null ? (document.value as Record<string, unknown>) : {}
    const problems: string[] = []
    const found: string[] = []
    for (const trace of check.check.trace ?? []) {
        const traced = traceProblems(trace, record[trace.key] ?? [], place, check.check.harness)
        problems.push(...traced.problems)
        found.push(...traced.found)
    }
    return outcome(check, problems, found.length === 0 ? "no id cited, none required" : `cited: ${listed(found)}`)
}

interface CitedTrace {
    readonly key: string
    readonly minItems: number
    readonly files: readonly string[]
    readonly cites?: "context" | "work" | undefined
    readonly named?: readonly string[] | undefined
}

/** The record files a Work name may point at: a Work id's record, a named record file, or a named folder's record. */
const recordFilesOf = (name: string): string[] => {
    if (!name.startsWith(`${WORK_DIR}/`)) {
        const file = recordFileOfId(name)
        return file === undefined ? [] : [file]
    }
    return /\.ya?ml$/.test(name) ? [name] : [posix.join(name, "index.yaml"), posix.join(name, "resource.yaml")]
}

/**
 * The Work records a Work key may cite beyond its traced files: each record of the checkout that a traced Work file (a context
 * file, never a whole allowPath folder) or the contract's inputs (`named`) points at by id or path, keyed by the ids its file
 * names. Only a named record counts, so a task never cites the whole Work tree.
 */
const readableWork = (trace: CitedTrace, place: CheckPlace): Map<string, Set<string>> => {
    const names = new Map<string, string>()
    for (const file of trace.files) {
        const path = isAbsolute(file) ? file : join(place.root, file)
        if (!existsSync(path) || statSync(path).isDirectory()) continue
        for (const name of workNamesIn(readFileSync(path, "utf8"))) if (!names.has(name)) names.set(name, file)
    }
    for (const name of trace.named ?? []) if (!names.has(name)) names.set(name, "the inputs")
    const records = new Map<string, Set<string>>()
    for (const [name, by] of names) {
        const file = recordFilesOf(name).find((candidate) => {
            const path = join(place.root, candidate)
            return existsSync(path) && !statSync(path).isDirectory()
        })
        if (file === undefined || trace.files.includes(file)) continue
        const key = `${file} (named by ${by})`
        if (!records.has(key)) records.set(key, idsAt(join(place.root, file)))
    }
    return records
}

/**
 * The problem of a rule id no context file names: the contexts page of `harness` that owns it when there is one, which points
 * at a brief that left that page out, else the context files it was looked for in.
 */
const unnamedRule = (key: string, id: string, context: string, harness: string | undefined): string => {
    const owner = harness === undefined ? undefined : ruleOwnerOf(harness, id)
    if (owner === undefined) return `${key}: ${id} is named by none of the context files (${context})`
    return `${key}: ${id} is owned by ${owner}, which the brief did not include (context files: ${context})`
}

/** What one traced key cites: the ids found in a context file (or a Work record the task may read), and the problems of the ones that are not. */
const traceProblems = (trace: CitedTrace, value: unknown, place: CheckPlace, harness: string | undefined): { readonly problems: string[]; readonly found: string[] } => {
    const problems: string[] = []
    const found: string[] = []
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return { problems: [`${trace.key} is not a list of ids`], found }
    if (value.length < trace.minItems) problems.push(`${trace.key} cites ${String(value.length)} id(s); the op requires at least ${String(trace.minItems)}`)
    const work = trace.cites === "work"
    const files = idsOfFiles(trace.files, place)
    const pointed = work ? readableWork(trace, place) : new Map<string, Set<string>>()
    const context = trace.files.length === 0 ? "none" : listed(trace.files)
    const looked = `looked in ${trace.files.length === 0 ? "no Work file" : listed(trace.files)}; records they or the inputs name: ${pointed.size === 0 ? "none" : listed([...pointed.keys()])}`
    for (const id of value) {
        const owner = [...files, ...pointed].find(([, ids]) => ids.has(id))?.[0]
        if (owner !== undefined) found.push(`${id} in ${owner}`)
        else if (work) problems.push(`${trace.key}: "${id}" names no Work record readable by this task (${looked})`)
        else if (!isRuleId(id)) problems.push(`${trace.key}: "${id}" is not a rule id`)
        else problems.push(unnamedRule(trace.key, id, context, harness))
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
 * A uat walk (T1): the Work record of the candidate against the observations the script wrote during a receipted `starci uat run`
 * into the run folder of the source work tree, which is git-ignored (harness/work.ts judgeUatWalk). The filed result only has to
 * agree; red names every mismatch, the first failing step first.
 */
const runUatFlowCheck = (check: ResolvedCheck & { readonly check: { readonly kind: "uat-flow" } }, place: CheckPlace): CheckOutcome => {
    const { record: recordPath, run } = check.check
    const file = join(place.root, recordPath)
    if (!existsSync(file)) return outcome(check, [`missing: ${recordPath}`], "")
    const document = readJsonDocument(RESULT_FILE, place)
    if ("problem" in document) return outcome(check, [document.problem], "")
    let judged
    try {
        judged = judgeUatWalk(parseUatRecord(readFileSync(file, "utf8"), recordPath), join(place.source ?? place.root, run), document.value)
    } catch (error: unknown) {
        return outcome(check, [error instanceof Error ? error.message : String(error)], "")
    }
    const problems = judged.problems.map((problem) => problem.text)
    return outcome(check, judged.failingStep === undefined ? problems : [`first failing step: ${String(judged.failingStep)}`, ...problems], `the receipted run in ${run} walks every step of ${recordPath}, and ${document.from} agrees`)
}

/**
 * A command whose exit the filed result's verdict must agree with (T0): the harness runs the suite on the clean checkout, and the
 * check is green when the worker reported what the run did, passed for exit 0 and failed for any other, so a red suite reported
 * honestly is a finding and a claim the run contradicts is red.
 */
const runVerdictCommand = async (check: ResolvedCheck, argv: readonly string[], key: string, place: CheckPlace, options: { readonly timeoutMs?: number }): Promise<CheckOutcome> => {
    const run = await heavyCommand(argv, place.cwd, options)
    const observed = run.exitCode === 0 ? "passed" : "failed"
    const document = readJsonDocument(RESULT_FILE, place)
    const claimed = "problem" in document ? undefined : asRecord(document.value)[key]
    const ran = `${argv.join(" ")} exited ${String(run.exitCode)} (${observed})${run.timedOut ? ", killed at the deadline" : ""}`
    if (claimed === observed) return { ...fromRun(check, run), status: "green", detail: `${ran}; the result's ${key} agrees\n${tailOf(run)}` }
    const why = "problem" in document ? document.problem : `the result's ${key} is ${JSON.stringify(claimed)}, but the harness saw ${observed}`
    return { ...fromRun(check, run), status: "red", detail: `${ran}; ${why}\n${tailOf(run)}` }
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
 * A scoped `starci check` verb, run with --json so its steps can be read. It judges what the task changed, or, for a task that
 * changes nothing (a verify-only task whose audit found the code already right), the tracked files under its allowPaths as
 * they stand: the gates and the lint over what the task was asked to prove. A step that only skipped proves nothing, so the
 * check is red when no step ran at all (no package in that scope, or every package lacks its tsconfig and ESLint config).
 */
const runScopedCheck = async (check: ResolvedCheck, args: readonly string[], place: CheckPlace, allowPaths: readonly string[]): Promise<CheckOutcome> => {
    const withBase = place.diffBase === undefined || args.includes("--base") ? args : [...args, "--base", place.diffBase]
    // check run judges as the task: its own changes since its work began, its deferral and its obligations (core/check/scope.ts).
    // A wave's run judges as its tasks together: their deferrals and the modules their composers answer for.
    const judging = args[1] !== "run" || withBase.includes("--task") || withBase.includes("--wave") ? [] : place.taskId !== undefined ? ["--task", place.taskId] : place.wave !== undefined && place.wave.length > 0 ? ["--wave", place.wave.join(",")] : []
    const asTask = judging.length === 0 ? withBase : withBase.includes("--") ? [...withBase.slice(0, withBase.indexOf("--")), ...judging, ...withBase.slice(withBase.indexOf("--"))] : [...withBase, ...judging]
    const rest = asTask.indexOf("--")
    const within = place.within !== true || asTask.includes("--within") ? asTask : rest < 0 ? [...asTask, "--within"] : [...asTask.slice(0, rest), "--within", ...asTask.slice(rest)]
    const withPaths = within.includes("--") ? within : [...within, "--", ...allowPaths]
    // No timeout on the verb itself: it waits in the heavy queue for each step, and every step it runs carries its own budget
    // from admission (harness/heavy.ts); a deadline here would count queue time. The verify's lock deadline bounds the whole.
    const run = await captureTool(process.execPath, [selfEntry(), "--json", "--cwd", place.cwd, ...withPaths], place.cwd, {})
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
    const changed = Array.isArray(scope.changed) ? scope.changed.length : 0
    const judged = changed === 0 && Array.isArray(scope.files) && scope.files.length > 0 ? `, so ${String(scope.files.length)} tracked file(s) under allowPaths` : ""
    const lines = [
        `scope vs ${String(scope.base)}: ${String(changed)} changed file(s)${judged}, ${String(Array.isArray(scope.targets) ? scope.targets.length : 0)} package(s)`,
        ...steps.map((step) => `${step.status} ${step.step} ${step.package}${step.reason === "" ? "" : " (" + step.reason + ")"}`),
        ...(ran.length === 0 ? ["no step ran: nothing was typechecked or linted, so this check proves nothing"] : []),
        ...steps.filter((step) => step.status === "red").map((step) => `--- ${step.package} ${step.step}\n${step.output}`),
    ]
    return { name: check.name, kind: check.check.kind, status: run.exitCode === 0 && ran.length > 0 ? "green" : "red", exitCode: run.exitCode, detail: lines.join("\n") }
}

/**
 * Runs a command check: its argv (a list, or a string split at blanks), held to its verdict key when it names one. With
 * `coverage: changed` a command that runs jest (`runsJest`) has its coverage narrowed to the task's changed logic files
 * (harness/coverage-scope.ts), and the detail opens with the files it judged; any other command runs as named.
 */
const runCommandCheck = async (check: ResolvedCheck & { readonly check: { readonly kind: "command" } }, place: CheckPlace, allowPaths: readonly string[], options: { readonly timeoutMs?: number }): Promise<CheckOutcome> => {
    const primitive = check.check
    const named = Array.isArray(primitive.run) ? primitive.run : primitive.run.split(/\s+/).filter((part) => part !== "")
    try {
        const scope = primitive.coverage === "changed" && runsJest(named, place.cwd) ? await changedCoverageScope(place, allowPaths) : undefined
        const argv = scope === undefined ? named : withCoverageArgs(named, scope)
        const judged = primitive.verdict !== undefined ? await runVerdictCommand(check, argv, primitive.verdict, place, options) : fromRun(check, await heavyCommand(argv, place.cwd, options))
        return scope === undefined ? judged : { ...judged, detail: `${scope.detail}\n${judged.detail}` }
    } catch (error: unknown) {
        return outcome(check, [error instanceof Error ? error.message : String(error)], "")
    }
}

/** Runs one primitive check of a contract. A missing tool or file is a red check, never a crash of the verify. */
export const runCheck = async (check: ResolvedCheck, contract: Contract, place: CheckPlace): Promise<CheckOutcome> => {
    const primitive = check.check
    const options = place.timeoutMs === undefined ? {} : { timeoutMs: place.timeoutMs }
    switch (primitive.kind) {
        case "starci": {
            const [group, verb] = primitive.args
            if (group === "check" && verb !== undefined && SCOPED_CHECK_VERBS.has(verb)) return runScopedCheck(check, primitive.args, place, contract.context.allowPaths)
            return fromRun(check, await captureTool(process.execPath, [selfEntry(), "--cwd", place.cwd, ...primitive.args], place.cwd, options))
        }
        case "command":
            return runCommandCheck({ ...check, check: primitive }, place, contract.context.allowPaths, options)
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
        case "cite": {
            // The anchor cites (harness/cite.ts) of the filed result, against the change in the checkout the check runs in.
            const document = readJsonDocument(RESULT_FILE, place)
            if ("problem" in document) return outcome(check, [document.problem], "")
            const judged = await judgeCites(primitive, document.value, { root: place.root, base: place.diffBase ?? "HEAD", allowPaths: contract.context.allowPaths })
            return outcome(check, judged.problems, judged.detail)
        }
    }
}
