import type { DatabaseSync } from "node:sqlite"
import { Refusal } from "../shared/errors.js"
import { captureTool, headline } from "../shared/exec.js"
import { git } from "../shared/git.js"
import { normaliseRepoPath, parseContract } from "./contract.js"
import type { Contract } from "./contract.js"
import { LIVE_STATES, REVERT_PREFIX, isGeneratedKey, nodeHashOf, sha } from "./graph.js"
import type { Classified, NodeState, NodeView, PlanNode, PlanTask, PriorWork, RevertOf } from "./graph.js"
import { inOrder } from "./sequential.js"
import { getTask, lastEvent, latestAttempt, recordEvent, resultOf } from "./tasks.js"
import { graphVersions, snapshotOf } from "./workflow.js"
import type { Snapshot, WorkflowTask } from "./workflow.js"

/*
 * The replan pattern's mechanics (cli/README.md "Workflow graph"): the settled result of a task, the early cutoff that
 * compares results instead of upstream node hashes, the per-key classification of a desired graph against the current one,
 * the compensating revert of a dropped done task, and the per-key actions a step or `kernel next` acts on.
 */

const text = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value))

/**
 * Records the commit a task landed (the commit carrying its `Starci-Task:` trailer), clearing its result hash so the next read
 * recomputes it. The settle path calls it right after the branch moved; a task settled without the call is found by its
 * `task-settled` event or its trailer, so the call is an optimisation of record, never a requirement.
 */
export const recordSettleCommit = (db: DatabaseSync, taskId: string, commit: string | null): void => {
    db.prepare("UPDATE tasks SET settle_commit = ?, result_hash = NULL WHERE id = ?").run(commit, taskId)
}

/** Where a done task's result is read: the commit it landed (null when it changed nothing) and the commit its tree is read at. */
interface SettledAt {
    readonly landed: string | null
    readonly tree: string | null
}

const settledAt = async (root: string, db: DatabaseSync, taskId: string, recorded: string | null): Promise<SettledAt> => {
    if (recorded !== null && recorded !== "") return { landed: recorded, tree: recorded }
    const event = lastEvent(db, "task-settled", taskId) as { readonly commit?: unknown; readonly committed?: unknown } | undefined
    if (event !== undefined && typeof event.commit === "string") return { landed: event.committed === true ? event.commit : null, tree: event.commit }
    const found = await captureTool("git", ["log", "--all", "-n", "1", "--format=%H", "--fixed-strings", `--grep=Starci-Task: ${taskId}`], root)
    const commit = found.exitCode === 0 ? found.stdout.trim() : ""
    return commit === "" ? { landed: null, tree: null } : { landed: commit, tree: commit }
}

/** The listing of a commit's tree under the given repository paths: the content identity of what a task owns at that commit. */
const treeListing = async (root: string, commit: string, paths: readonly string[]): Promise<string> => {
    const normal = [...new Set(paths.map(normaliseRepoPath))].sort((a, b) => (a < b ? -1 : Number(a > b)))
    const scoped = normal.includes(".") ? [] : normal
    const listed = await captureTool("git", ["ls-tree", "-r", "--full-tree", commit, "--", ...scoped], root)
    if (listed.exitCode !== 0) throw new Refusal("CLI_TOOL_FAILED", `git ls-tree ${commit} failed: ${headline(listed.stderr)}`)
    return listed.stdout
}

/** sha256 of the output a task's newest attempt filed, or of nothing. */
const outputHash = (db: DatabaseSync, taskId: string): string => {
    const attempt = latestAttempt(db, taskId)
    const result = attempt === undefined ? undefined : resultOf(db, attempt.id)
    return sha(result?.output ?? null)
}

/**
 * The settled result hash of a done task: the git tree of its allowPaths at the commit it settled at, plus the hash of its
 * filed output. Two attempts that land the same files and the same output have the same result hash.
 */
const resultHash = async (root: string, db: DatabaseSync, taskId: string, at: SettledAt): Promise<string> => {
    const task = getTask(db, taskId)
    const tree = at.tree === null ? "unknown-commit" : await treeListing(root, at.tree, task.contract.context.allowPaths)
    return sha({ result: 1, tree: sha(tree), output: outputHash(db, taskId) })
}

