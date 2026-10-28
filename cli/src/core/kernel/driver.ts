import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { admitCommand, answerDecision, finishCommand, goalVersionOf, openDecisions, raiseDecision, readCommand } from "../../harness/coordinator-commands.js"
import type { Command, CommandRow, Decision, KernelDecisionKind } from "../../harness/coordinator-commands.js"
import { loadCoordinatorLiveness, olderThan } from "../../harness/coordinator-liveness.js"
import type { CoordinatorLiveness } from "../../harness/coordinator-liveness.js"
import { kernelTitle, workflowWorktreeOf } from "../../harness/kernel.js"
import { workflowLanes } from "../../harness/lanes.js"
import { findLedgerId, now, openLedger } from "../../harness/ledger.js"
import { readMachine, textOf } from "../../harness/machine.js"
import { inTransaction, releaseLeases } from "../../harness/leases.js"
import { inLaunchGrace, livenessOf, loadLiveness } from "../../harness/liveness.js"
import { closeWorker, locateOrca, mailCheck, OrcaFailure, requestIdOf, requestShow, terminalList, UNKNOWN_STATES, workerAbandon, workerShow } from "../../harness/orca/client.js"
import type { MailMessage, OrcaBinary, TerminalInventory } from "../../harness/orca/client.js"
import { askIdle, claimNudge, loadStallRules, nudgesOf, promptOf, reportStalled, sendNudge, STALL_GAVE_UP, stallKindOf, stallStep } from "../../harness/stall.js"
import { isSeatOpen, kernelSeatOf, recordSeat, renewSeatLease, SEAT_LAUNCH_FAILED, SEAT_LAUNCH_UNKNOWN, SEAT_RELEASED, SEAT_STOPPED, seatsOfTask } from "../../harness/seats.js"
import type { SeatRow } from "../../harness/seats.js"
import { supervisorTerminals, wakeSupervisor } from "../../harness/supervisor.js"
import { projectOf } from "../../harness/work.js"
import { getTask, latestAttempt, recordEvent, resultOf, setStatus } from "../../harness/tasks.js"
import { DISPATCHING, getWorkflow, setWorkflowStatus, snapshotOf } from "../../harness/workflow.js"
import type { Snapshot } from "../../harness/workflow.js"
import { asRefusal, Refusal } from "../../shared/errors.js"
import type { VerbContext } from "../../shared/verb.js"
import { inOrder } from "../../harness/sequential.js"
import { workflowActions } from "../../harness/reconcile.js"
import type { NodeAction } from "../../harness/reconcile.js"
import { resumeSeat } from "../seat/start.js"
import { workflowAmendVerb } from "../workflow/amend.js"
import { readSnapshot, stepWorkflow } from "../workflow/engine.js"
import type { StepAction } from "../workflow/engine.js"

/** The reason a workflow carries while the harness holds it for an unreachable Orca; only this pause is lifted by the driver. */
export const ORCA_DOWN = "orca-down"

/** The reason of a workflow paused for too many Kernel relaunches; the owner resumes it. */
export const RELAUNCH_LIMIT = "kernel-relaunch-limit"

/** What a coordinator reads with a decision: the workflow in a few lines, never the terminals of its seats. */
export interface Digest {
    readonly workflow: string
    readonly runner: string
    readonly status: string
    readonly reason: string | null
    readonly graphVersion: number
    readonly goalVersion: number
    readonly worktree: string | null
    readonly nodes: Readonly<Record<string, number>>
    readonly openDecisions: number
    readonly recentCommands: readonly { readonly cmdId: string; readonly kind: string; readonly status: string }[]
    /** The planning digest: the lane of each Work record the graph covers, each step satisfied, carried, optional or missing. */
    readonly lanes: readonly string[]
}

/** What `kernel next` returns: one decision (or idle when none came within the wait, or an inline task waits), with the digest. */
export interface KernelNext {
    readonly workflow: string
    readonly kind: KernelDecisionKind | "idle"
    readonly decision: Decision | null
    readonly digest: Digest
    readonly actions: readonly StepAction[]
    readonly inlineNext: string | null
}

const withLedger = <T>(root: string, work: (db: DatabaseSync) => T): T => {
    const db = openLedger(root)
    try {
        return work(db)
    } finally {
        db.close()
    }
}

