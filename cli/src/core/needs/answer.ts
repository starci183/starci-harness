import type { DatabaseSync } from "node:sqlite"
import { raiseDecision, SHARED_NEED, decisionId } from "../../harness/coordinator-commands.js"
import type { Command } from "../../harness/coordinator-commands.js"
import { openLedger } from "../../harness/ledger.js"
import { withMachine } from "../../harness/machine.js"
import { KERNEL_NEED_GUIDANCE, resolverKeys, SUPERVISOR_NEED_GUIDANCE } from "../../harness/need-answer.js"
import { isPackageNeed, needOf, needRepo, normalizeNeedKey, patchNeed, waitersOf } from "../../harness/needs.js"
import type { NeedRow } from "../../harness/needs.js"
import { projectOf } from "../../harness/work.js"
import { getWorkflow } from "../../harness/workflow.js"
import { Refusal } from "../../shared/errors.js"
import { mainCheckout } from "../../shared/git.js"
import { breakCycle, closeDecision, evidenceOf, scopeOf, waiting } from "./tend.js"

/**
 * The coordinators' answers to a shared need, recorded on the need (harness/needs.ts): a Kernel's resolver or rejection
 * (`kernel submit` of a workflow-change), the Supervisor's owner workflow or rejection (`supervisor submit` of a need-owner) and
 * its `[Worker]` (`supervisor dispatch --need`). Each is checked against the need as it stands before anything is applied, so an
 * answer to a need that moved on bounces back NEED_ANSWER_INVALID with guidance instead of half-applying.
 */

const withLedger = <T>(root: string, work: (db: DatabaseSync) => T): T => {
    const db = openLedger(root)
    try {
        return work(db)
    } finally {
        db.close()
    }
}

/** The states a coordinator may answer a need in: routed to it, or open between passes. */
const ANSWERABLE: readonly string[] = ["open", "routed", "owned"]

/** Where a command's need lives: its project, the repository of the ledger and its normalized key. */
interface NeedPlace {
    readonly project: string
    readonly repo: string
    readonly key: string
}

const placeOf = async (root: string, key: string): Promise<NeedPlace> => ({ project: (await projectOf(root)).key, repo: needRepo(await mainCheckout(root)), key: normalizeNeedKey(key) })

/** The need a command answers, refused when the store has none or it is no longer answerable at this router. */
const answerable = (db: DatabaseSync, place: NeedPlace, by: "kernel" | "supervisor"): NeedRow => {
    const guidance = by === "kernel" ? KERNEL_NEED_GUIDANCE : SUPERVISOR_NEED_GUIDANCE
    const need = needOf(db, place.project, place.key)
    if (need === undefined) throw new Refusal("NEED_ANSWER_INVALID", `no shared need ${place.key} in this project (starci needs list); ${guidance}`)
    if (!ANSWERABLE.includes(need.state)) throw new Refusal("NEED_ANSWER_INVALID", `need ${place.key} is ${need.state}${need.mergedInto === null ? "" : ` into ${need.mergedInto}`}, past answering; re-read with ${by} next`)
    if (by === "supervisor" && need.level === "kernel" && need.state !== "owned") throw new Refusal("NEED_ANSWER_INVALID", `need ${place.key} is routed to a Kernel, not to the Supervisor; it reaches you once it is shared or past its deadline`)
    return need
}

/** Checks a Kernel's need answer against the need before its workflow-change is applied. */
export const assertKernelNeed = async (root: string, command: Command): Promise<void> => {
    if (command.need === undefined) return
    const place = await placeOf(root, command.need.key)
    withMachine((db) => answerable(db, place, "kernel"))
}

/**
 * Records a Kernel's applied answer: a rejection ends the need `rejected` (its waiters go back to their Ops on the next step); a
 * resolver makes the workflow its owner and the named task its resolver (`resolving`), and a resolver that closes a cycle
 * reopens the need at once with the cycle named (tend.ts breakCycle).
 */
export const recordKernelNeed = async (root: string, command: Command): Promise<NeedRow | null> => {
    const answer = command.need
    if (answer === undefined) return null
    const place = await placeOf(root, answer.key)
    return withMachine((db) => {
        const need = answerable(db, place, "kernel")
        if (answer.reject !== undefined) return patchNeed(db, place.project, place.key, { state: "rejected", reason: `rejected by the Kernel of ${command.workflow} (${command.cmdId}): ${answer.reject}`, resolvedAt: null }, "rejected")
        return resolveBy(db, place, command, need)
    })
}

/**
 * Makes a workflow a need's owner and the task keys an answer names its resolver (`resolving`), and reopens it at once with the
 * cycle named when that resolver closes a cycle (tend.ts breakCycle).
 */
