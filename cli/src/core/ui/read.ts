import type { DatabaseSync } from "node:sqlite"
import { providerViews } from "../../harness/circuit.js"
import type { ProviderView } from "../../harness/circuit.js"
import { awaitsOwner, openDecisions } from "../../harness/coordinator-commands.js"
import type { Decision as LedgerDecision } from "../../harness/coordinator-commands.js"
import { resolveChecks } from "../../harness/contract.js"
import type { Contract } from "../../harness/contract.js"
import { currentGoal } from "../../harness/goal.js"
import { taskState } from "../../harness/graph.js"
import type { NodeView, PlanNode } from "../../harness/graph.js"
import { kernelTitle, opTitle } from "../../harness/kernel.js"
import { evaluateFlow, flowLines, loadLanes, recordsOf, roleOf } from "../../harness/lanes.js"
import type { FlowReport } from "../../harness/lanes.js"
import { livenessOf, loadLiveness } from "../../harness/liveness.js"
import { readMachine, runningWorkers, textOf } from "../../harness/machine.js"
import { loadOps } from "../../harness/ops.js"
import { locateOrca, terminalRead } from "../../harness/orca/client.js"
import type { OrcaBinary } from "../../harness/orca/client.js"
import { RouteRefusal, routeTask } from "../../harness/router.js"
import type { RoutePick, RouteRecord } from "../../harness/router.js"
import { loadRouting, poolsOfProvider } from "../../harness/routing.js"
import { isSeatOpen, kernelSeatOf, listSeats } from "../../harness/seats.js"
import type { SeatRow } from "../../harness/seats.js"
import { inOrder } from "../../harness/sequential.js"
import { listSettings } from "../../harness/settings.js"
import { loadStallRules } from "../../harness/stall.js"
import { supervisorStatus, supervisorTitle } from "../../harness/supervisor.js"
import type { SupervisorState } from "../../harness/supervisor.js"
import { poolWindows } from "../../harness/usage.js"
import type { Project } from "../../harness/work.js"
import { listWorkflows, parallelSlots, snapshotOf } from "../../harness/workflow.js"
import type { Snapshot, WorkflowRow as LedgerWorkflow, WorkflowTask } from "../../harness/workflow.js"
import { Refusal } from "../../shared/errors.js"
import type { VerbContext } from "../../shared/verb.js"
import { hostStatus, loadHost, selectServices } from "../../harness/host.js"
import { getTask } from "../../harness/tasks.js"
import { taskStatusVerb } from "../task/status.js"
import { rulingCommand } from "./write.js"
import type { Check, ConfigEntry, Decision, EventRow, GraphNode, Liveness, Member, Overview, ProjectSummary, ProviderId, ProviderStatus, Seat, TaskDetail, WorkflowDetail, WorkflowRow } from "./contract.js"
import { placeHolding, places, projectsOf, readLedger } from "./places.js"

/** How many ledger and host events the overview's feed shows, newest first. */
const EVENTS_SHOWN = 50

/** The event kinds that ask for the owner's eye: a decision raised, a refusal, a seat or task that died, stalled or got lost. */
const ATTENTION: ReadonlySet<string> = new Set([
    "decision-raised",
    "command-failed",
    "task-timeout",
    "task-stalled",
    "worker-lost",
    "verify-stuck",
    "seat-launch-failed",
    "seat-launch-unknown",
    "seat-dead-on-arrival",
    "kernel-relaunched",
    "workflow-kernel-close-failed",
    "prior-store-failed",
    "send-refused",
    "mail-impostor",
    "provider-outcome-unrecorded",
    "stall-nudged",
    "stall-gave-up",
])

/** The effort a launch input names (`effort` of what was sent to Orca or the router's pick), else null. */
const effortOf = (launch: unknown): string | null => (typeof launch === "object" && launch !== null && "effort" in launch && typeof launch.effort === "string" ? launch.effort : null)

const memberOf = (agent: string | null, model: string | null, launch: unknown): Member => ({ agent: agent ?? "-", model: model ?? "-", effort: effortOf(launch) })

