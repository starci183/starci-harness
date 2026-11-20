import { existsSync, readFileSync } from "node:fs"
import { basename, dirname, join, posix } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"
import { captureGitSync } from "../shared/git.js"
import { HARNESS_PREFIX, normaliseRepoPath, parseContract } from "./contract.js"
import type { Contract } from "./contract.js"
import { isRelayKey } from "./graph.js"
import { readMachine, textOf } from "./machine.js"
import { loadOps } from "./ops.js"
import type { Ops } from "./ops.js"
import { workflowWorktree } from "./tasks.js"
import { getWorkflow, graphOf } from "./workflow.js"

/** The schema tag of ops/lanes.yaml. */
export const LANES_SCHEMA = "starci/lanes@1"

/** The evidence a lane step may be satisfied by; satisfiedBy evaluates each (ops/lanes.yaml says what each means). */
export const SATISFIERS = ["record-exists", "record-done", "task-green"] as const

/** The goal flags of `optionalUnless` and the value of the workflow file's `requires` (graph.ts headerSchema) each reads. */
const GOAL_FLAGS = { requiresSecurity: "security", requiresPerf: "perf" } as const

const stepSchema = z.strictObject({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    label: z.string().min(1),
    satisfiedWhen: z.array(z.enum(SATISFIERS)).min(1),
    optionalUnless: z.enum(Object.keys(GOAL_FLAGS) as [keyof typeof GOAL_FLAGS, ...(keyof typeof GOAL_FLAGS)[]]).optional(),
})

const laneSchema = z.strictObject({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    match: z.array(z.strictObject({ family: z.string().min(1) })).min(1),
    build: z.string().min(1).optional(),
    steps: z.array(stepSchema).min(1),
})

const lanesFileSchema = z.strictObject({ schema: z.literal(LANES_SCHEMA), lanes: z.array(laneSchema).min(1) })

/** One lane of ops/lanes.yaml: the ordered steps a matching Work record walks. */
export type Lane = z.infer<typeof laneSchema>

/** One step of a lane. */
export type LaneStep = z.infer<typeof stepSchema>

/** Loads ops/lanes.yaml beside the op files; every label and build must name an op (LANES_INVALID). */
export const loadLanes = (ops: Ops): readonly Lane[] => {
    const file = join(ops.dir, "lanes.yaml")
    const parsed = lanesFileSchema.safeParse(parse(readFileSync(file, "utf8")))
    if (!parsed.success) throw new Refusal("LANES_INVALID", `${file}: ${z.prettifyError(parsed.error)}`)
    const { lanes } = parsed.data
    const ids = new Set(lanes.map((lane) => lane.id))
    const problems = lanes.flatMap((lane) => [
        ...(ids.size === lanes.length ? [] : [`lane ids repeat`]),
        ...(lane.build === undefined || lane.build in ops.labels ? [] : [`lane ${lane.id}: build ${lane.build} has no op file`]),
        ...lane.steps.flatMap((step) => (step.label in ops.labels ? [] : [`lane ${lane.id} step ${step.id}: label ${step.label} has no op file`])),
    ])
    if (problems.length > 0) throw new Refusal("LANES_INVALID", `${file}:\n${[...new Set(problems)].join("\n")}`)
    return lanes
}

const WORK = ".starciwork"

/** A Work record a path names: its id, family, folder and the file that holds it (repository-relative). */
export interface WorkRef {
    readonly id: string
    readonly family: string
    readonly folder: string
    readonly file: string
}

const refOf = (family: string, segments: readonly string[], folder: string, file: string): WorkRef => ({
    id: [family, ...segments].join("."),
    family,
    folder,
    file: posix.join(folder, file),
})

/** The Work record a repository path names, or undefined: `.starciwork/brand`, `.starciwork/master-plan.yaml` and `.starciwork/_resources/environments/<name>`. */
export const recordOfPath = (path: string): WorkRef | undefined => {
    const parts = normaliseRepoPath(path).split("/")
    if (parts[0] !== WORK) return undefined
    if (parts[1] === "brand") return refOf("brand", [], posix.join(WORK, "brand"), "index.yaml")
    if (parts[1] === "master-plan.yaml" && parts.length === 2) return refOf("master-plan", [], WORK, "master-plan.yaml")
    const name = parts[3]
    if (parts[1] === "_resources" && parts[2] === "environments" && name !== undefined && !name.includes(".")) {
        return refOf("environment", [name], posix.join(WORK, "_resources", "environments", name), "resource.yaml")
    }
    return undefined
}

