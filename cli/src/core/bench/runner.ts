import { randomBytes } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { pathToFileURL } from "node:url"
import { isDeepStrictEqual } from "node:util"
import { stringify } from "yaml"
import { runtimeRoot, stateBase } from "../../harness/ledger.js"
import { captureTool } from "../../shared/exec.js"
import type { ToolRun } from "../../shared/exec.js"
import { benchRoot, runnable } from "./scenario.js"
import type { Assertion, Scenario, Step } from "./scenario.js"

/** The verdict of one scenario run: pass, fail (an assertion did not hold), error (the bench itself broke) or pending (not automated). */
export type Verdict = "pass" | "fail" | "error" | "pending"

/** One row of the scoreboard: what ran, under which fault, and every failed expectation. */
export interface ScenarioResult {
    readonly id: string
    readonly group: string
    readonly automation: string
    readonly verdict: Verdict
    readonly fault: string | null
    readonly failures: readonly string[]
    readonly runDir: string | null
    readonly ms: number
    readonly at: string
}

/** A failed expectation: the scenario goes on to its end only when the bench can still read state, so it stops here. */
class Unmet extends Error {}

interface RunState {
    readonly scenario: Scenario
    readonly dir: string
    readonly repo: string
    readonly state: string
    readonly orcaState: string
    readonly orcaLog: string
    readonly env: Readonly<Record<string, string>>
    readonly vars: Map<string, string>
    readonly failures: string[]
}

const VAR = /\$\{([A-Za-z0-9_.-]+)\}/g

/** The project state folder of the run's only project (`<state>/projects/<ledger_id>`), once a writing verb minted it. */
const projectFolder = (state: string): string | undefined => {
    const root = join(state, "projects")
    if (!existsSync(root)) return undefined
    const [only] = readdirSync(root).filter((name) => statSync(join(root, name)).isDirectory())
    return only === undefined ? undefined : join(root, only)
}

const expand = (run: RunState, text: string): string =>
    text.replaceAll(VAR, (whole, name: string) => {
        if (name === "repo") return run.repo
        if (name === "run") return run.dir
        if (name === "state") return run.state
        if (name === "project") return projectFolder(run.state) ?? whole
        return run.vars.get(name) ?? whole
    })

const deepExpand = (run: RunState, value: unknown): unknown => {
    if (typeof value === "string") return expand(run, value)
    if (Array.isArray(value)) return value.map((entry) => deepExpand(run, entry))
    if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [expand(run, key), deepExpand(run, entry)]))
    return value
}

const inRepo = (run: RunState, path: string): string => {
    const expanded = expand(run, path)
    return isAbsolute(expanded) ? expanded : join(run.repo, expanded)
}

// A fixture that must never be text in this public repository: a provider-shaped credential and a lint suppression, built here.
const generated = (kind: "secret" | "loosening"): string => {
    if (kind === "secret") return `const awsKey = "${["AK", "IA"].join("")}${randomBytes(8).toString("hex").toUpperCase()}"\n`
    return `// ${["eslint", "disable"].join("-")}-next-line\nexport const value = 1\n`
}

const writeText = (file: string, content: string, crlf: boolean): void => {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, crlf ? content.replaceAll(/\r?\n/g, "\r\n") : content)
}

const git = async (run: RunState, args: readonly string[], where?: string): Promise<ToolRun> => captureTool("git", args, where === undefined ? run.repo : inRepo(run, where))

const cliPath = (): string => join(runtimeRoot(), "cli", "dist", "main.js")

/** The orca stand-in: a copy of this node named orca, which runs the bench stub preloaded by NODE_OPTIONS and nothing else. */
const orcaBinary = (): string => {
    const dir = join(stateBase(), "bench", "bin")
    const file = join(dir, process.platform === "win32" ? "orca.exe" : "orca")
    if (!existsSync(file) || statSync(file).size !== statSync(process.execPath).size) {
        mkdirSync(dir, { recursive: true })
        copyFileSync(process.execPath, file)
    }
    return file
}