/** A Supervisor's liveness in the app's words: alive with a lapsed lease is stalled, gone is closed, a launch not yet answered is unknown. */
const supervisorLiveness = (state: SupervisorState): Liveness => {
    switch (state.liveness) {
        case "alive":
            return state.leaseExpired ? "stalled" : "alive"
        case "gone":
            return "closed"
        case "absent":
            return "absent"
        case "starting":
        case "unknown":
            return "unknown"
    }
}

/** A seat's liveness verdict (harness/liveness.ts) in the app's words. */
const seatLiveness = (seat: SeatRow): Liveness => {
    switch (livenessOf(seat, loadLiveness()).verdict) {
        case "live":
            return "alive"
        case "quiet":
        case "stale":
            return "stalled"
        case "lost":
            return "absent"
        case "closed":
            return "closed"
        case "launching":
        case "unknown":
            return "unknown"
    }
}

const orcaOf = async (cwd: string): Promise<OrcaBinary | undefined> => locateOrca(cwd).catch(() => undefined)

/** Each project's Supervisor state, asked of Orca's terminal list once per project. */
const supervisorsOf = async (projects: readonly Project[], cwd: string): Promise<Map<string, SupervisorState>> => {
    const binary = await orcaOf(cwd)
    const states = await inOrder(projects, async (project) => supervisorStatus(binary, cwd, project))
    return new Map(states.map((state) => [state.project.key, state]))
}

/** The open Supervisor decisions of a ledger that await the owner (`awaitsOwner`). */
const ownerDecisions = (db: DatabaseSync): LedgerDecision[] => openDecisions(db, "supervisor").filter(awaitsOwner)

const circuitOf = (view: ProviderView): ProviderStatus["circuit"] => {
    if (!view.circuit.open) return "closed"
    return view.circuit.probe === "none" ? "open" : "half-open"
}

const isProvider = (value: string): value is ProviderId => ["claude", "codex", "devin", "cursor"].includes(value)

/** Each provider of ops/routing.yaml: circuit, the usage windows its pools last reported (else the binding quota reading), running members and cap. */
const providersOf = (): ProviderStatus[] => {
    const routing = loadRouting()
    const running = runningWorkers()
    const views = providerViews(0).filter((view) => isProvider(view.provider))
    return views.map((view) => {
        const pools = poolsOfProvider(routing, view.provider)
        const several = pools.length > 1
        const windows = readMachine(
            (db) =>
                view.pools.flatMap((pool) => {
                    const reported = poolWindows(db, pool.pool).map((window) => ({ label: several ? `${pool.pool} ${window.window}` : window.window, usedPercent: window.usedPercent, resetsAt: window.resetsAt }))
                    if (reported.length > 0 || pool.quota.usedPercent === null) return reported
                    return [{ label: pool.pool, usedPercent: pool.quota.usedPercent, resetsAt: pool.quota.resetsAt }]
                }),
            [],
        )
        const members = [...running.byMember.entries()].filter(([member]) => pools.includes(member.split("/")[0] ?? ""))
        return {
            provider: view.provider as ProviderId,
            circuit: circuitOf(view),
            failureKind: view.circuit.failureKind,
            reopensAt: view.circuit.probeDueAt ?? view.circuit.openUntil,
            windows,
            running: members.map(([member, count]) => ({ model: member.slice(member.indexOf("/") + 1), count })),
            cap: view.pools.reduce((sum, pool) => sum + pool.cap, 0),
        }
    })
}

const workflowRowOf = (db: DatabaseSync, project: string, workflow: LedgerWorkflow, awaiting: ReadonlySet<string>): WorkflowRow => {
    const { views, live } = snapshotOf(db, workflow.id)
    const kernel = kernelSeatOf(db, workflow.id)
    return {
        project,
        id: workflow.id,
        goalSummary: currentGoal(db, workflow.id, workflow.header, workflow.goalVersion).text,
        status: workflow.status,
        reason: workflow.reason,
        done: views.filter((view) => view.state === "done").length,
        total: views.length,
        liveOps: live,
        parallelCap: parallelSlots(workflow.header),
        kernel: kernel === undefined ? null : memberOf(kernel.agent, kernel.model, kernel.launch),
        awaitingOwner: awaiting.has(workflow.id),
    }
}

