import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { answerDecision, decisionId, getDecision, raiseDecision, SHARED_NEED } from "../../harness/coordinator-commands.js"
import { CHANGE_SCHEMA } from "../../harness/graph.js"
import { workflowWorktreeOf } from "../../harness/kernel.js"
import { LandConflict, rebaseCandidate } from "../../harness/land.js"
import { now, openLedger, projectDir } from "../../harness/ledger.js"
import { withMachine } from "../../harness/machine.js"
import { KERNEL_NEED_GUIDANCE, SUPERVISOR_NEED_GUIDANCE } from "../../harness/need-answer.js"
import {
    attachWaiter,
    ENDED_NEED_STATES,
    isPackageNeed,
    isSharedPath,
    kindOf,
    loadNeedDeadline,
    needRepo,
    needOf,
    needsOfOutput,
    needsOfWorkflow,
    packageFolderOf,
    patchNeed,
    reopenNeed,
    sameRepo,
    waiterRowsOfTask,
    waitersOf,
} from "../../harness/needs.js"
import type { NeedDecisionRef, NeedLevel, NeedRow, NeedScope, WaiterRow } from "../../harness/needs.js"
import { thisVerifier, withSettleLock } from "../../harness/settle.js"
import { getTask, latestAttempt, resultOf } from "../../harness/tasks.js"
import { projectOf } from "../../harness/work.js"
import { getWorkflow, snapshotOf } from "../../harness/workflow.js"
import { olderThan } from "../../harness/coordinator-liveness.js"
import { asRefusal, Refusal } from "../../shared/errors.js"
import { captureGit, currentBranch, gitSucceeds, mainCheckout, resolveSha } from "../../shared/git.js"
import type { VerbContext } from "../../shared/verb.js"
import { listHandoffs } from "../pkg/edit.js"
import { taskCancelVerb } from "../task/cancel.js"
import { workflowAmendVerb } from "../workflow/amend.js"
import type { StepAction } from "../workflow/engine.js"

/**
 * The router of shared needs (cli/README.md "Shared needs"), run by every step of a workflow (harness/engine.ts settleWorkflow:
 * `workflow step`, `kernel next`, `supervisor next` and `supervisor tick`) for the needs its tasks wait on, own or resolve:
 * 1. a task returned blocked with needs is recorded as a waiter of each and parked (`task cancel`: its work preserved, its slot freed);
 * 2. an open need is routed by scope: one workflow and no shared path to that workflow's Kernel, two workflows or a shared path
 *    or a config key to the Supervisor, a `@starci` package to the Supervisor as a package edit; a need routed past the owner
 *    deadline (ops/liveness.yaml), or whose decision was answered with no owner (an escalation), goes one level up;
 * 3. a resolver is judged: done resolves the need, failed, cancelled or removed reopens it at its router;
 * 4. a resolved or rejected need releases its waiters in the workflow: the resolver's commit is carried onto the workflow's
 *    branch when it landed elsewhere, then each waiter's key is retried, its new attempt starting from the preserved work.
 */

/** A step of a release amend calls this router again; the nested call does nothing, the outer one finishes the pass. */
let tending = false

const withLedger = <T>(root: string, work: (db: DatabaseSync) => T): T => {
    const db = openLedger(root)
    try {
        return work(db)
    } finally {
        db.close()
    }
}

/** Where one pass runs: the project, the repository (its main checkout) and checkout of the ledger, and the workflow. */
interface Place {
    readonly context: VerbContext
    readonly project: string
    readonly repo: string
    readonly root: string
    readonly workflow: string
}

const action = (detail: string, kind: StepAction["action"] = "wait", task: string | null = null, key: string | null = null): StepAction => ({ key, task, action: kind, detail })

/** The scope a need's key, waiters and paths give it. */
export const scopeOf = (key: string, waiters: readonly WaiterRow[]): NeedScope => {
    if (isPackageNeed(key)) return "package"
    const homes = new Set(waiters.map((waiter) => `${resolve(waiter.repo).toLowerCase()}|${waiter.workflow ?? "-"}`))
    if (homes.size > 1 || waiters.some((waiter) => waiter.workflow === null)) return "shared"
    if (kindOf(key) === "config" || waiters.some((waiter) => waiter.paths.some((path) => isSharedPath(path)))) return "shared"
    return "workflow"
}

