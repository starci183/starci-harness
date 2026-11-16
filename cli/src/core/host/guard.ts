import { readFileSync } from "node:fs"
import { installRefusals } from "../../harness/install-guard.js"
import type { InstallRefusal } from "../../harness/install-guard.js"
import { Refusal } from "../../shared/errors.js"
import { BOTH_EDITIONS, defineVerb, EVERYONE } from "../../shared/verb.js"

interface GuardData {
    readonly command: string
    readonly cwd: string
    readonly refusals: readonly InstallRefusal[]
    readonly verdict: "allow" | "deny"
}

/** The command and folder a host's pre-tool hook hands over on stdin: `{ tool_input: { command }, cwd }` (Claude Code, Codex and Devin alike). */
const hookInput = (fallbackCwd: string): { command: string; cwd: string } => {
    const raw = readFileSync(0, "utf8")
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        throw new Refusal("HOST_GUARD_INPUT", "the hook input on stdin is no JSON object with tool_input.command")
    }
    const record = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {}
    const input = typeof record.tool_input === "object" && record.tool_input !== null ? (record.tool_input as Record<string, unknown>) : {}
    const command = typeof input.command === "string" ? input.command : ""
    return { command, cwd: typeof record.cwd === "string" && record.cwd !== "" ? record.cwd : fallbackCwd }
}

/**
 * `starci host guard <command...>`: judges a shell command line before it runs (contexts/harness/host.md "Dependencies through a link"):
 * every npm, pnpm or yarn command of it that writes a node_modules, chained, backgrounded or wrapped, is refused when its target's
 * node_modules is a junction or symlink, or a real folder another worktree links to. With `--hook` it reads a host's pre-tool hook input
 * on stdin and answers with the host's deny decision, so every agent host runs the same guard.
 */
export const hostGuardVerb = defineVerb({
    path: ["host", "guard"],
    summary: "judge a shell command line before it runs: an npm, pnpm or yarn command that writes node_modules (ci, install, i, uninstall, update, prune, dedupe, rebuild, link and their aliases), chained, in the background or wrapped (&&, ;, |, &, start /b, cmd /c, sh -c), is refused when its target node_modules is a junction or symlink or another worktree's node_modules links to it; --hook reads a pre-tool hook's JSON on stdin and prints the deny decision",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/host-guard@1",
    flags: {
        line: { kind: "rest", summary: "the command line to judge (with --hook: read from stdin)" },
        hook: { kind: "boolean", summary: "read the host's pre-tool hook input ({ tool_input: { command }, cwd }) on stdin and print its permission decision" },
    },
    run: (context, flags) => {
        const { command, cwd } = flags.hook ? hookInput(context.cwd) : { command: flags.line.join(" "), cwd: context.cwd }
        const refusals = command.trim() === "" ? [] : installRefusals(command, cwd)
        const data: GuardData = { command, cwd, refusals, verdict: refusals.length === 0 ? "allow" : "deny" }
        const reason = refusals.map((refusal) => `${refusal.command}: ${refusal.message}`).join("\n")
        if (flags.hook) {
            const decision = refusals.length === 0 ? {} : { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `starci host guard (contexts/harness/host.md): ${reason}` } }
            return Promise.resolve({ data, message: JSON.stringify(decision) })
        }
        return Promise.resolve({ data, message: refusals.length === 0 ? "allow: no command writes node_modules through a link" : `deny\n${reason}`, ...(refusals.length === 0 ? {} : { exitCode: 1 }) })
    },
})