/** The newest events of a ledger as feed rows: their kind and subject, the attention kinds marked. */
const ledgerEvents = (db: DatabaseSync, project: string): EventRow[] =>
    db
        .prepare("SELECT at, kind, subject FROM events ORDER BY id DESC LIMIT ?")
        .all(EVENTS_SHOWN)
        .map((row) => {
            const kind = textOf(row.kind) ?? ""
            const subject = textOf(row.subject)
            return { at: textOf(row.at) ?? "", project, text: subject === null ? kind : `${kind} ${subject}`, attention: ATTENTION.has(kind) }
        })

/** What the host driver recorded (machine.sqlite host_events), newest first, each under the project its data names. */
const hostEvents = (projects: readonly Project[]): EventRow[] =>
    readMachine((db) => db.prepare("SELECT at, kind, subject, data_json FROM host_events ORDER BY id DESC LIMIT ?").all(EVENTS_SHOWN), []).map((row) => {
        const kind = textOf(row.kind) ?? ""
        const data: unknown = JSON.parse(textOf(row.data_json) ?? "null")
        const key = typeof data === "object" && data !== null && "project" in data && typeof data.project === "string" ? data.project : ""
        return { at: textOf(row.at) ?? "", project: projects.find((project) => project.key === key)?.key ?? key, text: `${kind} ${textOf(row.subject) ?? ""}`.trim(), attention: ATTENTION.has(kind) }
    })

/** How long the scheduler's answer about the tick service stands before it is asked again. */
const SCHEDULE_TTL_MS = 30_000
let scheduled: { readonly at: number; readonly up: boolean } | undefined

/** Whether the host's supervisor-tick service (ops/host.yaml) is up, by `host status` of that one service, cached briefly. */
const tickScheduled = async (cwd: string): Promise<boolean> => {
    if (scheduled !== undefined && Date.now() - scheduled.at < SCHEDULE_TTL_MS) return scheduled.up
    const config = loadHost()
    const status = await hostStatus(config, selectServices(config, ["supervisor-tick"]), cwd).catch(() => undefined)
    scheduled = { at: Date.now(), up: status?.services.every((service) => service.state === "up") ?? false }
    return scheduled.up
}

/**
 * The host driver: `watch` when the supervisor-tick schedule is up or a tick acted within two watch periods; `tick` the
 * ticks that acted (a `supervisor-tick` host event is recorded only when a tick did something) and the newest one's time.
 */
const hostOf = async (cwd: string): Promise<Overview["host"]> => {
    const ticks = readMachine((db) => db.prepare("SELECT COUNT(*) AS n, MAX(at) AS at FROM host_events WHERE kind = 'supervisor-tick'").get(), undefined)
    const lastTickAt = textOf(ticks?.at)
    const recent = lastTickAt !== null && Date.now() - Date.parse(lastTickAt) < 2 * loadStallRules().watchSeconds * 1000
    return { watch: recent || (await tickScheduled(cwd)), tick: Number(ticks?.n ?? 0), lastTickAt }
}