/** The waiters still parked on a need. */
export const waiting = (waiters: readonly WaiterRow[]): WaiterRow[] => waiters.filter((waiter) => waiter.releasedAt === null)

/** A task as a node of the needs graph: its repository, workflow and plan key. */
const refOf = (repo: string, workflow: string | null, key: string | null): string => `${resolve(repo).toLowerCase()}|${workflow ?? "-"}|${key ?? "-"}`

/** The task a need's resolver names as a node, or null for a worker, a package edit or no resolver. */
const resolverRef = (need: NeedRow): string | null => (need.resolver?.kind === "task" && need.resolver.workflow !== null && need.resolver.key !== null ? refOf(need.resolver.repo, need.resolver.workflow, need.resolver.key) : null)

/**
 * A cycle through a need: a waiter of it that its resolver (through the resolvers of the needs that resolver waits on in turn)
 * depends on, as the path of task refs; null when there is none.
 */
export const findCycle = (db: DatabaseSync, need: NeedRow): string[] | null => {
    const start = resolverRef(need)
    if (start === null) return null
    const edges = new Map<string, string[]>()
    const open = db.prepare("SELECT * FROM shared_needs WHERE project = ? AND state IN ('routed', 'owned', 'resolving')").all(need.project)
    for (const row of open) {
        const other = needOf(db, need.project, String(row.key))
        const to = other === undefined ? null : resolverRef(other)
        if (other === undefined || to === null) continue
        for (const waiter of waiting(waitersOf(db, need.project, other.key))) {
            const from = refOf(waiter.repo, waiter.workflow, waiter.taskKey)
            edges.set(from, [...(edges.get(from) ?? []), to])
        }
    }
    const targets = new Set(waiting(waitersOf(db, need.project, need.key)).map((waiter) => refOf(waiter.repo, waiter.workflow, waiter.taskKey)))
    const seen = new Set<string>()
    const walk = (at: string, path: readonly string[]): string[] | null => {
        if (targets.has(at)) return [...path, at]
        if (seen.has(at)) return null
        seen.add(at)
        for (const next of edges.get(at) ?? []) {
            const found = walk(next, [...path, at])
            if (found !== null) return found
        }
        return null
    }
    return walk(start, [])
}

/** The readable line of a cycle: each task by its workflow and key. */
const cycleLine = (path: readonly string[]): string => path.map((ref) => ref.split("|").slice(1).join(":")).join(" -> ")

/** Reopens a need whose resolver closes a cycle, at its router, naming the cycle; returns the need, reopened or as it stands. */
export const breakCycle = (db: DatabaseSync, need: NeedRow): NeedRow => {
    const cycle = findCycle(db, need)
    if (cycle === null) return need
    return reopenNeed(db, need, `cycle: ${cycleLine(cycle)} (its resolver waits, through other needs, on a waiter of ${need.key}); name another resolver`)
}

/** Closes the decision a need was routed by, when it is still open: the need moved on without it. */
export const closeDecision = (ref: NeedDecisionRef | null, why: string): void => {
    if (ref === null) return
    try {
        withLedger(ref.repo, (db) => {
            const decision = getDecision(db, ref.id)
            if (decision?.answeredBy === null) answerDecision(db, ref.id, `superseded: ${why}`, ref.scope)
        })
    } catch {
        // A ledger that cannot be opened now keeps its decision; the coordinator's answer to it is refused STALE by the need's state.
    }
}

/** The evidence a need's decision carries: the need, its waiters with what each reported, why it is routed here, and how to answer. */
export const evidenceOf = (need: NeedRow, waiters: readonly WaiterRow[], level: NeedLevel, scope: NeedScope, extra: Readonly<Record<string, unknown>> = {}): unknown => ({
    project: need.project,
    need: need.key,
    round: need.round,
    scope,
    level,
    reason: need.reason,
    route: scope === "package" ? "package" : level,
    waiters: waiters.map((waiter) => ({ repo: waiter.repo, workflow: waiter.workflow, task: waiter.task, key: waiter.taskKey, given: waiter.given, rules: waiter.rules, paths: waiter.paths, note: waiter.note })),
    rules: [...new Set(waiters.flatMap((waiter) => waiter.rules))],
    paths: [...new Set(waiters.flatMap((waiter) => waiter.paths))],
    answer:
        level === "kernel"
            ? KERNEL_NEED_GUIDANCE
            : scope === "package"
              ? `a package edit, never the owner's: starci supervisor dispatch --need ${need.key} --brief <the fix> (--input package=${need.key.slice("package:".length)} is filled), whose worker runs pkg branch, fixes it and pkg handoff; the waiters are released once Debug merged the handoff`
              : SUPERVISOR_NEED_GUIDANCE,
    ...extra,
})

