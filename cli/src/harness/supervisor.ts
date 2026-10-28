import { randomUUID } from "node:crypto"
import { basename } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { z } from "zod"
import { asRefusal, Refusal } from "../shared/errors.js"
import { coordinatorBrief } from "./coordinator-brief.js"
import { coordinatorLaunch } from "./coordinator-launch.js"
import { leaseEnd, loadCoordinatorLiveness, olderThan } from "./coordinator-liveness.js"
import { now, runtimeRoot } from "./ledger.js"
import { readMachine, withMachine } from "./machine.js"
import { agentLaunch, isSelectorNotFound, launchOperationOf, locateOrca, mailSend, OrcaFailure, repoAdd, requestIdOf, runCreate, taskCreate, terminalClose, terminalList, terminalRename } from "./orca/client.js"
import type { AgentLaunchInput, MailSend, OrcaBinary } from "./orca/client.js"
import { describeRoute, pickCoordinator, RouteRefusal } from "./router.js"
import type { RouteMember } from "./router.js"
import { loadRouting, selectsModel } from "./routing.js"
import type { Project } from "./work.js"

/** The exact title of a project's Supervisor terminal and orchestration task: `[Supervisor] <project>`. */
export const supervisorTitle = (project: string): string => `[Supervisor] ${project}`

const supervisorSchema = z.object({
    id: z.string(),
    project: z.string(),
    project_root: z.string(),
    terminal: z.string().nullable(),
    run_id: z.string().nullable(),
    task_id: z.string().nullable(),
    agent: z.string(),
    model: z.string(),
    started_at: z.string(),
    ended_at: z.string().nullable(),
    ended_by: z.string().nullable(),
    lease_until: z.string().nullable(),
    launch_op: z.string().nullable(),
    launch_json: z.string().nullable(),
})

/** A project's Supervisor (machine.sqlite `project_supervisors`), including a launch reserved before Orca answered. */
export type SupervisorRecord = z.infer<typeof supervisorSchema>

/** Who retired a Supervisor row: the owner's stop, ensure finding its terminal gone, or the stall ladder replacing it. */
export type SupervisorEnd = "owner" | "gone" | "stalled"

/** The project a Supervisor row serves. */
export const projectOfRecord = (seat: SupervisorRecord): Project => ({ root: seat.project_root, key: seat.project, name: basename(seat.project_root) })

/** Reads a project's live Supervisor reservation without creating a host store. */
export const supervisorRecord = (project: string): SupervisorRecord | null =>
    readMachine((db) => {
        const row = db.prepare("SELECT * FROM project_supervisors WHERE project = ? AND ended_at IS NULL").get(project)
        return row === undefined ? null : supervisorSchema.parse(row)
    }, null)

/** Every live Supervisor of the host, one per project, oldest first. */
export const liveSupervisors = (): SupervisorRecord[] =>
    readMachine((db) => db.prepare("SELECT * FROM project_supervisors WHERE ended_at IS NULL ORDER BY started_at").all(), []).map((row) => supervisorSchema.parse(row))

/**
 * The projects whose Supervisor the host driver keeps: a live one, or one whose last Supervisor ended by anything but the owner's
 * `supervisor stop` (gone or stalled). The driver adds the projects that own running workflows.
 */
export const keptProjects = (): Project[] =>
    readMachine(
        (db) =>
            db
                .prepare("SELECT * FROM project_supervisors s WHERE started_at = (SELECT MAX(started_at) FROM project_supervisors WHERE project = s.project) AND (ended_at IS NULL OR ended_by IS NOT 'owner')")
                .all(),
        [],
    ).map((row) => projectOfRecord(supervisorSchema.parse(row)))

/** Renews a Supervisor's TTL lease; every Supervisor verb its seat runs (attach, next, submit) calls it. */
export const renewSupervisorLease = (id: string): void => {
    withMachine((db) => db.prepare("UPDATE project_supervisors SET lease_until = ? WHERE id = ? AND ended_at IS NULL").run(leaseEnd(loadCoordinatorLiveness().supervisorTtlMinutes), id))
}

/** An attached Supervisor: its terminal, Run and task are known. */
export type AttachedSupervisor = SupervisorRecord & { readonly terminal: string; readonly run_id: string; readonly task_id: string }

