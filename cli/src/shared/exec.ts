import { spawn, spawnSync } from "node:child_process"
import type { ChildProcess, ChildProcessByStdio } from "node:child_process"
import type { Readable } from "node:stream"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { Refusal } from "./errors.js"

const MAX_BUFFER = 64 * 1024 * 1024

/** The exit code a run gets when its timeout killed it (the coreutils `timeout` convention). */
export const EXIT_TIMEOUT = 124

/** The captured output of one finished tool run. */
export interface ToolOutput {
    readonly stdout: string
    readonly stderr: string
}

/** The full result of a tool run whose failure is an answer, not an error (a red lint, a red typecheck); `timedOut` when its deadline killed it. */
export interface ToolRun extends ToolOutput {
    readonly exitCode: number
    readonly timedOut: boolean
}

/** How one tool runs: a deadline after which its whole process tree is killed, and extra environment variables. */
export interface RunOptions {
    readonly timeoutMs?: number
    readonly env?: Readonly<Record<string, string>>
}

interface Finished extends ToolRun {
    /** Why the process never started (ENOENT, EINVAL, EACCES ...), or undefined when it ran. */
    readonly notStarted: string | undefined
}

const errorCode = (error: unknown): unknown => (typeof error === "object" && error !== null && "code" in error ? error.code : undefined)

/** The line of a tool's stderr that says what went wrong: git's `fatal:` or `error:` line, else the first that is no warning or hint. */
export const headline = (stderr: string): string => {
    const lines = stderr.split("\n").map((line) => line.trim()).filter((line) => line !== "")
    return lines.find((line) => /^(?:fatal|error)\b/i.test(line)) ?? lines.find((line) => !/^(?:warning|hint)\b/i.test(line)) ?? lines[0] ?? ""
}

/** True while a process with this pid runs on this host; EPERM means it runs under another user. */
export const pidAlive = (pid: number): boolean => {
    try {
        process.kill(pid, 0)
        return true
    } catch (error: unknown) {
        return errorCode(error) === "EPERM"
    }
}