/** The home of a need's Supervisor decision: this workflow when one of its tasks waits on it, else the first waiter's. */
const carrierOf = (place: Place, waiters: readonly WaiterRow[]): { readonly repo: string; readonly workflow: string } | null => {
    const here = waiters.find((waiter) => waiter.workflow === place.workflow && sameRepo(waiter.repo, place.repo))
    if (here !== undefined) return { repo: place.repo, workflow: place.workflow }
    const first = waiters.find((waiter) => waiter.workflow !== null)
    return first?.workflow == null ? { repo: place.repo, workflow: place.workflow } : { repo: first.repo, workflow: first.workflow }
}

/**
 * Routes an open need at its level: its scope (scopeOf) sets the floor, a Kernel for one workflow's own need and the Supervisor
 * for a shared or package one, and a need reopened at a higher router stays there. The decision is claimed on the need first
 * (its id is deterministic), then raised in the ledger that holds it; a routed need re-raises it each pass, which is idempotent.
 */
const route = (place: Place, need: NeedRow, level: NeedLevel): StepAction[] => {
    const waiters = waiting(withMachine((db) => waitersOf(db, need.project, need.key)))
    if (waiters.length === 0) return []
    const scope = scopeOf(need.key, waiters)
    const floor: NeedLevel = scope === "workflow" ? "kernel" : "supervisor"
    const at: NeedLevel = level === "owner" ? "owner" : level === "supervisor" || floor === "supervisor" ? "supervisor" : "kernel"
    const home = at === "kernel" ? { repo: waiters[0]?.repo ?? place.repo, workflow: waiters[0]?.workflow ?? place.workflow } : carrierOf(place, waiters)
    if (home === null) return []
    const subject = at === "owner" ? `need-deadline:${need.key}#${String(need.round)}` : `need:${need.key}#${String(need.round)}@${at}`
    const kind = at === "owner" ? "escalation" : SHARED_NEED
    const scopeOfDecision = at === "kernel" ? "kernel" : "supervisor"
    const ref: NeedDecisionRef = { repo: home.repo, workflow: home.workflow, id: decisionId(scopeOfDecision, home.workflow, kind, subject), scope: scopeOfDecision }
    const claimed = withMachine((db) => {
        const current = needOf(db, need.project, need.key)
        if (current === undefined) return undefined
        if (current.round !== need.round || (current.state !== "open" && current.decision?.id !== ref.id)) return undefined
        return current.state === "open" ? patchNeed(db, need.project, need.key, { state: "routed", level: at, scope, decision: ref, routedAt: now() }, "routed") : current
    })
    if (claimed === undefined) return []
    const evidence =
        at === "owner"
            ? {
                  project: home.repo,
                  need: need.key,
                  escalation: {
                      kind: scope === "package" ? "harness" : "owner",
                      question: `shared need ${need.key} (${String(waiters.length)} waiter(s): ${waiters.map((waiter) => `${waiter.workflow ?? "worker"}:${waiter.taskKey ?? waiter.task}`).join(", ")}) has had no owner past ${String(loadNeedDeadline())} min at the Supervisor; ${scope === "package" ? "Debug: dispatch its package edit or rule it" : "rule who owns it"}, then relay it as a need-owner (or supervisor dispatch --need ${need.key})`,
                  },
              }
            : evidenceOf(claimed, waiters, at, scope)
    try {
        withLedger(home.repo, (db) => raiseDecision(db, { scope: scopeOfDecision, workflowId: home.workflow, kind, subject, evidence }))
    } catch (error: unknown) {
        return [action(`need ${need.key}: decision ${ref.id} not raised yet (${asRefusal(error).code}); the next step raises it`, "problem")]
    }
    return claimed.state === need.state ? [] : [action(`need ${need.key} routed to the ${at === "kernel" ? `Kernel of ${home.workflow}` : at === "owner" ? "owner" : "Supervisor"} as ${ref.id} (${scope}, ${String(waiters.length)} waiter(s))`)]
}

