import { existsSync, readdirSync, readFileSync } from "node:fs"
import { basename, dirname, join, posix } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"
import { captureGitSync } from "../shared/git.js"
import { HARNESS_PREFIX, normaliseRepoPath, parseContract } from "./contract.js"
import type { Contract } from "./contract.js"
import { readMachine, textOf } from "./machine.js"
import { loadOps } from "./ops.js"
import type { Ops } from "./ops.js"
import { getWorkflow, graphOf } from "./workflow.js"

/** The schema tag of ops/lanes.yaml. */
export const LANES_SCHEMA = "starci/lanes@1"

/** The evidence a lane step may be satisfied by; satisfiedBy evaluates each (ops/lanes.yaml says what each means). */
export const SATISFIERS = ["record-exists", "record-done", "direction-approved", "assets-exist", "owners-landed", "uat-receipted", "task-green"] as const

/** The goal flags of `optionalUnless` and the value of the workflow file's `requires` (graph.ts headerSchema) each reads. */
const GOAL_FLAGS = { requiresSecurity: "security", requiresPerf: "perf" } as const

/** One lane a step is held until: its records of the feature, through one of its steps (default the last), required unless `required: false`. */
const heldSchema = z.strictObject({
    lane: z.string().min(1),
    through: z.string().min(1).optional(),
    required: z.boolean().optional(),
})

const stepSchema = z.strictObject({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    label: z.string().min(1),
    satisfiedWhen: z.array(z.enum(SATISFIERS)).min(1),
    optionalWhen: z.enum(["hasNoArtworkSlots"]).optional(),
    optionalUnless: z.enum(Object.keys(GOAL_FLAGS) as [keyof typeof GOAL_FLAGS, ...(keyof typeof GOAL_FLAGS)[]]).optional(),
    heldUntil: z.array(heldSchema).min(1).optional(),
    over: z.enum(["record", "feature"]).optional(),
})

const laneSchema = z.strictObject({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    match: z.array(z.strictObject({ family: z.string().min(1), role: z.enum(["be", "fe"]).optional() })).min(1),
    build: z.string().min(1).optional(),
    steps: z.array(stepSchema).min(1),
})

const lanesFileSchema = z.strictObject({ schema: z.literal(LANES_SCHEMA), lanes: z.array(laneSchema).min(1) })

/** One lane of ops/lanes.yaml: the ordered steps a matching Work record walks. */
export type Lane = z.infer<typeof laneSchema>

/** One step of a lane. */
export type LaneStep = z.infer<typeof stepSchema>

/** Loads ops/lanes.yaml beside the op files; every label, build and heldUntil must name an op, a lane or a lane's step (LANES_INVALID). */
export const loadLanes = (ops: Ops): readonly Lane[] => {
    const file = join(ops.dir, "lanes.yaml")
    const parsed = lanesFileSchema.safeParse(parse(readFileSync(file, "utf8")))
    if (!parsed.success) throw new Refusal("LANES_INVALID", `${file}: ${z.prettifyError(parsed.error)}`)
    const { lanes } = parsed.data
    const ids = new Set(lanes.map((lane) => lane.id))
    const problems = lanes.flatMap((lane) => [
        ...(ids.size === lanes.length ? [] : [`lane ids repeat`]),
        ...(lane.build === undefined || lane.build in ops.labels ? [] : [`lane ${lane.id}: build ${lane.build} has no op file`]),
        ...lane.steps.flatMap((step) => [
            ...(step.label in ops.labels ? [] : [`lane ${lane.id} step ${step.id}: label ${step.label} has no op file`]),
            ...(step.heldUntil ?? []).flatMap((held) => {
                const target = lanes.find((other) => other.id === held.lane)
                if (target === undefined) return [`lane ${lane.id} step ${step.id}: heldUntil ${held.lane} names no lane`]
                return held.through === undefined || target.steps.some((other) => other.id === held.through) ? [] : [`lane ${lane.id} step ${step.id}: heldUntil ${held.lane} through ${held.through} names no step of it`]
            }),
        ]),
    ])
    if (problems.length > 0) throw new Refusal("LANES_INVALID", `${file}:\n${[...new Set(problems)].join("\n")}`)
    return lanes
}