// A timeout must take the grandchildren too (npm's node, tsc, eslint workers): on Windows only taskkill /T reaches them,
// elsewhere the child leads its own process group and the whole group is killed.
const killTree = (child: ChildProcess): void => {
    const pid = child.pid
    if (pid === undefined) return
    if (process.platform === "win32") {
        spawnSync(join(process.env.SystemRoot ?? String.raw`C:\Windows`, "System32", "taskkill.exe"), ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
        return
    }
    try {
        process.kill(-pid, "SIGKILL")
    } catch {
        child.kill("SIGKILL")
    }
}

/** Collects one output stream up to MAX_BUFFER; the rest is dropped rather than failing the run. */
const collector = (): { readonly push: (chunk: Buffer) => void; readonly text: () => string } => {
    const chunks: Buffer[] = []
    let size = 0
    return {
        push: (chunk: Buffer): void => {
            if (size >= MAX_BUFFER) return
            chunks.push(chunk)
            size += chunk.length
        },
        text: (): string => Buffer.concat(chunks).toString("utf8").trim(),
    }
}

const execute = (tool: string, args: readonly string[], cwd: string, options: RunOptions): Promise<Finished> =>
    new Promise((settle) => {
        let timedOut = false
        let notStarted: string | undefined
        let timer: NodeJS.Timeout | undefined
        const stdout = collector()
        const stderr = collector()
        const env = options.env === undefined ? process.env : { ...process.env, ...options.env }
        const detached = options.timeoutMs !== undefined && process.platform !== "win32"
        let child: ChildProcessByStdio<null, Readable, Readable>
        try {
            child = spawn(tool, [...args], { cwd, env, windowsHide: true, detached, stdio: ["ignore", "pipe", "pipe"] })
        } catch (error: unknown) {
            // Windows refuses a .cmd or .bat synchronously (spawn EINVAL), before any process exists.
            const code = errorCode(error)
            settle({ exitCode: 1, stdout: "", stderr: error instanceof Error ? error.message : String(error), notStarted: typeof code === "string" ? code : "spawn failed", timedOut: false })
            return
        }
        child.stdout.on("data", stdout.push)
        child.stderr.on("data", stderr.push)
        let done = false
        const finish = (code: number | null): void => {
            if (done) return
            done = true
            if (timer !== undefined) clearTimeout(timer)
            const errors = stderr.text()
            const separator = errors === "" ? "" : "\n"
            const note = timedOut ? `${separator}timed out after ${String(Math.round((options.timeoutMs ?? 0) / 1000))}s; the process tree was killed` : ""
            settle({ exitCode: timedOut ? EXIT_TIMEOUT : (code ?? 1), stdout: stdout.text(), stderr: `${errors}${note}`, notStarted, timedOut })
        }
        child.on("error", (error: Error) => {
            stderr.push(Buffer.from(error.message))
            // A process that never started (it has no pid) emits no close; a kill error of a running one waits for its close.
            if (child.pid === undefined) {
                const code = errorCode(error)
                notStarted = typeof code === "string" ? code : "spawn failed"
                finish(null)
            }
        })
        child.on("close", finish)
        if (options.timeoutMs !== undefined) {
            timer = setTimeout(() => {
                timedOut = true
                killTree(child)
            }, options.timeoutMs)
        }
    })

/**
 * The refusal of a process that never started: CLI_TOOL_MISSING for ENOENT, CLI_TOOL_NOT_STARTED otherwise (EINVAL is what
 * Windows answers for a .cmd or .bat, which cannot run without a shell). Nothing ran, so the call had no effect.
 */
export class ToolNotStarted extends Refusal {
    public readonly reason: string

    public constructor(tool: string, cause: string) {
        const hint = cause === "EINVAL" ? "; a .cmd or .bat cannot run without a shell, name the .exe (or node.exe and its script) instead" : ""
        super(cause === "ENOENT" ? "CLI_TOOL_MISSING" : "CLI_TOOL_NOT_STARTED", cause === "ENOENT" ? `${tool} is not installed or not on PATH` : `${tool} could not be started: ${cause}${hint}`)
        this.name = "ToolNotStarted"
        this.reason = cause
    }
}

/** Runs a host tool without a shell (no quoting surprises) and refuses with a named code when it is missing, fails or times out. */
export const runTool = async (tool: string, args: readonly string[], cwd: string, options: RunOptions = {}): Promise<ToolOutput> => {
    const run = await execute(tool, args, cwd, options)
    if (run.notStarted !== undefined) throw new ToolNotStarted(tool, run.notStarted)
    if (run.timedOut) throw new Refusal("CLI_TOOL_TIMEOUT", `${tool} ${args.join(" ")} ${headline(run.stderr)}`)
    const reason = headline(run.stderr) || `exit ${String(run.exitCode)}`
    if (run.exitCode !== 0) throw new Refusal("CLI_TOOL_FAILED", `${tool} ${args.join(" ")} failed: ${reason}`)
    return { stdout: run.stdout, stderr: run.stderr }
}

/**
 * Runs a host tool and returns its exit code and output instead of throwing on a non-zero exit; a timeout exits EXIT_TIMEOUT with
 * `timedOut`. A process that never started is refused with ToolNotStarted.
 */
export const captureTool = async (tool: string, args: readonly string[], cwd: string, options: RunOptions = {}): Promise<ToolRun> => {
    const run = await execute(tool, args, cwd, options)
    if (run.notStarted !== undefined) throw new ToolNotStarted(tool, run.notStarted)
    return { exitCode: run.exitCode, stdout: run.stdout, stderr: run.stderr, timedOut: run.timedOut }
}

/** Runs a short host tool synchronously (for code that cannot await, such as opening the ledger), killed after `timeoutMs` when given; never throws. */
export const captureToolSync = (tool: string, args: readonly string[], cwd: string, timeoutMs?: number): ToolRun => {
    const run = spawnSync(tool, [...args], { cwd, windowsHide: true, encoding: "utf8", maxBuffer: MAX_BUFFER, ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }) })
    if (run.error !== undefined) return { exitCode: 1, stdout: "", stderr: run.error.message, timedOut: "code" in run.error && run.error.code === "ETIMEDOUT" }
    return { exitCode: run.status ?? 1, stdout: run.stdout.trim(), stderr: run.stderr.trim(), timedOut: false }
}