/** True when the caller runs in the attached Supervisor's own terminal (where Orca authorizes dispatches into its Run). */
export const inSupervisorTerminal = (seat: SupervisorRecord | null): seat is AttachedSupervisor =>
    seat?.terminal != null && seat.run_id !== null && seat.task_id !== null && process.env.ORCA_TERMINAL_HANDLE === seat.terminal

/** True when the Supervisor record is attached: its terminal, Run and task are known (wherever the caller runs). */
export const isAttached = (seat: SupervisorRecord | null): seat is AttachedSupervisor => seat?.terminal != null && seat.run_id !== null && seat.task_id !== null

/**
 * Requires the project's Supervisor in its own terminal, refusing SUPERVISOR_REQUIRED anywhere else, and renews its lease. The
 * host driver (`supervisor tick`) passes the attached record it acts for, which must be the project's: it dispatches with that
 * Supervisor's identity and renews nothing, since the lease measures the Supervisor's own calls.
 */
export const requireSupervisor = async (binary: OrcaBinary, cwd: string, project: Project, acting?: AttachedSupervisor): Promise<AttachedSupervisor> => {
    const start = `the owner starts it once with starci supervisor start --project ${project.root}`
    const seat = acting ?? supervisorRecord(project.key)
    if (acting === undefined && !inSupervisorTerminal(seat)) throw new Refusal("SUPERVISOR_REQUIRED", `run this from the terminal of ${supervisorTitle(project.name)}; ${start}`)
    if (!isAttached(seat) || seat.project !== project.key || supervisorRecord(project.key)?.id !== seat.id) throw new Refusal("SUPERVISOR_REQUIRED", `no attached Supervisor of project ${project.name}; ${start}`)
    const live = await terminalList(binary, cwd)
    if (!live.truncated && !live.handles.has(seat.terminal)) throw new Refusal("SUPERVISOR_REQUIRED", `the terminal of ${supervisorTitle(project.name)} is gone; run starci supervisor ensure --project ${project.root}`)
    if (acting === undefined) renewSupervisorLease(seat.id)
    return seat
}

/** A Supervisor's liveness: absent, starting (no terminal receipt yet), alive or gone by Orca's terminal list, or unknown. */
export type SupervisorLiveness = "absent" | "starting" | "alive" | "gone" | "unknown"

/** One project's Supervisor and its liveness. */
export interface SupervisorState {
    readonly project: Project
    readonly supervisor: SupervisorRecord | null
    readonly liveness: SupervisorLiveness
    readonly leaseExpired: boolean
}

/** Reports a project's Supervisor liveness from Orca's terminal inventory; an incomplete inventory or a silent Orca proves no absence. */
export const supervisorStatus = async (binary: OrcaBinary | undefined, cwd: string, project: Project): Promise<SupervisorState> => {
    const supervisor = supervisorRecord(project.key)
    if (supervisor === null) return { project, supervisor, liveness: "absent", leaseExpired: false }
    const leaseExpired = supervisor.lease_until !== null && supervisor.lease_until < now()
    if (supervisor.terminal === null) return { project, supervisor, liveness: "starting", leaseExpired }
    if (binary === undefined) return { project, supervisor, liveness: "unknown", leaseExpired }
    try {
        const live = await terminalList(binary, cwd)
        const unlisted = live.truncated ? "unknown" : "gone"
        return { project, supervisor, liveness: live.handles.has(supervisor.terminal) ? "alive" : unlisted, leaseExpired }
    } catch {
        return { project, supervisor, liveness: "unknown", leaseExpired }
    }
}

const retire = (id: string, by: SupervisorEnd): void => {
    withMachine((db) => db.prepare("UPDATE project_supervisors SET ended_at = ?, ended_by = ? WHERE id = ? AND ended_at IS NULL").run(now(), by, id))
}

const launchOf = async (binary: OrcaBinary, project: Project, input: AgentLaunchInput, agent: string): Promise<{ readonly terminal: string | null }> =>
    coordinatorLaunch({ agent, pool: agent }, async () => {
        try {
            return await agentLaunch(binary, input, runtimeRoot())
        } catch (error: unknown) {
            if (!isSelectorNotFound(error)) throw error
            await repoAdd(binary, project.root, runtimeRoot())
            return agentLaunch(binary, input, runtimeRoot())
        }
    })