/** Moves a need one router up: its open decision is closed and it is routed again a level higher (Kernel, Supervisor, owner). */
const escalate = (place: Place, need: NeedRow, why: string): StepAction[] => {
    const up: NeedLevel = need.level === "kernel" ? "supervisor" : "owner"
    if (need.level === "owner") return []
    closeDecision(need.decision, `escalated to the ${up}: ${why}`)
    const reopened = withMachine((db) => patchNeed(db, need.project, need.key, { state: "open", level: up, decision: null, routedAt: null, reason: why }, "escalated"))
    return [action(`need ${need.key} escalated to the ${up}: ${why}`), ...route(place, reopened, up)]
}

/** A routed need: re-raised, escalated past the deadline or when its decision was answered with no owner, or moved up when a second workflow joined. */
const tendRouted = (place: Place, need: NeedRow): StepAction[] => {
    const waiters = waiting(withMachine((db) => waitersOf(db, need.project, need.key)))
    if (need.level === "kernel" && scopeOf(need.key, waiters) !== "workflow") return escalate(place, need, "a second workflow or a shared path reported it; one owner is ruled by the Supervisor")
    const decision = need.decision === null ? undefined : withLedger(need.decision.repo, (db) => getDecision(db, need.decision?.id ?? ""))
    if (decision?.answeredBy != null && need.level !== "owner") return escalate(place, need, `its decision was answered by ${decision.answeredBy} with no owner`)
    if (need.level !== "owner" && need.routedAt !== null && olderThan(need.routedAt, loadNeedDeadline())) return escalate(place, need, `no owner within ${String(loadNeedDeadline())} min`)
    return route(place, need, need.level ?? "kernel")
}

/**
 * A need the Supervisor gave to a workflow: its Kernel names the resolver; a Kernel decision answered without one (an
 * escalation) hands the need back to the Supervisor, its router.
 */
const tendOwned = (place: Place, need: NeedRow): StepAction[] => {
    const ref = need.decision
    const decision = ref === null ? undefined : withLedger(ref.repo, (db) => getDecision(db, ref.id))
    if (decision?.answeredBy == null) return []
    const reopened = withMachine((db) => reopenNeed(db, need, `the owning workflow's Kernel answered ${decision.id} by ${decision.answeredBy ?? "?"} with no resolver; back to the Supervisor`, "supervisor"))
    return [action(`need ${need.key} returned to the Supervisor: its owner named no resolver`), ...route(place, reopened, "supervisor")]
}

/** How a resolver stands: done (with the commit it landed, if any), failed (why), or still working. */
type ResolverStatus = { readonly kind: "done"; readonly commit: string | null; readonly detail: string } | { readonly kind: "failed"; readonly detail: string } | { readonly kind: "pending" }

const FAILED_TASK: readonly string[] = ["failed", "cancelled", "awaiting_owner"]

/** A task resolver by id (a worker's task): done when it is done, failed when it ended any other way. */
const taskStatus = (repo: string, taskId: string): ResolverStatus =>
    withLedger(repo, (db) => {
        const task = getTask(db, taskId)
        if (task.status === "done") return { kind: "done", commit: task.settleCommit, detail: `task ${taskId} done` }
        return FAILED_TASK.includes(task.status) ? { kind: "failed", detail: `its resolver task ${taskId} is ${task.status}` } : { kind: "pending" }
    })