const WORK = ".starciwork"

// Folders inside a record that are no record of their own: a uat flow's runs, a business rule's acceptance criteria.
const INSIDE_RECORD = new Set(["runs", "ac"])

/** A Work record a path names: its id, family, feature, folder and the file that holds it (repository-relative). */
export interface WorkRef {
    readonly id: string
    readonly family: string
    readonly feature: string | null
    readonly folder: string
    readonly file: string
}

const refOf = (family: string, feature: string | null, segments: readonly string[], folder: string, file = "index.yaml"): WorkRef => ({
    id: [family, ...(feature === null ? [] : [feature]), ...segments].join("."),
    family,
    feature,
    folder,
    file: posix.join(folder, file),
})

/**
 * The Work record a repository path names, or undefined: `.starciwork/features/<f>/<family>/<name...>` (an impl record is
 * `impl/<repository>/<name>`; the deepest folder holding an index.yaml is the record, else the shortest), `.starciwork/brand`,
 * and `.starciwork/_resources/environments/<name>`.
 */
export const recordOfPath = (path: string, repo: string): WorkRef | undefined => {
    const parts = normaliseRepoPath(path).split("/")
    if (parts[0] !== WORK) return undefined
    if (parts[1] === "brand") return refOf("brand", null, [], posix.join(WORK, "brand"))
    const name = parts[3]
    if (parts[1] === "_resources" && parts[2] === "environments" && name !== undefined && !name.includes(".")) {
        return refOf("environment", null, [name], posix.join(WORK, "_resources", "environments", name), "resource.yaml")
    }
    const feature = parts[2]
    const family = parts[3]
    if (parts[1] !== "features" || feature === undefined || family === undefined || family.includes(".")) return undefined
    const tail: string[] = []
    for (const segment of parts.slice(4)) {
        if (segment.includes(".") || INSIDE_RECORD.has(segment)) break
        tail.push(segment)
    }
    const minimum = family === "impl" ? 2 : 1
    if (tail.length < minimum) return undefined
    let depth = minimum
    for (let candidate = minimum + 1; candidate <= tail.length; candidate += 1) {
        if (existsSync(join(repo, WORK, "features", feature, family, ...tail.slice(0, candidate), "index.yaml"))) depth = candidate
    }
    const segments = tail.slice(0, depth)
    return refOf(family, feature, segments, posix.join(WORK, "features", feature, family, ...segments))
}

/** The repository paths a contract names: its own context, its allowPaths and its input values. */
const pathsOf = (contract: Contract): string[] => [
    ...(contract.context.extend ?? []).filter((entry) => !entry.startsWith(HARNESS_PREFIX)),
    ...contract.context.allowPaths,
    ...Object.values(contract.input.base ?? {}),
    ...Object.values(contract.input.extend ?? {}),
]