const pathOf = (value: unknown, path: string): unknown =>
    path.split(".").reduce<unknown>((current, key) => (current !== null && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined), value)

const envelopeOf = (stdout: string): Record<string, unknown> | undefined => {
    try {
        const parsed: unknown = JSON.parse(stdout)
        return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined
    } catch {
        return undefined
    }
}

const unmet = (run: RunState, label: string, what: string): never => {
    run.failures.push(`${label}: ${what}`)
    throw new Unmet(what)
}

const known = (run: RunState, name: string, label: string): string => run.vars.get(name) ?? unmet(run, label, `no ${name}: boot the tree first`)

/** The terminal, role and default folder a seat's verb runs with: the Supervisor in the repository, a Kernel in its worktree. */
const seatOf = (run: RunState, seat: string | undefined, label: string): { readonly env: Record<string, string>; readonly cwd: string } => {
    if (seat === undefined) return { env: {}, cwd: run.repo }
    if (seat === "supervisor") return { env: { ORCA_TERMINAL_HANDLE: known(run, "supervisor.terminal", label), STARCI_ROLE: "supervisor" }, cwd: run.repo }
    const workflow = seat.slice("kernel:".length)
    return { env: { ORCA_TERMINAL_HANDLE: known(run, `kernel.${workflow}.terminal`, label), STARCI_ROLE: "kernel" }, cwd: run.vars.get(`worktree.${workflow}`) ?? run.repo }
}

const starci = async (run: RunState, step: Step, label: string): Promise<void> => {
    const args = (step.starci ?? []).map((arg) => expand(run, arg))
    const seat = seatOf(run, step.seat, label)
    const cwd = step.cwd === undefined ? seat.cwd : inRepo(run, step.cwd)
    const env = { ...run.env, ...seat.env, ...Object.fromEntries(Object.entries(step.env ?? {}).map(([key, value]) => [key, expand(run, value)])) }
    const done = await captureTool(process.execPath, [cliPath(), ...args, "--json", "--cwd", cwd], cwd, { env, timeoutMs: 600_000 })
    const envelope = envelopeOf(done.stdout)
    const expect = step.expect ?? { exit: 0 }
    const said = `exit ${String(done.exitCode)} ${envelope === undefined ? done.stdout.slice(0, 300) : JSON.stringify({ code: envelope.code, message: typeof envelope.message === "string" ? envelope.message.slice(0, 300) : undefined })}`
    if (expect.exit !== undefined && done.exitCode !== expect.exit) unmet(run, label, `expected exit ${String(expect.exit)}, got ${said}`)
    if (expect.ok !== undefined && envelope?.ok !== expect.ok) unmet(run, label, `expected ok ${String(expect.ok)}, got ${said}`)
    if (expect.code !== undefined && envelope?.code !== expect.code) unmet(run, label, `expected refusal ${expect.code}, got ${said}`)
    if (expect.contains !== undefined && !done.stdout.includes(expand(run, expect.contains))) unmet(run, label, `output lacks "${expect.contains}": ${said}`)
    for (const [name, path] of Object.entries(step.save ?? {})) {
        const value = pathOf(envelope, path)
        if (value === undefined) unmet(run, label, `no ${path} to save as ${name}: ${said}`)
        run.vars.set(name, typeof value === "string" ? value : JSON.stringify(value))
    }
}

/** The checkout a task's worker writes in: the task's recorded worktree (its workflow's), else the scratch repository. */
const checkoutOf = (run: RunState, task: string, label: string): string => {
    const project = projectFolder(run.state)
    if (project === undefined || !existsSync(join(project, "runtime.sqlite"))) return run.repo
    const [worktree] = query(run, "ledger", `SELECT worktree FROM tasks WHERE id = '${task.replaceAll("'", "''")}'`, label) as unknown[]
    return typeof worktree === "string" && worktree !== "" ? worktree : run.repo
}