/** How the resolver of a resolving need stands, read from its ledger, its package handoff and git. */
const resolverStatus = async (need: NeedRow): Promise<ResolverStatus> => {
    const resolver = need.resolver
    if (resolver === null) return { kind: "failed", detail: "it has no resolver" }
    if (resolver.kind === "task") {
        if (resolver.task !== null) return taskStatus(resolver.repo, resolver.task)
        const { workflow, key } = resolver
        if (workflow === null || key === null) return { kind: "failed", detail: "its resolver names no task" }
        return withLedger(resolver.repo, (db): ResolverStatus => {
            const snapshot = snapshotOf(db, workflow)
            const view = snapshot.views.find((candidate) => candidate.key === key)
            if (view === undefined) return { kind: "failed", detail: `its resolver ${workflow}:${key} left the graph` }
            if (view.state === "done" && view.task !== null) return { kind: "done", commit: getTask(db, view.task.id).settleCommit, detail: `${workflow}:${key} landed (task ${view.task.id})` }
            if (["failed", "cancelled"].includes(view.state)) return { kind: "failed", detail: `its resolver ${workflow}:${key} is ${view.state}` }
            if (snapshot.workflow.status === "stopped") return { kind: "failed", detail: `the workflow ${workflow} of its resolver stopped` }
            return { kind: "pending" }
        })
    }
    const handoff = resolver.handoff ?? listHandoffs().find((one) => one.packages.includes(packageFolderOf(need.key)) && one.at >= need.openedAt) ?? null
    if (handoff !== null && resolver.handoff === null) withMachine((db) => patchNeed(db, need.project, need.key, { resolver: { ...resolver, handoff: { branch: handoff.branch, head: handoff.head, harness: handoff.harness } } }, "handoff-linked"))
    if (handoff !== null && (await gitSucceeds(handoff.harness, ["merge-base", "--is-ancestor", handoff.head, "main"]))) return { kind: "done", commit: null, detail: `package edit ${handoff.branch} ${handoff.head.slice(0, 9)} is merged on harness main` }
    if (handoff === null && resolver.task !== null && resolver.repo !== null) {
        const worker = taskStatus(resolver.repo, resolver.task)
        if (worker.kind === "failed") return worker
    }
    return { kind: "pending" }
}

/** A resolving need: done resolves it, failed reopens it at its router. */
const tendResolving = async (place: Place, need: NeedRow): Promise<StepAction[]> => {
    const status = await resolverStatus(need)
    if (status.kind === "pending") return []
    if (status.kind === "failed") {
        const reopened = withMachine((db) => reopenNeed(db, need, `${status.detail}; it returns to its router`))
        return [action(`need ${need.key} reopened: ${status.detail}`), ...route(place, reopened, reopened.level ?? "kernel")]
    }
    withMachine((db) => patchNeed(db, need.project, need.key, { state: "resolved", resolvedAt: now(), reason: status.detail, resolver: need.resolver?.kind === "task" ? { ...need.resolver, ...(status.commit === null ? {} : { commit: status.commit }) } : need.resolver }, "resolved"))
    return [action(`need ${need.key} resolved: ${status.detail}`, "verified")]
}

/**
 * Carries a resolver's landed commit onto the workflow's branch when that branch lacks it (the resolver landed on another
 * workflow's branch or a worker's), under the branch's land lock, as a landing does (harness/land.ts rebaseCandidate, then a
 * fast-forward of the workflow's checkout). A commit that does not apply is named and the waiters are released anyway: their new
 * attempt reports the need again if it still misses it, which reopens the need.
 */
const carry = async (place: Place, commit: string): Promise<string> => {
    const target = withLedger(place.root, (db) => workflowWorktreeOf(db, place.workflow)) ?? place.root
    if (await gitSucceeds(target, ["merge-base", "--is-ancestor", commit, "HEAD"])) return `${commit.slice(0, 12)} is on the branch`
    const branch = await currentBranch(target)
    if (branch === undefined) return `${commit.slice(0, 12)} not carried: ${target} is on a detached HEAD`
    const db = openLedger(place.root)
    try {
        return await withSettleLock(db, thisVerifier(`need-carry:${place.workflow}`), 60_000, `land-lock:${branch}`, async () => {
            const head = await resolveSha(target, "HEAD")
            const made = await rebaseCandidate(target, commit, await resolveSha(target, `${commit}^`), head)
            const ff = await captureGit(["merge", "--ff-only", "--quiet", made.commit], target)
            if (ff.exitCode !== 0) throw new Refusal("NEED_CARRY_FAILED", `git merge --ff-only in ${target}: ${ff.stderr.trim()}`)
            return `carried ${commit.slice(0, 12)} onto ${branch} as ${made.commit.slice(0, 12)}`
        })
    } catch (error: unknown) {
        if (error instanceof LandConflict) return `${commit.slice(0, 12)} does not apply to ${branch} (${error.files.join(", ")}); the waiters run without it and report again if they still miss it`
        return `${commit.slice(0, 12)} not carried (${asRefusal(error).code}): ${asRefusal(error).message.split("\n")[0] ?? ""}`
    } finally {
        db.close()
    }
}