/** The Work records a task is over: every record a path of its contract names, once each. */
export const recordsOf = (contract: Contract, repo: string): WorkRef[] => {
    const found = new Map<string, WorkRef>()
    for (const path of pathsOf(contract)) {
        const ref = recordOfPath(path, repo)
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
}

/** The role (be, fe) workspace.yaml gives an impl record's repository, if it names it. */
const roleOf = (ref: WorkRef, repo: string): string | undefined => {
    if (ref.family !== "impl") return undefined
    const repository = ref.id.split(".")[2]
    const workspace = readYamlFile(join(repo, WORK, "workspace.yaml"))
    const repositories = Array.isArray(workspace?.repositories) ? (workspace.repositories as unknown[]) : []
    for (const entry of repositories) {
        if (typeof entry === "object" && entry !== null && "name" in entry && entry.name === repository && "role" in entry && typeof entry.role === "string") return entry.role
    }
    return undefined
}

/** The lane a Work record walks: the first whose match names its family (and its repository's role, for an impl record). */
export const laneOf = (ref: WorkRef, lanes: readonly Lane[], repo: string): Lane | undefined => {
    const role = roleOf(ref, repo)
    return lanes.find((lane) => lane.match.some((match) => match.family === ref.family && (match.role === undefined || match.role === role)))
}

const fileExists = (repo: string, path: unknown): path is string => typeof path === "string" && path !== "" && existsSync(join(repo, path))

/** The asset slots a ui record declares (`assets`: {slot, file?}). */
const slotsOf = (record: Record<string, unknown> | undefined): unknown[] => (Array.isArray(record?.assets) ? (record.assets as unknown[]) : [])

/** Whether a done task of a label over the record (or its feature) is in the project's ledger. */
const greenTask = (place: FlowPlace, ref: WorkRef, label: string, over: LaneStep["over"]): string | undefined => {
    if (place.db === undefined) return undefined
    for (const row of place.db.prepare("SELECT id, contract_json FROM tasks WHERE status = 'done' AND label = ? ORDER BY created_at DESC").all(label)) {
        let contract: Contract
        try {
            contract = parseContract(JSON.parse(String(row.contract_json)))
        } catch {
            continue
        }
        const refs = recordsOf(contract, place.repo)
        if (refs.some((other) => (over === "feature" ? ref.feature !== null && other.feature === ref.feature : other.id === ref.id))) return String(row.id)
    }
    return undefined
}

/** The evidence that satisfies one satisfier for a record, or undefined (ops/lanes.yaml names what each means). */
const satisfiedBy = (satisfier: (typeof SATISFIERS)[number], ref: WorkRef, step: LaneStep, place: FlowPlace): string | undefined => {
    const { repo } = place
    const record = readYamlFile(join(repo, ref.file))
    const done = record?.state === "done"
    switch (satisfier) {
        case "record-exists":
            return record === undefined ? undefined : `${ref.file} exists`
        case "record-done":
            return done ? `${ref.id} is done` : undefined
        case "direction-approved":
            return done && fileExists(repo, record.direction) ? `${ref.id} is done and its direction ${record.direction} exists` : undefined
        case "assets-exist":
            return assetsDrawn(record, ref, repo)
        case "owners-landed":
            return ownersLanded(record, ref, repo)
        case "uat-receipted": {
            const evidence = readYamlFile(join(repo, ref.folder, "evidence.yaml"))
            const runs = Array.isArray(evidence?.runs) ? evidence.runs.length : 0
            return done && runs > 0 ? `${ref.id} is done and its evidence.yaml cites ${String(runs)} run(s)` : undefined
        }
        case "task-green":
            return taskGreen(place, ref, step)
    }
}

/** `task-green`: a done task of the step's label over the record (or its feature). */
const taskGreen = (place: FlowPlace, ref: WorkRef, step: LaneStep): string | undefined => {
    const task = greenTask(place, ref, step.label, step.over)
    const over = step.over === "feature" ? "feature " + (ref.feature ?? "-") : ref.id
    return task === undefined ? undefined : `task ${task} (${step.label}) is done over ${over}`
}

/** `assets-exist`: every asset slot of the record names a file that exists. */
const assetsDrawn = (record: Record<string, unknown> | undefined, ref: WorkRef, repo: string): string | undefined => {
    const slots = slotsOf(record)
    const drawn = slots.length > 0 && slots.every((slot) => typeof slot === "object" && slot !== null && "file" in slot && fileExists(repo, slot.file))
    return drawn ? `every asset slot of ${ref.id} has its file` : undefined
}

/** `owners-landed`: every owner path of the record has a commit. */
const ownersLanded = (record: Record<string, unknown> | undefined, ref: WorkRef, repo: string): string | undefined => {
    const owners = Array.isArray(record?.owners) ? (record.owners as unknown[]) : []
    const paths = owners.map((owner) => (typeof owner === "object" && owner !== null && "path" in owner && typeof owner.path === "string" ? owner.path : "")).filter((path) => path !== "")
    if (paths.length === 0) return undefined
    const landed = paths.every((path) => captureGitSync(["log", "-1", "--format=%H", "--", path], repo).stdout.trim() !== "")
    return landed ? `every owner of ${ref.id} (${paths.join(", ")}) has a commit` : undefined
}

/** Why a step is optional for this record and goal, or undefined when it must be walked. */
const optionalBecause = (step: LaneStep, ref: WorkRef, place: FlowPlace): string | undefined => {
    if (step.optionalUnless !== undefined && !place.requires.includes(GOAL_FLAGS[step.optionalUnless])) return `the goal does not require ${GOAL_FLAGS[step.optionalUnless]}`
    if (step.optionalWhen === "hasNoArtworkSlots") {
        const record = readYamlFile(join(place.repo, ref.file))
        const drawn = record?.state === "done" && fileExists(place.repo, record.direction)
        if (drawn && slotsOf(record).length === 0) return `${ref.id} is drawn and declares no asset slot`
    }
    return undefined
}

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

/** The records of a feature that walk a lane: those on disk (at any depth of the lane's families) and those the graph covers. */
const featureRecords = (feature: string, lane: Lane, covered: readonly WorkRef[], lanes: readonly Lane[], repo: string): WorkRef[] => {
    const found = new Map(covered.filter((ref) => ref.feature === feature).map((ref) => [ref.id, ref]))
    for (const family of new Set(lane.match.map((match) => match.family))) {
        for (const ref of recordsUnder(posix.join(WORK, "features", feature, family), repo)) if (!found.has(ref.id)) found.set(ref.id, ref)
    }
    return [...found.values()].filter((ref) => laneOf(ref, lanes, repo)?.id === lane.id)
}

/** The Work records on disk under a repository folder, at any depth, once each. */
const recordsUnder = (folder: string, repo: string): WorkRef[] => {
    const found = new Map<string, WorkRef>()
    const scan = (at: string): void => {
        const dir = join(repo, at)
        if (!existsSync(dir)) return
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (!entry.isDirectory() || INSIDE_RECORD.has(entry.name)) continue
            const path = posix.join(at, entry.name)
            const ref = existsSync(join(dir, entry.name, "index.yaml")) ? recordOfPath(path, repo) : undefined
            if (ref !== undefined && !found.has(ref.id)) found.set(ref.id, ref)
            scan(path)
        }
    }
    scan(folder)
    return [...found.values()]
}

