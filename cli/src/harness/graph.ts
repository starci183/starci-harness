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
import { loadRouting } from "./routing.js"
import type { ResultStatus, TaskStatus } from "./tasks.js"
import { locateWorkRoot, readUatRecord, samePath, uatBinding, uatContract, uatPlace } from "./work.js"
import type { UatBinding, WorkRoot } from "./work.js"

/** The schema tag of a workflow file: the Kernel's goal and its graph of contracts. */
export const WORKFLOW_SCHEMA = "starci/workflow@1"

/** The schema tag of a change file: add, edit, remove (keepEffect: no revert), retry or accept (a stale task) tasks of a running workflow. */
export const CHANGE_SCHEMA = "starci/workflow-change@1"

/** How the harness runs the tasks of a workflow: Orca worker seats, or the chat agent itself one task at a time. */
export type Runner = "orca" | "inline"

const KEY = /^[a-z0-9][a-z0-9._-]{0,62}$/

const DEFAULT_PARALLEL = 2

const keySchema = z.string().regex(KEY, "a key is lower-case letters, digits, '.', '_' or '-', at most 63, starting with a letter or digit")

const difficultySchema = z.enum(["easy", "medium", "hard", "insane"])

/** How hard a task is, as the router reads it. */
export type Difficulty = z.infer<typeof difficultySchema>

/** A risk tag of a task, one of ops/routing.yaml qualification.riskTags: a tagged task is high-risk and refuses a probation member. */
const riskTagSchema = z.string().refine((tag) => loadRouting().qualification.riskTags.includes(tag), { message: "a risk tag is one of ops/routing.yaml qualification.riskTags" })

/**
 * The fields of one task as a file writes it: a contract file, or the contract written inline, plus its edges and what the
 * router reads of it (difficulty, risk); the router alone picks the agent and model.
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
    risk: z.array(riskTagSchema).min(1).optional(),
}

const taskFieldsSchema = z.strictObject(taskFieldsShape)

type TaskFields = z.infer<typeof taskFieldsSchema>

const fileTaskSchema = z.strictObject({ id: keySchema, ...taskFieldsShape })

/**
 * The scope ceiling of a goal: the path prefixes every task's allowPaths must lie under and the most tasks the graph may hold
 * (the harness's generated revert nodes not counted). A desired graph or an amend past it is refused SCOPE_EXCEEDED.
 */
export const scopeSchema = z.strictObject({ paths: z.array(z.string().min(1)).min(1).optional(), maxTasks: z.number().int().min(1).optional() })

/** A goal's scope ceiling. */
export type Scope = z.infer<typeof scopeSchema>

/**
 * The workflow-wide fields of a workflow file, kept in the ledger as the workflow's goal. No field names an agent, a model or a
 * preference among them: the router of ops/routing.yaml alone picks every Op and Kernel.
 */
export const headerSchema = z.strictObject({
    schema: z.literal(WORKFLOW_SCHEMA),
    id: keySchema,
    goal: z.string().min(1),
    acceptance: z.array(z.string().min(1)).optional(),
    scope: scopeSchema.optional(),
    // The goal's requirements that make optional lane steps mandatory (ops/lanes.yaml optionalUnless); a replan keeps them.
    requires: z.array(z.enum(["security", "perf"])).optional(),
    runner: z.enum(["orca", "inline"]),
    worktree: z.string().min(1).optional(),
    // Capped by workflowParallel of ops/routing.yaml where tasks are queued (engine.ts queueReady), never refused.
    maxParallel: z.number().int().min(1).default(DEFAULT_PARALLEL),
    base: z.string().min(1).default("HEAD"),
})

/** A workflow's goal and defaults: everything of its file but the tasks. */
export type WorkflowHeader = z.infer<typeof headerSchema>

/** The routing overrides a ledger may still hold in a workflow's stored goal from before the router picked alone; reading drops them. */
const DROPPED_HEADER_FIELDS: readonly string[] = ["agent", "model", "effort", "bias"]

/** Reads a workflow header as the ledger stored it, without the routing overrides headerSchema no longer takes. */
export const storedHeader = (value: unknown): WorkflowHeader =>
    headerSchema.parse(typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value).filter(([key]) => !DROPPED_HEADER_FIELDS.includes(key))) : value)

const workflowFileSchema = z.strictObject({ ...headerSchema.shape, tasks: z.array(fileTaskSchema).min(1) })

const changeEntrySchema = z.discriminatedUnion("op", [
    z.strictObject({ op: z.literal("add"), task: fileTaskSchema }),
    z.strictObject({ op: z.literal("edit"), id: keySchema, set: taskFieldsSchema }),
    z.strictObject({ op: z.literal("remove"), id: keySchema, keepEffect: z.boolean().optional() }),
    z.strictObject({ op: z.literal("retry"), id: keySchema }),
    z.strictObject({ op: z.literal("accept"), id: keySchema }),
])

const changeFileSchema = z.strictObject({ schema: z.literal(CHANGE_SCHEMA), workflow: keySchema, reason: z.string().min(1).optional(), changes: z.array(changeEntrySchema).min(1) })

/**
 * The key prefix of the compensating nodes the harness generates when a replan drops a done task: `revert.<key>`. A workflow
 * or change file never adds such a key; a desired graph that leaves one out keeps it, since the harness owns it.
 */
export const REVERT_PREFIX = "revert."

/** True for a key the harness generated (a compensating revert node). */
export const isGeneratedKey = (key: string): boolean => key.startsWith(REVERT_PREFIX)

/** One entry of a change file. */
export type ChangeEntry = z.infer<typeof changeEntrySchema>