/** True when every need a task waits on has ended, so releasing it now does not run it before another of its needs. */
const allEnded = (db: DatabaseSync, project: string, rows: readonly WaiterRow[]): boolean =>
    rows.filter((row) => row.releasedAt === null).every((row) => {
        const need = needOf(db, project, row.key)
        return need === undefined || ENDED_NEED_STATES.includes(need.state)
    })

/**
 * Releases the waiters of an ended need in this workflow: each whose every need ended gets the resolver's commit carried (a
 * resolved need landed elsewhere) and its key retried in one amend, unless its Kernel already moved it on; then its rows are
 * marked released with how. A waiter outside any workflow (a worker) is marked released for its Supervisor.
 */
const release = async (place: Place, need: NeedRow): Promise<StepAction[]> => {
    const mine = waiting(withMachine((db) => waitersOf(db, need.project, need.key))).filter((waiter) => waiter.workflow === place.workflow && sameRepo(waiter.repo, place.repo))
    const ready = withMachine((db) => mine.filter((waiter) => allEnded(db, need.project, waiterRowsOfTask(db, need.project, waiter.repo, waiter.task))))
    if (ready.length === 0) return []
    const commit = need.state === "resolved" && need.resolver?.kind === "task" ? (need.resolver.commit ?? null) : null
    const landedHere = need.resolver?.kind === "task" && need.resolver.workflow === place.workflow && sameRepo(need.resolver.repo, place.repo)
    const carried = commit !== null && !landedHere && need.resolver?.kind === "task" && sameRepo(need.resolver.repo, place.repo) ? await carry(place, commit) : null
    const snapshot = withLedger(place.root, (db) => snapshotOf(db, place.workflow))
    const retry = ready.filter((waiter) => {
        const view = snapshot.views.find((candidate) => candidate.key === waiter.taskKey)
        return view !== undefined && (view.task === null || view.task.id === waiter.task)
    })
    const keys = [...new Set(retry.map((waiter) => waiter.taskKey).filter((key): key is string => key !== null))]
    const actions: StepAction[] = []
    if (keys.length > 0) {
        const dir = join(projectDir(place.root), "needs")
        mkdirSync(dir, { recursive: true })
        const id = `need-release-${createHash("sha256").update(`${need.project}\0${need.key}\0${String(need.round)}\0${place.workflow}\0${keys.join(",")}`).digest("hex").slice(0, 16)}`
        const file = join(dir, `${id}.yaml`)
        const why = need.state === "resolved" ? `shared need ${need.key} resolved` : `shared need ${need.key} rejected: ${need.reason ?? "not shared"}`
        writeFileSync(file, JSON.stringify({ schema: CHANGE_SCHEMA, workflow: place.workflow, reason: why, changes: keys.map((key) => ({ op: "retry", id: key })) }, null, 2))
        try {
            await workflowAmendVerb.run({ ...place.context, cwd: place.root }, { workflow: place.workflow, desired: undefined, change: file, "based-on": undefined, "cmd-id": id, "keep-effect": undefined, accept: undefined })
        } catch (error: unknown) {
            return [action(`need ${need.key}: waiters ${keys.join(", ")} not released yet (${asRefusal(error).code}): ${asRefusal(error).message.split("\n")[0] ?? ""}; the next step retries`, "problem")]
        }
        actions.push(action(`need ${need.key} ${need.state}: released ${keys.join(", ")} (retried from their preserved work)${carried === null ? "" : `; ${carried}`}`, "dispatched"))
    }
    const how = { by: need.state, round: need.round, reason: need.reason, commit, carried, retried: keys }
    withMachine((db) => {
        for (const waiter of ready) {
            db.prepare("UPDATE shared_need_waiters SET released_at = ?, release_json = ? WHERE project = ? AND repo = ? AND task_id = ? AND released_at IS NULL").run(now(), JSON.stringify(how), need.project, waiter.repo, waiter.task)
        }
    })
    return actions
}