/** The steps of a record's lane already carried, each with the tasks that carry it, in lane order. */
type CarriedBefore = readonly { readonly step: string; readonly keys: readonly string[] }[]

/** What a walk of the graph's lanes reads, and where it writes its problems. */
interface LaneWalk {
    readonly nodes: readonly FlowNode[]
    readonly place: FlowPlace
    readonly lanes: readonly Lane[]
    readonly refsOf: ReadonlyMap<string, readonly WorkRef[]>
    readonly covered: ReadonlyMap<string, WorkRef>
    readonly ancestors: ReadonlyMap<string, ReadonlySet<string>>
    readonly problems: string[]
    readonly flowOf: (ref: WorkRef) => RecordFlow | undefined
}

/** Whether a task is over the record (or, for a feature step, over the record's feature). */
const isOver = (walk: LaneWalk, node: FlowNode, ref: WorkRef, step: LaneStep): boolean =>
    (walk.refsOf.get(node.key) ?? []).some((other) => (step.over === "feature" ? ref.feature !== null && other.feature === ref.feature : other.id === ref.id))

/** The problems of a carrier of a held step: a required held lane with no record of the feature, or a carrier that does not depend on the tasks carrying the held records' steps (through the named step). */
const heldProblems = (walk: LaneWalk, step: LaneStep, ref: WorkRef, key: string, above: ReadonlySet<string>): string[] => {
    const { feature } = ref
    if (feature === null) return []
    return (step.heldUntil ?? []).flatMap((until) => {
        const held = walk.lanes.find((lane) => lane.id === until.lane)
        if (held === undefined) return []
        const through = until.through ?? held.steps.at(-1)?.id
        const steps = held.steps.slice(0, held.steps.findIndex((entry) => entry.id === through) + 1)
        const named = through === held.steps.at(-1)?.id ? held.id : held.id + " through " + String(through)
        const records = featureRecords(feature, held, [...walk.covered.values()], walk.lanes, walk.place.repo)
        if (records.length === 0) {
            return until.required === false ? [] : [`${ref.id}: step ${step.id} is held until the ${named} records of feature ${feature}, and it has none; write one (docs) and walk its lane (${steps.map((entry) => entry.label).join(", ")}) before task ${key}`]
        }
        return records.flatMap((record) => {
            const keys = (walk.flowOf(record)?.steps ?? []).filter((entry) => steps.some((kept) => kept.id === entry.step)).flatMap((entry) => entry.tasks)
            const missing = keys.filter((dep) => !above.has(dep))
            const suffix = named === held.id ? "" : " (" + named + ")"
            return missing.length === 0 ? [] : [`${ref.id}: task ${key} carries step ${step.id}, held until ${record.id}${suffix}; make it depend on ${missing.join(", ")}`]
        })
    })
}

