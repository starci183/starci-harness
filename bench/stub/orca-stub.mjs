// The bench's Orca stand-in. It is preloaded (NODE_OPTIONS --import) into every node process of a bench run and acts only
// in a copy of node named orca(.exe), which the runner points STARCI_ORCA_BIN at; anywhere else it returns at once.
// It answers the subset of the orca CLI the harness client calls (the coordinator tree included: agent launch, Runs bound to
// a coordinator terminal, tasks, workers nested under a parent, request-show, the mailboxes of check and send), records every
// call, and replays the faults the scenario scripted in its state file (STARCI_BENCH_ORCA). Its idle signals are scripted too:
// `tuiIdle` (terminal wait --for tui-idle), `lastOutput` (terminal list), `idleSince`, `heartbeat` and `agentWait` (worker-show),
// and `terminal send` keeps every prompt typed by its retry-request in `typed`. `terminal list` shows each terminal's `titles`
// entry (its last rename, or a scripted one) and its `orphaned` flag. It never launches anything.
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

const refuse = (code, message) => ({ ok: false, error: { code, message } })

// Every mutation Orca took under a retry-request id: request-show reads it back, a replay answers the first outcome.
const remember = (state, flags) => {
    if (typeof flags["retry-request"] === "string") state.requests[flags["retry-request"]] = "completed"
}

// Orca authorizes a dispatch into a Run only from the terminal bound to it as coordinator (run-create or run-use --from).
const coordinatorRefusal = (state, run, from) => {
    if (run === undefined) return undefined
    const known = state.runs[run]
    if (known === undefined) return refuse("run_not_found", `no run ${run}`)
    if (from !== known.coordinator) return refuse("not_run_coordinator", `${String(from)} is not the coordinator of ${run}`)
    if (state.terminals[from] !== true) return refuse("terminal_not_found", `coordinator terminal ${from} is gone`)
    return undefined
}

const mailbox = (state, to) => {
    state.mail[to] = state.mail[to] ?? []
    return state.mail[to]
}