/** What the router reads of a task beside its label: its difficulty and its risk tags. */
export interface TaskRoute {
    readonly difficulty?: Difficulty
    readonly risk?: readonly string[]
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

/**
 * A task of a recorded graph: its contract hash, and its node hash (contract hash and round), the identity its ledger tasks
 * are dispatched under. Dependencies do not enter it: what a dependency landed is compared by its settled result hash
 * (harness/reconcile.ts), so an upstream retry or no-op edit that lands the same result invalidates nothing below it.
 */
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
    ...(fields.risk === undefined ? {} : { risk: fields.risk }),
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
        if (isGeneratedKey(id)) {
            problems.push(`task ${id}: a key starting with ${REVERT_PREFIX} is the harness's own (a compensating revert node)`)
            continue
        }
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
    state: { readonly tasks: Map<string, PlanTask>; readonly retries: Set<string>; readonly keepEffect: Set<string>; readonly accepts: Set<string> },
    where: { readonly dir: string; readonly base: string; readonly ops: Ops; readonly at: TaskAt },
): void => {
    const { tasks, retries } = state
    const { dir, base, ops, at } = where
    const existing = tasks.get(key)
    if (change.op === "add") {
        if (existing !== undefined) throw new Refusal("WORKFLOW_INVALID", "the graph has this task already; edit it instead")
        if (isGeneratedKey(key)) throw new Refusal("WORKFLOW_INVALID", `a key starting with ${REVERT_PREFIX} is the harness's own (a compensating revert node)`)
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
            if (change.keepEffect === true) state.keepEffect.add(key)
            break
        case "retry":
            retries.add(key)
            tasks.set(key, { ...existing, round: existing.round + 1 })
            break
        case "accept":
            state.accepts.add(key)
            break
    }
}

/**
 * A change file applied: the new task list, the keys to retry, the removed keys whose effect stays (keepEffect: no revert
 * node), the stale keys the Kernel accepts on their dependencies' current results, and the problems.
 */
export interface ChangesApplied {
    readonly tasks: readonly PlanTask[]
    readonly retries: ReadonlySet<string>
    readonly keepEffect: ReadonlySet<string>
    readonly accepts: ReadonlySet<string>
    readonly problems: readonly string[]
}

/** Applies a change file to the tasks of the current graph. */
export const applyChanges = (
    current: readonly PlanTask[],
    changes: readonly ChangeEntry[],
    dir: string,
    base: string,
    ops: Ops,
    plan: { readonly workflow: string; readonly place: PlanPlace },
): ChangesApplied => {
    if (changes.some((change) => uatOfChange(change) !== undefined)) workRootOf(plan.place)
    const tasks = new Map(current.map((task) => [task.key, task]))
    const retries = new Set<string>()
    const keepEffect = new Set<string>()
    const accepts = new Set<string>()
    const problems: string[] = []
    for (const change of changes) {
        const key = change.op === "add" ? change.task.id : change.id
        try {
            applyChange(change, key, { tasks, retries, keepEffect, accepts }, { dir, base, ops, at: { workflow: plan.workflow, key, place: plan.place } })
        } catch (error: unknown) {
            problems.push(`${change.op} ${key}: ${messageOf(error)}`)
        }
    }
    return { tasks: [...tasks.values()], retries, keepEffect, accepts, problems }
}

/** sha256 of a value's json. */
export const sha = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex")

/** The node hash of a task: its contract hash and its retry round. */
export const nodeHashOf = (contract: string, round: number): string => sha({ node: 2, contract, round })

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
 * edges acyclic. A node's hash is its contract hash and round only (nodeHashOf); the nodes come in dependency order.
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

/** The nodes in dependency order, each hashed from its contract and its round (nodeHashOf). */
const hashNodes = (order: readonly string[], byKey: ReadonlyMap<string, PlanTask>): PlanNode[] =>
    order.flatMap((key) => {
        const task = byKey.get(key)
        if (task === undefined) return []
        const own = contractHash(task.contract)
        return [{ ...task, dependsOn: [...task.dependsOn].sort(byCodeUnit), contractHash: own, hash: nodeHashOf(own, task.round) }]
    })

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

/**
 * How a replan treats one task (harness/reconcile.ts classifies; cli/README.md "Workflow graph" says what each does): keep,
 * continue, stale (a dependency's settled result changed: the Kernel decides), rework (done and its contract changed: a new
 * attempt from its previous commit), redo-live (live and its contract changed), redo (a retry asked, or a changed task that is
 * neither done nor live), add, drop, and revert (the compensating node a dropped done task gets).
 */
export type ReplanClass = "keep" | "continue" | "stale" | "rework" | "redo-live" | "redo" | "add" | "drop" | "revert"

/** The earlier work a new attempt of a key starts from: its task, the commit it landed (if any) and the contract diff. */
export interface PriorWork {
    readonly task: string
    readonly commit: string | null
    readonly contractDiff: readonly string[]
}

/** What a revert node undoes: the dropped key, its last done task and the commits its tasks landed, newest first. */
export interface RevertOf {
    readonly key: string
    readonly task: string
    readonly commits: readonly string[]
}

/**
 * One task of a replan: its class, its state before, the live task the replan cancels (if any), and why. `hash` is its node
 * hash in the new graph (none for a drop); `prior` the work a rework or redo-live starts from; `revertOf` what a revert node
 * undoes; `staleDeps` the dependencies whose settled result changed under a stale task.
 */
export interface Classified {
    readonly key: string
    readonly class: ReplanClass
    readonly state: NodeState | null
    readonly cancel: string | null
    readonly why: string
    readonly hash?: string
    readonly prior?: PriorWork
    readonly revertOf?: RevertOf
    readonly staleDeps?: readonly string[]
}

