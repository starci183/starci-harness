// The bench's Orca stand-in. It is preloaded (NODE_OPTIONS --import) into every node process of a bench run and acts only
// in a copy of node named orca(.exe), which the runner points STARCI_ORCA_BIN at; anywhere else it returns at once.
// It answers the subset of the orca CLI the harness client calls, records every call, and replays the faults the scenario
// scripted in its state file (STARCI_BENCH_ORCA). It never launches anything.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { basename } from "node:path"
import { createHash } from "node:crypto"

const self = basename(process.execPath).toLowerCase()

const parseFlags = (args) => {
    const flags = {}
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index]
        if (!arg.startsWith("--")) continue
        const next = args[index + 1]
        if (next === undefined || next.startsWith("--")) flags[arg.slice(2)] = true
        else {
            flags[arg.slice(2)] = next
            index += 1
        }
    }
    return flags
}

const idOf = (prefix, seed) => `${prefix}-${createHash("sha256").update(seed).digest("hex").slice(0, 10)}`

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

const answer = (reply, exitCode) => {
    if (reply !== undefined) process.stdout.write(typeof reply === "string" ? reply : `${JSON.stringify(reply)}\n`)
    process.exit(exitCode)
}

const defaults = (command, flags, state) => {
    switch (command) {
        case "--version":
            return { ok: true, result: { version: "bench-stub" } }
        case "run-create": {
            const id = idOf("run", flags["retry-request"] ?? String(state.calls))
            return { ok: true, result: { run: { id } } }
        }
        case "run-use":
            return { ok: true, result: { run: { id: flags.id } } }
        case "task-create":
            return { ok: true, result: { task: { id: idOf("otask", flags["retry-request"] ?? String(state.calls)) } } }
        case "worker-start": {
            const key = flags["retry-request"] ?? String(state.calls)
            const known = state.dispatches[key]
            const dispatchId = known?.dispatchId ?? idOf("dispatch", key)
            const terminal = known?.terminal ?? idOf("term", key)
            state.dispatches[key] = { dispatchId, terminal, title: flags["task-title"], state: "ready", replays: (known?.replays ?? -1) + 1 }
            state.workers[dispatchId] = state.workers[dispatchId] ?? "ready"
            state.terminals[terminal] = true
            const effective = { agent: state.effectiveAgent ?? flags.agent, model: state.effectiveModel ?? flags.model }
            return { ok: true, result: { dispatchId, taskId: idOf("otask", key), runId: flags.run ?? null, state: "ready", worker: { agentTerminalHandle: terminal, state: "ready" }, launch: { effective } } }
        }
        case "worker-show": {
            const worker = state.workers[flags.dispatch]
            if (worker === undefined) return { ok: false, error: { code: "dispatch_not_found", message: "no such dispatch" } }
            const terminal = Object.values(state.dispatches).find((entry) => entry.dispatchId === flags.dispatch)?.terminal ?? null
            return { ok: true, result: { dispatch: { id: flags.dispatch }, worker: { state: worker, agentTerminalHandle: terminal }, observation: { status: worker } } }
        }
        case "worker-stop":
            if (state.workers[flags.dispatch] !== undefined) state.workers[flags.dispatch] = "stopped"
            return { ok: true, result: { state: "stopped" } }
        case "worker-release":
            if (state.workers[flags.dispatch] !== undefined) state.workers[flags.dispatch] = "released"
            return { ok: true, result: { state: "released" } }
        case "terminal create": {
            const handle = idOf("term", `${flags.title}\0${String(state.calls)}`)
            state.terminals[handle] = true
            return { ok: true, result: { terminal: { handle } } }
        }
        case "terminal list":
            return { ok: true, result: { terminals: Object.keys(state.terminals).filter((handle) => state.terminals[handle]).map((handle) => ({ handle })) } }
        case "terminal close":
            if (state.terminals[flags.terminal] !== true) return { ok: false, error: { code: "terminal_not_found", message: "gone" } }
            state.terminals[flags.terminal] = false
            return { ok: true, result: { closed: true } }
        case "terminal rename":
        case "repo add":
        case "check":
        case "send":
            return { ok: true, result: {} }
        default:
            return { ok: false, error: { code: "unknown_command", message: `the bench stub does not know ${command}` } }
    }
}

const commandOf = (args) => {
    if (args[0] === "--version") return "--version"
    if (args[0] === "orchestration") return args[1]
    return `${args[0]} ${args[1]}`
}

if (self === "orca" || self === "orca.exe") {
    const args = process.argv.slice(1).map((arg, index) => (index === 0 ? basename(arg) : arg))
    const statePath = process.env.STARCI_BENCH_ORCA
    const state = statePath !== undefined && existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {}
    state.calls = (state.calls ?? 0) + 1
    state.dispatches = state.dispatches ?? {}
    state.workers = state.workers ?? {}
    state.terminals = state.terminals ?? {}
    state.rules = state.rules ?? []
    const command = commandOf(args)
    const flags = parseFlags(args)
    const rule = state.rules.find((candidate) => candidate.command === command && (candidate.times ?? 1) > 0)
    if (rule !== undefined) rule.times = (rule.times ?? 1) - 1
    const save = () => {
        if (statePath !== undefined) writeFileSync(statePath, JSON.stringify(state, null, 2))
        if (process.env.STARCI_BENCH_ORCA_LOG !== undefined) appendFileSync(process.env.STARCI_BENCH_ORCA_LOG, `${JSON.stringify({ command, flags, fault: rule?.fault ?? null })}\n`)
    }
    if (rule === undefined || rule.fault === "pass") {
        const reply = defaults(command, flags, state)
        save()
        answer(reply, reply.ok ? 0 : 1)
    }
    // A fault that still acts (lost reply, slow reply) lets the default happen first: Orca did it, the answer went missing.
    if (rule.fault === "lost-reply" || rule.fault === "slow") {
        const reply = defaults(command, flags, state)
        save()
        if (rule.fault === "slow") sleep(rule.ms ?? 1000)
        answer(rule.fault === "lost-reply" ? undefined : reply, 0)
    }
    save()
    if (rule.fault === "refuse") answer({ ok: false, error: { code: rule.code ?? "refused", message: rule.message ?? "refused by the bench" }, result: rule.result }, 1)
    if (rule.fault === "unknown") answer({ ok: false, error: { message: "outcome unknown" }, result: { state: "outcome_unknown" } }, 1)
    if (rule.fault === "garbage") answer("<html>not json</html>\n", 0)
    if (rule.fault === "crash") answer(undefined, 3)
    if (rule.fault === "reply") answer(rule.reply, rule.exit ?? 0)
    answer({ ok: false, error: { code: "bench_rule", message: `unknown fault ${String(rule.fault)}` } }, 1)
}