/**
 * Computes and stores the result hash (and landed commit) of every done task of a workflow that has none yet; git is the
 * authority for what landed. Returns nothing: readResults reads them back.
 */
export const ensureResultHashes = async (root: string, db: DatabaseSync, workflowId: string): Promise<void> => {
    const rows = db.prepare("SELECT id, settle_commit FROM tasks WHERE workflow_id = ? AND status = 'done' AND result_hash IS NULL").all(workflowId)
    for (const row of rows) {
        const id = text(row.id)
        const at = await settledAt(root, db, id, row.settle_commit === null || row.settle_commit === undefined ? null : text(row.settle_commit))
        const hash = await resultHash(root, db, id, at)
        db.prepare("UPDATE tasks SET settle_commit = ?, result_hash = ? WHERE id = ?").run(at.landed, hash, id)
    }
}

/** The settled facts of a workflow's tasks: result hash and landed commit of each done task, and the dependency tasks each ran on. */
export interface Results {
    readonly hashes: ReadonlyMap<string, string>
    readonly commits: ReadonlyMap<string, string>
    readonly inputs: ReadonlyMap<string, Readonly<Record<string, string | null>>>
    readonly tasks: readonly WorkflowTask[]
}

/** Reads the settled facts of a workflow's tasks (call ensureResultHashes first for done tasks to carry a hash). */
export const readResults = (db: DatabaseSync, workflowId: string, tasks: readonly WorkflowTask[]): Results => {
    const hashes = new Map<string, string>()
    const commits = new Map<string, string>()
    const inputs = new Map<string, Record<string, string | null>>()
    for (const row of db.prepare("SELECT id, result_hash, settle_commit, plan_inputs_json FROM tasks WHERE workflow_id = ?").all(workflowId)) {
        const id = text(row.id)
        if (typeof row.result_hash === "string") hashes.set(id, row.result_hash)
        if (typeof row.settle_commit === "string" && row.settle_commit !== "") commits.set(id, row.settle_commit)
        if (typeof row.plan_inputs_json === "string") inputs.set(id, JSON.parse(row.plan_inputs_json) as Record<string, string | null>)
    }
    return { hashes, commits, inputs, tasks }
}

/**
 * The dependency task a task ran on for `dep`: recorded at dispatch, else (a task dispatched before inputs were recorded) the
 * newest done task of that key created before it.
 */
const ranOn = (results: Results, task: WorkflowTask, dep: string): string | null => {
    const recorded = results.inputs.get(task.id)
    if (recorded !== undefined && dep in recorded) return recorded[dep] ?? null
    const before = results.tasks.filter((other) => other.key === dep && other.status === "done" && other.createdAt <= task.createdAt)
    return before.at(-1)?.id ?? null
}

/**
 * Early cutoff: the dependencies of a task whose settled result differs from the one the task ran on. `current` gives each
 * dependency's settled task now, or null while it is not settled (a dependency being redone is pending, never stale yet).
 */
export const changedInputs = (task: WorkflowTask, dependsOn: readonly string[], current: (dep: string) => string | null, results: Results): string[] =>
    dependsOn.filter((dep) => {
        const now = current(dep)
        if (now === null) return false
        const ran = ranOn(results, task, dep)
        if (ran === now) return false
        if (ran === null) return true
        const left = results.hashes.get(ran)
        const right = results.hashes.get(now)
        return left === undefined || right === undefined || left !== right
    })

/**
 * The identity hash of a node for early cutoff: its contract hash plus its dependencies' settled result hashes; null while a
 * dependency has no settled result.
 */
export const identityHash = (node: Pick<PlanNode, "contractHash" | "round" | "dependsOn">, resultOfDep: (dep: string) => string | null): string | null => {
    const deps = node.dependsOn.map((dep) => [dep, resultOfDep(dep)] as const)
    if (deps.some(([, hash]) => hash === null)) return null
    return sha({ identity: 1, contract: node.contractHash, round: node.round, deps })
}

/** The fields that differ between two contracts, one line each (`input.summary: "a" -> "b"`). */
export const contractDiff = (before: Contract, after: Contract): string[] => {
    const lines: string[] = []
    const walk = (left: unknown, right: unknown, path: string): void => {
        if (JSON.stringify(left) === JSON.stringify(right)) return
        const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
        if (isRecord(left) && isRecord(right)) {
            for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort((a, b) => (a < b ? -1 : Number(a > b)))) {
                walk(left[key], right[key], path === "" ? key : `${path}.${key}`)
            }
            return
        }
        lines.push(`${path}: ${left === undefined ? "(none)" : JSON.stringify(left)} -> ${right === undefined ? "(none)" : JSON.stringify(right)}`)
    }
    walk(before, after, "")
    return lines
}