/** The repository paths a contract names: its own context, its allowPaths and its input values. */
const pathsOf = (contract: Contract): string[] => [
    ...(contract.context.extend ?? []).filter((entry) => !entry.startsWith(HARNESS_PREFIX)),
    ...contract.context.allowPaths,
    ...Object.values(contract.input.base ?? {}),
    ...Object.values(contract.input.extend ?? {}),
]

/** The Work records a task is over: every record a path of its contract names, once each. */
export const recordsOf = (contract: Contract): WorkRef[] => {
    const found = new Map<string, WorkRef>()
    for (const path of pathsOf(contract)) {
        const ref = recordOfPath(path)
        if (ref !== undefined && !found.has(ref.id)) found.set(ref.id, ref)
    }
    return [...found.values()]
}

const readYamlFile = (file: string): Record<string, unknown> | undefined => {
    if (!existsSync(file)) return undefined
    try {
        const value: unknown = parse(readFileSync(file, "utf8"))
        return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
    } catch {
        return undefined
    }
}

/** What the evaluation reads beside the graph: the repository holding the Work tree, the project ledger, and the goal's requirements. */
export interface FlowPlace {
    readonly repo: string
    readonly db: DatabaseSync | undefined
    readonly requires: readonly string[]
    /** The workflow judged: its own done tasks count as evidence whatever they landed. */
    readonly workflowId?: string
    /** The revision the workflow forks from (its header's `base`, HEAD by default): a done task of another workflow counts only when its landed commit is an ancestor of it. */
    readonly base?: string
}

/** The lane a Work record walks: the first whose match names its family. */
export const laneOf = (ref: WorkRef, lanes: readonly Lane[]): Lane | undefined => lanes.find((lane) => lane.match.some((match) => match.family === ref.family))

/**
 * Whether a task's work is on the tree the workflow is judged on: a task of the workflow itself (its work is on its branch), or a task of
 * another workflow whose landed commit is an ancestor of the workflow's base. A task that landed nothing, or whose workflow was stopped on
 * a branch the base does not hold, proves nothing about this tree.
 */
export const onThisTree = (place: FlowPlace, row: Record<string, unknown>): boolean => {
    if (place.workflowId !== undefined && row.workflow_id === place.workflowId) return true
    const commit = typeof row.settle_commit === "string" && row.settle_commit !== "" ? row.settle_commit : undefined
    return commit !== undefined && captureGitSync(["merge-base", "--is-ancestor", commit, place.base ?? "HEAD"], place.repo).exitCode === 0
}

/** Whether a done task of a label over the record is in the project's ledger and its work is on the tree being judged (onThisTree). */
const greenTask = (place: FlowPlace, ref: WorkRef, label: string): string | undefined => {
    if (place.db === undefined) return undefined
    for (const row of place.db.prepare("SELECT id, contract_json, workflow_id, settle_commit FROM tasks WHERE status = 'done' AND label = ? ORDER BY created_at DESC").all(label)) {
        if (!onThisTree(place, row)) continue
        let contract: Contract
        try {
            contract = parseContract(JSON.parse(String(row.contract_json)))
        } catch {
            continue
        }
        if (recordsOf(contract).some((other) => other.id === ref.id)) return String(row.id)
    }
    return undefined
}

/** The evidence that satisfies one satisfier for a record, or undefined (ops/lanes.yaml names what each means). */
const satisfiedBy = (satisfier: (typeof SATISFIERS)[number], ref: WorkRef, step: LaneStep, place: FlowPlace): string | undefined => {
    const record = readYamlFile(join(place.repo, ref.file))
    switch (satisfier) {
        case "record-exists":
            return record === undefined ? undefined : `${ref.file} exists`
        case "record-done":
            return record?.state === "done" ? `${ref.id} is done` : undefined
        case "task-green":
            return taskGreen(place, ref, step)
    }
}

