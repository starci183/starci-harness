import type { DatabaseSync } from "node:sqlite"
import { resolve } from "node:path"
import { openLedger } from "../../harness/ledger.js"
import { planPlace } from "../../harness/graph.js"
import type { Classified, PlanSource, PlanPlace } from "../../harness/graph.js"
import type { Ops } from "../../harness/ops.js"
import { loadOps } from "../../harness/ops.js"
import { acceptInputs, ensureResultHashes, readResults } from "../../harness/reconcile.js"
import { DISPATCHING, graphVersionOfCommand, recordReplan, snapshotOf } from "../../harness/workflow.js"
import type { WorkflowRow } from "../../harness/workflow.js"
import { Refusal } from "../../shared/errors.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import type { VerbContext, VerbResult } from "../../shared/verb.js"
import { cancelTasks, readSnapshot, reconcile, reportMessage, reportOf, stepWorkflow } from "./engine.js"
import type { StepAction, WorkflowReport } from "./engine.js"
import { regoal } from "./goal-change.js"
import { buildReplan, classCounts, classificationTable, readReplanSource } from "./replan.js"
import type { RelayAdd, Replan } from "./replan.js"

const keyList = (value: string | undefined): ReadonlySet<string> =>
    new Set(
        (value ?? "")
            .split(",")
            .map((key) => key.trim())
            .filter((key) => key !== ""),
    )

const versionOf = (value: string | undefined): number | undefined => {
    if (value === undefined) return undefined
    const version = Number(value)
    if (!Number.isInteger(version) || version < 1) throw new Refusal("FLAG_INVALID", `--based-on takes a graph version (a whole number from 1), not ${value}`)
    return version
}

/** What an amend asks of the ledger: the workflow, its replan file and the Kernel's per-key choices. */
interface AmendAsk {
    readonly root: string
    readonly workflowId: string
    readonly file: string
    readonly source: PlanSource
    readonly ops: Ops
    readonly place: PlanPlace
    readonly basedOn: number | undefined
    readonly cmdId: string | undefined
    readonly keepEffect: ReadonlySet<string>
    readonly accepts: ReadonlySet<string>
    readonly relays?: readonly RelayAdd[]
}

type Amended = { readonly duplicate: number } | { readonly replan: Replan; readonly workflow: WorkflowRow }

/** Builds and records the replan in the ledger: idempotent by cmdId, compare-and-swap on basedOn, settled results hashed first. */
const amendInLedger = async (db: DatabaseSync, ask: AmendAsk): Promise<Amended> => {
    const before = snapshotOf(db, ask.workflowId)
    const applied = ask.cmdId === undefined ? undefined : graphVersionOfCommand(db, before.workflow.id, ask.cmdId)
    if (applied !== undefined) return { duplicate: applied }
    if (before.workflow.status === "stopping" || before.workflow.status === "stopped") {
        throw new Refusal("WORKFLOW_STOPPED", `workflow ${before.workflow.id} is ${before.workflow.status}; a stopped workflow is not amended`)
    }
    if (ask.basedOn !== undefined && ask.basedOn !== before.workflow.graphVersion) {
        throw new Refusal("STALE", `workflow ${before.workflow.id} is at graph v${String(before.workflow.graphVersion)}, not v${String(ask.basedOn)}; read it again (starci workflow status) and resubmit`)
    }
    await ensureResultHashes(ask.root, db, before.workflow.id)
    const snapshot = snapshotOf(db, ask.workflowId)
    const options = { results: readResults(db, snapshot.workflow.id, snapshot.tasks), keepEffect: ask.keepEffect, accepts: ask.accepts, relays: ask.relays ?? [] }
    const replan = buildReplan(db, snapshot, ask.file, ask.source, ask.ops, ask.place, options)
    if (replan.unchanged) throw new Refusal("NOTHING_TO_AMEND", `${ask.file} changes nothing in workflow ${snapshot.workflow.id} (graph v${String(snapshot.workflow.graphVersion)})`)
    const workflow = recordReplan(db, snapshot.workflow, replan.header, replan.nodes, replan.reason, replan.classification, {
        ...(ask.cmdId === undefined ? {} : { cmdId: ask.cmdId }),
        within: (tx) => {
            acceptInputs(tx, snapshot.workflow.id, replan.accepts)
        },
    })
    return { replan, workflow }
}

/** The data of an amend: the graph version it recorded (or had recorded, for a repeated cmdId) and, when new, its classification and step report. */
interface AmendData {
    readonly workflow: string
    readonly graphVersion: number
    readonly duplicate: boolean
    readonly goalVersion?: number
    readonly reason?: string
    readonly classification?: readonly Classified[]
    readonly notes?: readonly string[]
    readonly report?: WorkflowReport
}