const KEY_MAX = 63

/** The key of the revert node of a dropped key. */
export const revertKeyOf = (key: string): string => {
    const plain = `${REVERT_PREFIX}${key}`
    return plain.length <= KEY_MAX ? plain : `${REVERT_PREFIX}${sha(key).slice(0, 16)}`
}

/**
 * The compensating node of a dropped done task: same label, allowPaths and checks, verified like any task, whose work is to
 * undo exactly the commits the dropped key landed, newest first (`revertCommits` does the mechanics).
 */
export const revertTask = (dropped: PlanNode, commits: readonly string[]): PlanTask => {
    const paths = dropped.contract.context.allowPaths.join(", ")
    const listed = commits.map((commit) => commit.slice(0, 12)).join(" ")
    const contract = parseContract({
        ...dropped.contract,
        input: {
            ...dropped.contract.input,
            summary: `revert ${dropped.key}: undo commits ${listed} on ${paths}`,
            details:
                `The replan dropped task ${dropped.key}, whose attempts landed ${commits.join(", ")} (newest first). Undo exactly those commits and nothing else: ` +
                `\`git revert --no-commit <commit>\` for each in that order, then \`git reset -q\` (starci's revertCommits does this); resolve a conflict in favour of the code before them and keep every later change.`,
        },
    })
    return { key: revertKeyOf(dropped.key), contract, dependsOn: [], route: dropped.route, round: 0 }
}

/**
 * Applies the reverse of `commits` (newest first) to the work tree, committing nothing and leaving the index as it was: the
 * mechanics of a revert node, whose verify then settles it like any task. Refuses when git cannot apply one cleanly.
 */
export const revertCommits = async (root: string, commits: readonly string[]): Promise<void> => {
    await inOrder(commits, async (commit) => {
        const reverted = await captureTool("git", ["revert", "--no-commit", commit], root)
        if (reverted.exitCode !== 0) {
            await captureTool("git", ["revert", "--abort"], root)
            throw new Refusal("REVERT_CONFLICT", `git revert of ${commit.slice(0, 12)} does not apply cleanly: ${headline(reverted.stderr)}; the revert node goes to a worker`)
        }
    })
    await git(root, ["reset", "-q"])
}

/** What a replan is judged on: the graph before (nodes and views), the graph asked for, and the Kernel's per-key choices. */
export interface ReplanInput {
    readonly before: readonly NodeView[]
    readonly beforeNodes: readonly PlanNode[]
    readonly after: readonly PlanNode[]
    readonly retries: ReadonlySet<string>
    readonly keepEffect: ReadonlySet<string>
    readonly accepts: ReadonlySet<string>
    readonly results: Results
}

/** A compensating revert node a drop generated, and what it undoes. */
export interface RevertPlan {
    readonly task: PlanTask
    readonly of: RevertOf
}

/** A replan classified: one row per key and the revert nodes the drops generated (to add to the graph). */
export interface ClassifiedReplan {
    readonly rows: readonly Classified[]
    readonly reverts: readonly RevertPlan[]
}

const liveTaskId = (view: NodeView | undefined): string | null => (view?.task != null && LIVE_STATES.includes(view.state) ? view.task.id : null)

const taskOf = (results: Results, id: string | undefined): WorkflowTask | undefined => (id === undefined ? undefined : results.tasks.find((task) => task.id === id))

interface Context {
    readonly input: ReplanInput
    readonly old: ReadonlyMap<string, PlanNode>
    readonly views: ReadonlyMap<string, NodeView>
    readonly unchanged: Set<string>
}

/**
 * The commits the done tasks of a key landed, newest first: what its work stands on (a retry that landed the same result
 * lands no commit, so the earlier one still carries it) and what a drop of it reverts.
 */
const landedOf = (results: Results, key: string): string[] =>
    results.tasks
        .filter((task) => task.key === key && task.status === "done")
        .flatMap((task) => results.commits.get(task.id) ?? [])
        .reverse()