/** `GET /api/overview`: every registered project with its Supervisor, the providers, every workflow, the newest events and the host driver. */
export const overviewOf = async (cwd: string): Promise<Overview> => {
    const all = await places()
    const projects = projectsOf(all)
    const supervisors = await supervisorsOf(projects, cwd)
    const owners = new Map<string, number>()
    const workflows: WorkflowRow[] = []
    const events: EventRow[] = hostEvents(projects)
    for (const place of all) {
        readLedger(
            place.repo,
            (db) => {
                const asked = ownerDecisions(db)
                owners.set(place.project.key, (owners.get(place.project.key) ?? 0) + asked.length)
                const awaiting = new Set(asked.map((decision) => decision.workflowId))
                workflows.push(...listWorkflows(db).map((workflow) => workflowRowOf(db, place.project.key, workflow, awaiting)))
                events.push(...ledgerEvents(db, place.project.key))
            },
            undefined,
        )
    }
    const summaries: ProjectSummary[] = projects.map((project) => {
        const state = supervisors.get(project.key)
        const seat = state?.supervisor ?? null
        return {
            key: project.key,
            name: project.name,
            supervisor: state === undefined || seat === null ? null : { member: memberOf(seat.agent, seat.model, seat.launch_json === null ? null : JSON.parse(seat.launch_json)), liveness: supervisorLiveness(state), terminal: seat.terminal },
            openOwnerDecisions: owners.get(project.key) ?? 0,
        }
    })
    return {
        projects: summaries,
        providers: providersOf(),
        workflows,
        events: events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, EVENTS_SHOWN),
        host: await hostOf(cwd),
    }
}

/** One attempt as the server reads it: its member, outcome, start and the router's pick it ran on. */
interface AttemptFact {
    readonly seq: number
    readonly member: Member
    readonly outcome: string
    readonly startedAt: string
    readonly pick: RoutePick | null
}

/** Every attempt of a task, oldest first, with the pick the router recorded on it (attempts.pick_json). */
const attemptsOf = (db: DatabaseSync, taskId: string): AttemptFact[] =>
    db
        .prepare("SELECT seq, agent, model, outcome, verdict, started_at, pick_json FROM attempts WHERE task_id = ? ORDER BY seq")
        .all(taskId)
        .map((row) => {
            const raw = textOf(row.pick_json)
            const pick = raw === null ? null : (JSON.parse(raw) as RoutePick)
            return { seq: Number(row.seq), member: memberOf(textOf(row.agent), textOf(row.model), pick), outcome: textOf(row.verdict) ?? textOf(row.outcome) ?? "running", startedAt: textOf(row.started_at) ?? "", pick }
        })

/** The checkout the lanes of a workflow are read in: its worktree, else its repository (as workflowLanes reads them). */
const flowOf = (db: DatabaseSync, snapshot: Snapshot, repo: string): FlowReport => {
    const checkout = textOf(db.prepare("SELECT worktree FROM workflows WHERE id = ?").get(snapshot.workflow.id)?.worktree) ?? repo
    return evaluateFlow(snapshot.nodes, { repo: checkout, db, requires: snapshot.workflow.header.requires ?? [] }, loadLanes(loadOps()))
}

/** The Work record a contract is over and the side (be, fe) its repository's role in workspace.yaml gives it. */
const recordOf = (contract: Contract, repo: string): { readonly record: string | null; readonly side: "be" | "fe" | null } => {
    const ref = recordsOf(contract, repo)[0]
    if (ref === undefined) return { record: null, side: null }
    const role = roleOf(ref, repo)
    return { record: ref.id, side: role === "be" || role === "fe" ? role : null }
}

const nodeOf = (db: DatabaseSync, repo: string, node: PlanNode, view: NodeView | undefined): GraphNode => {
    const task = view?.task ?? null
    const latest = task === null ? undefined : attemptsOf(db, task.id).at(-1)
    return {
        key: node.key,
        title: node.contract.input.summary,
        label: node.contract.label,
        state: view?.state ?? "waiting",
        task: task?.id ?? null,
        member: latest?.member ?? null,
        startedAt: latest?.startedAt ?? null,
        dependsOn: node.dependsOn,
        ...recordOf(node.contract, repo),
        why: view?.why ?? null,
    }
}