const sleep = async (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/**
 * The repository a ledger belongs to, as the host registry records it: the project a Supervisor decision names, whichever of
 * its checkouts (the workflow's worktree, say) the Kernel runs in.
 */
const repositoryOf = (root: string): string => {
    const id = findLedgerId(root)
    return (id === undefined ? null : readMachine((db) => textOf(db.prepare("SELECT repo_root FROM ledgers WHERE ledger_id = ?").get(id)?.repo_root), null)) ?? root
}

/** The digest of a workflow as the ledger holds it now. */
export const digestOf = (db: DatabaseSync, workflowId: string): Digest => {
    const snapshot = snapshotOf(db, workflowId)
    const nodes: Record<string, number> = {}
    for (const view of snapshot.views) nodes[view.state] = (nodes[view.state] ?? 0) + 1
    const recent = db.prepare("SELECT cmd_id, kind, status FROM commands WHERE workflow_id = ? ORDER BY received_at DESC LIMIT 3").all(workflowId)
    return {
        workflow: workflowId,
        runner: snapshot.workflow.header.runner,
        status: snapshot.workflow.status,
        reason: snapshot.workflow.reason,
        graphVersion: snapshot.workflow.graphVersion,
        goalVersion: goalVersionOf(db, workflowId),
        worktree: workflowWorktreeOf(db, workflowId) ?? null,
        nodes,
        openDecisions: openDecisions(db, "kernel", workflowId).length,
        recentCommands: recent.map((row) => ({ cmdId: String(row.cmd_id), kind: String(row.kind), status: String(row.status) })),
        lanes: workflowLanes(db, workflowId),
    }
}

/** Renews the Kernel seat's lease when the caller is that seat (its own terminal); a Debug reading `next` renews nothing. */
const renewKernel = (root: string, workflowId: string, rules: CoordinatorLiveness): void => {
    const terminal = process.env.ORCA_TERMINAL_HANDLE
    if (terminal === undefined || terminal === "") return
    withLedger(root, (db) => {
        const seat = kernelSeatOf(db, workflowId)
        if (seat?.terminal === terminal) renewSeatLease(db, seat.id, rules.seatLeaseMinutes)
    })
}

const TASK_STATES_OPEN_TO_DECIDE: Readonly<Record<string, readonly string[]>> = {
    red: ["failed", "lost", "launch-unknown"],
    question: ["returned"],
}

/** Closes open decisions the ledger has moved past (a retried red task, a done workflow that reopened): never left to an LLM to notice. */
const supersede = (db: DatabaseSync, snapshot: Snapshot): void => {
    for (const decision of openDecisions(db, "kernel", snapshot.workflow.id)) {
        const states = TASK_STATES_OPEN_TO_DECIDE[decision.kind]
        if (states !== undefined && decision.subject.startsWith("t-")) {
            const view = snapshot.views.find((candidate) => candidate.task?.id === decision.subject)
            if (view === undefined || !states.includes(view.state)) answerDecision(db, decision.id, `superseded: task ${decision.subject} is ${view?.state ?? "no longer in the graph"}`, "kernel")
        }
        if (decision.kind === "done" && !["done", "stopped"].includes(snapshot.workflow.status)) answerDecision(db, decision.id, `superseded: workflow is ${snapshot.workflow.status}`, "kernel")
    }
}

const firstOpen = (root: string, workflowId: string): Decision | undefined =>
    withLedger(root, (db) =>
        inTransaction(db, () => {
            supersede(db, snapshotOf(db, workflowId))
            return openDecisions(db, "kernel", workflowId)[0]
        }),
    )

const redChecks = (db: DatabaseSync, taskId: string): unknown[] =>
    db.prepare("SELECT name, detail FROM check_runs WHERE task_id = ? AND status = 'red' ORDER BY id DESC LIMIT 5").all(taskId).map((row) => ({ name: String(row.name), detail: String(row.detail).slice(0, 500) }))

const firstSeen = (db: DatabaseSync, kind: string, subject: string): string => {
    const row = db.prepare("SELECT at FROM events WHERE kind = ? AND subject = ? ORDER BY id LIMIT 1").get(kind, subject)
    if (row !== undefined) return String(row.at)
    recordEvent(db, kind, subject, {})
    return now()
}

const LEASE_HOLDER = /leased by task (\S+)/

/** Raises one Kernel decision of the workflow (each fact once); returns its id. */
type Raise = (kind: KernelDecisionKind, subject: string, evidence: unknown) => string

/** A failed or lost node is red; a node a worker returned (blocked or mismatch) is a question. */
const raiseNodeStates = (db: DatabaseSync, snapshot: Snapshot, raise: Raise): void => {
    for (const view of snapshot.views) {
        const task = view.task
        if (task === null) continue
        if (view.state === "failed") raise("red", task.id, { key: view.key, why: view.why, tryNo: task.tryNo, outcome: latestAttempt(db, task.id)?.outcome ?? null, redChecks: redChecks(db, task.id) })
        if (view.state === "lost") raise("red", task.id, { key: view.key, why: view.why, lost: "Orca reported its worker gone; the task is effect_unknown and keeps its leases" })
        if (view.state === "returned") {
            const attempt = latestAttempt(db, task.id)
            raise("question", task.id, { key: view.key, why: view.why, result: task.result, output: attempt === undefined ? null : (resultOf(db, attempt.id)?.output ?? null) })
        }
    }
}

/** A node whose dependency's settled result changed under it is stale; a stale decision no longer called for is superseded. */
const raiseStale = (db: DatabaseSync, workflowId: string, nodes: readonly NodeAction[], raise: Raise): void => {
    const stale = nodes.filter((node) => node.action === "stale" && node.task !== null).map((node) => ({ subject: `${node.key}:${node.task ?? ""}`, node }))
    for (const { subject, node } of stale) raise("stale", subject, { key: node.key, task: node.task, staleDeps: node.staleDeps ?? [], why: node.why })
    const current = new Set(stale.map((entry) => entry.subject))
    for (const decision of openDecisions(db, "kernel", workflowId)) {
        if (decision.kind === "stale" && !current.has(decision.subject)) answerDecision(db, decision.id, "superseded: no longer stale", "kernel")
    }
}

/** A node waiting on another workflow's path lease past conflictMinutes is a conflict. */
const raiseConflicts = (db: DatabaseSync, workflowId: string, actions: readonly StepAction[], rules: CoordinatorLiveness, raise: Raise): void => {
    for (const action of actions) {
        const holder = action.action === "wait" && action.detail.startsWith("LEASE_CONFLICT") ? LEASE_HOLDER.exec(action.detail)?.[1] : undefined
        if (holder === undefined || action.key === null) continue
        const holderWorkflow = db.prepare("SELECT workflow_id FROM tasks WHERE id = ?").get(holder)?.workflow_id
        if (holderWorkflow === undefined || holderWorkflow === null || holderWorkflow === workflowId) continue
        const subject = `${action.key}:${holder}`
        if (olderThan(firstSeen(db, "lease-conflict-seen", `${workflowId}:${subject}`), rules.conflictMinutes)) {
            raise("conflict", subject, { key: action.key, holderTask: holder, holderWorkflow: String(holderWorkflow), detail: action.detail })
        }
    }
}

/**
 * Raises every decision the ledger now calls for (each fact once): a failed, lost or stuck node is red; a node a worker
 * returned (blocked or mismatch) is a question; a node waiting on another workflow's path lease past conflictMinutes is a
 * conflict; a node whose dependency's settled result changed under it (reconcile.ts workflowActions) is stale; a done or
 * stopped workflow is done.
 */
const raiseDecisions = (root: string, workflowId: string, actions: readonly StepAction[], nodes: readonly NodeAction[], rules: CoordinatorLiveness): void => {
    withLedger(root, (db) => {
        inTransaction(db, () => {
            const snapshot = snapshotOf(db, workflowId)
            const raise: Raise = (kind, subject, evidence) => raiseDecision(db, { scope: "kernel", workflowId, kind, subject, evidence })
            raiseNodeStates(db, snapshot, raise)
            raiseStale(db, workflowId, nodes, raise)
            raiseConflicts(db, workflowId, actions, rules, raise)
            const { status, graphVersion, reason } = snapshot.workflow
            if (status === "done" || status === "stopped") raise("done", `${status}:g${String(graphVersion)}`, { status, reason })
        })
    })
}

const isOrcaDown = (error: unknown): boolean => {
    if (error instanceof OrcaFailure) return error.effect === "unknown"
    // ORCA_MISSING, or an orca process that could not be started: no answer at all.
    return error instanceof Refusal
}

/** Probes Orca with a read; an Orca that does not answer is down (a typed refusal is an answer). */
const probeOrca = async (cwd: string): Promise<OrcaBinary | { readonly down: string }> => {
    try {
        const binary = await locateOrca(cwd)
        await terminalList(binary, cwd)
        return binary
    } catch (error: unknown) {
        if (isOrcaDown(error)) return { down: asRefusal(error).message.split("\n")[0] ?? "no answer" }
        throw error
    }
}

/** Orca unreachable: the workflow is paused(orca-down) and nothing is improvised; Orca back: only that pause is lifted. */
const holdForOrca = (root: string, workflowId: string, down: string | null): StepAction[] =>
    withLedger(root, (db) =>
        inTransaction(db, () => {
            const workflow = getWorkflow(db, workflowId)
            if (down !== null && DISPATCHING.includes(workflow.status)) {
                setWorkflowStatus(db, workflowId, "paused", `${ORCA_DOWN}: ${down}`)
                return [{ key: null, task: null, action: "problem", detail: `Orca unreachable (${down}): workflow paused(${ORCA_DOWN}); nothing is launched or fenced until it answers` }]
            }
            if (down === null && workflow.status === "paused" && workflow.reason?.startsWith(ORCA_DOWN) === true) {
                setWorkflowStatus(db, workflowId, "running", null)
                return [{ key: null, task: null, action: "kernel", detail: `Orca answers again: workflow resumed from paused(${ORCA_DOWN})` }]
            }
            return []
        }),
    )

/** The terminals that may ask this workflow's Kernel something: its own Op seats' terminals, and the Supervisor's above it. */
const askers = (db: DatabaseSync, workflowId: string, supervisors: readonly string[]): ReadonlySet<string> => {
    const ops = db
        .prepare("SELECT s.terminal FROM seats s JOIN tasks t ON t.id = s.task_id WHERE s.role = 'worker' AND t.workflow_id = ? AND s.terminal IS NOT NULL")
        .all(workflowId)
        .map((row) => String(row.terminal))
    return new Set([...ops, ...supervisors])
}

/**
 * Raises a question for each mail that asks something (question, escalation) from the Run tree: one of this workflow's own Op
 * seats, or the Supervisor. Mail from any other sender (or none named) is recorded as an impostor event and never reaches the
 * Kernel; worker_done only wakes, the ledger is the state.
 */
const takeMail = (root: string, workflowId: string, messages: readonly MailMessage[], supervisors: readonly string[]): StepAction[] =>
    withLedger(root, (db) => {
        const trusted = askers(db, workflowId, supervisors)
        return messages.flatMap((message): StepAction[] => {
            if (message.type !== "question" && message.type !== "escalation") return []
            if (message.from === null || !trusted.has(message.from)) {
                recordEvent(db, "mail-impostor", workflowId, { mail: message.id, from: message.from, type: message.type, subject: message.subject })
                return [{ key: null, task: null, action: "problem", detail: `mail ${message.id} (${message.type}) from ${message.from ?? "no sender"} is not of this workflow's Run tree: recorded, dropped` }]
            }
            const id = raiseDecision(db, { scope: "kernel", workflowId, kind: "question", subject: `mail:${message.id}`, evidence: { from: message.from, type: message.type, subject: message.subject, body: message.body, payload: message.payload } })
            return [{ key: null, task: null, action: "wait", detail: `mail ${message.id} (${message.type}) is decision ${id}` }]
        })
    })

/** Drains the Kernel Run's mailbox (waiting up to `waitMs` for the first batch): each batch is recorded, then acked. */
const drainMail = async (root: string, workflowId: string, binary: OrcaBinary, cwd: string, waitMs: number | undefined): Promise<StepAction[]> => {
    const kernel = withLedger(root, (db) => getWorkflow(db, workflowId).kernel)
    if (kernel.terminal === null || kernel.runId === null) {
        if (waitMs !== undefined) await sleep(waitMs)
        return []
    }
    const actions: StepAction[] = []
    const supervisors = supervisorTerminals(await projectOf(root))
    const { terminal, runId: run } = kernel
    // Each batch is acked by the next check, so the batches follow each other; at most ten per drain.
    const take = async (delivery: Awaited<ReturnType<typeof mailCheck>>, batch: number): Promise<void> => {
        if (delivery.deliveryId === null || batch >= 10) return
        actions.push(...takeMail(root, workflowId, delivery.messages, supervisors))
        await take(await mailCheck(binary, { terminal, run, ack: delivery.deliveryId }, cwd), batch + 1)
    }
    try {
        await take(await mailCheck(binary, { terminal, run, waitMs }, cwd), 0)
    } catch (error: unknown) {
        actions.push({ key: null, task: null, action: "problem", detail: `mailbox not read (${asRefusal(error).code}); the ledger is read anyway` })
        if (waitMs !== undefined) await sleep(waitMs)
    }
    return actions
}

/**
 * Fences a worker Orca reports idle (no terminal output at its last pong) past its task's budget.minutes: worker-stop, else
 * worker-abandon; the task fails with outcome `timeout` and frees its leases. Orca's report is the evidence; no report, no fence.
 */
const fenceIdle = async (root: string, binary: OrcaBinary, cwd: string, snapshot: Snapshot): Promise<StepAction[]> => {
    const rules = loadLiveness()
    const targets = withLedger(root, (db) =>
        snapshot.views.flatMap((view) => {
            if (view.state !== "running" || view.task === null) return []
            const task = getTask(db, view.task.id)
            return seatsOfTask(db, task.id)
                .filter((seat) => seat.role === "worker" && isSeatOpen(seat) && seat.handle !== null)
                .flatMap((seat) => {
                    const idle = livenessOf(seat, rules).idleSeconds
                    return idle !== null && idle >= task.contract.budget.minutes * 60 ? [{ key: view.key, task: task.id, seat, idle, budget: task.contract.budget.minutes }] : []
                })
        }),
    )
    return inOrder(targets, async ({ key, task, seat, idle, budget }): Promise<StepAction> => {
        const handle = seat.handle ?? ""
        try {
            const closed = await closeWorker(binary, handle, cwd, seat.terminal)
            const fence = closed.stopped ? `stopped (${closed.stop}), release ${closed.release}` : `abandoned (${await workerAbandon(binary, handle, cwd, requestIdOf("timeout-abandon", seat.id))})`
            withLedger(root, (db) => { inTransaction(db, () => {
                    recordSeat(db, seat.id, { status: closed.settled ? SEAT_RELEASED : SEAT_STOPPED, facts: { timeout: { idleSeconds: idle, budgetMinutes: budget }, closed } })
                    if (getTask(db, task).status !== "running") return
                    const attempt = latestAttempt(db, task)
                    if (attempt !== undefined) db.prepare("UPDATE attempts SET outcome = 'timeout', ended_at = COALESCE(ended_at, ?) WHERE id = ?").run(now(), attempt.id)
                    setStatus(db, task, "failed")
                    releaseLeases(db, task)
                    recordEvent(db, "task-timeout", task, { seat: seat.id, idleSeconds: idle, budgetMinutes: budget, fence })
                }); },
            )
            return { key, task, action: "lost", detail: `worker idle ${String(idle)} s past budget ${String(budget)} min: ${fence}; task failed (timeout)` }
        } catch (error: unknown) {
            return { key, task, action: "problem", detail: `idle worker not fenced (${asRefusal(error).code}): ${asRefusal(error).message.split("\n")[0] ?? ""}` }
        }
    })
}

/**
 * The stall ladder for a workflow's Ops: an Op whose task runs with no result filed, past its launch grace, whose agent Orca
 * reports idle at its prompt (tui-idle, or no output and no heartbeat for stall.quietMinutes) with no activity for
 * stall.idleMinutes, is nudged with its loop prompt (once per stall, at most stall.nudgeMax times); a nudge unanswered past
 * stall.nudgeGraceMinutes, or a stall after the last nudge, fences it (worker-stop, else worker-abandon) and fails its task with
 * outcome `stalled`, reported to its provider's circuit by the kind Orca's failure words name (else `stall`). The Kernel's red
 * decision retries it, and the router puts that pool behind every other for the retry.
 */
export const sweepOpStalls = async (root: string, binary: OrcaBinary, cwd: string, workflowId: string, inventory: TerminalInventory | null): Promise<StepAction[]> => {
    const rules = loadStallRules()
    const grace = loadLiveness()
    const snapshot = readSnapshot(root, workflowId)
    const targets = withLedger(root, (db) =>
        snapshot.views.flatMap((view) => {
            if (view.state !== "running" || view.task === null) return []
            const taskId = view.task.id
            return seatsOfTask(db, taskId)
                .filter((seat) => seat.role === "worker" && isSeatOpen(seat) && seat.handle !== null && seat.terminal !== null && !inLaunchGrace(seat, grace) && olderThan(seat.startedAt, rules.idleMinutes))
                // Orca's terminal list already says it printed lately: active, not asked further.
                .filter((seat) => !(inventory?.lastOutput.has(seat.terminal ?? "") === true && !olderThan(inventory.lastOutput.get(seat.terminal ?? "") ?? null, rules.idleMinutes)))
                .map((seat) => ({ key: view.key, task: taskId, seat, nudges: nudgesOf(db, seat.id) }))
        }),
    )
    const done = await inOrder(targets, async ({ key, task, seat, nudges }): Promise<StepAction | null> => {
        const terminal = seat.terminal ?? ""
        const signals = await askIdle(binary, cwd, { terminal, handle: seat.handle }, inventory, rules)
        const lastActive = signals.lastActive ?? seat.startedAt
        if (signals.idle !== true || !olderThan(lastActive, rules.idleMinutes)) return null
        const step = stallStep(lastActive, nudges, rules)
        if (step.kind === "wait") return { key, task, action: "wait", detail: `Op idle at its prompt (${signals.evidence.join("; ")}); ${step.detail}` }
        if (step.kind === "nudge") {
            if (!withLedger(root, (db) => claimNudge(db, task, seat.id, step.n, { role: "op", evidence: signals.evidence }))) return null
            try {
                await sendNudge(binary, cwd, { id: seat.id, terminal }, step.n, promptOf(rules.prompts.op, { task }))
            } catch (error: unknown) {
                return { key, task, action: "problem", detail: `Op stalled; nudge ${String(step.n)} not delivered (${asRefusal(error).code})` }
            }
            return { key, task, action: "wait", detail: `Op idle at its prompt (${signals.evidence.join("; ")}): nudge ${String(step.n)} of ${String(rules.nudgeMax)}` }
        }
        const kind = stallKindOf(signals.failureText)
        try {
            const closed = await closeWorker(binary, seat.handle ?? "", cwd, seat.terminal)
            const fence = closed.stopped ? `stopped (${closed.stop}), release ${closed.release}` : `abandoned (${await workerAbandon(binary, seat.handle ?? "", cwd, requestIdOf("stall-abandon", seat.id))})`
            const failed = withLedger(root, (db) =>
                inTransaction(db, () => {
                    recordSeat(db, seat.id, { status: closed.settled ? SEAT_RELEASED : SEAT_STOPPED, facts: { stalled: { kind, step: step.detail, evidence: signals.evidence }, closed } })
                    recordEvent(db, STALL_GAVE_UP, task, { seat: seat.id, role: "op", kind, why: step.detail, failure: signals.failureText })
                    if (getTask(db, task).status !== "running") return false
                    const attempt = latestAttempt(db, task)
                    if (attempt !== undefined) db.prepare("UPDATE attempts SET outcome = 'stalled', ended_at = COALESCE(ended_at, ?) WHERE id = ?").run(now(), attempt.id)
                    setStatus(db, task, "failed")
                    releaseLeases(db, task)
                    recordEvent(db, "task-stalled", task, { seat: seat.id, kind, why: step.detail, fence })
                    return true
                }),
            )
            if (seat.agent !== null) reportStalled(seat.agent, kind, `Op ${task} ${step.detail}${signals.failureText === null ? "" : ": " + signals.failureText}`)
            return { key, task, action: "lost", detail: `Op stalled (${kind}, ${step.detail}): ${fence}${failed ? "; task failed (stalled)" : ""}` }
        } catch (error: unknown) {
            return { key, task, action: "problem", detail: `stalled Op not fenced (${asRefusal(error).code}): ${asRefusal(error).message.split("\n")[0] ?? ""}` }
        }
    })
    return done.filter((action) => action !== null)
}

/**
 * A completed launch request whose receipt names a dispatch is judged by that dispatch, never replayed (a replay answers the same
 * receipt forever): a worker Orca shows started is adopted on the seat (the task runs); one that is gone, or still has not started
 * its turn (stall.startUnknownStates) past stall.startDeadlineMinutes, was dead on arrival: it is fenced (worker-stop, else
 * worker-abandon), its attempt closes launch-failed (no try spent), its member reports a `stall` to its provider's circuit, and
 * the task goes back to the queue, where the router puts that pool behind every other. Anything else waits.
 */
const judgeLaunchedDispatch = async (root: string, binary: OrcaBinary, cwd: string, target: { readonly key: string | null; readonly task: string; readonly seat: SeatRow }, dispatchId: string): Promise<StepAction> => {
    const { key, task, seat } = target
    const stall = loadStallRules()
    const shown = await workerShow(binary, dispatchId, cwd).catch(() => null)
    const states = shown === null ? [] : [shown.state, shown.observed].filter((state): state is string => state !== null)
    const gone = states.some((state) => loadLiveness().goneStates.includes(state))
    const unstarted = states.some((state) => stall.startUnknownStates.includes(state))
    if (shown?.state != null && !gone && !unstarted && !UNKNOWN_STATES.includes(shown.state)) {
        withLedger(root, (db) => { inTransaction(db, () => {
            recordSeat(db, seat.id, { status: shown.state ?? seat.status, handle: dispatchId, terminal: shown.terminal, facts: { adopted: { dispatchId, state: shown.state } } })
            if (getTask(db, task).status === "effect_unknown") setStatus(db, task, "running")
            recordEvent(db, "seat-adopted", task, { seat: seat.id, dispatchId, state: shown.state })
        }); })
        return { key, task, action: "launched", detail: `effect_unknown launch resolved: dispatch ${dispatchId} is ${shown.state}, adopted` }
    }
    if (!gone && !(unstarted && olderThan(seat.startedAt, stall.startDeadlineMinutes))) return { key, task, action: "wait", detail: `dispatch ${dispatchId} is ${states.join("/") || "unknown"}; its worker has not started yet` }
    const closed = await closeWorker(binary, dispatchId, cwd, shown?.terminal ?? seat.terminal)
    const fence = closed.stopped ? `stopped (${closed.stop})` : `abandoned (${await workerAbandon(binary, dispatchId, cwd, requestIdOf("doa-abandon", seat.id))})`
    const requeued = withLedger(root, (db) => inTransaction(db, () => {
        const attempt = latestAttempt(db, task)
        if (attempt !== undefined) db.prepare("UPDATE attempts SET outcome = 'launch-failed', ended_at = COALESCE(ended_at, ?) WHERE id = ? AND outcome IS NULL").run(now(), attempt.id)
        recordSeat(db, seat.id, { status: closed.settled ? SEAT_LAUNCH_FAILED : SEAT_STOPPED, handle: dispatchId, facts: { deadOnArrival: { states, failure: shown?.failureText ?? null }, closed } })
        recordEvent(db, "seat-dead-on-arrival", task, { seat: seat.id, dispatchId, states, fence })
        if (getTask(db, task).status !== "effect_unknown") return false
        setStatus(db, task, "queued")
        return true
    }))
    if (seat.agent !== null) reportStalled(seat.agent, stallKindOf(shown?.failureText ?? null), `dispatch ${dispatchId} of ${task} never started (${states.join("/") || "no answer"})`)
    return { key, task, action: "lost", detail: `dispatch ${dispatchId} dead on arrival (${states.join("/") || "no answer"}): ${fence}; attempt launch-failed${requeued ? ", task queued again" : ""}` }
}

/**
 * Resolves each effect_unknown launch through Orca with its attempt's request id: completed with a dispatch -> that dispatch is
 * judged (judgeLaunchedDispatch); completed with none -> the launch is replayed under the same id to read the first outcome;
 * pending -> wait; absent past effectUnknownDeadlineMinutes -> a red decision (stuck).
 */
const resolveUnknown = async (root: string, binary: OrcaBinary, cwd: string, snapshot: Snapshot, rules: CoordinatorLiveness): Promise<StepAction[]> => {
    const targets = withLedger(root, (db) =>
        snapshot.views.flatMap((view) => {
            if (view.state !== "launch-unknown" || view.task === null) return []
            const seat = seatsOfTask(db, view.task.id).find((candidate) => isSeatOpen(candidate) && candidate.status === SEAT_LAUNCH_UNKNOWN && candidate.requestId !== null)
            return seat === undefined ? [] : [{ key: view.key, task: view.task.id, request: seat.requestId ?? "", startedAt: seat.startedAt, seat }]
        }),
    )
    return inOrder(targets, async ({ key, task, request, startedAt, seat }): Promise<StepAction> => {
        const shownRequest = await requestShow(binary, request, cwd).catch(() => null)
        const state = shownRequest?.state ?? "unknown"
        const dispatchId = shownRequest?.dispatchId ?? seat.handle
        if (state === "completed" && dispatchId !== null) return judgeLaunchedDispatch(root, binary, cwd, { key, task, seat }, dispatchId)
        if (state === "completed") {
            try {
                const resumed = await resumeSeat({ root, cwd, task })
                return { key, task, action: "launched", detail: `effect_unknown launch resolved (request ${request} completed): ${resumed.message.split("\n")[0] ?? ""}` }
            } catch (error: unknown) {
                return { key, task, action: "problem", detail: `replay of request ${request} refused (${asRefusal(error).code})` }
            }
        }
        if (state !== "pending" && olderThan(startedAt, rules.effectUnknownDeadlineMinutes)) {
            const id = withLedger(root, (db) => raiseDecision(db, { scope: "kernel", workflowId: snapshot.workflow.id, kind: "red", subject: task, evidence: { key, stuck: `effect_unknown launch: Orca request-show says ${state} past ${String(rules.effectUnknownDeadlineMinutes)} min`, request } }))
            return { key, task, action: "problem", detail: `launch stuck (request ${request} ${state}): decision ${id}` }
        }
        return { key, task, action: "wait", detail: `launch outcome unknown, request ${request} is ${state}` }
    })
}

/** One deterministic tick: Orca probe and hold, mailbox, the dispatch step, idle fencing, the Ops' stall ladder and unknown launches. */
const tick = async (context: VerbContext, root: string, workflowId: string, rules: CoordinatorLiveness): Promise<{ readonly actions: StepAction[]; readonly binary: OrcaBinary | null }> => {
    const runner = readSnapshot(root, workflowId).workflow.header.runner
    const actions: StepAction[] = []
    let binary: OrcaBinary | null = null
    if (runner === "orca") {
        const probed = await probeOrca(context.cwd)
        if ("down" in probed) return { actions: holdForOrca(root, workflowId, probed.down), binary: null }
        binary = probed
        actions.push(...holdForOrca(root, workflowId, null), ...(await drainMail(root, workflowId, binary, context.cwd, undefined)))
    }
    const report = await stepWorkflow(context, root, workflowId)
    actions.push(...report.actions)
    if (binary !== null) {
        const after = readSnapshot(root, workflowId)
        const inventory = await terminalList(binary, context.cwd).catch(() => null)
        actions.push(...(await fenceIdle(root, binary, context.cwd, after)), ...(await sweepOpStalls(root, binary, context.cwd, workflowId, inventory)), ...(await resolveUnknown(root, binary, context.cwd, after, rules)))
    }
    const db = openLedger(root)
    let nodes: NodeAction[]
    try {
        nodes = await workflowActions(root, db, workflowId)
    } finally {
        db.close()
    }
    raiseDecisions(root, workflowId, actions, nodes, rules)
    return { actions, binary }
}

const inlineTask = (root: string, workflowId: string): string | null => {
    const view = readSnapshot(root, workflowId).views.find((candidate) => (candidate.state === "queued" || candidate.state === "running") && candidate.task !== null)
    return view?.task?.id ?? null
}

/**
 * `kernel next`: the deterministic driver. It returns at once an open decision; otherwise it ticks (mail, step, fences, stalled Ops, unknown
 * launches) and returns the first decision the ledger calls for, else waits on the Kernel Run's mailbox (re-reading the ledger
 * every nextPollSeconds) until nextWaitSeconds pass and returns idle. An inline workflow never waits: with no decision it
 * returns idle naming the task the chat agent works next.
 */
export const kernelNext = async (context: VerbContext, root: string, workflowId: string, waitSeconds?: number): Promise<KernelNext> => {
    const rules = loadCoordinatorLiveness()
    const deadline = Date.now() + (waitSeconds ?? rules.nextWaitSeconds) * 1000
    const status = readSnapshot(root, workflowId).workflow.status
    if (status === "defined") throw new Refusal("WORKFLOW_NOT_STARTED", `workflow ${workflowId} is defined, not started; the Supervisor starts it`)
    const actions: StepAction[] = []
    const answer = (decision: Decision | undefined, inline: string | null): KernelNext => ({
        workflow: workflowId,
        kind: decision?.kind === undefined ? "idle" : (decision.kind as KernelDecisionKind),
        decision: decision ?? null,
        digest: withLedger(root, (db) => digestOf(db, workflowId)),
        actions: actions.slice(-30),
        inlineNext: inline,
    })
    // One round: tick, then answer, or wait for mail and go round again until the deadline.
    const round = async (): Promise<KernelNext> => {
        renewKernel(root, workflowId, rules)
        const pending = firstOpen(root, workflowId)
        if (pending !== undefined) return answer(pending, null)
        const ticked = await tick(context, root, workflowId, rules)
        actions.push(...ticked.actions)
        const raised = firstOpen(root, workflowId)
        if (raised !== undefined) return answer(raised, null)
        const runner = readSnapshot(root, workflowId).workflow.header.runner
        const left = deadline - Date.now()
        if (runner === "inline" || left <= 0) return answer(undefined, runner === "inline" ? inlineTask(root, workflowId) : null)
        const waitMs = Math.min(rules.nextPollSeconds * 1000, left)
        if (ticked.binary === null) await sleep(waitMs)
        else actions.push(...(await drainMail(root, workflowId, ticked.binary, context.cwd, waitMs)))
        return round()
    }
    return round()
}

/** What a submit did: the command row and whether it was a replay of one applied before. */
export interface Submitted {
    readonly command: CommandRow
    readonly replay: boolean
}

const applyKernel = async (context: VerbContext, root: string, command: Command, dir: string): Promise<unknown> => {
    if (command.kind === "workflow-change") {
        if (command.change === undefined) return { amended: false, answered: command.answers ?? [] }
        const change = resolve(dir, command.change)
        const list = (values: readonly string[] | undefined): string | undefined => (values === undefined || values.length === 0 ? undefined : values.join(","))
        const amended = await workflowAmendVerb.run(context, {
            workflow: command.workflow,
            desired: undefined,
            change,
            "based-on": command.basedOn.graph === undefined ? undefined : String(command.basedOn.graph),
            "cmd-id": command.cmdId,
            "keep-effect": list(command.keepEffect),
            accept: list(command.accept),
        })
        const data = amended.data as { readonly graphVersion: number; readonly classification?: readonly { readonly key: string; readonly class: string }[] }
        return { amended: true, graphVersion: data.graphVersion, classification: (data.classification ?? []).map((row) => `${row.key}:${row.class}`) }
    }
    const kind = command.kind === "handoff" ? "handoff" : "escalation"
    const decision = withLedger(root, (db) =>
        raiseDecision(db, {
            scope: "supervisor",
            workflowId: command.workflow,
            kind,
            subject: command.cmdId,
            evidence: { project: repositoryOf(root), cmdId: command.cmdId, escalation: command.escalation ?? null, handoff: command.handoff ?? null, note: command.note ?? null, digest: digestOf(db, command.workflow) },
        }),
    )
    const body = command.escalation?.question ?? command.handoff?.summary ?? command.note ?? command.kind
    const mail = { type: kind, subject: `${kernelTitle(command.workflow)}: ${command.kind}`, body, payload: { cmdId: command.cmdId, decision }, retryRequest: requestIdOf("kernel-mail", command.cmdId) } as const
    return { decision, mail: await wakeSupervisor((await projectOf(root)).key, context.cwd, mail) }
}

/**
 * The content of a Kernel command, whatever its cmdId: its fields but the cmdId, and the bytes of the change file it names, so
 * one unfit change resubmitted under fresh cmdIds is recognised as the same command.
 */
const contentOf = (command: Command, dir: string): string => {
    const hash = createHash("sha256").update(JSON.stringify(Object.entries(command).filter(([field]) => field !== "cmdId")))
    if (command.change !== undefined) {
        try {
            hash.update("\0").update(readFileSync(resolve(dir, command.change)))
        } catch {
            hash.update("\0unreadable")
        }
    }
    return hash.digest("hex")
}

/** How many times the workflow's Kernel commands of this content were refused. */
const refusalsOf = (db: DatabaseSync, workflowId: string, content: string): number =>
    Number(db.prepare("SELECT COUNT(*) AS n FROM commands WHERE scope = 'kernel' AND workflow_id = ? AND status = 'failed' AND json_extract(outcome_json, '$.content') = ?").get(workflowId, content)?.n ?? 0)

/** Raises the one harness escalation of a poisoned command for the Supervisor (once per content). */
const escalatePoison = (db: DatabaseSync, root: string, command: Command, content: string, refusals: number, last: string): string =>
    raiseDecision(db, {
        scope: "supervisor",
        workflowId: command.workflow,
        kind: "escalation",
        subject: `poison:${content.slice(0, 16)}`,
        evidence: { project: repositoryOf(root), cmdId: command.cmdId, escalation: { kind: "harness", question: `the Kernel of ${command.workflow} submitted the same ${command.kind} ${String(refusals)} times and it was refused each time (last: ${last}); later submits of it are refused at once. Look at the Kernel's plan.` } },
    })

/**
 * `kernel submit <file>`: one Kernel command. It is admitted first (cmdId dedupe, basedOn compare-and-swap, an `applying` intent
 * row), then applied: workflow-change through `workflow amend`; escalation and handoff become a Supervisor decision carrying
 * the ledger row, and a mail wakes the Supervisor. The decisions it answers close with it. A refused command records its content;
 * the poisonRefusals-th refusal of one content escalates to the Supervisor (kind harness), and every later submit of that
 * content is refused at once (COMMAND_POISONED) without being applied.
 */
export const kernelSubmit = async (context: VerbContext, root: string, file: string): Promise<Submitted> => {
    const parsed = readCommand(file, "kernel")
    const { command } = parsed
    const admitted = withLedger(root, (db) => admitCommand(db, "kernel", parsed))
    if (admitted.kind === "replay") return { command: admitted.row, replay: true }
    const limit = loadCoordinatorLiveness().poisonRefusals
    const content = contentOf(command, dirname(file))
    const prior = withLedger(root, (db) => refusalsOf(db, command.workflow, content))
    if (prior >= limit) {
        const message = `this ${command.kind} was refused ${String(prior)} times under other cmdIds; it is not applied again and the Supervisor has the escalation`
        withLedger(root, (db) => { inTransaction(db, () => {
                finishCommand(db, "kernel", command, "failed", { code: "COMMAND_POISONED", message, content })
                escalatePoison(db, root, command, content, prior, message)
            }); },
        )
        throw new Refusal("COMMAND_POISONED", message)
    }
    let outcome: unknown
    try {
        outcome = await applyKernel(context, root, command, dirname(file))
    } catch (error: unknown) {
        const refusal = asRefusal(error)
        withLedger(root, (db) => { inTransaction(db, () => {
                finishCommand(db, "kernel", command, "failed", { code: refusal.code, message: refusal.message, content })
                if (prior + 1 >= limit) escalatePoison(db, root, command, content, prior + 1, `${refusal.code}: ${refusal.message.split("\n")[0] ?? ""}`)
            }); },
        )
        throw error
    }
    const row = withLedger(root, (db) => finishCommand(db, "kernel", command, "applied", outcome))
    renewKernel(root, command.workflow, loadCoordinatorLiveness())
    return { command: row, replay: false }
}