/** `task-green`: a done task of the step's label over the record. */
const taskGreen = (place: FlowPlace, ref: WorkRef, step: LaneStep): string | undefined => {
    const task = greenTask(place, ref, step.label)
    return task === undefined ? undefined : `task ${task} (${step.label}) is done over ${ref.id}`
}

/** Why a step is optional for this goal, or undefined when it must be walked. */
const optionalBecause = (step: LaneStep, place: FlowPlace): string | undefined =>
    step.optionalUnless !== undefined && !place.requires.includes(GOAL_FLAGS[step.optionalUnless]) ? `the goal does not require ${GOAL_FLAGS[step.optionalUnless]}` : undefined

/** A task of the graph as the flow reads it. */
export interface FlowNode {
    readonly key: string
    readonly contract: Contract
    readonly dependsOn: readonly string[]
}

/** One step of a record's lane: satisfied (its evidence), carried (by tasks), optional (why) or missing (how to fix). */
export interface StepFlow {
    readonly step: string
    readonly label: string
    readonly status: "satisfied" | "carried" | "optional" | "missing"
    readonly detail: string
    readonly tasks: readonly string[]
}

/** The lane of one Work record and where each of its steps stands. */
export interface RecordFlow {
    readonly record: string
    readonly lane: string
    readonly steps: readonly StepFlow[]
}

/** The flow of a graph: every covered record's lane, and the problems that make the graph incomplete. */
export interface FlowReport {
    readonly records: readonly RecordFlow[]
    readonly problems: readonly string[]
}

const ancestorsOf = (nodes: readonly FlowNode[]): Map<string, Set<string>> => {
    const byKey = new Map(nodes.map((node) => [node.key, node]))
    const memo = new Map<string, Set<string>>()
    const visit = (key: string, seen: Set<string>): Set<string> => {
        const known = memo.get(key)
        if (known !== undefined) return known
        const into = new Set<string>()
        for (const dep of byKey.get(key)?.dependsOn ?? []) {
            if (seen.has(dep)) continue
            into.add(dep)
            for (const above of visit(dep, new Set([...seen, dep]))) into.add(above)
        }
        memo.set(key, into)
        return into
    }
    for (const node of nodes) visit(node.key, new Set([node.key]))
    return memo
}

/** The step a task names in its inputs (`step`), when a lane holds more than one step of its label. */
const stepInput = (contract: Contract): string | undefined => contract.input.extend?.step ?? contract.input.base?.step

/** The steps of a record's lane already carried, each with the tasks that carry it, in lane order. */
type CarriedBefore = readonly { readonly step: string; readonly keys: readonly string[] }[]

/** What a walk of the graph's lanes reads, and where it writes its problems. */
interface LaneWalk {
    readonly nodes: readonly FlowNode[]
    readonly place: FlowPlace
    readonly lanes: readonly Lane[]
    readonly refsOf: ReadonlyMap<string, readonly WorkRef[]>
    readonly ancestors: ReadonlyMap<string, ReadonlySet<string>>
    readonly problems: string[]
}

/** Whether a task is over the record. */
const isOver = (walk: LaneWalk, node: FlowNode, ref: WorkRef): boolean => (walk.refsOf.get(node.key) ?? []).some((other) => other.id === ref.id)

/** The tasks of a step's label over the record not yet used by another step: those naming the step as input, else those naming none. */
const carriersOf = (walk: LaneWalk, ref: WorkRef, step: LaneStep, used: ReadonlySet<string>): string[] => {
    const candidates = walk.nodes.filter((node) => node.contract.label === step.label && isOver(walk, node, ref) && !used.has(node.key))
    const named = candidates.filter((node) => stepInput(node.contract) === step.id)
    return (named.length > 0 ? named : candidates.filter((node) => stepInput(node.contract) === undefined)).map((node) => node.key)
}

