import { randomUUID } from "node:crypto"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"
import { coordinatorBrief } from "./coordinator-brief.js"
import { coordinatorLaunch } from "./coordinator-launch.js"
import { leaseEnd, loadCoordinatorLiveness, olderThan } from "./coordinator-liveness.js"
import { now, runtimeRoot } from "./ledger.js"
import { readMachine, withMachine } from "./machine.js"
import { agentLaunch, isSelectorNotFound, launchOperationOf, OrcaFailure, repoAdd, requestIdOf, runCreate, taskCreate, terminalClose, terminalList, terminalRename } from "./orca/client.js"
import type { AgentLaunchInput, OrcaBinary } from "./orca/client.js"
import { describeRoute, pickCoordinator, RouteRefusal } from "./router.js"
import { loadRouting, selectsModel } from "./routing.js"

/** The exact title of the host Supervisor's terminal and orchestration task. */
export const SUPERVISOR_TITLE = "[Supervisor]"

const supervisorSchema = z.object({
    id: z.string(),
    terminal: z.string().nullable(),
    run_id: z.string().nullable(),
    task_id: z.string().nullable(),
    agent: z.string(),
    model: z.string(),
    started_at: z.string(),
    ended_at: z.string().nullable(),
    lease_until: z.string().nullable(),
    launch_op: z.string().nullable(),
    launch_json: z.string().nullable(),
})

/** The singleton host Supervisor (machine.sqlite), including a launch reserved before Orca answered. */
export type SupervisorRecord = z.infer<typeof supervisorSchema>

/** Reads the host's live Supervisor reservation without creating a host store. */
export const supervisorRecord = (): SupervisorRecord | null =>
    readMachine((db) => {
        const row = db.prepare("SELECT * FROM supervisors WHERE ended_at IS NULL").get()
        return row === undefined ? null : supervisorSchema.parse(row)
    }, null)

/** Renews the Supervisor's TTL lease; every Supervisor verb (attach, next, submit) calls it. */
export const renewSupervisorLease = (id: string): void => {
    withMachine((db) => db.prepare("UPDATE supervisors SET lease_until = ? WHERE id = ? AND ended_at IS NULL").run(leaseEnd(loadCoordinatorLiveness().supervisorTtlMinutes), id))
}

/** An attached Supervisor: its terminal, Run and task are known. */
export type AttachedSupervisor = SupervisorRecord & { readonly terminal: string; readonly run_id: string; readonly task_id: string }

/** True when the caller runs in the attached Supervisor's own terminal (where Orca authorizes dispatches into its Run). */
export const inSupervisorTerminal = (seat: SupervisorRecord | null): seat is AttachedSupervisor =>
    seat?.terminal != null && seat.run_id !== null && seat.task_id !== null && process.env.ORCA_TERMINAL_HANDLE === seat.terminal

/** Requires the recorded Supervisor's own terminal, refusing SUPERVISOR_REQUIRED anywhere else; renews its lease. */
export const requireSupervisor = async (binary: OrcaBinary, cwd: string): Promise<AttachedSupervisor> => {
    const seat = supervisorRecord()
    if (!inSupervisorTerminal(seat)) throw new Refusal("SUPERVISOR_REQUIRED", "run this from the Supervisor's terminal; the owner starts it once with starci supervisor start")
    const live = await terminalList(binary, cwd)
    if (!live.truncated && !live.handles.has(seat.terminal)) throw new Refusal("SUPERVISOR_REQUIRED", "the Supervisor terminal is gone; run starci supervisor ensure")
    renewSupervisorLease(seat.id)
    return seat
}

/** The Supervisor's liveness: absent, starting (no terminal receipt yet), alive or gone by Orca's terminal list, or unknown. */
export type SupervisorLiveness = "absent" | "starting" | "alive" | "gone" | "unknown"

/** Reports Supervisor liveness from Orca's terminal inventory; an incomplete inventory or a silent Orca proves no absence. */
export const supervisorStatus = async (binary: OrcaBinary | undefined, cwd: string): Promise<{ readonly supervisor: SupervisorRecord | null; readonly liveness: SupervisorLiveness; readonly leaseExpired: boolean }> => {
    const supervisor = supervisorRecord()
    if (supervisor === null) return { supervisor, liveness: "absent", leaseExpired: false }
    const leaseExpired = supervisor.lease_until !== null && supervisor.lease_until < now()
    if (supervisor.terminal === null) return { supervisor, liveness: "starting", leaseExpired }
    if (binary === undefined) return { supervisor, liveness: "unknown", leaseExpired }
    try {
        const live = await terminalList(binary, cwd)
        return { supervisor, liveness: live.handles.has(supervisor.terminal) ? "alive" : live.truncated ? "unknown" : "gone", leaseExpired }
    } catch {
        return { supervisor, liveness: "unknown", leaseExpired }
    }
}