/** The open seats of a workflow: its Kernel and the Ops of its tasks, then the project's Supervisor. */
const seatsOf = (db: DatabaseSync, snapshot: Snapshot, supervisor: SupervisorState | undefined): Seat[] => {
    const tasks = new Map(snapshot.tasks.map((task) => [task.id, task]))
    const own = listSeats(db).filter((seat) => isSeatOpen(seat) && seat.endedAt === null && (seat.workflowId === snapshot.workflow.id || (seat.taskId !== null && tasks.has(seat.taskId))))
    const seats: Seat[] = own.flatMap((seat): Seat[] => {
        const member = memberOf(seat.agent, seat.model, seat.launch)
        if (seat.role === "kernel") return [{ id: seat.id, role: "kernel", title: kernelTitle(snapshot.workflow.id), member, liveness: seatLiveness(seat), task: null }]
        if (seat.role !== "worker" || seat.taskId === null) return []
        const task = snapshot.nodes.find((node) => node.key === tasks.get(seat.taskId ?? "")?.key)
        const title = task === undefined ? `[Op] ${seat.taskId}` : opTitle({ id: seat.taskId, contract: task.contract })
        return [{ id: seat.id, role: "worker", title, member, liveness: seatLiveness(seat), task: seat.taskId }]
    })
    const record = supervisor?.supervisor ?? null
    if (supervisor === undefined || record === null) return seats
    const member = memberOf(record.agent, record.model, record.launch_json === null ? null : JSON.parse(record.launch_json))
    return [{ id: record.id, role: "supervisor", title: supervisorTitle(supervisor.project.name), member, liveness: supervisorLiveness(supervisor), task: null }, ...seats]
}

const holdsWorkflow = (id: string) => (db: DatabaseSync): boolean => listWorkflows(db).some((workflow) => workflow.id === id)

/** `GET /api/workflows/:project/:workflow`: the workflow's goal, graph with each node's state and member, its lanes, seats and parallel slots. */
export const workflowOf = async (cwd: string, project: string, id: string): Promise<WorkflowDetail> => {
    const place = placeHolding(await places(), project, holdsWorkflow(id), "WORKFLOW_UNKNOWN", `workflow ${id}`)
    const supervisor = (await supervisorsOf([place.project], cwd)).get(place.project.key)
    const detail = readLedger(
        place.repo,
        (db): WorkflowDetail => {
            const snapshot = snapshotOf(db, id)
            const { workflow, nodes, views } = snapshot
            const goal = currentGoal(db, workflow.id, workflow.header, workflow.goalVersion)
            const flow = flowOf(db, snapshot, place.repo)
            const slots = parallelSlots(workflow.header)
            return {
                project,
                id,
                goal: { version: goal.version, text: goal.text },
                graphVersion: workflow.graphVersion,
                status: workflow.status,
                reason: workflow.reason,
                nodes: nodes.map((node) => nodeOf(db, place.repo, node, views.find((view) => view.key === node.key))),
                flow: flowLines(flow),
                flowProblems: flow.problems,
                seats: seatsOf(db, snapshot, supervisor),
                parallel: { live: snapshot.live, cap: slots, queued: views.filter((view) => view.state === "ready" || view.state === "queued").length },
            }
        },
        undefined,
    )
    if (detail === undefined) throw new Refusal("WORKFLOW_UNKNOWN", `no workflow ${id} in project ${project}`)
    return detail
}

/** The router's decision for a task: the pick recorded on its newest attempt, else a dry run of its next attempt (`routeTask`, nothing recorded). */
const routeOf = (repo: string, taskId: string, attempts: readonly AttemptFact[]): TaskDetail["route"] => {
    const recorded = attempts.findLast((attempt) => attempt.pick !== null)?.pick ?? null
    const answer = recorded ?? routeTask(repo, taskId, { record: false })
    const record: RouteRecord | null = answer instanceof RouteRefusal || !(answer instanceof Refusal) ? answer.record : null
    const steps = (record?.steps ?? []).map((step) => {
        const dropped = (record?.dropped ?? []).filter((row) => row.step === step.step).map((row) => `dropped ${row.member}: ${row.reason}`)
        const note = step.note === undefined ? [] : [step.note]
        return { step: step.step, detail: [step.kept.join(" > ") || "(none)", ...note, ...dropped].join("; ") }
    })
    if (answer instanceof Refusal) return { tier: record?.tier ?? "-", steps, chosen: { agent: "-", model: "-", effort: null }, by: `refused ${answer.code}: ${answer.message}` }
    return { tier: answer.tier, steps, chosen: { agent: answer.agent, model: answer.model, effort: answer.effort ?? null }, by: answer.record.chosen?.by ?? "-" }
}

