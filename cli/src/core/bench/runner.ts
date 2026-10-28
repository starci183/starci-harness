import { randomBytes } from "node:crypto"
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { pathToFileURL } from "node:url"
import { isDeepStrictEqual } from "node:util"
import { stringify } from "yaml"
import { runtimeRoot, stateBase } from "../../harness/ledger.js"
import { locateOps } from "../../harness/ops.js"
import { inOrder } from "../../harness/sequential.js"
import { captureTool, startServing } from "../../shared/exec.js"
import { captureGit, samePath } from "../../shared/git.js"
import type { Serving, ToolRun } from "../../shared/exec.js"
import { benchRoot, runnable } from "./scenario.js"
import type { Assertion, GENERATED, Scenario, Step } from "./scenario.js"

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
    /** The long-lived verbs a `serve` step started, stopped when the scenario ends. */
    readonly served: Serving[]
    /** The provider-shaped key of the run's generated secret fixture. */
    readonly key: string
}

const VAR = /\$\{([A-Za-z0-9_.-]+)\}/g

/**
 * The state folder (`<state>/projects/<ledger_id>`) of a repository of the run, once a writing verb minted its ledger: the one the
 * host registry lists for that repository, else, before any registry, the only folder there is.
 */
const ledgerFolder = (state: string, repo: string): string | undefined => {
    const root = join(state, "projects")
    if (!existsSync(root)) return undefined
    const machine = join(state, "machine.sqlite")
    if (existsSync(machine)) {
        const db = new DatabaseSync(machine, { readOnly: true, timeout: 5000 })
        try {
            const row = db.prepare("SELECT ledger_id, repo_root FROM ledgers").all().find((candidate) => samePath(String(candidate.repo_root), repo))
            if (row !== undefined) return join(root, String(row.ledger_id))
        } finally {
            db.close()
        }
    }
    const only = readdirSync(root).find((name) => statSync(join(root, name)).isDirectory())
    return only === undefined ? undefined : join(root, only)
}

/** A repository of the run by name: the scratch repository, or one of `repos` (`<run>/<name>`). */
const repoNamed = (run: RunState, name: string | undefined): string => (name === undefined ? run.repo : join(run.dir, name))

/** The project state folder of the run's scratch repository. */
const projectFolder = (run: RunState): string | undefined => ledgerFolder(run.state, run.repo)