/** The problems of a step's carriers: one that does not depend on every task of an earlier step. */
const carriedProblems = (walk: LaneWalk, ref: WorkRef, laneId: string, step: LaneStep, carriers: readonly string[], before: CarriedBefore): void => {
    for (const key of carriers) {
        const above = walk.ancestors.get(key) ?? new Set<string>()
        for (const earlier of before) {
            const missing = earlier.keys.filter((dep) => !above.has(dep))
            if (missing.length > 0) walk.problems.push(`${ref.id} (lane ${laneId}): task ${key} carries step ${step.id} but does not depend on ${missing.join(", ")} (step ${earlier.step} before it); add them to its dependsOn`)
        }
    }
}

/** One lane step of a record: optional, satisfied by evidence, carried by tasks (`used` takes them), or missing (a problem naming the fix). */
const walkStep = (walk: LaneWalk, ref: WorkRef, lane: Lane, step: LaneStep, before: CarriedBefore, used: Set<string>): StepFlow => {
    const optional = optionalBecause(step, walk.place)
    if (optional !== undefined) return { step: step.id, label: step.label, status: "optional", detail: optional, tasks: [] }
    const evidence = step.satisfiedWhen.map((satisfier) => satisfiedBy(satisfier, ref, step, walk.place)).find((found) => found !== undefined)
    if (evidence !== undefined) return { step: step.id, label: step.label, status: "satisfied", detail: evidence, tasks: [] }
    const carriers = carriersOf(walk, ref, step, used)
    if (carriers.length === 0) {
        const after = before.flatMap((entry) => entry.keys)
        const shared = lane.steps.filter((other) => other.label === step.label).length > 1
        const fix = [`add a ${step.label} task over ${ref.folder}`, ...(shared ? [`with input step: ${step.id}`] : []), ...(after.length === 0 ? [] : [`depending on ${after.join(", ")}`])].join(" ")
        const detail = `neither satisfied (${step.satisfiedWhen.join(" | ")}) nor carried: ${fix}`
        walk.problems.push(`${ref.id} (lane ${lane.id}): step ${step.id} is ${detail}`)
        return { step: step.id, label: step.label, status: "missing", detail, tasks: [] }
    }
    for (const key of carriers) used.add(key)
    return { step: step.id, label: step.label, status: "carried", detail: `carried by ${carriers.join(", ")}`, tasks: carriers }
}

/**
 * The tasks of a perRecord label (ops/ops/README.md) that work more than one Work record: they carry lane steps of several
 * records. A relay node works no record: it carries a shared need's commits that another workflow's lane already walked.
 */
const splitProblems = (nodes: readonly FlowNode[], report: FlowReport, ops: Ops): string[] =>
    nodes.flatMap((node) => {
        if (ops.labels[node.contract.label]?.perRecord !== true || isRelayKey(node.key)) return []
        const records = new Set(report.records.filter((flow) => flow.steps.some((step) => step.tasks.includes(node.key))).map((flow) => flow.record))
        if (records.size <= 1) return []
        return [`task ${node.key} (${node.contract.label}) works ${[...records].sort((a, b) => a.localeCompare(b)).join(", ")}: split into one task per record (disjoint allowPaths), they run in parallel up to the workflow cap`]
    })

/**
 * The flow of a graph (ops/lanes.yaml): every Work record a task is over walks its lane. Each step is optional, satisfied by
 * evidence, carried by tasks of its label over the record, or missing; a carrying task must depend on the tasks carrying the
 * steps before it. A relay node is outside the flow: the records its commits implement walked their lane in the workflow that
 * built them.
 */
export const evaluateFlow = (graph: readonly FlowNode[], place: FlowPlace, lanes: readonly Lane[]): FlowReport => {
    const nodes = graph.filter((node) => !isRelayKey(node.key))
    const refsOf = new Map(nodes.map((node) => [node.key, recordsOf(node.contract)]))
    const covered = new Map<string, WorkRef>()
    for (const refs of refsOf.values()) for (const ref of refs) covered.set(ref.id, ref)
    const walk: LaneWalk = { nodes, place, lanes, refsOf, ancestors: ancestorsOf(nodes), problems: [] }
    const records: RecordFlow[] = []
    for (const ref of covered.values()) {
        const lane = laneOf(ref, lanes)
        if (lane === undefined) continue
        const steps: StepFlow[] = []
        const used = new Set<string>()
        let before: CarriedBefore = []
        for (const step of lane.steps) {
            const walked = walkStep(walk, ref, lane, step, before, used)
            steps.push(walked)
            if (walked.status !== "carried") continue
            carriedProblems(walk, ref, lane.id, step, walked.tasks, before)
            before = [...before, { step: step.id, keys: walked.tasks }]
        }
        records.push({ record: ref.id, lane: lane.id, steps })
    }
    return { records, problems: [...new Set(walk.problems)] }
}