/** npm's own entry script next to this Node (npm.cmd cannot run without a shell on Windows); undefined when Node ships without npm. */
const npmEntry = (): string | undefined => {
    const nodeDir = dirname(process.execPath)
    const candidates = [join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"), join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")]
    return candidates.find((candidate) => existsSync(candidate))
}

/** Runs npm through the current Node, so no shell is involved on any platform. */
export const runNpm = async (args: readonly string[], cwd: string, options: RunOptions = {}): Promise<ToolOutput> => {
    const entry = npmEntry()
    if (entry === undefined) throw new Refusal("CLI_TOOL_MISSING", "npm is not bundled with this Node.js")
    return runTool(process.execPath, [entry, ...args], cwd, options)
}

/** Runs npm through the current Node and returns its exit code instead of throwing. */
export const captureNpm = async (args: readonly string[], cwd: string, options: RunOptions = {}): Promise<ToolRun> => {
    const entry = npmEntry()
    if (entry === undefined) throw new Refusal("CLI_TOOL_MISSING", "npm is not bundled with this Node.js")
    return captureTool(process.execPath, [entry, ...args], cwd, options)
}

/** Runs one argv without a shell; `npm` and `npx` go through the current Node's own scripts, so Windows .cmd shims are never needed. */
export const captureCommand = async (argv: readonly string[], cwd: string, options: RunOptions = {}): Promise<ToolRun> => {
    const [tool, ...args] = argv
    if (tool === undefined) throw new Refusal("CLI_USAGE", "an empty command cannot run")
    if (tool === "npm" || tool === "npx") {
        const entry = npmEntry()
        if (entry === undefined) throw new Refusal("CLI_TOOL_MISSING", "npm is not bundled with this Node.js")
        const script = tool === "npm" ? entry : join(dirname(entry), "npx-cli.js")
        return captureTool(process.execPath, [script, ...args], cwd, options)
    }
    if (tool === "node") return captureTool(process.execPath, args, cwd, options)
    return captureTool(tool, args, cwd, options)
}

/**
 * Starts a long-lived host program (a desktop app) without a shell and without waiting for it: detached, its output ignored,
 * so this CLI exits while it runs. Refuses with ToolNotStarted when the program could not be started.
 */
export const startDetached = (argv: readonly string[], cwd: string): Promise<void> =>
    new Promise((settle, refuse) => {
        const [tool, ...args] = argv
        if (tool === undefined) {
            refuse(new Refusal("CLI_USAGE", "an empty command cannot run"))
            return
        }
        let child: ChildProcess
        try {
            child = spawn(tool, args, { cwd, windowsHide: true, detached: true, stdio: "ignore" })
        } catch (error: unknown) {
            const code = errorCode(error)
            refuse(new ToolNotStarted(tool, typeof code === "string" ? code : "spawn failed"))
            return
        }
        child.once("error", (error: Error) => {
            const code = errorCode(error)
            refuse(new ToolNotStarted(tool, typeof code === "string" ? code : error.message))
        })
        child.once("spawn", () => {
            child.unref()
            settle()
        })
    })

/** Runs a host tool and reports whether it succeeded, never throwing; for probes such as doctor. */
export const probeTool = async (tool: string, args: readonly string[], cwd: string): Promise<string | undefined> => {
    try {
        return (await runTool(tool, args, cwd)).stdout
    } catch {
        return undefined
    }
}