const expand = (run: RunState, text: string): string =>
    text.replaceAll(VAR, (whole, name: string) => {
        if (name === "repo") return run.repo
        if (name === "run") return run.dir
        if (name === "state") return run.state
        if (name === "project") return projectFolder(run) ?? whole
        if (name === "ops") return locateOps()
        if (name === "generatedKey") return run.key
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

/** Bytes of the generated page's embedded font: more than policy/loosening.yaml scan.maxFileBytes once base64-encoded. */
const FONT_BYTES = 1_200_000

/**
 * A page that embeds a font as a base64 `data:font/woff2` URI larger than the scan bound, whose payload spells a provider-shaped
 * key the way base64 can; `secret` plants the run's key in a tag of the page as well.
 */
const fontPage = (run: RunState, secret: boolean): string => {
    const font = Buffer.alloc(FONT_BYTES)
    for (let index = 0; index < FONT_BYTES; index += 1) font[index] = (index * 131 + (index >> 7)) & 0xff
    const payload = `${run.key}+/${font.toString("base64")}`
    const planted = secret ? `<meta name="aws" content="${run.key}">\n` : ""
    return `<!doctype html>\n<html><head>\n<style>@font-face { font-family: "Bench Sans"; src: url(data:font/woff2;base64,${payload}) format("woff2"); }</style>\n${planted}</head><body>direction</body></html>\n`
}

// A fixture that must never be text in this public repository: a provider-shaped credential, a lint suppression and a page
// embedding a font, built here. The run's credential is one key (`${generatedKey}` in a step's text), so a scenario can name the line it sits on.
const generated = (run: RunState, kind: (typeof GENERATED)[number]): string => {
    if (kind === "secret") return `const awsKey = "${run.key}"\n`
    if (kind === "font-page" || kind === "font-page-secret") return fontPage(run, kind === "font-page-secret")
    return `// ${["eslint", "disable"].join("-")}-next-line\nexport const value = 1\n`
}

const writeText = (file: string, content: string, crlf: boolean): void => {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, crlf ? content.replaceAll(/\r?\n/g, "\r\n") : content)
}

const git = async (run: RunState, args: readonly string[], where?: string): Promise<ToolRun> => captureGit(args, where === undefined ? run.repo : inRepo(run, where))

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

/** The variable prefix of a project's Supervisor: `supervisor` for the scratch repository's, `supervisor.<repo>` for another's. */
const supervisorVars = (project: string | undefined): string => (project === undefined ? "supervisor" : `supervisor.${project}`)

/**
 * The terminal, role and default folder a seat's verb runs with: a Supervisor (`supervisor`, or `supervisor:<repo>` for the
 * project of another repository of the run) in its project's repository, a Kernel in its worktree.
 */
const seatOf = (run: RunState, seat: string | undefined, label: string): { readonly env: Record<string, string>; readonly cwd: string } => {
    if (seat === undefined) return { env: {}, cwd: run.repo }
    if (seat.startsWith("supervisor")) {
        const project = seat.includes(":") ? seat.slice("supervisor:".length) : undefined
        return { env: { ORCA_TERMINAL_HANDLE: known(run, `${supervisorVars(project)}.terminal`, label), STARCI_ROLE: "supervisor" }, cwd: repoNamed(run, project) }
    }
    const workflow = seat.slice("kernel:".length)
    return { env: { ORCA_TERMINAL_HANDLE: known(run, `kernel.${workflow}.terminal`, label), STARCI_ROLE: "kernel" }, cwd: run.vars.get(`worktree.${workflow}`) ?? run.repo }
}

/** What a verb run said, for a failure: its exit and its envelope's code and message, else the head of its output. */
const saidOf = (done: ToolRun, envelope: Record<string, unknown> | undefined): string => {
    if (envelope === undefined) return `exit ${String(done.exitCode)} ${done.stdout.slice(0, 300)}`
    const message = typeof envelope.message === "string" ? envelope.message.slice(0, 300) : undefined
    // A `starci app` verb answers ok with @starci/hfs's own exit and stderr in its data; without them its failure says nothing.
    const data = typeof envelope.data === "object" && envelope.data !== null ? (envelope.data as Record<string, unknown>) : {}
    const stderr = message === undefined && typeof data.stderr === "string" && data.stderr !== "" ? data.stderr.slice(0, 300) : undefined
    return `exit ${String(done.exitCode)} ${JSON.stringify({ code: envelope.code, message, ...(stderr === undefined ? {} : { stderr }) })}`
}

const starci = async (run: RunState, step: Step, label: string): Promise<void> => {
    const args = (step.starci ?? []).map((arg) => expand(run, arg))
    const seat = seatOf(run, step.seat, label)
    const cwd = step.cwd === undefined ? seat.cwd : inRepo(run, step.cwd)
    const env = { ...run.env, ...seat.env, ...Object.fromEntries(Object.entries(step.env ?? {}).map(([key, value]) => [key, expand(run, value)])) }
    const done = await captureTool(process.execPath, [cliPath(), ...args, "--json", "--cwd", cwd], cwd, { env, timeoutMs: 600_000 })
    const envelope = envelopeOf(done.stdout)
    const expect = step.expect ?? { exit: 0 }
    const said = saidOf(done, envelope)
    if (expect.exit !== undefined && done.exitCode !== expect.exit) unmet(run, label, `expected exit ${String(expect.exit)}, got ${said}`)
    if (expect.ok !== undefined && envelope?.ok !== expect.ok) unmet(run, label, `expected ok ${String(expect.ok)}, got ${said}`)
    if (expect.code !== undefined && envelope?.code !== expect.code) unmet(run, label, `expected refusal ${expect.code}, got ${said}`)
    if (expect.contains !== undefined && !done.stdout.includes(expand(run, expect.contains))) unmet(run, label, `output lacks "${expect.contains}": ${said}`)
    if (expect.lacks !== undefined && (done.stdout + done.stderr).includes(expand(run, expect.lacks))) unmet(run, label, `output carries "${expect.lacks}", which it must not`)
    for (const [name, path] of Object.entries(step.save ?? {})) {
        const value = pathOf(envelope, path)
        if (value === undefined) unmet(run, label, `no ${path} to save as ${name}: ${said}`)
        run.vars.set(name, typeof value === "string" ? value : JSON.stringify(value))
    }
}

/** The checkout a task's worker writes in: the task's recorded worktree (its workflow's), else the scratch repository. */
const checkoutOf = (run: RunState, task: string, label: string): string => {
    const project = projectFolder(run)
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
    const project = projectFolder(run)
    if (project === undefined) unmet(run, label, "no project state folder to file into")
    const output = join(project ?? run.state, "outputs", `${task}.json`)
    writeText(output, JSON.stringify(deepExpand(run, step.output ?? { summary: `bench worker for ${task}`, files: Object.keys(step.files ?? {}), rulesApplied: [] })), false)
    await starci(run, { starci: ["task", "result", task, "--status", step.status, "--output", `@${output}`], cwd: checkout }, label)
}

/** A store of the run: the host's machine.sqlite, or the ledger of the scratch repository (or of the repository `repo` names). */
const openDb = (run: RunState, db: "ledger" | "machine", label: string, repo?: string): DatabaseSync => {
    const file = db === "machine" ? join(run.state, "machine.sqlite") : join(ledgerFolder(run.state, repoNamed(run, repo)) ?? run.state, "runtime.sqlite")
    if (!existsSync(file)) unmet(run, label, `${db} database ${file} does not exist`)
    return new DatabaseSync(file, { timeout: 5000 })
}

const query = (run: RunState, db: "ledger" | "machine", sql: string, label: string, repo?: string): unknown => {
    const handle = openDb(run, db, label, repo)
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

/** Counts the Orca calls of one command (matching flags, or distinct values of one flag) against the expected bounds. */
const checkOrcaCalls = (run: RunState, expected: NonNullable<Assertion["orcaCalls"]>, label: string): void => {
    const { command, count, min, max, distinct } = expected
    const match = Object.entries(expected.match ?? {}).map(([flag, pattern]) => [flag, new RegExp(expand(run, pattern))] as const)
    const calls = orcaCalls(run).filter((call) => call.command === command && match.every(([flag, pattern]) => pattern.test(typeof call.flags[flag] === "string" ? call.flags[flag] : "")))
    const n = distinct === undefined ? calls.length : new Set(calls.map((call) => JSON.stringify(call.flags[distinct]))).size
    const distinctNote = distinct === undefined ? "" : " with distinct " + distinct
    const what = `${String(n)} orca ${command} call(s)${distinctNote}`
    if (count !== undefined && n !== count) unmet(run, label, `${what}, expected ${String(count)}`)
    if (min !== undefined && n < min) unmet(run, label, `${what}, expected at least ${String(min)}`)
    if (max !== undefined && n > max) unmet(run, label, `${what}, expected at most ${String(max)}`)
}

/** The git assertions: commits matching a grep, a clean worktree, a path at HEAD. */
const checkGit = async (run: RunState, assertion: Assertion, label: string): Promise<void> => {
    if (assertion.gitLog !== undefined) {
        const log = await git(run, ["log", "--format=%H", `--grep=${expand(run, assertion.gitLog.grep)}`, "--fixed-strings", expand(run, assertion.gitLog.ref ?? "HEAD")], assertion.gitLog.in)
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
}

const check = async (run: RunState, assertion: Assertion, label: string): Promise<void> => {
    if (assertion.sql !== undefined) {
        const got = query(run, assertion.sql.db, assertion.sql.query, label, assertion.sql.repo)
        const want = deepExpand(run, assertion.sql.equals)
        if (!isDeepStrictEqual(got, want)) unmet(run, label, `${assertion.sql.query} gave ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`)
    }
    await checkGit(run, assertion, label)
    if (assertion.orcaCalls !== undefined) checkOrcaCalls(run, assertion.orcaCalls, label)
    if (assertion.exists !== undefined) {
        const present = existsSync(inRepo(run, assertion.exists.path))
        if (present !== assertion.exists.present) unmet(run, label, `${assertion.exists.path} exists is ${String(present)}`)
        const text = assertion.exists.contains
        if (present && text !== undefined && !readFileSync(inRepo(run, assertion.exists.path), "utf8").includes(expand(run, text))) unmet(run, label, `${assertion.exists.path} lacks "${text}"`)
    }
}

const orcaScript = (run: RunState, step: NonNullable<Step["orca"]>): void => {
    const current = existsSync(run.orcaState) ? (JSON.parse(readFileSync(run.orcaState, "utf8")) as Record<string, unknown>) : {}
    const rules = [...((current.rules as unknown[] | undefined) ?? []), ...((deepExpand(run, step.rules ?? []) as unknown[]))]
    const workers = { ...(current.workers as Record<string, string> | undefined) }
    // `*` names every Op dispatch the stand-in launched so far and `kernel` every Kernel's: the scenario cannot know Orca's ids before the launch.
    const { dispatch, state } = step.worker ?? { dispatch: undefined, state: "" }
    const launched = Object.values((current.dispatches as Record<string, { readonly dispatchId: string; readonly kind?: string }> | undefined) ?? {})
    if (dispatch === "*" || dispatch === "kernel") for (const entry of launched.filter((candidate) => (candidate.kind === "kernel") === (dispatch === "kernel"))) workers[entry.dispatchId] = state
    else if (dispatch !== undefined) workers[expand(run, dispatch)] = state
    const terminals = { ...(current.terminals as Record<string, boolean> | undefined) }
    const titles = { ...(current.titles as Record<string, string> | undefined) }
    const orphaned = { ...(current.orphaned as Record<string, boolean> | undefined) }
    const terminalWorktrees = { ...(current.terminalWorktrees as Record<string, string> | undefined) }
    const holders = { ...(current.holders as Record<string, { readonly url: string; readonly pid: number }> | undefined) }
    if (step.terminal !== undefined) {
        const handle = expand(run, step.terminal.handle)
        terminals[handle] = step.terminal.live
        if (step.terminal.title !== undefined) titles[handle] = expand(run, step.terminal.title)
        if (step.terminal.orphaned !== undefined) orphaned[handle] = step.terminal.orphaned
        if (step.terminal.worktree !== undefined) terminalWorktrees[handle] = inRepo(run, step.terminal.worktree).replaceAll("\\", "/")
        if (step.terminal.holder !== undefined) holders[handle] = { url: expand(run, step.terminal.holder.url), pid: Number(expand(run, step.terminal.holder.pid)) }
    }
    const mail = { ...(current.mail as Record<string, unknown[]> | undefined) }
    let sent = Number(current.benchMail ?? 0)
    for (const letter of step.mail ?? []) {
        const to = expand(run, letter.to)
        for (let copy = 0; copy < (letter.count ?? 1); copy += 1) {
            sent += 1
            mail[to] = [...(mail[to] ?? []), { id: `bench-msg-${String(sent)}`, type: letter.type, subject: expand(run, letter.subject ?? ""), body: expand(run, letter.body ?? ""), payload: deepExpand(run, letter.payload ?? null), from: letter.from === undefined ? null : expand(run, letter.from) }]
        }
    }
    writeFileSync(run.orcaState, JSON.stringify({ ...current, ...(deepExpand(run, step.set ?? {}) as Record<string, unknown>), rules, workers, terminals, titles, orphaned, terminalWorktrees, holders, mail, benchMail: sent }, null, 2))
}

/** Attaches the workflow's current Kernel seat (in the ledger of repository `repo`) from the terminal Orca gave it (`kernel attach`), saving its identity. */
const adoptKernel = async (run: RunState, workflow: string, attach: boolean, label: string, repo?: string): Promise<void> => {
    const rows = query(run, "ledger", `SELECT id, terminal FROM seats WHERE role = 'kernel' AND workflow_id = '${workflow}' ORDER BY started_at DESC, rowid DESC LIMIT 1`, label, repo) as unknown[]
    const row = (Array.isArray(rows[0]) ? rows[0] : rows) as unknown[]
    const [launch, terminal] = row
    if (typeof launch !== "string" || typeof terminal !== "string") unmet(run, label, `workflow ${workflow} has no Kernel seat with a terminal: ${JSON.stringify(rows)}`)
    run.vars.set(`kernel.${workflow}.launch`, String(launch))
    run.vars.set(`kernel.${workflow}.terminal`, String(terminal))
    const [worktree] = query(run, "ledger", `SELECT worktree FROM workflows WHERE id = '${workflow}'`, label, repo) as unknown[]
    if (typeof worktree === "string") run.vars.set(`worktree.${workflow}`, worktree)
    if (!attach) return
    await starci(run, { starci: ["kernel", "attach", workflow, "--launch", String(launch)], seat: `kernel:${workflow}`, save: { [`kernel.${workflow}.run`]: "data.kernel.runId" } }, `${label} (kernel attach)`)
}

/**
 * Boots the coordinator tree through real verbs: the Supervisor of the project (once per project: `supervisor start` and `attach`
 * from that project's repository), the workflow's definition and start in its own repository (`in`, default the project's) and
 * its Kernel's attach.
 */
const boot = async (run: RunState, step: NonNullable<Step["boot"]>, label: string): Promise<void> => {
    const vars = supervisorVars(step.project)
    const seat = step.project === undefined ? "supervisor" : `supervisor:${step.project}`
    const home = repoNamed(run, step.in ?? step.project)
    if (!run.vars.has(`${vars}.terminal`)) {
        await starci(run, { starci: ["supervisor", "start"], cwd: repoNamed(run, step.project), save: { [`${vars}.launch`]: "data.id", [`${vars}.terminal`]: "data.terminal" } }, `${label} (supervisor start)`)
        await starci(run, { starci: ["supervisor", "attach", "--launch", `\${${vars}.launch}`], seat, save: { [`${vars}.run`]: "data.run_id" } }, `${label} (supervisor attach)`)
    }
    if (step.file !== undefined) await starci(run, { starci: ["workflow", "define", step.file], cwd: home }, `${label} (workflow define)`)
    if (step.adopt !== undefined) await adoptKernel(run, step.adopt, step.attach !== false, label, step.in ?? step.project)
    if (step.workflow === undefined) return
    await starci(run, { starci: ["workflow", "start", step.workflow], seat, cwd: home }, `${label} (workflow start)`)
    await adoptKernel(run, step.workflow, step.attach !== false, label, step.in ?? step.project)
}

/** The files a step writes: `file` under the run folder (text or YAML), `write` in the scratch repository (text or a generated fixture). */
const writeFiles = (run: RunState, step: Step): void => {
    if (step.file !== undefined) {
        const target = isAbsolute(expand(run, step.file.path)) ? expand(run, step.file.path) : join(run.dir, expand(run, step.file.path))
        const content = step.file.content ?? stringify(deepExpand(run, step.file.yaml))
        writeText(target, expand(run, content), step.file.crlf === true)
    }
    if (step.write?.from !== undefined) cpSync(expand(run, step.write.from), inRepo(run, step.write.path), { recursive: true })
    else if (step.write !== undefined) {
        const content = step.write.generated === undefined ? expand(run, step.write.content ?? "") : generated(run, step.write.generated)
        writeText(inRepo(run, step.write.path), content, step.write.crlf === true)
    }
}

/** The ready line of a served verb or stand-in: `starci ui: <url> token <token>`, `stub telegram: <url> token <token>`. */
const SERVED = /(?:starci ui|stub \w+): (http:\/\/\S+) token (\S+)/

/** Starts a long-lived verb or bench stand-in in the scratch repository and saves the URL and token its ready line prints. */
const serve = async (run: RunState, step: NonNullable<Step["serve"]>, label: string): Promise<void> => {
    const args = step.stub === undefined ? [cliPath(), ...(step.starci ?? []).map((arg) => expand(run, arg)), "--cwd", run.repo] : [join(benchRoot(), "stub", `${step.stub}-stub.mjs`)]
    const cwd = step.cwd === undefined ? run.repo : inRepo(run, step.cwd)
    const served = await startServing(process.execPath, args, cwd, { env: run.env, ready: SERVED, timeoutMs: 60_000 }).catch((error: unknown) =>
        unmet(run, label, `${args.join(" ")} did not serve: ${error instanceof Error ? error.message : String(error)}`),
    )
    run.served.push(served)
    run.vars.set(`${step.as}.url`, served.ready[1] ?? "")
    run.vars.set(`${step.as}.token`, served.ready[2] ?? "")
}

/** Reads an event stream until `contains` shows or five seconds pass, then drops the connection. */
const readStream = async (response: Response, contains: string | undefined): Promise<string> => {
    const reader = response.body?.getReader()
    if (reader === undefined) return ""
    const decoder = new TextDecoder()
    const deadline = Date.now() + 5000
    let text = ""
    while (Date.now() < deadline && (contains === undefined || !text.includes(contains))) {
        const left = deadline - Date.now()
        const chunk = await Promise.race([reader.read(), new Promise<undefined>((done) => setTimeout(() => { done(undefined) }, left))])
        if (chunk === undefined || chunk.done) break
        if (chunk.value instanceof Uint8Array) text += decoder.decode(chunk.value, { stream: true })
        if (contains === undefined) break
    }
    await reader.cancel()
    return text
}

/** The fetch options of an http step: its method, its bearer token and, when it has one, its JSON body. */
const requestInit = (run: RunState, step: NonNullable<Step["http"]>): RequestInit => {
    const headers: Record<string, string> = step.token === undefined ? {} : { Authorization: `Bearer ${expand(run, step.token)}` }
    if (step.body === undefined) return { method: step.method, headers }
    return { method: step.method, headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(deepExpand(run, step.body)) }
}

/** The JSON a response text carries: its envelope or a bare array; nothing for a stream. */
const responseBody = (text: string, stream: boolean): unknown => {
    if (stream) return undefined
    return envelopeOf(text) ?? (text.startsWith("[") ? JSON.parse(text) : undefined)
}

/** Holds a response body to the JSON paths and values an http step expects, then saves the paths it names as variables. */
const holdBody = (run: RunState, step: NonNullable<Step["http"]>, url: string, body: unknown, said: string, label: string): void => {
    const expect = step.expect ?? {}
    for (const path of expect.has ?? []) if (pathOf(body, path) === undefined) unmet(run, label, `${step.method} ${url} has no ${path}: ${said}`)
    for (const [path, want] of Object.entries(expect.equals ?? {})) {
        const got = pathOf(body, path)
        if (!isDeepStrictEqual(got, deepExpand(run, want))) unmet(run, label, `${step.method} ${url}: ${path} is ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`)
    }
    for (const [name, path] of Object.entries(step.save ?? {})) {
        const value = pathOf(body, path)
        if (value === undefined) unmet(run, label, `no ${path} to save as ${name}: ${said}`)
        run.vars.set(name, typeof value === "string" ? value : JSON.stringify(value))
    }
}

/** One HTTP request to a served verb, held to its expected status, text, JSON paths and values. */
const http = async (run: RunState, step: NonNullable<Step["http"]>, label: string): Promise<void> => {
    const url = expand(run, step.url)
    const response = await fetch(url, requestInit(run, step)).catch((error: unknown) => unmet(run, label, `${step.method} ${url} failed: ${error instanceof Error ? error.message : String(error)}`))
    const expect = step.expect ?? {}
    const contains = expect.contains === undefined ? undefined : expand(run, expect.contains)
    const stream = step.stream === true
    const text = stream ? await readStream(response, contains) : await response.text()
    const said = `${String(response.status)} ${text.slice(0, 300)}`
    const status = expect.status ?? 200
    if (response.status !== status) unmet(run, label, `${step.method} ${url}: expected status ${String(status)}, got ${said}`)
    if (contains !== undefined && !text.includes(contains)) unmet(run, label, `${step.method} ${url} lacks "${contains}": ${said}`)
    holdBody(run, step, url, responseBody(text, stream), said, label)
}

/** Runs a step's SQL on a store of the run. */
const execSql = (run: RunState, sql: NonNullable<Step["sql"]>, label: string): void => {
    const handle = openDb(run, sql.db, label, sql.repo)
    try {
        handle.exec(expand(run, sql.exec))
    } finally {
        handle.close()
    }
}

/** Saves the first value a query returns as a variable of the run. */
const readVar = (run: RunState, read: NonNullable<Step["read"]>, label: string): void => {
    const [first] = query(run, read.db, read.query, label, read.repo) as unknown[]
    const value = Array.isArray(first) ? (first as unknown[])[0] : first
    if (value === undefined || value === null) unmet(run, label, `${read.query} returned nothing to save as ${read.as}`)
    run.vars.set(read.as, typeof value === "string" ? value : JSON.stringify(value))
}

const execute = async (run: RunState, step: Step, index: number): Promise<void> => {
    const named = step.name === undefined ? "" : " (" + step.name + ")"
    const label = `step ${String(index + 1)}${named}`
    writeFiles(run, step)
    if (step.remove !== undefined) rmSync(inRepo(run, step.remove), { force: true, recursive: true })
    if (step.orca !== undefined) orcaScript(run, step.orca)
    if (step.sql !== undefined) execSql(run, step.sql, label)
    if (step.git !== undefined) {
        const done = await git(run, step.git.map((arg) => expand(run, arg)))
        const want = step.expect?.exit ?? 0
        if (done.exitCode !== want) unmet(run, label, `git ${step.git.join(" ")} exited ${String(done.exitCode)}: ${done.stderr.slice(0, 300)}`)
        for (const [name, path] of Object.entries(step.save ?? {})) {
            if (path !== "stdout") unmet(run, label, `a git step saves only its stdout, not ${path}`)
            run.vars.set(name, done.stdout.trim())
        }
    }
    if (step.boot !== undefined) await boot(run, step.boot, label)
    if (step.read !== undefined) readVar(run, step.read, label)
    if (step.worker !== undefined) await worker(run, step.worker, label)
    if (step.serve !== undefined) await serve(run, step.serve, label)
    if (step.http !== undefined) await http(run, step.http, label)
    if (step.starci !== undefined) await Promise.all(Array.from({ length: step.parallel ?? 1 }, async () => starci(run, step, label)))
    if (step.assert !== undefined) await check(run, step.assert, label)
}

const stamp = (): string => new Date().toISOString().replaceAll(/[:.]/g, "-")

const setUp = async (scenario: Scenario, fault: string | null): Promise<RunState> => {
    const faultSuffix = fault === null ? "" : "-" + fault
    const dir = join(stateBase(), "bench", `${stamp()}-${scenario.id}${faultSuffix}`)
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
        // The host's own Codex usage never reaches a scenario: its Codex home is the run's empty folder.
        CODEX_HOME: join(dir, "codex"),
        // The host's secret.env never reaches a scenario: the secret loader reads the run's own file, absent until a step writes it.
        STARCI_SECRET_ENV: join(dir, "secret.env"),
        NODE_OPTIONS: `--import=${stub}`,
    }
    const run: RunState = { scenario, dir, repo, state, orcaState, orcaLog, env: {}, vars: new Map(), failures: [], served: [], key: `${["AK", "IA"].join("")}${randomBytes(8).toString("hex").toUpperCase()}` }
    const withEnv: RunState = { ...run, env: { ...env, ...Object.fromEntries(Object.entries(scenario.env ?? {}).map(([key, value]) => [key, expand(run, value)])) } }
    const repos: readonly [string, Readonly<Record<string, string>> | undefined][] = [[repo, scenario.repo?.files], ...Object.entries(scenario.repos ?? {}).map(([name, files]): [string, Readonly<Record<string, string>> | undefined] => [join(dir, name), files.files])]
    for (const [path] of repos.slice(1)) mkdirSync(path, { recursive: true })
    await inOrder(repos, async ([path, given]) => {
        await inOrder([["init", "-q", "-b", "main"], ["config", "user.email", "bench@starci.local"], ["config", "user.name", "starci bench"], ["config", "core.autocrlf", "false"]], (args) => git(withEnv, args, path))
        for (const [file, content] of Object.entries(given ?? { "README.md": "# bench scratch repository\n" })) writeText(join(path, file), expand(withEnv, content), false)
        await git(withEnv, ["add", "-A"], path)
        await git(withEnv, ["commit", "-q", "-m", "bench: scratch repository"], path)
    })
    for (const name of Object.keys(scenario.repos ?? {})) withEnv.vars.set(`repo.${name}`, join(dir, name))
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
    // A step runs only under its `when` fault and never under its `unless` one; its number counts every step of the scenario.
    const steps = (scenario.steps ?? []).map((step, index) => ({ step, index })).filter(({ step }) => (step.when === undefined || step.when === fault) && step.unless !== fault)
    try {
        await inOrder(steps, ({ step, index }) => execute(run, step, index))
    } catch (error: unknown) {
        verdict = error instanceof Unmet ? "fail" : "error"
        if (!(error instanceof Unmet)) run.failures.push(`bench error: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
        for (const served of run.served) served.stop()
    }
    const result: ScenarioResult = { ...base, verdict, failures: run.failures, runDir: run.dir, ms: Date.now() - started }
    writeFileSync(join(run.dir, "result.json"), JSON.stringify(result, null, 2))
    return result
}