const worker = async (run: RunState, step: NonNullable<Step["worker"]>, label: string): Promise<void> => {
    const task = expand(run, step.task)
    const checkout = checkoutOf(run, task, label)
    const inCheckout = (path: string): string => (isAbsolute(expand(run, path)) ? expand(run, path) : join(checkout, expand(run, path)))
    for (const [path, content] of Object.entries(step.files ?? {})) writeText(inCheckout(path), expand(run, content), false)
    for (const path of step.remove ?? []) rmSync(inCheckout(path), { force: true, recursive: true })
    const project = projectFolder(run.state)
    if (project === undefined) unmet(run, label, "no project state folder to file into")
    const output = join(project ?? run.state, "outputs", `${task}.json`)
    writeText(output, JSON.stringify(deepExpand(run, step.output ?? { summary: `bench worker for ${task}`, files: Object.keys(step.files ?? {}), rulesApplied: [] })), false)
    await starci(run, { starci: ["task", "result", task, "--status", step.status, "--output", `@${output}`], cwd: checkout }, label)
}

const openDb = (run: RunState, db: "ledger" | "machine", label: string): DatabaseSync => {
    const file = db === "machine" ? join(run.state, "machine.sqlite") : join(projectFolder(run.state) ?? run.state, "runtime.sqlite")
    if (!existsSync(file)) unmet(run, label, `${db} database ${file} does not exist`)
    return new DatabaseSync(file, { timeout: 5000 })
}

const query = (run: RunState, db: "ledger" | "machine", sql: string, label: string): unknown => {
    const handle = openDb(run, db, label)
    try {
        const rows = handle.prepare(expand(run, sql)).all().map((row) => Object.values(row))
        return rows.every((row) => row.length === 1) ? rows.map((row) => row[0]) : rows
    } finally {
        handle.close()
    }
}

const orcaCalls = (run: RunState): { readonly command: string; readonly flags: Record<string, unknown> }[] =>
    existsSync(run.orcaLog)
        ? readFileSync(run.orcaLog, "utf8")
              .split("\n")
              .filter((line) => line !== "")
              .map((line) => JSON.parse(line) as { command: string; flags: Record<string, unknown> })
        : []

const check = async (run: RunState, assertion: Assertion, label: string): Promise<void> => {
    if (assertion.sql !== undefined) {
        const got = query(run, assertion.sql.db, assertion.sql.query, label)
        const want = deepExpand(run, assertion.sql.equals)
        if (!isDeepStrictEqual(got, want)) unmet(run, label, `${assertion.sql.query} gave ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`)
    }
    if (assertion.gitLog !== undefined) {
        const log = await git(run, ["log", "--format=%H", `--grep=${expand(run, assertion.gitLog.grep)}`, "--fixed-strings", "HEAD"], assertion.gitLog.in)
        const count = log.stdout.split("\n").filter((line) => line !== "").length
        if (count !== assertion.gitLog.count) unmet(run, label, `git log --grep ${assertion.gitLog.grep} found ${String(count)} commit(s), expected ${String(assertion.gitLog.count)}`)
    }
    if (assertion.gitClean !== undefined) {
        const status = await git(run, ["status", "--porcelain", "--untracked-files=all"])
        if ((status.stdout === "") !== assertion.gitClean) unmet(run, label, `worktree clean is ${String(status.stdout === "")}: ${status.stdout.slice(0, 300)}`)
    }
    if (assertion.gitHas !== undefined) {
        const found = await git(run, ["cat-file", "-e", `HEAD:${expand(run, assertion.gitHas.path)}`], assertion.gitHas.in)
        if ((found.exitCode === 0) !== assertion.gitHas.present) unmet(run, label, `HEAD has ${assertion.gitHas.path}: ${String(found.exitCode === 0)}`)
    }
    if (assertion.orcaCalls !== undefined) {
        const { command, count, min, max, distinct } = assertion.orcaCalls
        const match = Object.entries(assertion.orcaCalls.match ?? {}).map(([flag, pattern]) => [flag, new RegExp(expand(run, pattern))] as const)
        const calls = orcaCalls(run).filter((call) => call.command === command && match.every(([flag, pattern]) => pattern.test(typeof call.flags[flag] === "string" ? call.flags[flag] : "")))
        const n = distinct === undefined ? calls.length : new Set(calls.map((call) => JSON.stringify(call.flags[distinct]))).size
        const what = `${String(n)} orca ${command} call(s)${distinct === undefined ? "" : ` with distinct ${distinct}`}`
        if (count !== undefined && n !== count) unmet(run, label, `${what}, expected ${String(count)}`)
        if (min !== undefined && n < min) unmet(run, label, `${what}, expected at least ${String(min)}`)
        if (max !== undefined && n > max) unmet(run, label, `${what}, expected at most ${String(max)}`)
    }
    if (assertion.exists !== undefined) {
        const present = existsSync(inRepo(run, assertion.exists.path))
        if (present !== assertion.exists.present) unmet(run, label, `${assertion.exists.path} exists is ${String(present)}`)
    }
}