const checkState = (status: string | undefined): Check["state"] => {
    if (status === "green" || status === "red") return status
    return "pending"
}

/** How many rendered rows of a task's terminal the task answer carries. */
const TAIL_ROWS = 40

/**
 * The last rows the task's open seat's terminal renders, read once from Orca for this request (never polled); none when the task
 * has no open seat with a terminal, Orca is absent, or the terminal is gone.
 */
const terminalTailOf = async (seat: SeatRow | undefined, cwd: string): Promise<readonly string[]> => {
    if (seat?.terminal == null) return []
    const binary = await orcaOf(cwd)
    if (binary === undefined) return []
    const rows = await terminalRead(binary, seat.terminal, TAIL_ROWS, cwd).catch(() => null)
    return (rows ?? []).slice(-TAIL_ROWS)
}

/** One task as the task status verb reads it (its contract, check runs and seats), through the verb itself. */
const taskStatusOf = async (repo: string, taskId: string): Promise<{ readonly contract: Contract; readonly checkRuns: readonly { readonly name: string; readonly status: string; readonly runner: string; readonly ranAt: string }[]; readonly seats: readonly SeatRow[] }> => {
    const context: VerbContext = { cwd: repo, tree: "none", treeRoot: undefined, verbs: [], progress: () => undefined }
    const status = (await taskStatusVerb.run(context, { task: taskId, workflow: undefined })).data
    if (!("checkRuns" in status)) throw new Refusal("TASK_UNKNOWN", `no task ${taskId}`)
    return { contract: status.task.contract, checkRuns: status.checkRuns, seats: status.seats }
}

const holdsTask = (id: string) => (db: DatabaseSync): boolean => db.prepare("SELECT 1 FROM tasks WHERE id = ? AND workflow_id IS NOT NULL").get(id) !== undefined

/** The workflow facts of a task: its workflow, its ledger task and plan node, the node view carrying it, its attempts and the lanes. */
const taskFacts = (db: DatabaseSync, repo: string, id: string): { readonly workflowId: string; readonly task: WorkflowTask; readonly node: PlanNode | undefined; readonly view: NodeView | undefined; readonly attempts: AttemptFact[]; readonly flow: FlowReport } => {
    const workflowId = getTask(db, id).workflowId ?? ""
    const snapshot = snapshotOf(db, workflowId)
    const task = snapshot.tasks.find((candidate) => candidate.id === id)
    if (task === undefined) throw new Refusal("TASK_UNKNOWN", `no task ${id} in workflow ${workflowId}`)
    return {
        workflowId,
        task,
        node: snapshot.nodes.find((candidate) => candidate.key === task.key),
        view: snapshot.views.find((candidate) => candidate.task?.id === id),
        attempts: attemptsOf(db, id),
        flow: flowOf(db, snapshot, repo),
    }
}