/** A node whose contract changed: rework when done, redo-live when live, redo otherwise; the prior work it starts from rides along. */
const changedRow = (node: PlanNode, previous: PlanNode, view: NodeView | undefined, results: Results): Classified => {
    const state = view?.state ?? null
    const diff = contractDiff(previous.contract, node.contract)
    const task = view?.task ?? null
    const prior: PriorWork | undefined = task === null ? undefined : { task: task.id, commit: landedOf(results, node.key)[0] ?? null, contractDiff: diff }
    const base = { key: node.key, state, hash: node.hash, ...(prior === undefined ? {} : { prior }) }
    if (state === "done") return { ...base, class: "rework", cancel: null, why: "done and its contract changed: a new attempt from its previous commit" }
    const live = liveTaskId(view)
    if (live !== null) return { ...base, class: "redo-live", cancel: live, why: "live and its contract changed: fenced, preserved, relaunched from its patch" }
    return { ...base, class: "redo", cancel: null, why: task === null ? "its contract changed (not sent yet)" : "its contract changed" }
}

/** A node whose contract is unchanged: stale when a dependency's settled result changed under it (unless accepted), else keep or continue. */
const unchangedRow = (node: PlanNode, view: NodeView | undefined, context: Context): Classified => {
    const { input, views, unchanged } = context
    const state = view?.state ?? null
    const live = liveTaskId(view)
    const carrying = taskOf(input.results, view?.task?.id)
    const current = (dep: string): string | null => {
        const depView = views.get(dep)
        return unchanged.has(dep) && depView?.state === "done" && depView.task !== null ? depView.task.id : null
    }
    const stale = carrying === undefined || input.accepts.has(node.key) ? [] : changedInputs(carrying, node.dependsOn, current, input.results)
    const base = { key: node.key, state, hash: node.hash }
    if (stale.length > 0) return { ...base, class: "stale", cancel: null, staleDeps: stale, why: `the settled result of ${stale.join(", ")} changed under it: the Kernel keeps (accept) or retries it` }
    if (input.accepts.has(node.key)) return { ...base, class: live === null ? "keep" : "continue", cancel: null, why: "accepted by the Kernel on its dependencies' current results" }
    if (live !== null) return { ...base, class: "continue", cancel: null, why: "unchanged and running" }
    return { ...base, class: "keep", cancel: null, why: state === "done" ? "done and unchanged: its result is reused" : "unchanged" }
}

/** A key the replan drops: a live task is cancelled (fenced, preserved, released); a done one that landed a commit gets a revert node. */
const dropRow = (node: PlanNode, view: NodeView | undefined, context: Context, nextKeys: ReadonlySet<string>): { readonly row: Classified; readonly revert: RevertPlan | null } => {
    const state = view?.state ?? null
    const live = liveTaskId(view)
    if (live !== null) return { row: { key: node.key, class: "drop", state, cancel: live, why: "no longer in the goal; its live task is cancelled (fenced, preserved, released)" }, revert: null }
    const base = { key: node.key, class: "drop" as const, state, cancel: null }
    if (state !== "done" || view?.task == null) return { row: { ...base, why: "no longer in the goal; its history is kept" }, revert: null }
    const commits = landedOf(context.input.results, node.key)
    const listed = commits.map((commit) => commit.slice(0, 12)).join(" ")
    if (commits.length === 0) return { row: { ...base, why: "done but landed no commit: nothing to revert" }, revert: null }
    if (isGeneratedKey(node.key)) return { row: { ...base, why: "a revert node the Kernel removed; its effect stays" }, revert: null }
    if (context.input.keepEffect.has(node.key)) return { row: { ...base, why: `done; keepEffect: its commits ${listed} stay` }, revert: null }
    const revert = revertTask(node, commits)
    if (nextKeys.has(revert.key)) return { row: { ...base, why: `done; ${revert.key} undoes it already` }, revert: null }
    return { row: { ...base, why: `done; ${revert.key} reverts ${listed}` }, revert: { task: revert, of: { key: node.key, task: view.task.id, commits } } }
}

/**
 * Classifies a replan per task key against the current graph (the reconcile of a desired graph, or of a change file applied
 * to it). Node hashes carry no dependency hashes, so an upstream change reaches a task below only when the upstream's settled
 * result differs from the one it ran on (stale), and the Kernel decides; nothing is cancelled for it. Rows come in the new
 * graph's dependency order, then the drops; `reverts` are the compensating nodes to add to the graph.
 */