/** Sends (or replays with --retry-launch) the reserved launch and records its terminal, or the operation id an unknown answer names. */
const sendLaunch = async (binary: OrcaBinary, cwd: string, seat: { readonly id: string; readonly project: Project }, input: AgentLaunchInput, agent: string): Promise<void> => {
    try {
        const launched = await launchOf(binary, seat.project, input, agent)
        if (launched.terminal !== null) {
            withMachine((db) => db.prepare("UPDATE project_supervisors SET terminal = COALESCE(terminal, ?) WHERE id = ? AND ended_at IS NULL").run(launched.terminal, seat.id))
            await terminalRename(binary, launched.terminal, supervisorTitle(seat.project.name), cwd)
        }
    } catch (error: unknown) {
        if (error instanceof OrcaFailure && error.effect === "none") withMachine((db) => db.prepare("UPDATE project_supervisors SET ended_at = ?, ended_by = 'gone' WHERE id = ? AND terminal IS NULL").run(now(), seat.id))
        else if (error instanceof OrcaFailure) {
            const operation = launchOperationOf(error)
            if (operation !== undefined) withMachine((db) => db.prepare("UPDATE project_supervisors SET launch_op = ? WHERE id = ?").run(operation, seat.id))
        }
        throw error
    }
}

/**
 * Reserves the project's one Supervisor, then launches the router's coordinator member with `orca agent launch` (terminal
 * surface) in the project's main checkout, titled `[Supervisor] <project>`, pointing it at its brief in the project's state
 * folder. A second start while one is alive refuses SUPERVISOR_RUNNING; an unknown launch keeps its reservation (and the
 * operation id to replay) instead of launching twice.
 */