const launchOf = async (binary: OrcaBinary, cwd: string, input: AgentLaunchInput, agent: string): Promise<{ readonly terminal: string | null }> =>
    coordinatorLaunch({ agent, pool: agent }, async () => {
        try {
            return await agentLaunch(binary, input, runtimeRoot())
        } catch (error: unknown) {
            if (!isSelectorNotFound(error)) throw error
            await repoAdd(binary, runtimeRoot(), cwd)
            return agentLaunch(binary, input, runtimeRoot())
        }
    })

/** Sends (or replays with --retry-launch) the reserved launch and records its terminal, or the operation id an unknown answer names. */
const sendLaunch = async (binary: OrcaBinary, cwd: string, id: string, input: AgentLaunchInput, agent: string): Promise<void> => {
    try {
        const launched = await launchOf(binary, cwd, input, agent)
        if (launched.terminal !== null) {
            withMachine((db) => db.prepare("UPDATE supervisors SET terminal = COALESCE(terminal, ?) WHERE id = ? AND ended_at IS NULL").run(launched.terminal, id))
            await terminalRename(binary, launched.terminal, SUPERVISOR_TITLE, cwd)
        }
    } catch (error: unknown) {
        if (error instanceof OrcaFailure && error.effect === "none") withMachine((db) => db.prepare("UPDATE supervisors SET ended_at = ? WHERE id = ? AND terminal IS NULL").run(now(), id))
        else if (error instanceof OrcaFailure) {
            const operation = launchOperationOf(error)
            if (operation !== undefined) withMachine((db) => db.prepare("UPDATE supervisors SET launch_op = ? WHERE id = ?").run(operation, id))
        }
        throw error
    }
}

/**
 * Reserves the one host Supervisor, then launches the router's coordinator member with `orca agent launch` (terminal surface) in
 * the runtime checkout, pointing it at its brief under .runtime. A second start while one is alive refuses SUPERVISOR_RUNNING;
 * an unknown launch keeps its reservation (and the operation id to replay) instead of launching twice.
 */
export const startSupervisor = async (binary: OrcaBinary, cwd: string): Promise<SupervisorRecord> => {
    const status = await supervisorStatus(binary, cwd)
    const previous = status.supervisor
    if (previous !== null && status.liveness !== "gone") throw new Refusal("SUPERVISOR_RUNNING", `the Supervisor is ${status.liveness}; starci supervisor status, or stop it first`)
    if (previous !== null) withMachine((db) => db.prepare("UPDATE supervisors SET ended_at = ? WHERE id = ? AND ended_at IS NULL").run(now(), previous.id))
    const pick = pickCoordinator("supervisor")
    if (pick instanceof RouteRefusal) throw new Refusal(pick.code, describeRoute(pick).join("; "))
    const id = randomUUID()
    const prompt = coordinatorBrief({ role: "supervisor", root: runtimeRoot(), launchId: id, agent: pick.agent, model: pick.model })
    const input: AgentLaunchInput = { agent: pick.agent, ...(selectsModel(loadRouting(), pick.agent) ? { model: pick.model, effort: pick.effort } : {}), worktree: `path:${runtimeRoot().replaceAll("\\", "/")}`, prompt }
    withMachine((db) => {
        if (db.prepare("SELECT 1 FROM supervisors WHERE ended_at IS NULL").get() !== undefined) throw new Refusal("SUPERVISOR_RUNNING", "another Supervisor start reserved the host meanwhile")
        db.prepare("INSERT INTO supervisors (id, agent, model, started_at, lease_until, launch_json) VALUES (?, ?, ?, ?, ?, ?)").run(id, pick.agent, pick.model, now(), leaseEnd(loadCoordinatorLiveness().supervisorTtlMinutes), JSON.stringify(input))
    })
    await sendLaunch(binary, cwd, id, input, pick.agent)
    const seat = supervisorRecord()
    if (seat?.id !== id) throw new Refusal("SUPERVISOR_MOVED", "the Supervisor was stopped while it launched")
    return seat
}

/** What `supervisor ensure` did. */
export interface SupervisorEnsured {
    readonly action: "none" | "started" | "replayed" | "stuck"
    readonly liveness: SupervisorLiveness
    readonly supervisor: SupervisorRecord | null
    readonly detail: string
}