const defaults = (command, flags, state) => {
    switch (command) {
        case "--version":
            return { ok: true, result: { version: "bench-stub" } }
        case "agent launch": {
            // A coordinator in a terminal; --retry-launch replays the operation it names, never a second terminal.
            const operation = flags["retry-launch"] ?? idOf("op", `${String(flags.prompt)}\0${String(state.calls)}`)
            const known = state.launches[operation]
            const handle = known ?? idOf("term", `agent\0${operation}`)
            state.launches[operation] = handle
            if (known === undefined) state.terminals[handle] = true
            state.agents[handle] = { agent: flags.agent, model: flags.model ?? null, prompt: flags.prompt, operation }
            return { ok: true, result: { operationId: operation, outcome: { kind: "terminal", handle } } }
        }
        case "run-create": {
            const id = idOf("run", flags["retry-request"] ?? String(state.calls))
            if (state.runs[id] === undefined) state.runs[id] = { coordinator: flags.from ?? null, objective: flags.objective }
            remember(state, flags)
            return { ok: true, result: { run: { id } } }
        }
        case "run-use": {
            if (state.runs[flags.id] === undefined) return refuse("run_not_found", `no run ${String(flags.id)}`)
            state.runs[flags.id].coordinator = flags.from ?? null
            return { ok: true, result: { run: { id: flags.id } } }
        }
        case "task-create": {
            const denied = coordinatorRefusal(state, flags.run, flags.from)
            if (denied !== undefined) return denied
            const id = idOf("otask", flags["retry-request"] ?? String(state.calls))
            state.tasks[id] = { run: flags.run, title: flags["task-title"] }
            remember(state, flags)
            return { ok: true, result: { task: { id } } }
        }
        case "worker-start": {
            const key = flags["retry-request"] ?? String(state.calls)
            const known = state.dispatches[key]
            if (known === undefined) {
                const denied = coordinatorRefusal(state, flags.run, flags.from)
                if (denied !== undefined) return denied
                if (flags.parent !== undefined && state.tasks[flags.parent]?.run !== flags.run) return refuse("parent_not_in_run", `task ${String(flags.parent)} is not of run ${String(flags.run)}`)
            }
            const dispatchId = known?.dispatchId ?? idOf("dispatch", key)
            const terminal = known?.terminal ?? idOf("term", key)
            const title = flags["task-title"]
            const kind = typeof title === "string" && title.startsWith("[Kernel]") ? "kernel" : "op"
            state.dispatches[key] = { dispatchId, terminal, title, kind, run: flags.run ?? null, parent: flags.parent ?? null, state: "ready", replays: (known?.replays ?? -1) + 1 }
            // `newWorkerState` scripts the state a new worker starts in (start_unknown: Orca submitted the prompt, the turn never began).
            state.workers[dispatchId] = state.workers[dispatchId] ?? state.newWorkerState ?? "ready"
            if (known === undefined) state.terminals[terminal] = true
            const taskId = idOf("otask", key)
            state.tasks[taskId] = { run: flags.run ?? null, title }
            remember(state, flags)
            // request-show reads the receipt back: the dispatch the request made.
            if (typeof flags["retry-request"] === "string") state.receipts = { ...(state.receipts ?? {}), [flags["retry-request"]]: { dispatchId } }
            const effective = { agent: state.effectiveAgent ?? flags.agent, model: state.effectiveModel ?? flags.model }
            return { ok: true, result: { dispatchId, taskId, runId: flags.run ?? null, state: "ready", worker: { agentTerminalHandle: terminal, state: "ready" }, launch: { effective } } }
        }
        case "worker-show": {
            const worker = state.workers[flags.dispatch]
            if (worker === undefined) return refuse("dispatch_not_found", "no such dispatch")
            const terminal = Object.values(state.dispatches).find((entry) => entry.dispatchId === flags.dispatch)?.terminal ?? null
            const idle = state.idleSince?.[flags.dispatch]
            const heartbeat = state.heartbeat?.[flags.dispatch]
            const agentWait = state.agentWait?.[flags.dispatch]
            return {
                ok: true,
                result: {
                    dispatch: { id: flags.dispatch, ...(heartbeat === undefined ? {} : { lastHeartbeatAt: heartbeat }) },
                    worker: { state: worker, agentTerminalHandle: terminal },
                    observation: { status: worker, ...(idle === undefined ? {} : { lastOutputAt: idle }), ...(agentWait === undefined ? {} : { agentWait }) },
                },
            }
        }
        case "worker-stop":
            if (state.workers[flags.dispatch] !== undefined) state.workers[flags.dispatch] = "stopped"
            return { ok: true, result: { state: "stopped" } }
        case "worker-release":
            if (state.workers[flags.dispatch] !== undefined) state.workers[flags.dispatch] = "released"
            return { ok: true, result: { state: "released" } }
        case "worker-abandon":
            if (state.workers[flags.dispatch] !== undefined) state.workers[flags.dispatch] = "abandoned"
            remember(state, flags)
            return { ok: true, result: { state: "abandoned" } }
        case "request-show": {
            const known = state.requests[flags.request]
            const receipt = state.receipts?.[flags.request]
            return { ok: true, result: { state: known ?? "absent", ...(known === undefined || receipt === undefined ? {} : { receipt }) } }
        }
        case "check": {
            // The coordinator's mailbox (its Run): --ack acknowledges a delivery, the reply is the oldest unacknowledged batch.
            const box = mailbox(state, `run:${String(flags.run)}`)
            if (typeof flags.ack === "string") for (const message of box) if (message.delivery === flags.ack) message.acked = true
            const open = box.filter((message) => message.acked !== true)
            if (open.length === 0) return { ok: true, result: { delivery: null } }
            const delivery = idOf("delivery", `${String(flags.run)}\0${String(state.calls)}`)
            const batch = open.slice(0, state.batchSize ?? 5)
            for (const message of batch) message.delivery = delivery
            state.deliveries = (state.deliveries ?? 0) + 1
            return { ok: true, result: { delivery: { id: delivery, messages: batch.map(({ id, type, subject, body, payload, from }) => ({ id, type, subject, body, payload, from })) } } }
        }
        case "send": {
            const key = flags["retry-request"]
            if (key !== undefined && state.sent[key] !== undefined) return { ok: true, result: { message: { id: state.sent[key] } } }
            const id = idOf("msg", key ?? String(state.calls))
            let payload = flags.payload
            try {
                payload = JSON.parse(String(flags.payload))
            } catch {
                // a payload Orca cannot read is kept as text
            }
            mailbox(state, String(flags.to)).push({ id, type: flags.type ?? "status", subject: flags.subject ?? "", body: flags.body ?? "", payload, from: flags.from ?? null })
            if (key !== undefined) state.sent[key] = id
            return { ok: true, result: { message: { id } } }
        }
        case "terminal create": {
            const handle = idOf("term", `${flags.title}\0${String(state.calls)}`)
            state.terminals[handle] = true
            return { ok: true, result: { terminal: { handle } } }
        }
        case "terminal list":
            // Each terminal's title (the last rename, or what the scenario scripted) and whether it is orphaned, as Orca lists them.
            return {
                ok: true,
                result: {
                    terminals: Object.keys(state.terminals)
                        .filter((handle) => state.terminals[handle])
                        .map((handle) => ({ handle, lastOutputAt: state.lastOutput?.[handle] ?? null, title: state.titles?.[handle] ?? null, orphaned: state.orphaned?.[handle] === true })),
                },
            }
        case "terminal show":
            if (state.terminals[flags.terminal] !== true) return refuse("terminal_not_found", "gone")
            return { ok: true, result: { terminal: { handle: flags.terminal, lastOutputAt: state.lastOutput?.[flags.terminal] ?? null, agentWait: null } } }
        case "terminal read":
            // The rendered rows a scenario set for the terminal (`screens`), else none.
            if (state.terminals[flags.terminal] !== true) return refuse("terminal_not_found", "gone")
            return { ok: true, result: { terminal: { handle: flags.terminal, status: "running", tail: (state.screens?.[flags.terminal] ?? []).slice(-Number(flags.limit ?? 40)), source: "screen" } } }
        case "terminal wait": {
            // tui-idle is satisfied for a terminal the scenario marked idle at its prompt; any other wait times out as Orca's does.
            if (state.terminals[flags.terminal] !== true) return refuse("terminal_not_found", "gone")
            if (flags.for === "tui-idle" && state.tuiIdle?.[flags.terminal] === true) return { ok: true, result: { wait: { handle: flags.terminal, condition: "tui-idle", satisfied: true, status: "running", exitCode: null } } }
            return refuse("timeout", "timeout")
        }
        case "terminal send": {
            // A nudge typed into a terminal; the same retry-request is one prompt, never typed twice.
            if (state.terminals[flags.terminal] !== true) return refuse("terminal_not_found", "gone")
            const key = flags["retry-request"] ?? String(state.calls)
            state.typed = state.typed ?? {}
            if (state.typed[key] === undefined) state.typed[key] = { terminal: flags.terminal, text: flags.text, enter: flags.enter === true }
            return { ok: true, result: { accepted: true, retryRequest: key } }
        }
        case "terminal close":
            if (state.terminals[flags.terminal] !== true) return refuse("terminal_not_found", "gone")
            state.terminals[flags.terminal] = false
            return { ok: true, result: { closed: true } }
        case "terminal rename":
            if (typeof flags.terminal === "string" && typeof flags.title === "string") state.titles = { ...(state.titles ?? {}), [flags.terminal]: flags.title }
            return { ok: true, result: {} }
        case "repo add":
            return { ok: true, result: {} }
        default:
            return refuse("unknown_command", `the bench stub does not know ${command}`)
    }
}