const orcaScript = (run: RunState, step: NonNullable<Step["orca"]>): void => {
    const current = existsSync(run.orcaState) ? (JSON.parse(readFileSync(run.orcaState, "utf8")) as Record<string, unknown>) : {}
    const rules = [...((current.rules as unknown[] | undefined) ?? []), ...((deepExpand(run, step.rules ?? []) as unknown[]))]
    const workers = { ...((current.workers as Record<string, string> | undefined) ?? {}) }
    // `*` names every Op dispatch the stand-in launched so far and `kernel` every Kernel's: the scenario cannot know Orca's ids before the launch.
    const { dispatch, state } = step.worker ?? { dispatch: undefined, state: "" }
    const launched = Object.values((current.dispatches as Record<string, { readonly dispatchId: string; readonly kind?: string }> | undefined) ?? {})
    if (dispatch === "*" || dispatch === "kernel") for (const entry of launched.filter((candidate) => (candidate.kind === "kernel") === (dispatch === "kernel"))) workers[entry.dispatchId] = state
    else if (dispatch !== undefined) workers[expand(run, dispatch)] = state
    const terminals = { ...((current.terminals as Record<string, boolean> | undefined) ?? {}) }
    if (step.terminal !== undefined) terminals[expand(run, step.terminal.handle)] = step.terminal.live
    const mail = { ...((current.mail as Record<string, unknown[]> | undefined) ?? {}) }
    let sent = Number(current.benchMail ?? 0)
    for (const letter of step.mail ?? []) {
        const to = expand(run, letter.to)
        for (let copy = 0; copy < (letter.count ?? 1); copy += 1) {
            sent += 1
            mail[to] = [...(mail[to] ?? []), { id: `bench-msg-${String(sent)}`, type: letter.type, subject: expand(run, letter.subject ?? ""), body: expand(run, letter.body ?? ""), payload: deepExpand(run, letter.payload ?? null), from: letter.from === undefined ? null : expand(run, letter.from) }]
        }
    }
    writeFileSync(run.orcaState, JSON.stringify({ ...current, ...(deepExpand(run, step.set ?? {}) as Record<string, unknown>), rules, workers, terminals, mail, benchMail: sent }, null, 2))
}