/**
 * Keeps one Supervisor alive (the Windows Task Scheduler entry runs this): absent or gone by Orca's word -> start; a reserved
 * launch with an unknown answer -> replay it with its operation id; no operation id past the effect-unknown deadline -> stuck
 * (reported, never relaunched blind); alive or unknown -> nothing. Unknown is not dead.
 */
export const ensureSupervisor = async (binary: OrcaBinary, cwd: string): Promise<SupervisorEnsured> => {
    const status = await supervisorStatus(binary, cwd)
    const { supervisor, liveness } = status
    if (liveness === "absent" || liveness === "gone") {
        const started = await startSupervisor(binary, cwd)
        return { action: "started", liveness, supervisor: started, detail: `started Supervisor ${started.agent}/${started.model}` }
    }
    if (liveness === "starting" && supervisor !== null) {
        if (supervisor.launch_op !== null && supervisor.launch_json !== null) {
            const input = { ...(JSON.parse(supervisor.launch_json) as AgentLaunchInput), retryLaunch: supervisor.launch_op }
            await sendLaunch(binary, cwd, supervisor.id, input, supervisor.agent)
            return { action: "replayed", liveness, supervisor: supervisorRecord(), detail: `replayed launch operation ${supervisor.launch_op}` }
        }
        if (olderThan(supervisor.started_at, loadCoordinatorLiveness().effectUnknownDeadlineMinutes)) {
            return { action: "stuck", liveness, supervisor, detail: "the reserved launch has no terminal and no operation id past the deadline; inspect Orca, then supervisor stop --abandon" }
        }
    }
    return { action: "none", liveness, supervisor, detail: status.leaseExpired ? "lease expired but Orca does not say gone: held" : "nothing to do" }
}

/** Binds only the reserved launch to its own Orca terminal and creates the Supervisor's Run and parent task idempotently. */
export const attachSupervisor = async (binary: OrcaBinary, cwd: string, launch: string): Promise<SupervisorRecord> => {
    const terminal = process.env.ORCA_TERMINAL_HANDLE
    const seat = supervisorRecord()
    if (terminal === undefined || terminal === "" || seat?.id !== launch || (seat.terminal !== null && seat.terminal !== terminal)) throw new Refusal("SUPERVISOR_ATTACH_REFUSED", "attach runs in the reserved Supervisor agent terminal with its launch id (the brief names both)")
    withMachine((db) => db.prepare("UPDATE supervisors SET terminal = ? WHERE id = ? AND ended_at IS NULL").run(terminal, launch))
    renewSupervisorLease(launch)
    await terminalRename(binary, terminal, SUPERVISOR_TITLE, cwd)
    const run = seat.run_id ?? (await runCreate(binary, { from: terminal, objective: "StarCi Supervisor: the owner channel", retryRequest: requestIdOf("supervisor-run", launch) }, cwd))
    withMachine((db) => db.prepare("UPDATE supervisors SET run_id = ? WHERE id = ? AND ended_at IS NULL").run(run, launch))
    const task = seat.task_id ?? (await taskCreate(binary, { spec: "StarCi host Supervisor: owner requests, workflows and Kernel escalations; the harness ledger owns state.", taskTitle: SUPERVISOR_TITLE, run, from: terminal, retryRequest: requestIdOf("supervisor-task", launch) }, cwd))
    withMachine((db) => db.prepare("UPDATE supervisors SET task_id = ? WHERE id = ? AND ended_at IS NULL").run(task, launch))
    return { ...seat, terminal, run_id: run, task_id: task }
}

/** Stops the host Supervisor's terminal and retires its reservation once Orca confirms the close; `abandon` retires a launch with no receipt. */
export const stopSupervisor = async (binary: OrcaBinary, cwd: string, abandon: boolean): Promise<{ readonly stopped: string | null }> => {
    const seat = supervisorRecord()
    if (seat === null) return { stopped: null }
    if (seat.terminal === null && !abandon) throw new Refusal("SUPERVISOR_LAUNCH_UNKNOWN", "the reserved launch has no terminal receipt; supervisor ensure replays it, or stop --abandon after checking Orca")
    if (seat.terminal !== null) await terminalClose(binary, seat.terminal, cwd)
    withMachine((db) => db.prepare("UPDATE supervisors SET ended_at = ? WHERE id = ?").run(now(), seat.id))
    return { stopped: seat.id }
}