/** The tasks of a step's label over the record not yet used by another step: those naming the step as input, else those naming none. */
const carriersOf = (walk: LaneWalk, ref: WorkRef, step: LaneStep, used: ReadonlySet<string>): string[] => {
    const candidates = walk.nodes.filter((node) => node.contract.label === step.label && isOver(walk, node, ref, step) && !used.has(node.key))
    const named = candidates.filter((node) => stepInput(node.contract) === step.id)
    return (named.length > 0 ? named : candidates.filter((node) => stepInput(node.contract) === undefined)).map((node) => node.key)
}

/** The problems of a step's carriers: one that does not depend on every task of an earlier step, or on the records its step is held until. */
const carriedProblems = (walk: LaneWalk, ref: WorkRef, laneId: string, step: LaneStep, carriers: readonly string[], before: CarriedBefore): void => {
    for (const key of carriers) {
        const above = walk.ancestors.get(key) ?? new Set<string>()
        for (const earlier of before) {
            const missing = earlier.keys.filter((dep) => !above.has(dep))
            if (missing.length > 0) walk.problems.push(`${ref.id} (lane ${laneId}): task ${key} carries step ${step.id} but does not depend on ${missing.join(", ")} (step ${earlier.step} before it); add them to its dependsOn`)
        }
        walk.problems.push(...heldProblems(walk, step, ref, key, above))
    }
}

/** One lane step of a record: optional, satisfied by evidence, carried by tasks (`used` takes them), or missing (a problem naming the fix). */
const walkStep = (walk: LaneWalk, ref: WorkRef, lane: Lane, step: LaneStep, before: CarriedBefore, used: Set<string>): StepFlow => {
    const optional = optionalBecause(step, ref, walk.place)
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

/** The owner paths of an impl record (`owners`: {role, path}). */
const ownerPaths = (ref: WorkRef, repo: string): string[] => {
    const record = readYamlFile(join(repo, ref.file))
    const owners = Array.isArray(record?.owners) ? (record.owners as unknown[]) : []
    return owners.flatMap((owner) => (typeof owner === "object" && owner !== null && "path" in owner && typeof owner.path === "string" && owner.path !== "" ? [normaliseRepoPath(owner.path)] : []))
}

/** Whether two repository paths overlap: one is the other or inside it. */
const overlaps = (left: string, right: string): boolean => left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)

/**
 * The tasks of a perRecord label (ops/ops/README.md) that work more than one Work record: they carry lane steps of several
 * records, or their allowPaths reach the owner paths of several impl records.
 */
