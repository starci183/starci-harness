import { resolve } from "node:path"
import { openLedger } from "../../harness/ledger.js"
import { planPlace } from "../../harness/graph.js"
import { loadOps } from "../../harness/ops.js"
import { DISPATCHING, recordReplan, snapshotOf } from "../../harness/workflow.js"
import { Refusal } from "../../shared/errors.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { cancelTasks, readSnapshot, reconcile, reportMessage, reportOf, stepWorkflow } from "./engine.js"
import type { StepAction } from "./engine.js"
import { buildReplan, classCounts, classificationTable, readReplanSource } from "./replan.js"

/**
 * `starci workflow amend <id> --change <file>`: the Kernel's replan. It builds the new graph from a change file (add, edit,
 * remove, retry) or a whole workflow file, classifies every task (keep, continue, redo, add, drop) by node hash, records graph
 * version n+1 with that classification, cancels the live tasks of redo and drop through task cancel, and resumes dispatch.
 */
export const workflowAmendVerb = defineVerb({
    path: ["workflow", "amend"],
    summary: "replan a workflow from a change file (add, edit, remove, retry) or a whole workflow file: keep/continue/redo/add/drop, cancel what is dropped or redone, resume",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["owner", "kernel", "supervisor"],
    schema: "starci/workflow-amend@1",
    flags: {
        workflow: { kind: "string", summary: "the workflow id", required: true, positional: true },
        change: { kind: "string", summary: "a starci/workflow-change@1 file, or a whole starci/workflow@1 file of the same id", required: true },
    },
    run: async (context, flags) => {
        const place = await planPlace(context.cwd)
        const root = place.repo
        const file = resolve(context.cwd, flags.change)
        const ops = loadOps()
        const source = await readReplanSource(file, ops, place)
        const db = openLedger(root)
        const { replan, workflow } = (() => {
            try {
                const snapshot = snapshotOf(db, flags.workflow)
                if (snapshot.workflow.status === "stopping" || snapshot.workflow.status === "stopped") {
                    throw new Refusal("WORKFLOW_STOPPED", `workflow ${snapshot.workflow.id} is ${snapshot.workflow.status}; a stopped workflow is not amended`)
                }
                const built = buildReplan(db, snapshot, file, source, ops, place)
                if (built.unchanged) throw new Refusal("NOTHING_TO_AMEND", `${file} changes nothing in workflow ${snapshot.workflow.id} (graph v${String(snapshot.workflow.graphVersion)})`)
                return { replan: built, workflow: recordReplan(db, snapshot.workflow, built.header, built.nodes, built.reason, built.classification) }
            } finally {
                db.close()
            }
        })()
        const doomed = replan.classification.flatMap((row) => (row.cancel === null ? [] : [{ key: row.key, task: row.cancel, why: row.class }]))
        const actions: StepAction[] = await cancelTasks(context, doomed, `workflow ${workflow.id} amend to graph v${String(workflow.graphVersion)}: ${doomed.map((row) => `${row.key} ${row.why}`).join(", ")}`)
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
        return { data: { workflow: workflow.id, graphVersion: workflow.graphVersion, goalVersion: workflow.goalVersion, reason: replan.reason, classification: replan.classification, notes: replan.notes, report }, message }
    },
})