const commandOf = (args) => {
    if (args[0] === "--version") return "--version"
    if (args[0] === "orchestration") return args[1]
    return `${args[0]} ${args[1]}`
}

// A rule acts on its command, and when it names `match`, only on calls whose flags each match the given regular expression.
const matches = (rule, command, flags) =>
    rule.command === command && (rule.times ?? 1) > 0 && Object.entries(rule.match ?? {}).every(([name, pattern]) => new RegExp(String(pattern)).test(String(flags[name] ?? "")))

if (self === "orca" || self === "orca.exe") {
    const args = process.argv.slice(1).map((arg, index) => (index === 0 ? basename(arg) : arg))
    const statePath = process.env.STARCI_BENCH_ORCA
    const state = statePath !== undefined && existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {}
    state.calls = (state.calls ?? 0) + 1
    for (const key of ["dispatches", "workers", "terminals", "launches", "agents", "runs", "tasks", "requests", "mail", "sent"]) state[key] = state[key] ?? {}
    state.rules = state.rules ?? []
    const command = commandOf(args)
    const flags = parseFlags(args)
    const rule = state.rules.find((candidate) => matches(candidate, command, flags))
    if (rule !== undefined) rule.times = (rule.times ?? 1) - 1
    const save = (reply) => {
        if (statePath !== undefined) writeFileSync(statePath, JSON.stringify(state, null, 2))
        if (process.env.STARCI_BENCH_ORCA_LOG !== undefined) {
            const refused = reply !== undefined && reply.ok === false ? (reply.error?.code ?? "refused") : null
            appendFileSync(process.env.STARCI_BENCH_ORCA_LOG, `${JSON.stringify({ command, flags, fault: rule?.fault ?? null, refused })}\n`)
        }
    }
    if (rule === undefined || rule.fault === "pass") {
        const reply = defaults(command, flags, state)
        save(reply)
        answer(reply, reply.ok ? 0 : 1)
    }
    // A fault that still acts (lost reply, slow reply) lets the default happen first: Orca did it, the answer went missing.
    if (rule.fault === "lost-reply" || rule.fault === "slow") {
        const reply = defaults(command, flags, state)
        save(reply)
        if (rule.fault === "slow") sleep(rule.ms ?? 1000)
        answer(rule.fault === "lost-reply" ? undefined : reply, 0)
    }
    // Orca made the dispatch and its agent terminal and typed the prompt, but never saw the turn start: worker-start exits 1 with
    // outcome_unknown naming both, and the worker stays start_unknown, as Orca keeps it even once the agent runs.
    if (rule.fault === "turn-unobserved") {
        const reply = defaults(command, flags, state)
        if (reply.ok) state.workers[reply.result.dispatchId] = "start_unknown"
        save(reply)
        if (!reply.ok) answer(reply, 1)
        const terminal = reply.result.worker.agentTerminalHandle
        answer({ ok: false, result: { ...reply.result, state: "outcome_unknown", stage: "turn_start_unobserved", worker: { agentTerminalHandle: terminal, state: "start_unknown" }, effects: [{ kind: "terminal", role: "agent", action: "created", id: terminal }] } }, 1)
    }
    save(undefined)
    if (rule.fault === "refuse") answer({ ok: false, error: { code: rule.code ?? "refused", message: rule.message ?? "refused by the bench" }, result: rule.result }, 1)
    if (rule.fault === "unknown") answer({ ok: false, error: { message: "outcome unknown" }, result: { state: "outcome_unknown" } }, 1)
    if (rule.fault === "garbage") answer("<html>not json</html>\n", 0)
    if (rule.fault === "crash") answer(undefined, 3)
    if (rule.fault === "reply") answer(rule.reply, rule.exit ?? 0)
    answer({ ok: false, error: { code: "bench_rule", message: `unknown fault ${String(rule.fault)}` } }, 1)
}