/** `GET /api/tasks/:project/:task`: one workflow task with its contract, checks, the router's decision, attempts and terminal. */
export const taskOf = async (project: string, id: string): Promise<TaskDetail> => {
    const place = placeHolding(await places(), project, holdsTask(id), "TASK_UNKNOWN", `task ${id}`)
    const { contract, checkRuns, seats } = await taskStatusOf(place.repo, id)
    const facts = readLedger(place.repo, (db) => taskFacts(db, place.repo, id), undefined)
    if (facts === undefined) throw new Refusal("TASK_UNKNOWN", `no task ${id} in project ${project}`)
    const { workflowId, task, node, view, attempts, flow } = facts
    // check_runs come newest first; a check that has not run on this task yet is pending.
    const runs = checkRuns.filter((run) => run.runner === "harness")
    const checks: Check[] = resolveChecks(contract, loadOps()).map((check) => {
        const run = runs.find((candidate) => candidate.name === check.name)
        return { name: check.name, tier: check.tier, state: checkState(run?.status), detail: run === undefined ? null : `${run.status} at ${run.ranAt}` }
    })
    const open = seats.find((seat) => isSeatOpen(seat) && seat.endedAt === null && seat.terminal !== null)
    const step = flow.records.flatMap((record) => record.steps.filter((candidate) => task.key !== null && candidate.tasks.includes(task.key)).map((candidate) => `${record.lane}: ${candidate.step}`))[0] ?? null
    return {
        project,
        workflow: workflowId,
        id,
        key: task.key ?? id,
        label: contract.label,
        title: contract.input.summary,
        state: view?.state ?? taskState({ id: task.id, status: task.status, result: task.result, tryNo: task.tryNo, redChecks: task.redChecks, lost: task.lost }),
        contract: { summary: contract.input.summary, allowPaths: contract.context.allowPaths, dependsOn: node?.dependsOn ?? [], record: recordOf(contract, place.repo).record, step },
        checks,
        route: routeOf(place.repo, id, attempts),
        attempts: attempts.map((attempt) => ({ n: attempt.seq, member: attempt.member, outcome: attempt.outcome, at: attempt.startedAt })),
        terminalTail: await terminalTailOf(open, place.repo),
        terminal: (open ?? seats.find((seat) => seat.terminal !== null))?.terminal ?? null,
    }
}

const questionOf = (evidence: unknown): { readonly kind: "owner" | "harness"; readonly question: string; readonly paths: readonly string[]; readonly options: Decision["options"] } => {
    const escalation = typeof evidence === "object" && evidence !== null && "escalation" in evidence && typeof evidence.escalation === "object" && evidence.escalation !== null ? evidence.escalation : {}
    const field = (name: string): unknown => (name in escalation ? (escalation as Record<string, unknown>)[name] : undefined)
    const kind = field("kind") === "harness" ? "harness" : "owner"
    const question = typeof field("question") === "string" ? String(field("question")) : ""
    const paths = Array.isArray(field("paths")) ? (field("paths") as unknown[]).filter((path): path is string => typeof path === "string") : []
    const listed = Array.isArray(field("options")) ? (field("options") as unknown[]) : []
    const options = listed.flatMap((option) => {
        if (typeof option !== "object" || option === null) return []
        const value = option as Record<string, unknown>
        return typeof value.id === "string" && typeof value.title === "string" ? [{ id: value.id, title: value.title, detail: typeof value.detail === "string" ? value.detail : "" }] : []
    })
    return { kind, question, paths, options }
}

/** Who raised an escalation: the Kernel of its workflow when a Kernel command carried it, else the harness's own driver. */
const askedByOf = (decision: LedgerDecision): string => {
    const evidence = decision.evidence
    return typeof evidence === "object" && evidence !== null && "cmdId" in evidence && "digest" in evidence ? kernelTitle(decision.workflowId) : "harness"
}

/** `GET /api/inbox`: every open Supervisor decision that awaits the owner, oldest first, across every registered ledger. */
export const inboxOf = async (): Promise<Decision[]> => {
    const all = await places()
    return all
        .flatMap((place) =>
            readLedger(
                place.repo,
                (db) =>
                    ownerDecisions(db).map((decision): Decision => {
                        const { kind, question, paths, options } = questionOf(decision.evidence)
                        const body = paths.length === 0 ? question : `${question}\npaths: ${paths.join(", ")}`
                        return { project: place.project.key, id: decision.id, kind, workflow: decision.workflowId, title: question.split("\n")[0] ?? question, body, options, raisedAt: decision.raisedAt, askedBy: askedByOf(decision), command: rulingCommand(place.repo, decision.id) }
                    }),
                [],
            ),
        )
        .sort((a, b) => a.raisedAt.localeCompare(b.raisedAt))
}

/** `GET /api/config`: every harness setting, as `config list` reads it. */
export const configOf = (): ConfigEntry[] => listSettings().map((setting) => ({ key: setting.key, file: setting.file, value: setting.value }))