const splitProblems = (nodes: readonly FlowNode[], report: FlowReport, repo: string, ops: Ops): string[] => {
    const features = join(repo, WORK, "features")
    const impls = existsSync(features)
        ? readdirSync(features, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? recordsUnder(posix.join(WORK, "features", entry.name, "impl"), repo) : []))
        : []
    const owned = impls.map((ref) => ({ id: ref.id, paths: ownerPaths(ref, repo) }))
    return nodes.flatMap((node) => {
        if (ops.labels[node.contract.label]?.perRecord !== true) return []
        const allowed = node.contract.context.allowPaths.map(normaliseRepoPath)
        const records = new Set([
            ...report.records.filter((flow) => flow.steps.some((step) => step.tasks.includes(node.key))).map((flow) => flow.record),
            ...owned.filter((impl) => impl.paths.some((path) => allowed.some((allow) => overlaps(path, allow)))).map((impl) => impl.id),
        ])
        if (records.size <= 1) return []
        return [`task ${node.key} (${node.contract.label}) works ${[...records].sort((a, b) => a.localeCompare(b)).join(", ")}: split into one task per record (disjoint allowPaths), they run in parallel up to the workflow cap`]
    })
}

/**
 * The flow of a graph (ops/lanes.yaml): every Work record a task is over walks its lane, and so does every record a held step
 * waits on. Each step is optional, satisfied by evidence, carried by tasks of its label over the record, or missing; a carrying
 * task must depend on the tasks carrying the steps before it and on those carrying the records its step is held until.
 */
export const evaluateFlow = (nodes: readonly FlowNode[], place: FlowPlace, lanes: readonly Lane[]): FlowReport => {
    const { repo } = place
    const refsOf = new Map(nodes.map((node) => [node.key, recordsOf(node.contract, repo)]))
    const covered = new Map<string, WorkRef>()
    for (const refs of refsOf.values()) for (const ref of refs) covered.set(ref.id, ref)
    const flows = new Map<string, RecordFlow>()
    const flowOf = (ref: WorkRef): RecordFlow | undefined => {
        const known = flows.get(ref.id)
        if (known !== undefined) return known
        const lane = laneOf(ref, lanes, repo)
        if (lane === undefined) return undefined
        const steps: StepFlow[] = []
        const flow: RecordFlow = { record: ref.id, lane: lane.id, steps }
        flows.set(ref.id, flow)
        const used = new Set<string>()
        let before: CarriedBefore = []
        for (const step of lane.steps) {
            const walked = walkStep(walk, ref, lane, step, before, used)
            steps.push(walked)
            // The step is in the flow before its carriers are judged, so a held record's walk that comes back here sees it.
            if (walked.status !== "carried") continue
            carriedProblems(walk, ref, lane.id, step, walked.tasks, before)
            before = [...before, { step: step.id, keys: walked.tasks }]
        }
        return flow
    }
    const walk: LaneWalk = { nodes, place, lanes, refsOf, covered, ancestors: ancestorsOf(nodes), problems: [], flowOf }
    for (const ref of covered.values()) flowOf(ref)
    return { records: [...flows.values()], problems: [...new Set(walk.problems)] }
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
    const unsplit = splitProblems(nodes, report, place.repo, ops)
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
 * The planning digest of a workflow: the lane of each Work record its current graph covers, each step satisfied, carried,
 * optional or missing, read in the workflow's worktree (else its repository). The Kernel plans only what is missing.
 */
export const workflowLanes = (db: DatabaseSync, workflowId: string): readonly string[] => {
    const workflow = getWorkflow(db, workflowId)
    const checkout = textOf(db.prepare("SELECT worktree FROM workflows WHERE id = ?").get(workflowId)?.worktree) ?? undefined
    const repo = checkout ?? repoOfLedger(db)
    if (repo === undefined || !existsSync(repo)) return []
    try {
        const nodes = graphOf(db, workflowId, workflow.graphVersion)
        const report = evaluateFlow(nodes, { repo, db, requires: workflow.header.requires ?? [] }, loadLanes(loadOps()))
        return [...flowLines(report), ...report.problems.map((problem) => `missing: ${problem}`)]
    } catch (error: unknown) {
        return [`lanes unreadable: ${error instanceof Error ? error.message : String(error)}`]
    }
}