/**
 * Records every task of the workflow that came back blocked with needs as a waiter of each (again: `task result` records them
 * first, this makes a lost write good), then parks it with `task cancel`: its dirty work is preserved for the attempt its release
 * retries, its worktree and slot are freed, and no question is raised for it (kernel driver raiseNodeStates).
 */
const registerReturned = async (place: Place): Promise<StepAction[]> => {
    const returned = withLedger(place.root, (db) =>
        snapshotOf(db, place.workflow).views.flatMap((view) => {
            if (view.state !== "returned" || view.task === null) return []
            const attempt = latestAttempt(db, view.task.id)
            const reports = attempt === undefined ? [] : needsOfOutput(resultOf(db, attempt.id)?.output)
            return reports.length === 0 ? [] : [{ key: view.key, task: view.task.id, reports }]
        }),
    )
    const actions: StepAction[] = []
    for (const one of returned) {
        const keys = withMachine((db) =>
            one.reports.map((report) => {
                const attached = attachWaiter(db, report, { project: place.project, repo: place.repo, workflow: place.workflow, task: one.task, taskKey: one.key })
                breakCycle(db, attached.need)
                return attached.need.key
            }),
        )
        try {
            await taskCancelVerb.run({ ...place.context, cwd: place.root }, { task: one.task, reason: `parked on shared need ${keys.join(", ")}; released when it is resolved or rejected` })
        } catch (error: unknown) {
            actions.push(action(`waiter not parked (${asRefusal(error).code}): ${asRefusal(error).message.split("\n")[0] ?? ""}`, "problem", one.task, one.key))
            continue
        }
        withMachine((db) => db.prepare("UPDATE shared_need_waiters SET parked_at = ? WHERE project = ? AND repo = ? AND task_id = ? AND parked_at IS NULL").run(now(), place.project, place.repo, one.task))
        actions.push(action(`parked on shared need ${keys.join(", ")} (work preserved)`, "cancelled", one.task, one.key))
    }
    return actions
}

/** One need of the workflow, by its state. */
const tendOne = async (place: Place, need: NeedRow): Promise<StepAction[]> => {
    switch (need.state) {
        case "open":
            return route(place, withMachine((db) => breakCycle(db, need)), need.level ?? "kernel")
        case "routed":
            return tendRouted(place, need)
        case "owned":
            return tendOwned(place, need)
        case "resolving": {
            const checked = withMachine((db) => breakCycle(db, need))
            if (checked.state !== "resolving") return route(place, checked, checked.level ?? "kernel")
            const moved = await tendResolving(place, need)
            const after = withMachine((db) => needOf(db, need.project, need.key))
            return after?.state === "resolved" ? [...moved, ...(await release(place, after))] : moved
        }
        case "resolved":
        case "rejected":
            return release(place, need)
        case "merged":
            return []
    }
}

/**
 * One pass of the shared-need router over a workflow (see the file's head). Never throws: a need it cannot move now is a
 * `problem` action and the next step tries again.
 */
export const tendNeeds = async (context: VerbContext, root: string, workflowId: string): Promise<StepAction[]> => {
    if (tending) return []
    tending = true
    try {
        const project = await projectOf(root)
        if (project.key === "") return []
        if (getWorkflowSafe(root, workflowId) === undefined) return []
        const place: Place = { context, project: project.key, repo: needRepo(await mainCheckout(root)), root, workflow: workflowId }
        const actions = await registerReturned(place)
        for (const need of withMachine((db) => needsOfWorkflow(db, place.project, place.repo, workflowId))) {
            try {
                actions.push(...(await tendOne(place, need)))
            } catch (error: unknown) {
                actions.push(action(`need ${need.key} not tended (${asRefusal(error).code}): ${asRefusal(error).message.split("\n")[0] ?? ""}`, "problem"))
            }
        }
        return actions
    } catch (error: unknown) {
        return [action(`shared needs not tended (${asRefusal(error).code}): ${asRefusal(error).message.split("\n")[0] ?? ""}`, "problem")]
    } finally {
        tending = false
    }
}

const getWorkflowSafe = (root: string, workflowId: string): string | undefined => {
    try {
        return withLedger(root, (db) => getWorkflow(db, workflowId).id)
    } catch {
        return undefined
    }
}
