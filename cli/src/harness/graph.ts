import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, posix, resolve } from "node:path"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"
import { repositoryRoot } from "../shared/git.js"
import { CONTRACT_SCHEMA, DEFAULT_BUDGET, byCodeUnit, contractHash, contractProblems, contractSchema, parseContract, readContract } from "./contract.js"
import type { Contract } from "./contract.js"
import { pathsOverlap } from "./leases.js"
import { checkEntrySchema, keyNameSchema, outputSpecSchema } from "./ops.js"
import type { Ops } from "./ops.js"
import type { ResultStatus, TaskStatus } from "./tasks.js"
import { locateWorkRoot, readUatRecord, samePath, uatBinding, uatContract, uatPlace } from "./work.js"
import type { UatBinding, WorkRoot } from "./work.js"

/** The schema tag of a workflow file: the Kernel's goal and its graph of contracts. */
export const WORKFLOW_SCHEMA = "starci/workflow@1"

/** The schema tag of a change file: add, edit, remove or retry tasks of a running workflow. */
export const CHANGE_SCHEMA = "starci/workflow-change@1"

/** How the harness runs the tasks of a workflow: Orca worker seats, or the chat agent itself one task at a time. */
export type Runner = "orca" | "inline"

const KEY = /^[a-z0-9][a-z0-9._-]{0,62}$/

const DEFAULT_PARALLEL = 2

const MAX_PARALLEL = 16

const keySchema = z.string().regex(KEY, "a key is lower-case letters, digits, '.', '_' or '-', at most 63, starting with a letter or digit")

const difficultySchema = z.enum(["easy", "medium", "hard", "insane"])

/** How hard a task is, as the router reads it. */
export type Difficulty = z.infer<typeof difficultySchema>

/**
 * The fields of one task as a file writes it: a contract file, or the contract written inline, plus its edges and routing pins.
 * Inline, `context`, `inputs`, `output` and `checks` are the Kernel's extend; the label's op file adds its base. `readPaths`
 * is the earlier spelling of `context`. `uat: <flow id>` is a third form: the contract built from that Work record (uatContract).
 */
const taskFieldsShape = {
    contract: z.string().min(1).optional(),
    uat: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    summary: z.string().min(1).optional(),
    details: z.string().optional(),
    allowPaths: z.array(z.string().min(1)).min(1).optional(),
    context: z.array(z.string().min(1)).optional(),
    readPaths: z.array(z.string().min(1)).optional(),
    inputs: z.record(keyNameSchema, z.string().min(1)).optional(),
    output: z.record(keyNameSchema, outputSpecSchema).optional(),
    cwd: z.string().min(1).optional(),
    setup: contractSchema.shape.context.shape.setup,
    checks: z.array(checkEntrySchema).min(1).optional(),
    budget: contractSchema.shape.budget.optional(),
    dependsOn: z.array(keySchema).optional(),
    difficulty: difficultySchema.optional(),
    agent: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    effort: z.string().min(1).optional(),
}

const taskFieldsSchema = z.strictObject(taskFieldsShape)

type TaskFields = z.infer<typeof taskFieldsSchema>

const fileTaskSchema = z.strictObject({ id: keySchema, ...taskFieldsShape })

const biasSchema = z.strictObject({ only: z.array(z.string().min(1)).optional(), avoid: z.array(z.string().min(1)).optional(), prefer: z.array(z.string().min(1)).optional() })

/**
 * The workflow-wide fields of a workflow file, kept in the ledger as the workflow's goal. `agent` with `model` pins every
 * task of an orca run (a task's own pair wins); without a pin the router picks, steered by `bias` (only, avoid, prefer).
 */
export const headerSchema = z.strictObject({
    schema: z.literal(WORKFLOW_SCHEMA),
    id: keySchema,
    goal: z.string().min(1),
    runner: z.enum(["orca", "inline"]),
    agent: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    effort: z.string().min(1).optional(),
    bias: biasSchema.optional(),
    worktree: z.string().min(1).optional(),
    maxParallel: z.number().int().min(1).max(MAX_PARALLEL).default(DEFAULT_PARALLEL),
    base: z.string().min(1).default("HEAD"),
})

/** A workflow's goal and defaults: everything of its file but the tasks. */
export type WorkflowHeader = z.infer<typeof headerSchema>

const workflowFileSchema = z.strictObject({ ...headerSchema.shape, tasks: z.array(fileTaskSchema).min(1) })