/** Attaches the workflow's current Kernel seat from the terminal Orca gave it (`kernel attach`), saving its identity. */
const adoptKernel = async (run: RunState, workflow: string, attach: boolean, label: string): Promise<void> => {
    const rows = query(run, "ledger", `SELECT id, terminal FROM seats WHERE role = 'kernel' AND workflow_id = '${workflow}' ORDER BY started_at DESC, rowid DESC LIMIT 1`, label) as unknown[]
    const row = (Array.isArray(rows[0]) ? rows[0] : rows) as unknown[]
    const [launch, terminal] = row
    if (typeof launch !== "string" || typeof terminal !== "string") unmet(run, label, `workflow ${workflow} has no Kernel seat with a terminal: ${JSON.stringify(rows)}`)
    run.vars.set(`kernel.${workflow}.launch`, String(launch))
    run.vars.set(`kernel.${workflow}.terminal`, String(terminal))
    const [worktree] = query(run, "ledger", `SELECT worktree FROM workflows WHERE id = '${workflow}'`, label) as unknown[]
    if (typeof worktree === "string") run.vars.set(`worktree.${workflow}`, worktree)
    if (!attach) return
    await starci(run, { starci: ["kernel", "attach", workflow, "--launch", String(launch)], seat: `kernel:${workflow}`, save: { [`kernel.${workflow}.run`]: "data.kernel.runId" } }, `${label} (kernel attach)`)
}

/** Boots the coordinator tree through real verbs: Supervisor (once), the workflow's definition, its start and its Kernel's attach. */
const boot = async (run: RunState, step: NonNullable<Step["boot"]>, label: string): Promise<void> => {
    if (!run.vars.has("supervisor.terminal")) {
        await starci(run, { starci: ["supervisor", "start"], save: { "supervisor.launch": "data.id", "supervisor.terminal": "data.terminal" } }, `${label} (supervisor start)`)
        await starci(run, { starci: ["supervisor", "attach", "--launch", "${supervisor.launch}"], seat: "supervisor", save: { "supervisor.run": "data.run_id" } }, `${label} (supervisor attach)`)
    }
    if (step.file !== undefined) await starci(run, { starci: ["workflow", "define", step.file] }, `${label} (workflow define)`)
    if (step.adopt !== undefined) await adoptKernel(run, step.adopt, step.attach !== false, label)
    if (step.workflow === undefined) return
    await starci(run, { starci: ["workflow", "start", step.workflow], seat: "supervisor" }, `${label} (workflow start)`)
    await adoptKernel(run, step.workflow, step.attach !== false, label)
}

const execute = async (run: RunState, step: Step, index: number): Promise<void> => {
    const label = `step ${String(index + 1)}${step.name === undefined ? "" : ` (${step.name})`}`
    if (step.file !== undefined) {
        const target = isAbsolute(expand(run, step.file.path)) ? expand(run, step.file.path) : join(run.dir, expand(run, step.file.path))
        const content = step.file.content ?? stringify(deepExpand(run, step.file.yaml))
        writeText(target, expand(run, content), step.file.crlf === true)
    }
    if (step.write !== undefined) {
        const content = step.write.generated === undefined ? expand(run, step.write.content ?? "") : generated(step.write.generated)
        writeText(inRepo(run, step.write.path), content, step.write.crlf === true)
    }
    if (step.remove !== undefined) rmSync(inRepo(run, step.remove), { force: true, recursive: true })
    if (step.orca !== undefined) orcaScript(run, step.orca)
    if (step.sql !== undefined) {
        const handle = openDb(run, step.sql.db, label)
        try {
            handle.exec(expand(run, step.sql.exec))
        } finally {
            handle.close()
        }
    }
    if (step.git !== undefined) {
        const done = await git(run, step.git.map((arg) => expand(run, arg)))
        const want = step.expect?.exit ?? 0
        if (done.exitCode !== want) unmet(run, label, `git ${step.git.join(" ")} exited ${String(done.exitCode)}: ${done.stderr.slice(0, 300)}`)
    }
    if (step.boot !== undefined) await boot(run, step.boot, label)
    if (step.read !== undefined) {
        const [first] = query(run, step.read.db, step.read.query, label) as unknown[]
        const value = Array.isArray(first) ? (first as unknown[])[0] : first
        if (value === undefined || value === null) unmet(run, label, `${step.read.query} returned nothing to save as ${step.read.as}`)
        run.vars.set(step.read.as, typeof value === "string" ? value : JSON.stringify(value))
    }
    if (step.worker !== undefined) await worker(run, step.worker, label)
    if (step.starci !== undefined) await Promise.all(Array.from({ length: step.parallel ?? 1 }, async () => starci(run, step, label)))
    if (step.assert !== undefined) await check(run, step.assert, label)
}