export const startSupervisor = async (binary: OrcaBinary, cwd: string, project: Project, stalled: readonly RouteMember[] = []): Promise<SupervisorRecord> => {
    const status = await supervisorStatus(binary, cwd, project)
    const previous = status.supervisor
    if (previous !== null && status.liveness !== "gone") throw new Refusal("SUPERVISOR_RUNNING", `the Supervisor of project ${project.name} is ${status.liveness}; starci supervisor status, or stop it first`)
    if (previous !== null) retire(previous.id, "gone")
    const pick = pickCoordinator("supervisor", { stalled })
    if (pick instanceof RouteRefusal) throw new Refusal(pick.code, describeRoute(pick).join("; "))
    const id = randomUUID()
    const prompt = coordinatorBrief({ role: "supervisor", root: project.root, project: project.name, launchId: id, agent: pick.agent, model: pick.model })
    const input: AgentLaunchInput = { agent: pick.agent, ...(selectsModel(loadRouting(), pick.agent) ? { model: pick.model, effort: pick.effort } : {}), worktree: `path:${project.root.replaceAll("\\", "/")}`, prompt }
    withMachine((db) => {
        if (db.prepare("SELECT 1 FROM project_supervisors WHERE project = ? AND ended_at IS NULL").get(project.key) !== undefined) throw new Refusal("SUPERVISOR_RUNNING", `another Supervisor start reserved project ${project.name} meanwhile`)
        db.prepare("INSERT INTO project_supervisors (id, project, project_root, agent, model, started_at, lease_until, launch_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(id, project.key, project.root, pick.agent, pick.model, now(), leaseEnd(loadCoordinatorLiveness().supervisorTtlMinutes), JSON.stringify(input))
    })
    await sendLaunch(binary, cwd, { id, project }, input, pick.agent)
    const seat = supervisorRecord(project.key)
    if (seat?.id !== id) throw new Refusal("SUPERVISOR_MOVED", `the Supervisor of project ${project.name} was stopped while it launched`)
    return seat
}

/** What an ensure did for one project. */
export interface SupervisorEnsured {
    readonly project: Project
    readonly action: "none" | "started" | "replayed" | "stuck"
    readonly liveness: SupervisorLiveness
    readonly supervisor: SupervisorRecord | null
    readonly detail: string
}

/**
 * Keeps a project's one Supervisor alive (`supervisor ensure`, and every `supervisor tick`): absent or gone by Orca's word ->
 * start; a reserved launch with an unknown answer -> replay it with its operation id; no operation id past the effect-unknown
 * deadline -> stuck (reported, never relaunched blind); alive or unknown -> nothing. Unknown is not dead.
 */
export const ensureSupervisor = async (binary: OrcaBinary, cwd: string, project: Project): Promise<SupervisorEnsured> => {
    const status = await supervisorStatus(binary, cwd, project)
    const { supervisor, liveness } = status
    if (liveness === "absent" || liveness === "gone") {
        const started = await startSupervisor(binary, cwd, project)
        return { project, action: "started", liveness, supervisor: started, detail: `started ${supervisorTitle(project.name)} ${started.agent}/${started.model}` }
    }
    if (liveness === "starting" && supervisor !== null) {
        if (supervisor.launch_op !== null && supervisor.launch_json !== null) {
            const input = { ...(JSON.parse(supervisor.launch_json) as AgentLaunchInput), retryLaunch: supervisor.launch_op }
            await sendLaunch(binary, cwd, { id: supervisor.id, project }, input, supervisor.agent)
            return { project, action: "replayed", liveness, supervisor: supervisorRecord(project.key), detail: `replayed launch operation ${supervisor.launch_op}` }
        }
        if (olderThan(supervisor.started_at, loadCoordinatorLiveness().effectUnknownDeadlineMinutes)) {
            return { project, action: "stuck", liveness, supervisor, detail: `the reserved launch has no terminal and no operation id past the deadline; inspect Orca, then supervisor stop --abandon --project ${project.root}` }
        }
    }
    return { project, action: "none", liveness, supervisor, detail: status.leaseExpired ? "lease expired but Orca does not say gone: held" : "nothing to do" }
}

/**
 * Wakes a project's Supervisor by mail to its Run (`run:<id>`), from the caller's terminal when it runs in one: a Kernel's
 * escalation or handoff (`kernel submit`) and an owner request (`supervisor ask`) alike. The ledger row is the content, so a
 * Supervisor not attached yet, or a mail Orca refuses, changes nothing: `supervisor next` reads the row.
 */
export const wakeSupervisor = async (project: string, cwd: string, mail: Omit<MailSend, "to" | "from">): Promise<string> => {
    const supervisor = supervisorRecord(project)
    if (supervisor?.run_id == null) return "no Supervisor attached: it waits for supervisor next"
    try {
        // Orca needs a sender terminal: the caller's when it runs inside one (a Kernel), else the Supervisor's own terminal,
        // so the owner's `supervisor ask` from a shell or the desktop app still wakes it.
        const from = process.env.ORCA_TERMINAL_HANDLE ?? supervisor.terminal ?? undefined
        await mailSend(await locateOrca(cwd), { ...mail, to: `run:${supervisor.run_id}`, from }, cwd)
        return "mailed the Supervisor's Run"
    } catch (error: unknown) {
        return `mail not sent (${asRefusal(error).code}); it waits for supervisor next`
    }
}

/** Binds only the reserved launch to its own Orca terminal and creates its Supervisor's Run and parent task idempotently. */
export const attachSupervisor = async (binary: OrcaBinary, cwd: string, project: Project, launch: string): Promise<SupervisorRecord> => {
    const terminal = process.env.ORCA_TERMINAL_HANDLE
    const seat = supervisorRecord(project.key)
    if (terminal === undefined || terminal === "" || seat?.id !== launch || (seat.terminal !== null && seat.terminal !== terminal)) {
        throw new Refusal("SUPERVISOR_ATTACH_REFUSED", `attach runs in the reserved terminal of ${supervisorTitle(project.name)} with its launch id (the brief names both), from the project's checkout`)
    }
    const title = supervisorTitle(project.name)
    withMachine((db) => db.prepare("UPDATE project_supervisors SET terminal = ? WHERE id = ? AND ended_at IS NULL").run(terminal, launch))
    renewSupervisorLease(launch)
    await terminalRename(binary, terminal, title, cwd)
    const run = seat.run_id ?? (await runCreate(binary, { from: terminal, objective: `StarCi Supervisor of ${project.name}: the owner channel`, retryRequest: requestIdOf("supervisor-run", launch) }, cwd))
    withMachine((db) => db.prepare("UPDATE project_supervisors SET run_id = ? WHERE id = ? AND ended_at IS NULL").run(run, launch))
    const task = seat.task_id ?? (await taskCreate(binary, { spec: `StarCi Supervisor of project ${project.name}: owner requests, its workflows and their Kernel escalations; the harness ledgers own state.`, taskTitle: title, run, from: terminal, retryRequest: requestIdOf("supervisor-task", launch) }, cwd))
    withMachine((db) => db.prepare("UPDATE project_supervisors SET task_id = ? WHERE id = ? AND ended_at IS NULL").run(task, launch))
    return { ...seat, terminal, run_id: run, task_id: task }
}

/** Stops a project's Supervisor terminal and retires its record once Orca confirms the close; `abandon` retires a launch with no receipt. */
export const stopSupervisor = async (binary: OrcaBinary, cwd: string, project: Project, abandon: boolean, by: SupervisorEnd = "owner"): Promise<{ readonly stopped: string | null }> => {
    const seat = supervisorRecord(project.key)
    if (seat === null) return { stopped: null }
    if (seat.terminal === null && !abandon) throw new Refusal("SUPERVISOR_LAUNCH_UNKNOWN", `the reserved launch has no terminal receipt; supervisor ensure replays it, or stop --abandon after checking Orca`)
    if (seat.terminal !== null) await terminalClose(binary, seat.terminal, cwd)
    retire(seat.id, by)
    return { stopped: seat.id }
}

/** The host Supervisor a version-2 host store recorded (its `supervisors` table), read only to adopt the workflows it launched. */
export interface HostSupervisor {
    readonly id: string
    readonly terminal: string | null
    readonly runId: string | null
    readonly endedAt: string | null
    readonly startedAt: string
}

const hostTable = (db: DatabaseSync): boolean => db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'supervisors'").get() !== undefined

/** Every host Supervisor a version-2 host store holds, live or retired; none on a store that never had one. */
export const hostSupervisors = (): HostSupervisor[] =>
    readMachine((db) => (hostTable(db) ? db.prepare("SELECT * FROM supervisors").all() : []), []).map((row) => ({
        id: String(row.id),
        terminal: typeof row.terminal === "string" ? row.terminal : null,
        runId: typeof row.run_id === "string" ? row.run_id : null,
        endedAt: typeof row.ended_at === "string" ? row.ended_at : null,
        startedAt: String(row.started_at),
    }))

/** The Supervisor terminals above a project's Kernels: its own Supervisor's, and a live host Supervisor's until it is retired. */
export const supervisorTerminals = (project: Project): string[] =>
    [supervisorRecord(project.key)?.terminal, ...hostSupervisors().filter((seat) => seat.endedAt === null).map((seat) => seat.terminal)].filter((terminal): terminal is string => typeof terminal === "string")

/**
 * Retires the live host Supervisor of a version-2 host store once Orca reports its terminal gone (or its launch has no terminal
 * past the effect-unknown deadline): its row is ended, never deleted, and its Run stays readable for the adoption of its
 * workflows. Returns what it did, or null.
 */
export const retireHostSupervisor = async (binary: OrcaBinary, cwd: string): Promise<string | null> => {
    const live = hostSupervisors().find((seat) => seat.endedAt === null)
    if (live === undefined) return null
    let gone = live.terminal === null && olderThan(live.startedAt, loadCoordinatorLiveness().effectUnknownDeadlineMinutes)
    if (live.terminal !== null) {
        const inventory = await terminalList(binary, cwd).catch(() => null)
        gone = inventory !== null && !inventory.truncated && !inventory.handles.has(live.terminal)
    }
    if (!gone) return null
    withMachine((db) => db.prepare("UPDATE supervisors SET ended_at = ? WHERE id = ? AND ended_at IS NULL").run(now(), live.id))
    return `retired the host Supervisor ${live.id}: Orca reports its terminal ${live.terminal ?? "-"} gone`
}