const resolveBy = (db: DatabaseSync, place: NeedPlace, command: Command, need: NeedRow): NeedRow => {
    const keys = resolverKeys(command.need?.resolver)
    const resolving = patchNeed(
        db,
        place.project,
        place.key,
        { state: "resolving", owner: { kind: "workflow", repo: place.repo, workflow: command.workflow }, resolver: { kind: "task", repo: place.repo, workflow: command.workflow, key: keys[0] ?? null, keys, task: null }, reason: `resolver ${keys.map((key) => `${command.workflow}:${key}`).join(", ")} named by ${command.cmdId}` },
        "owned",
    )
    return need.state === "resolving" ? resolving : breakCycle(db, resolving)
}

/**
 * Applies the Supervisor's need-owner: a rejection ends the need `rejected`; with `need.resolver`, the tasks the owner workflow
 * holds (landed or not) resolve it at once (`resolving`); else the owner workflow (which must still dispatch) gets the need
 * (`owned`) as a Kernel shared-need decision in its own ledger. The Supervisor's decision closes, and every other workflow's
 * waiters stay parked on the owner: the recorded cross-workflow dependency, released through the cross-branch relay.
 */
export const applyNeedOwner = async (root: string, command: Command): Promise<unknown> => {
    const answer = command.need
    if (answer === undefined) throw new Refusal("NEED_ANSWER_INVALID", `a need-owner names its need; ${SUPERVISOR_NEED_GUIDANCE}`)
    const place = await placeOf(root, answer.key)
    // An owner that must still build the resolver is a running workflow; one whose named tasks may have landed already need not be.
    if (answer.reject === undefined && answer.resolver === undefined) {
        const status = withLedger(root, (db) => getWorkflow(db, command.workflow).status)
        if (!["running", "blocked", "paused"].includes(status)) throw new Refusal("NEED_ANSWER_INVALID", `workflow ${command.workflow} is ${status}; an owner that builds the resolver is a workflow still running, else name the tasks it landed as need.resolver; ${SUPERVISOR_NEED_GUIDANCE}`)
    }
    const { before, after } = withMachine((db) => {
        const need = answerable(db, place, "supervisor")
        if (answer.reject !== undefined) return { before: need, after: patchNeed(db, place.project, place.key, { state: "rejected", reason: `rejected by the Supervisor (${command.cmdId}): ${answer.reject}` }, "rejected") }
        if (answer.resolver !== undefined) return { before: need, after: resolveBy(db, place, command, need) }
        const subject = `need:${place.key}#${String(need.round)}@owner:${command.cmdId}`
        const ref = { repo: place.repo, workflow: command.workflow, id: decisionId("kernel", command.workflow, SHARED_NEED, subject), scope: "kernel" as const }
        return { before: need, after: patchNeed(db, place.project, place.key, { state: "owned", level: "supervisor", owner: { kind: "workflow", repo: place.repo, workflow: command.workflow }, decision: ref, routedAt: null, reason: `owned by ${command.workflow} (${command.cmdId})` }, "owned") }
    })
    if (before.decision?.id !== after.decision?.id) closeDecision(before.decision, `${after.state} by ${command.cmdId}`)
    if (after.state !== "owned") return { need: after.key, state: after.state }
    const waiters = waiting(withMachine((db) => waitersOf(db, place.project, place.key)))
    const decision = withLedger(root, (db) =>
        raiseDecision(db, { scope: "kernel", workflowId: command.workflow, kind: SHARED_NEED, subject: `need:${place.key}#${String(after.round)}@owner:${command.cmdId}`, evidence: evidenceOf(after, waiters, "kernel", scopeOf(place.key, waiters), { assignedBy: command.cmdId, owner: command.workflow }) }),
    )
    return { need: after.key, state: after.state, owner: command.workflow, decision }
}

/** Checks a `supervisor dispatch --need` before the worker is made: the need exists and waits on the Supervisor. */
export const assertWorkerNeed = (project: string, key: string): NeedRow => {
    const normal = normalizeNeedKey(key)
    return withMachine((db) => answerable(db, { project, repo: "", key: normal }, "supervisor"))
}

/**
 * Records a dispatched `[Worker]` as a need's owner and resolver (`resolving`): a package need is resolved by the package edit
 * its worker hands off (`pkg handoff`) once Debug merged it on harness main, any other by the worker's task landing.
 */
export const recordWorkerNeed = (project: string, key: string, worker: { readonly worker: string; readonly repo: string; readonly task: string }): NeedRow => {
    const normal = normalizeNeedKey(key)
    const before = withMachine((db) => answerable(db, { project, repo: worker.repo, key: normal }, "supervisor"))
    const after = withMachine((db) =>
        patchNeed(
            db,
            project,
            normal,
            {
                state: "resolving",
                owner: { kind: "worker", worker: worker.worker, repo: needRepo(worker.repo), task: worker.task },
                resolver: isPackageNeed(normal) ? { kind: "package", package: normal.slice("package:".length), worker: worker.worker, repo: worker.repo, task: worker.task, handoff: null } : { kind: "task", repo: worker.repo, workflow: null, key: null, task: worker.task },
                reason: `given to [Worker] ${worker.worker}`,
            },
            "owned",
        ),
    )
    closeDecision(before.decision, `given to [Worker] ${worker.worker}`)
    return after
}