const stamp = (): string => new Date().toISOString().replaceAll(/[:.]/g, "-")

const setUp = async (scenario: Scenario, fault: string | null): Promise<RunState> => {
    const dir = join(stateBase(), "bench", `${stamp()}-${scenario.id}${fault === null ? "" : `-${fault}`}`)
    const repo = join(dir, scenario.repo?.dir ?? "repo")
    const state = join(dir, "state")
    mkdirSync(repo, { recursive: true })
    mkdirSync(state, { recursive: true })
    const orcaState = join(dir, "orca.json")
    const orcaLog = join(dir, "orca.jsonl")
    writeFileSync(orcaState, "{}")
    const stub = pathToFileURL(join(benchRoot(), "stub", "orca-stub.mjs")).href
    const env: Record<string, string> = {
        STARCI_LOCAL_ROOT: state,
        STARCI_PROJECTS_ROOT: join(state, "projects"),
        STARCI_ORCA_BIN: orcaBinary(),
        STARCI_BENCH_ORCA: orcaState,
        STARCI_BENCH_ORCA_LOG: orcaLog,
        NODE_OPTIONS: `--import=${stub}`,
    }
    const run: RunState = { scenario, dir, repo, state, orcaState, orcaLog, env: {}, vars: new Map(), failures: [] }
    const withEnv: RunState = { ...run, env: { ...env, ...Object.fromEntries(Object.entries(scenario.env ?? {}).map(([key, value]) => [key, expand(run, value)])) } }
    for (const args of [["init", "-q", "-b", "main"], ["config", "user.email", "bench@starci.local"], ["config", "user.name", "starci bench"], ["config", "core.autocrlf", "false"]]) await git(withEnv, args)
    const files = scenario.repo?.files ?? { "README.md": "# bench scratch repository\n" }
    for (const [path, content] of Object.entries(files)) writeText(join(repo, path), content, false)
    await git(withEnv, ["add", "-A"])
    await git(withEnv, ["commit", "-q", "-m", "bench: scratch repository"])
    return withEnv
}

/** Runs one scenario in its own scratch repository and state base under `<state base>/bench/<run>`; a pending scenario is not run. */
export const runScenario = async (scenario: Scenario, fault: string | null): Promise<ScenarioResult> => {
    const started = Date.now()
    const base = { id: scenario.id, group: scenario.group, automation: scenario.automation, fault, at: new Date().toISOString() }
    if (!runnable(scenario)) return { ...base, verdict: "pending", failures: [], runDir: null, ms: 0 }
    // A bench run inside an Orca terminal must not adopt it, and a caller's role must not narrow the scenario's verbs.
    delete process.env.ORCA_TERMINAL_HANDLE
    delete process.env.STARCI_ROLE
    const run = await setUp(scenario, fault)
    let verdict: Verdict = "pass"
    try {
        for (const [index, step] of (scenario.steps ?? []).entries()) {
            if (step.when !== undefined && step.when !== fault) continue
            if (step.unless !== undefined && step.unless === fault) continue
            await execute(run, step, index)
        }
    } catch (error: unknown) {
        verdict = error instanceof Unmet ? "fail" : "error"
        if (!(error instanceof Unmet)) run.failures.push(`bench error: ${error instanceof Error ? error.message : String(error)}`)
    }
    const result: ScenarioResult = { ...base, verdict, failures: run.failures, runDir: run.dir, ms: Date.now() - started }
    writeFileSync(join(run.dir, "result.json"), JSON.stringify(result, null, 2))
    return result
}