/** The flow as text: one line per record, each step with its status. */
export const flowLines = (report: FlowReport): string[] =>
    report.records.map((flow) => {
        const steps = flow.steps.map((step) => step.step + " " + step.status + (step.tasks.length === 0 ? "" : " (" + step.tasks.join(", ") + ")"))
        return `${flow.record} [${flow.lane}]: ${steps.join(", ")}`
    })

/**
 * Refuses TASK_NOT_SPLIT when a task of a perRecord label works more than one Work record (splitProblems), then FLOW_INCOMPLETE
 * when a Work record the graph covers has a lane step that is neither satisfied by evidence nor carried by a task of its label over
 * the record, or a carrying task out of the lane's order: the Kernel plans the missing steps, and only them.
 */
export const assertFlow = (workflowId: string, nodes: readonly FlowNode[], place: FlowPlace, ops: Ops): FlowReport => {
    const report = evaluateFlow(nodes, place, loadLanes(ops))
    const unsplit = splitProblems(nodes, report, ops)
    if (unsplit.length > 0) throw new Refusal("TASK_NOT_SPLIT", `the graph of ${workflowId} gives one task several Work records:\n${bulleted(unsplit)}`)
    if (report.problems.length === 0) return report
    throw new Refusal(
        "FLOW_INCOMPLETE",
        `the graph of ${workflowId} leaves lane steps of its Work records undone (ops/lanes.yaml):\n${report.problems.map((problem) => "- " + problem).join("\n")}\nlanes:\n${flowLines(report).map((line) => "  " + line).join("\n")}`,
    )
}

/** Problems as a bulleted list, one per line. */
const bulleted = (problems: readonly string[]): string => problems.map((problem) => "- " + problem).join("\n")

/** The repository a ledger belongs to, from the host registry (`<projects>/<ledger_id>/runtime.sqlite`). */
export const repoOfLedger = (db: DatabaseSync): string | undefined => {
    const file = db.location()
    if (file === null) return undefined
    const id = basename(dirname(file))
    return readMachine((machine) => textOf(machine.prepare("SELECT repo_root FROM ledgers WHERE ledger_id = ?").get(id)?.repo_root) ?? undefined, undefined)
}

/**
 * Where a workflow's lanes are judged: its worktree, the checkout of the workflow branch's head where its records are written,
 * while it exists. The planning digest and a replan's FLOW_INCOMPLETE read this one tree, so a record the branch holds and main
 * does not is satisfied for both; each falls back to its own checkout only when the workflow has none.
 */
export const flowCheckoutOf = (db: DatabaseSync, workflowId: string): string | undefined => {
    const checkout = workflowWorktree(db, workflowId)
    return checkout !== undefined && existsSync(checkout) ? checkout : undefined
}

/**
 * The planning digest of a workflow: the lane of each Work record its current graph covers, each step satisfied, carried,
 * optional or missing, read where its lanes are judged (flowCheckoutOf, else its repository). The Kernel plans only what is missing.
 */
export const workflowLanes = (db: DatabaseSync, workflowId: string): readonly string[] => {
    const workflow = getWorkflow(db, workflowId)
    const repo = flowCheckoutOf(db, workflowId) ?? repoOfLedger(db)
    if (repo === undefined || !existsSync(repo)) return []
    try {
        const nodes = graphOf(db, workflowId, workflow.graphVersion)
        const report = evaluateFlow(nodes, { repo, db, requires: workflow.header.requires ?? [], workflowId, base: workflow.header.base }, loadLanes(loadOps()))
        return [...flowLines(report), ...report.problems.map((problem) => `missing: ${problem}`)]
    } catch (error: unknown) {
        return [`lanes unreadable: ${error instanceof Error ? error.message : String(error)}`]
    }
}
