import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { promisify } from "node:util"
import { Refusal } from "./errors.js"

const execFileAsync = promisify(execFile)

/** The captured output of one finished tool run. */
export interface ToolOutput {
    readonly stdout: string
    readonly stderr: string
}

/** Runs a host tool without a shell (no quoting surprises) and refuses with a named code when it is missing or fails. */
export const runTool = async (tool: string, args: readonly string[], cwd: string): Promise<ToolOutput> => {
    try {
        const { stdout, stderr } = await execFileAsync(tool, [...args], { cwd, windowsHide: true, maxBuffer: 32 * 1024 * 1024 })
        return { stdout: stdout.trim(), stderr: stderr.trim() }
    } catch (error: unknown) {
        const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined
        if (code === "ENOENT") throw new Refusal("CLI_TOOL_MISSING", `${tool} is not installed or not on PATH`)
        const detail = error instanceof Error ? error.message.split("\n")[0] ?? error.message : String(error)
        throw new Refusal("CLI_TOOL_FAILED", `${tool} ${args.join(" ")} failed: ${detail}`)
    }
}

/** npm's own entry script next to this Node (npm.cmd cannot run without a shell on Windows); undefined when Node ships without npm. */
const npmEntry = (): string | undefined => {
    const nodeDir = dirname(process.execPath)
    const candidates = [join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"), join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")]
    return candidates.find((candidate) => existsSync(candidate))
}

/** Runs npm through the current Node, so no shell is involved on any platform. */
export const runNpm = async (args: readonly string[], cwd: string): Promise<ToolOutput> => {
    const entry = npmEntry()
    if (entry === undefined) throw new Refusal("CLI_TOOL_MISSING", "npm is not bundled with this Node.js")
    return runTool(process.execPath, [entry, ...args], cwd)
}

/** Runs a host tool and reports whether it succeeded, never throwing; for probes such as doctor. */
export const probeTool = async (tool: string, args: readonly string[], cwd: string): Promise<string | undefined> => {
    try {
        return (await runTool(tool, args, cwd)).stdout
    } catch {
        return undefined
    }
}