export const classifyReplan = (input: ReplanInput): ClassifiedReplan => {
    const context: Context = { input, old: new Map(input.beforeNodes.map((node) => [node.key, node])), views: new Map(input.before.map((view) => [view.key, view])), unchanged: new Set<string>() }
    const rows: Classified[] = []
    for (const node of input.after) {
        const previous = context.old.get(node.key)
        const view = context.views.get(node.key)
        if (previous === undefined) {
            rows.push({ key: node.key, class: isGeneratedKey(node.key) ? "revert" : "add", state: null, cancel: null, hash: node.hash, why: "new in the goal" })
        } else if (input.retries.has(node.key)) {
            rows.push({ key: node.key, class: "redo", state: view?.state ?? null, cancel: liveTaskId(view), hash: node.hash, why: "retry asked" })
        } else if (previous.hash !== node.hash) {
            rows.push(changedRow(node, previous, view, input.results))
        } else {
            const row = unchangedRow(node, view, context)
            if (row.class === "keep" || row.class === "continue") context.unchanged.add(node.key)
            rows.push(row)
        }
    }
    const nextKeys = new Set(input.after.map((node) => node.key))
    const reverts: RevertPlan[] = []
    for (const node of input.beforeNodes) {
        if (nextKeys.has(node.key)) continue
        const dropped = dropRow(node, context.views.get(node.key), context, nextKeys)
        rows.push(dropped.row)
        if (dropped.revert !== null) reverts.push(dropped.revert)
    }
    return { rows, reverts }
}

/** The classification rows of the revert nodes, once their node hashes are known. */
export const revertRows = (nodes: readonly PlanNode[], reverts: readonly RevertPlan[]): Classified[] =>
    reverts.flatMap((plan) => {
        const node = nodes.find((candidate) => candidate.key === plan.task.key)
        if (node === undefined) return []
        const listed = plan.of.commits.map((commit) => commit.slice(0, 12)).join(" ")
        return [{ key: node.key, class: "revert" as const, state: null, cancel: null, hash: node.hash, why: `undoes ${listed} of dropped ${plan.of.key}`, revertOf: plan.of }]
    })

/**
 * Gives an unchanged node (same contract and round) the hash it was recorded under, so its ledger task keeps carrying it across
 * a hash scheme change; any other node keeps the hash buildGraph gave it.
 */
export const carryHashes = (nodes: readonly PlanNode[], beforeNodes: readonly PlanNode[]): PlanNode[] => {
    const old = new Map(beforeNodes.map((node) => [node.key, node]))
    return nodes.map((node) => {
        const previous = old.get(node.key)
        return previous?.contractHash === node.contractHash && previous.round === node.round ? { ...node, hash: previous.hash } : node
    })
}

/**
 * Moves an added node (no node of that key before) off a hash an earlier task of the same key was dispatched under, by raising
 * its round, so a re-added key is a new node and never inherits a dropped task's result.
 */
export const freshRounds = (db: DatabaseSync, workflowId: string, nodes: readonly PlanNode[], beforeNodes: readonly PlanNode[]): PlanNode[] => {
    const before = new Set(beforeNodes.map((node) => node.key))
    const taken = db.prepare("SELECT 1 FROM tasks WHERE workflow_id = ? AND plan_key = ? AND plan_hash = ?")
    return nodes.map((node) => {
        if (before.has(node.key)) return node
        let round = node.round
        let hash = node.hash
        while (taken.get(workflowId, node.key, hash) !== undefined) {
            round += 1
            hash = nodeHashOf(node.contractHash, round)
        }
        return round === node.round ? node : { ...node, round, hash }
    })
}

/** Rewrites the inputs of the tasks carrying accepted stale nodes to their dependencies' current settled tasks. */
export const acceptInputs = (db: DatabaseSync, workflowId: string, keys: ReadonlySet<string>): void => {
    if (keys.size === 0) return
    const snapshot = snapshotOf(db, workflowId)
    const views = new Map(snapshot.views.map((view) => [view.key, view]))
    for (const node of snapshot.nodes) {
        const task = views.get(node.key)?.task
        if (!keys.has(node.key) || task == null) continue
        const inputs = Object.fromEntries(node.dependsOn.map((dep) => [dep, views.get(dep)?.task?.id ?? null]))
        db.prepare("UPDATE tasks SET plan_inputs_json = ? WHERE id = ?").run(JSON.stringify(inputs), task.id)
        recordEvent(db, "workflow-accepted", workflowId, { key: node.key, task: task.id, inputs })
    }
}