const changeEntrySchema = z.discriminatedUnion("op", [
    z.strictObject({ op: z.literal("add"), task: fileTaskSchema }),
    z.strictObject({ op: z.literal("edit"), id: keySchema, set: taskFieldsSchema }),
    z.strictObject({ op: z.literal("remove"), id: keySchema }),
    z.strictObject({ op: z.literal("retry"), id: keySchema }),
])

const changeFileSchema = z.strictObject({ schema: z.literal(CHANGE_SCHEMA), workflow: keySchema, reason: z.string().min(1).optional(), changes: z.array(changeEntrySchema).min(1) })

/** One entry of a change file. */
export type ChangeEntry = z.infer<typeof changeEntrySchema>

/** The routing hints of a task: what the router reads (difficulty) and the pins that bypass it (agent, model, effort). */
export interface TaskRoute {
    readonly difficulty?: Difficulty
    readonly agent?: string
    readonly model?: string
    readonly effort?: string
}

/**
 * One task of a graph with its contract resolved; its key is its id in the workflow file, the plan key of its ledger tasks.
 * `round` counts the retries the Kernel asked for: it enters the node hash, so a retried node is a new node to dispatch.
 */
export interface PlanTask {
    readonly key: string
    readonly contract: Contract
    readonly dependsOn: readonly string[]
    readonly route: TaskRoute
    readonly round: number
}

/** A task of a recorded graph: its contract hash, and its node hash, which also covers the node hashes of its dependencies. */
export interface PlanNode extends PlanTask {
    readonly contractHash: string
    readonly hash: string
}

/** A graph built from tasks: the nodes in dependency order when it is fit, the problems that make it unfit, and notes. */
export interface BuiltGraph {
    readonly nodes: readonly PlanNode[]
    readonly problems: readonly string[]
    readonly notes: readonly string[]
}

/** What a workflow file or a change file asks for. */
export type PlanSource =
    | { readonly kind: "workflow"; readonly header: WorkflowHeader; readonly tasks: readonly PlanTask[]; readonly problems: readonly string[] }
    | { readonly kind: "change"; readonly workflow: string; readonly reason: string | null; readonly changes: readonly ChangeEntry[]; readonly dir: string }