/** Records an amend, then cancels what it dooms and resumes the workflow: the verb's work, and the harness's own replans. */
const amend = async (context: VerbContext, ask: AmendAsk): Promise<{ readonly data: AmendData; readonly message: string }> => {
    const { root, cmdId } = ask
    const db = openLedger(root)
    let amended: Amended
    try {
        amended = await amendInLedger(db, ask)
    } finally {
        db.close()
    }
    if ("duplicate" in amended) {
        const data: AmendData = { workflow: ask.workflowId, graphVersion: amended.duplicate, duplicate: true }
        return { data, message: `command ${String(cmdId)} was applied already: workflow ${ask.workflowId} graph v${String(amended.duplicate)}` }
    }
    const { replan, workflow } = amended
    const doomed = replan.classification.flatMap((row) => (row.cancel === null ? [] : [{ key: row.key, task: row.cancel, why: row.class }]))
    const doomedList = doomed.map((row) => `${row.key} ${row.why}`).join(", ")
    const actions: StepAction[] = await cancelTasks(context, doomed, `workflow ${workflow.id} amend to graph v${String(workflow.graphVersion)}: ${doomedList}`)
    let snapshot = reconcile(root, workflow.id)
    // Resume: a started workflow dispatches from the new graph at once.
    const resumed = DISPATCHING.includes(snapshot.workflow.status) ? await stepWorkflow(context, root, workflow.id) : null
    snapshot = readSnapshot(root, workflow.id)
    const report = resumed === null ? reportOf(root, snapshot, actions) : { ...resumed, actions: [...actions, ...resumed.actions] }
    const message = [
        `amended ${workflow.id} to graph v${String(workflow.graphVersion)} (goal v${String(workflow.goalVersion)}): ${classCounts(replan.classification)}`,
        classificationTable(replan.classification),
        ...replan.notes.map((note) => `note: ${note}`),
        reportMessage(report),
    ].join("\n")
    const data: AmendData = {
        workflow: workflow.id,
        graphVersion: workflow.graphVersion,
        goalVersion: workflow.goalVersion,
        duplicate: false,
        reason: replan.reason,
        classification: replan.classification,
        notes: replan.notes,
        report,
    }
    return { data, message }
}

/**
 * The harness's replan that adds relay nodes of shared needs to a workflow (core/needs/tend.ts), each waiter depending on its
 * relay, recorded and resumed like any amend; idempotent by `cmdId`. No file can ask for it: relay keys are the harness's own.
 */
export const amendWithRelays = async (context: VerbContext, workflowId: string, relays: readonly RelayAdd[], reason: string, cmdId: string): Promise<AmendData> => {
    const place = await planPlace(context.cwd)
    const source: PlanSource = { kind: "change", workflow: workflowId, reason, changes: [], dir: place.repo }
    const ask: AmendAsk = { root: place.repo, workflowId, file: reason, source, ops: loadOps(), place, basedOn: undefined, cmdId, keepEffect: new Set<string>(), accepts: new Set<string>(), relays }
    return (await amend(context, ask)).data
}

/**
 * `starci workflow amend <id> --desired <workflow file> --based-on <graph version>`: the Kernel's replan. The desired graph is
 * reconciled against the current one by task key (harness/reconcile.ts): keep, continue, stale, rework, redo-live, redo, add,
 * drop and the revert nodes of dropped done tasks; graph version n+1 is recorded atomically on `--based-on` (STALE when the
 * graph moved), idempotent by `--cmd-id`, inside the goal's scope ceiling (SCOPE_EXCEEDED) and keeping its deliverables
 * (GOAL_SHRUNK). `--change <file>` applies a
 * workflow-change@1 file (add, edit, remove, retry, accept) instead. The live tasks of redo-live, redo and drop are cancelled
 * through task cancel (fenced, preserved, released); stale tasks are never cancelled, the Kernel decides. Dispatch resumes.
 */
export const workflowAmendVerb = defineVerb({
    path: ["workflow", "amend"],
    summary: "replan a workflow from a desired graph (--desired, --based-on) or a change file: reconcile by task key, record graph n+1, cancel what is dropped or redone live, resume; --goal records goal n+1 instead",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["owner", "kernel", "supervisor"],
    schema: "starci/workflow-amend@1",
    flags: {
        workflow: { kind: "string", summary: "the workflow id", required: true, positional: true },
        desired: { kind: "string", summary: "the desired graph: a whole starci/workflow@1 file of the same id (needs --based-on)" },
        change: { kind: "string", summary: "a starci/workflow-change@1 file (add, edit, remove, retry, accept), or a whole workflow file" },
        goal: { kind: "string", summary: "a starci/goal-change@1 file, yaml or json: record goal n+1 (goal text, acceptance, scope ceiling) based on goal n (--based-on); owner and Supervisor only" },
        "based-on": { kind: "string", summary: "the graph version the replan was built on (with --goal: the goal version); STALE when the workflow moved past it" },
        "cmd-id": { kind: "string", summary: "the command id: the same id again returns the graph version it recorded" },
        "keep-effect": { kind: "string", summary: "comma list of removed keys whose committed effect stays (no revert node)" },
        accept: { kind: "string", summary: "comma list of stale keys kept on their dependencies' current results" },
    },
    run: async (context, flags): Promise<VerbResult<unknown>> => {
        if (flags.goal !== undefined) {
            if (flags.desired !== undefined || flags.change !== undefined) throw new Refusal("FLAG_INVALID", "--goal records a goal change alone; the Kernel answers it with its own amend --desired")
            return regoal(context, flags.workflow, flags.goal, flags["based-on"])
        }
        const named = flags.desired ?? flags.change
        if (named === undefined || (flags.desired !== undefined && flags.change !== undefined)) throw new Refusal("FLAG_INVALID", "give one of --desired <workflow file>, --change <change file> or --goal <goal-change file>")
        const basedOn = versionOf(flags["based-on"])
        if (flags.desired !== undefined && basedOn === undefined) throw new Refusal("FLAG_INVALID", "--desired needs --based-on <graph version>")
        const place = await planPlace(context.cwd)
        const root = place.repo
        const file = resolve(context.cwd, named)
        const ops = loadOps()
        const source = await readReplanSource(file, ops, place)
        if (flags.desired !== undefined && source.kind !== "workflow") throw new Refusal("WORKFLOW_INVALID", `${file} is a change file; --desired takes a whole starci/workflow@1 file (a change file goes to --change)`)
        const ask: AmendAsk = { root, workflowId: flags.workflow, file, source, ops, place, basedOn, cmdId: flags["cmd-id"], keepEffect: keyList(flags["keep-effect"]), accepts: keyList(flags.accept) }
        return amend(context, ask)
    },
})