/** What a step or `kernel next` does with one node of the current graph. */
export type NodeActionKind = "keep" | "continue" | "stale" | "start" | "wait" | "stuck"

/**
 * One node's action: keep (done, inputs current), continue (live, inputs current), stale (a dependency's settled result changed
 * under it: a decision for the Kernel, never an automatic cancel), start (ready; `prior` or `revertOf`, also on a continue,
 * say what the attempt starts from), wait (a dependency is not done), stuck (failed, returned, lost or cancelled: the Kernel amends).
 */
export interface NodeAction {
    readonly key: string
    readonly action: NodeActionKind
    readonly state: NodeState
    readonly task: string | null
    readonly why: string
    readonly prior?: PriorWork
    readonly revertOf?: Classified["revertOf"]
    readonly staleDeps?: readonly string[]
}

/** The newest classification row of a node (same key and hash) that says what it starts from. */
const startOf = (db: DatabaseSync, workflowId: string, node: PlanNode): Pick<NodeAction, "prior" | "revertOf"> => {
    for (const version of graphVersions(db, workflowId).reverse()) {
        const row = version.classification.find((entry) => entry.key === node.key && entry.hash === node.hash && (entry.prior !== undefined || entry.revertOf !== undefined))
        if (row !== undefined) return { ...(row.prior === undefined ? {} : { prior: row.prior }), ...(row.revertOf === undefined ? {} : { revertOf: row.revertOf }) }
    }
    return {}
}

const STUCK: readonly NodeState[] = ["failed", "returned", "lost", "cancelled"]

/** The action of one node of a snapshot, given the settled facts. */
const actionOf = (db: DatabaseSync, snapshot: Snapshot, node: PlanNode, results: Results, views: ReadonlyMap<string, NodeView>): NodeAction => {
    const view = views.get(node.key)
    const state: NodeState = view?.state ?? "waiting"
    const task = view?.task ?? null
    const base = { key: node.key, state, task: task?.id ?? null }
    if (state === "ready") return { ...base, action: "start", why: view?.why ?? "ready", ...startOf(db, snapshot.workflow.id, node) }
    if (state === "waiting" || state === "blocked") return { ...base, action: "wait", why: view?.why ?? state }
    if (STUCK.includes(state)) return { ...base, action: "stuck", why: view?.why ?? state }
    const carrying = taskOf(results, task?.id)
    const current = (dep: string): string | null => {
        const depView = views.get(dep)
        return depView?.state === "done" && depView.task !== null ? depView.task.id : null
    }
    const stale = carrying === undefined ? [] : changedInputs(carrying, node.dependsOn, current, results)
    if (stale.length > 0) return { ...base, action: "stale", staleDeps: stale, why: `the settled result of ${stale.join(", ")} changed under it: accept or retry it (workflow amend)` }
    if (state === "done") return { ...base, action: "keep", why: view?.why ?? state }
    return { ...base, action: "continue", why: view?.why ?? state, ...startOf(db, snapshot.workflow.id, node) }
}

/**
 * The per-key actions of a workflow's current graph, for the engine's step and `kernel next`: hashes the settled results first
 * (git is the authority), then classifies each node. A stale node is surfaced for the Kernel's decision and never cancelled.
 */
export const workflowActions = async (root: string, db: DatabaseSync, workflowId: string): Promise<NodeAction[]> => {
    await ensureResultHashes(root, db, workflowId)
    const snapshot = snapshotOf(db, workflowId)
    const results = readResults(db, workflowId, snapshot.tasks)
    const views = new Map(snapshot.views.map((view) => [view.key, view]))
    return snapshot.nodes.map((node) => actionOf(db, snapshot, node, results, views))
}

/** The prior work (and revert target) a node of the current graph starts from, for its brief; empty when it starts fresh. */
export const priorWorkOf = (db: DatabaseSync, workflowId: string, node: PlanNode): Pick<NodeAction, "prior" | "revertOf"> => startOf(db, workflowId, node)