const readDocument = (file: string): unknown => {
    let text: string
    try {
        text = readFileSync(file, "utf8")
    } catch (error: unknown) {
        throw new Refusal("WORKFLOW_UNREADABLE", `${file} is not readable: ${error instanceof Error ? error.message : String(error)}`)
    }
    try {
        // YAML is a superset of json, so one parser reads both forms.
        return parse(text)
    } catch (error: unknown) {
        throw new Refusal("WORKFLOW_UNREADABLE", `${file} is neither yaml nor json: ${error instanceof Error ? error.message : String(error)}`)
    }
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const INLINE_FIELDS = ["label", "summary", "details", "allowPaths", "context", "readPaths", "inputs", "output", "cwd", "setup", "checks", "budget"] as const

const routeOf = (fields: TaskFields, previous: TaskRoute = {}): TaskRoute => ({
    ...previous,
    ...(fields.difficulty === undefined ? {} : { difficulty: fields.difficulty }),
    ...(fields.agent === undefined ? {} : { agent: fields.agent }),
    ...(fields.model === undefined ? {} : { model: fields.model }),
    ...(fields.effort === undefined ? {} : { effort: fields.effort }),
})

/** Where the tasks of a workflow resolve: its repository, and the project's Work root or the refusal that says why it has none. */
export interface PlanPlace {
    readonly repo: string
    readonly work: WorkRoot | Refusal
}

/** The place of a workflow file used from `cwd`; a missing Work root refuses only a task that walks a Work flow. */
export const planPlace = async (cwd: string): Promise<PlanPlace> => {
    const repo = await repositoryRoot(cwd)
    try {
        return { repo, work: await locateWorkRoot(cwd) }
    } catch (error: unknown) {
        if (error instanceof Refusal) return { repo, work: error }
        throw error
    }
}

/**
 * The Work root a workflow's uat task reads its record from: the workflow's own repository. A walk is settled where its Work
 * is, so a workflow defined in another repository than the project's Work root is refused, never split across two ledgers.
 */
const workRootOf = (place: PlanPlace): string => {
    if (place.work instanceof Refusal) throw place.work
    if (!samePath(place.work.root, place.repo)) {
        throw new Refusal("WORK_ROOT_ELSEWHERE", `a uat task walks a Work flow of ${place.work.root} (from ${place.work.from}), but this workflow is defined in ${place.repo}; define it in the Work root`)
    }
    return place.work.root
}

/** The run id of a workflow's uat task: stable per workflow and task key, so a replan builds the same contract. */
const uatRunId = (workflow: string, key: string): string => `${workflow}-${key}`

/** Who a task is, for the contract of a uat task: its workflow and key, and where the workflow resolves. */
interface TaskAt {
    readonly workflow: string
    readonly key: string
    readonly place: PlanPlace
}

/** A one-key object holding `value`, or nothing when it is undefined, for spreading an optional field. */
const optional = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> => (value === undefined ? {} : ({ [key]: value } as Partial<Record<K, V>>))

/** The value when it holds something (a non-empty object or list), else undefined. */
const filled = <T extends object>(value: T | undefined): T | undefined => (value !== undefined && Object.keys(value).length > 0 ? value : undefined)

/** A contract section of a pinned base and an extend, or nothing when it has neither. */
const part = <B, E>(base: B | undefined, extend: E | undefined): { base?: B; extend?: E } | undefined =>
    base === undefined && extend === undefined ? undefined : { ...optional("base", base), ...optional("extend", extend) }

/** Builds the contract of a task written inline, or merges inline fields onto a contract it already has. */
const inlineContract = (fields: TaskFields, base: string, ops: Ops, previous?: Contract): Contract => {
    const label = fields.label ?? previous?.label
    const summary = fields.summary ?? previous?.input.summary
    const allowPaths = fields.allowPaths ?? previous?.context.allowPaths
    if (label === undefined || summary === undefined || allowPaths === undefined) {
        throw new Refusal("WORKFLOW_INVALID", "a task needs a contract file, or label, summary and allowPaths written inline")
    }
    if (fields.context !== undefined && fields.readPaths !== undefined) throw new Refusal("WORKFLOW_INVALID", "a task names context or readPaths (its earlier spelling), not both")
    const read = fields.context ?? fields.readPaths ?? previous?.context.extend
    // A named input the op declares is a base input; the rest extend.
    const declared = ops.labels[label]?.input.base ?? {}
    const named = fields.inputs === undefined ? undefined : Object.entries(fields.inputs)
    const inputBase = named === undefined ? previous?.input.base : Object.fromEntries(named.filter(([name]) => name in declared))
    const inputExtend = named === undefined ? previous?.input.extend : Object.fromEntries(named.filter(([name]) => !(name in declared)))
    return parseContract({
        schema: CONTRACT_SCHEMA,
        label,
        context: {
            revision: previous?.context.revision ?? base,
            allowPaths,
            ...optional("cwd", fields.cwd ?? previous?.context.cwd),
            ...optional("setup", fields.setup ?? previous?.context.setup),
            ...optional("base", previous?.context.base),
            ...optional("extend", filled(read)),
        },
        input: { summary, ...optional("details", fields.details ?? previous?.input.details), ...optional("base", filled(inputBase)), ...optional("extend", filled(inputExtend)) },
        ...optional("output", part(previous?.output?.base, filled(fields.output ?? previous?.output?.extend))),
        ...optional("checks", part(previous?.checks?.base, filled(fields.checks ?? previous?.checks?.extend))),
        budget: fields.budget ?? previous?.budget ?? { ...DEFAULT_BUDGET },
    })
}

/**
 * Resolves one task's fields to its contract: a contract file (relative to `dir`, the folder of the file naming it), a Work
 * flow (`uat`, built from its record in the Work root), or the fields written inline (on top of `previous` when an edit
 * changes a task that has one). The forms never mix.
 */
const resolveContract = (fields: TaskFields, dir: string, base: string, ops: Ops, at: TaskAt, previous?: Contract): Contract => {
    const inline = INLINE_FIELDS.filter((name) => fields[name] !== undefined)
    if (fields.uat !== undefined) {
        const others = [...(fields.contract === undefined ? [] : ["contract"]), ...inline]
        if (others.length > 0) throw new Refusal("WORKFLOW_INVALID", `a uat task names its Work flow only; its contract is built from the record (drop: ${others.join(", ")})`)
        return parseContract(uatContract(readUatRecord(workRootOf(at.place), fields.uat), { revision: base, runId: uatRunId(at.workflow, at.key) }))
    }
    if (fields.contract !== undefined) {
        if (inline.length > 0) throw new Refusal("WORKFLOW_INVALID", `a task names a contract file or writes its contract inline, not both (inline: ${inline.join(", ")})`)
        return readContract(resolve(dir, fields.contract))
    }
    return inlineContract(fields, base, ops, previous)
}

const prettify = (error: z.ZodError): string => z.prettifyError(error)

/** Reads a workflow file or a change file (yaml or json), validating its schema; the contracts of a workflow file are resolved too. */
export const readPlanSource = (file: string, ops: Ops, place: PlanPlace): PlanSource => {
    const raw = readDocument(file)
    const dir = dirname(file)
    const tag = typeof raw === "object" && raw !== null && "schema" in raw ? raw.schema : undefined
    if (tag === CHANGE_SCHEMA) {
        const parsed = changeFileSchema.safeParse(raw)
        if (!parsed.success) throw new Refusal("WORKFLOW_INVALID", `${file} is not a valid change file:\n${prettify(parsed.error)}`)
        return { kind: "change", workflow: parsed.data.workflow, reason: parsed.data.reason ?? null, changes: parsed.data.changes, dir }
    }
    const parsed = workflowFileSchema.safeParse(raw)
    if (!parsed.success) throw new Refusal("WORKFLOW_INVALID", `${file} is not a valid ${WORKFLOW_SCHEMA} file (or ${CHANGE_SCHEMA}):\n${prettify(parsed.error)}`)
    const { tasks: written, ...header } = parsed.data
    if (written.some((task) => task.uat !== undefined)) workRootOf(place)
    const problems: string[] = []
    const tasks: PlanTask[] = []
    for (const { id, ...fields } of written) {
        try {
            const at = { workflow: header.id, key: id, place }
            tasks.push({ key: id, contract: resolveContract(fields, dir, header.base, ops, at), dependsOn: fields.dependsOn ?? [], route: routeOf(fields), round: 0 })
        } catch (error: unknown) {
            problems.push(`task ${id}: ${messageOf(error)}`)
        }
    }
    return { kind: "workflow", header, tasks, problems }
}

/** The Work flow a change adds or sets on a task, if any. */
const uatOfChange = (change: ChangeEntry): string | undefined => {
    if (change.op === "add") return change.task.uat
    return change.op === "edit" ? change.set.uat : undefined
}

/**
 * The uat walks a plan source asks for (its uat-flow bindings), so a caller can check their run places (assertRunPlace) before
 * it records the graph: every uat task of a workflow file, and the tasks a change file adds or edits to walk a Work flow.
 */
export const uatWalksOf = (source: PlanSource, ops: Ops): UatBinding[] => {
    if (source.kind === "workflow") return source.tasks.flatMap((task) => uatBinding(task.contract, ops) ?? [])
    return source.changes.flatMap((change) => {
        const flow = uatOfChange(change)
        if (flow === undefined) return []
        const place = uatPlace(flow)
        const key = change.op === "add" ? change.task.id : change.id
        return [{ record: place.record, run: posix.join(place.runs, uatRunId(source.workflow, key)) }]
    })
}

/** Applies one change to the working task map (and the retry set); a change that cannot apply throws a Refusal. */
const applyChange = (
    change: ChangeEntry,
    key: string,
    state: { readonly tasks: Map<string, PlanTask>; readonly retries: Set<string> },
    where: { readonly dir: string; readonly base: string; readonly ops: Ops; readonly at: TaskAt },
): void => {
    const { tasks, retries } = state
    const { dir, base, ops, at } = where
    const existing = tasks.get(key)
    if (change.op === "add") {
        if (existing !== undefined) throw new Refusal("WORKFLOW_INVALID", "the graph has this task already; edit it instead")
        const { id, ...fields } = change.task
        tasks.set(id, { key: id, contract: resolveContract(fields, dir, base, ops, at), dependsOn: fields.dependsOn ?? [], route: routeOf(fields), round: 0 })
        return
    }
    if (existing === undefined) throw new Refusal("WORKFLOW_INVALID", "no such task in the graph")
    switch (change.op) {
        case "edit": {
            const touchesContract = change.set.contract !== undefined || change.set.uat !== undefined || INLINE_FIELDS.some((name) => change.set[name] !== undefined)
            tasks.set(key, {
                key,
                contract: touchesContract ? resolveContract(change.set, dir, base, ops, at, existing.contract) : existing.contract,
                dependsOn: change.set.dependsOn ?? existing.dependsOn,
                route: routeOf(change.set, existing.route),
                round: existing.round,
            })
            break
        }
        case "remove":
            tasks.delete(key)
            break
        case "retry":
            retries.add(key)
            tasks.set(key, { ...existing, round: existing.round + 1 })
            break
    }
}

/** Applies a change file to the tasks of the current graph; returns the new task list, the keys to retry, and the problems. */
export const applyChanges = (
    current: readonly PlanTask[],
    changes: readonly ChangeEntry[],
    dir: string,
    base: string,
    ops: Ops,
    plan: { readonly workflow: string; readonly place: PlanPlace },
): { readonly tasks: readonly PlanTask[]; readonly retries: ReadonlySet<string>; readonly problems: readonly string[] } => {
    if (changes.some((change) => uatOfChange(change) !== undefined)) workRootOf(plan.place)
    const tasks = new Map(current.map((task) => [task.key, task]))
    const retries = new Set<string>()
    const problems: string[] = []
    for (const change of changes) {
        const key = change.op === "add" ? change.task.id : change.id
        try {
            applyChange(change, key, { tasks, retries }, { dir, base, ops, at: { workflow: plan.workflow, key, place: plan.place } })
        } catch (error: unknown) {
            problems.push(`${change.op} ${key}: ${messageOf(error)}`)
        }
    }
    return { tasks: [...tasks.values()], retries, problems }
}

const sha = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex")

// Depth-first order with the path kept, so a cycle is reported as the loop it is (a -> b -> a).
const orderOf = (tasks: ReadonlyMap<string, PlanTask>): { readonly order: string[]; readonly cycles: string[] } => {
    const state = new Map<string, "open" | "closed">()
    const order: string[] = []
    const cycles: string[] = []
    const visit = (key: string, path: readonly string[]): void => {
        const seen = state.get(key)
        if (seen === "closed") return
        if (seen === "open") {
            cycles.push([...path.slice(path.indexOf(key)), key].join(" -> "))
            return
        }
        state.set(key, "open")
        for (const dep of tasks.get(key)?.dependsOn ?? []) if (tasks.has(dep)) visit(dep, [...path, key])
        state.set(key, "closed")
        order.push(key)
    }
    for (const key of [...tasks.keys()].sort(byCodeUnit)) visit(key, [])
    return { order, cycles }
}

const ancestorsOf = (key: string, tasks: ReadonlyMap<string, PlanTask>, into: Set<string> = new Set<string>()): Set<string> => {
    for (const dep of tasks.get(key)?.dependsOn ?? []) {
        if (into.has(dep)) continue
        into.add(dep)
        ancestorsOf(dep, tasks, into)
    }
    return into
}

/**
 * Builds the graph of a task list: every contract must be fit (contractProblems), keys unique, dependencies known and the
 * edges acyclic. Node hashes are computed in dependency order, so a changed contract changes the hash of every task below it.
 * Two tasks with no order between them whose allowPaths overlap are a note: the path lease serializes them at dispatch.
 */
export const buildGraph = (tasks: readonly PlanTask[], ops: Ops): BuiltGraph => {
    const problems: string[] = []
    const byKey = new Map<string, PlanTask>()
    for (const task of tasks) {
        if (byKey.has(task.key)) problems.push(`task ${task.key} is defined twice`)
        byKey.set(task.key, task)
        for (const problem of contractProblems(task.contract, ops)) problems.push(`task ${task.key}: ${problem}`)
        problems.push(...dependencyProblems(task, tasks))
    }
    const { order, cycles } = orderOf(byKey)
    for (const cycle of cycles) problems.push(`dependency cycle: ${cycle}`)
    if (problems.length > 0) return { nodes: [], problems, notes: [] }
    const nodes = hashNodes(order, byKey)
    return { nodes, problems: [], notes: overlapNotes(nodes, byKey) }
}

/** The problems of one task's dependencies: itself, a task not in the graph, a name given twice. */
const dependencyProblems = (task: PlanTask, tasks: readonly PlanTask[]): string[] => {
    const problems: string[] = []
    const deps = new Set<string>()
    for (const dep of task.dependsOn) {
        if (dep === task.key) problems.push(`task ${task.key} depends on itself`)
        else if (!tasks.some((other) => other.key === dep)) problems.push(`task ${task.key} depends on ${dep}, which is not in the graph`)
        if (deps.has(dep)) problems.push(`task ${task.key} names dependency ${dep} twice`)
        deps.add(dep)
    }
    return problems
}

/** The nodes in dependency order, each hashed from its contract, its round and the hashes of what it depends on. */
const hashNodes = (order: readonly string[], byKey: ReadonlyMap<string, PlanTask>): PlanNode[] => {
    const hashes = new Map<string, string>()
    const nodes: PlanNode[] = []
    for (const key of order) {
        const task = byKey.get(key)
        if (task === undefined) continue
        const own = contractHash(task.contract)
        const dependsOn = [...task.dependsOn].sort(byCodeUnit)
        const hash = sha({ contract: own, round: task.round, dependsOn: dependsOn.map((dep) => [dep, hashes.get(dep) ?? ""]) })
        hashes.set(key, hash)
        nodes.push({ ...task, dependsOn, contractHash: own, hash })
    }
    return nodes
}

/** A note for each pair of unordered nodes whose allowPaths overlap. */
const overlapNotes = (nodes: readonly PlanNode[], byKey: ReadonlyMap<string, PlanTask>): string[] => {
    const notes: string[] = []
    for (const [index, left] of nodes.entries()) {
        for (const right of nodes.slice(index + 1)) {
            if (ancestorsOf(left.key, byKey).has(right.key) || ancestorsOf(right.key, byKey).has(left.key)) continue
            const shared = left.contract.context.allowPaths.filter((path) => right.contract.context.allowPaths.some((other) => pathsOverlap(path, other)))
            if (shared.length > 0) notes.push(`tasks ${left.key} and ${right.key} have no order between them but share ${shared.join(", ")}: the path lease runs them one after the other`)
        }
    }
    return notes
}

/** The ledger task that currently carries a node: the newest task of its plan key whose plan hash is the node's hash. */
export interface NodeTask {
    readonly id: string
    readonly status: TaskStatus
    readonly result: ResultStatus | null
    readonly tryNo: number
    readonly redChecks: string | null
    /** True when a seat of the task is worker-lost: Orca said its worker is gone. */
    readonly lost: boolean
}

/**
 * Where a node stands. Without a task: waiting (a dependency is not done), ready, or blocked (a dependency failed or came
 * back unfinished). With one: its task's status, where a reported task whose result is not done is `returned` to the Kernel.
 */
export type NodeState = "waiting" | "ready" | "blocked" | "queued" | "running" | "launch-unknown" | "lost" | "reported" | "returned" | "verifying" | "done" | "failed" | "cancelled"

/** A node's state, its task and why it stands there. */
export interface NodeView {
    readonly key: string
    readonly state: NodeState
    readonly task: NodeTask | null
    readonly why: string
}

/** The node states that stop the work below them until the Kernel amends the graph. */
export const STUCK_STATES: readonly NodeState[] = ["failed", "returned", "lost", "cancelled", "blocked"]

/** The node states whose task is live: dispatched and not ended. */
export const LIVE_STATES: readonly NodeState[] = ["queued", "running", "launch-unknown", "lost", "reported", "returned", "verifying"]

const taskState = (task: NodeTask): NodeState => {
    switch (task.status) {
        case "queued":
            return "queued"
        case "running":
            return "running"
        case "effect_unknown":
            return task.lost ? "lost" : "launch-unknown"
        case "reported":
            return task.result === "done" ? "reported" : "returned"
        case "verifying":
            return "verifying"
        case "done":
            return "done"
        case "failed":
            return "failed"
        case "awaiting_owner":
            return "returned"
        case "cancelled":
            return "cancelled"
    }
}

const failure = (task: NodeTask): string => {
    if (task.redChecks !== null) return `its verify was red on ${task.redChecks}`
    return task.result === "failed" ? "the worker filed failed" : "it failed"
}

const taskWhy = (task: NodeTask, state: NodeState): string => {
    if (state === "returned") return `task ${task.id} came back ${task.result ?? task.status}; the Kernel amends (edit, retry or remove)`
    if (state === "failed") {
        return `task ${task.id} try ${String(task.tryNo)}: ${failure(task)}; its dependents are blocked until the Kernel amends`
    }
    if (state === "cancelled") return `task ${task.id} was cancelled; amend with retry or remove`
    if (state === "lost") return `task ${task.id}: Orca says its worker is gone and what it wrote is unknown; cancel it (starci task cancel ${task.id}), then amend with retry or remove`
    return `task ${task.id} is ${task.status}`
}

/** The view of a node with no task: blocked by a stuck dependency, waiting for open ones, or ready. */
const waitingView = (key: string, stuck: NodeView | undefined, open: readonly string[]): NodeView => {
    if (stuck !== undefined) return { key, state: "blocked", task: null, why: `${stuck.key} is ${stuck.state}` }
    if (open.length > 0) return { key, state: "waiting", task: null, why: `waits for ${open.join(", ")}` }
    return { key, state: "ready", task: null, why: "every dependency is done" }
}

/** The state of every node, in the graph's dependency order, from the node tasks the ledger holds. */
export const viewNodes = (nodes: readonly PlanNode[], tasks: ReadonlyMap<string, NodeTask>): NodeView[] => {
    const views = new Map<string, NodeView>()
    for (const node of nodes) {
        const task = tasks.get(node.key) ?? null
        if (task !== null) {
            const state = taskState(task)
            views.set(node.key, { key: node.key, state, task, why: taskWhy(task, state) })
            continue
        }
        const deps = node.dependsOn.map((dep) => views.get(dep)).filter((view): view is NodeView => view !== undefined)
        const stuck = deps.find((view) => STUCK_STATES.includes(view.state))
        const open = deps.filter((view) => view.state !== "done").map((view) => view.key)
        views.set(node.key, waitingView(node.key, stuck, open))
    }
    return nodes.map((node) => views.get(node.key)).filter((view): view is NodeView => view !== undefined)
}

/** How a replan treats one task: kept, continued, redone, added or dropped (cli/README.md "Workflow graph"). */
export type ReplanClass = "keep" | "continue" | "redo" | "add" | "drop"

/** One task of a replan: its class, its state before, the live task the replan cancels (if any), and why. */
export interface Classified {
    readonly key: string
    readonly class: ReplanClass
    readonly state: NodeState | null
    readonly cancel: string | null
    readonly why: string
}

/** The id of the live task a node view carries, if any. */
const liveTaskId = (view: NodeView | undefined): string | null => (view?.task != null && LIVE_STATES.includes(view.state) ? view.task.id : null)

/** How a replan treats one node of the new graph, given the node it replaces, its view before and whether a retry was asked. */
const classifyNode = (node: PlanNode, previous: PlanNode | undefined, view: NodeView | undefined, retry: boolean): Classified => {
    const state = view?.state ?? null
    if (previous === undefined) return { key: node.key, class: "add", state: null, cancel: null, why: "new in the goal" }
    if (retry) return { key: node.key, class: "redo", state, cancel: liveTaskId(view), why: "retry asked" }
    if (previous.hash !== node.hash) {
        const why = previous.contractHash === node.contractHash ? "a dependency changed" : "its contract changed"
        return { key: node.key, class: "redo", state, cancel: liveTaskId(view), why: view?.task == null ? `${why} (not sent yet)` : why }
    }
    if (liveTaskId(view) !== null) return { key: node.key, class: "continue", state, cancel: null, why: "unchanged and running" }
    return { key: node.key, class: "keep", state, cancel: null, why: state === "done" ? "done and unchanged: its result is reused" : "unchanged" }
}

/**
 * Classifies a replan by node hash (contract plus the hashes of its dependencies): keep (unchanged and not running: a done
 * result is reused, a task not yet sent stays as it is, a failed one stays failed), continue (unchanged and live), redo (its
 * contract or a dependency changed, or a retry was asked: a live task is cancelled and the node is sent again), add and drop
 * (a live task is cancelled, the history stays).
 */
export const classify = (before: readonly NodeView[], beforeNodes: readonly PlanNode[], after: readonly PlanNode[], retries: ReadonlySet<string>): Classified[] => {
    const old = new Map(beforeNodes.map((node) => [node.key, node]))
    const views = new Map(before.map((view) => [view.key, view]))
    const next = new Set(after.map((node) => node.key))
    const rows: Classified[] = []
    for (const node of after) {
        const previous = old.get(node.key)
        rows.push(classifyNode(node, previous, views.get(node.key), retries.has(node.key)))
    }
    for (const node of beforeNodes) {
        if (next.has(node.key)) continue
        const view = views.get(node.key)
        rows.push({ key: node.key, class: "drop", state: view?.state ?? null, cancel: liveTaskId(view), why: "no longer in the goal; its history is kept" })
    }
    return rows
}
