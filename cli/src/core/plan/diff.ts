import { resolve } from "node:path"
import { openExistingLedger } from "../../harness/ledger.js"
import { loadOps } from "../../harness/ops.js"
import { snapshotOf } from "../../harness/workflow.js"
import { Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { buildReplan, classCounts, classificationTable } from "../workflow/replan.js"

/** `starci plan diff <workflow> --to <file>`: the keep, continue, redo, add and drop classification an amend would apply; changes nothing. */
export const planDiffVerb = defineVerb({
    path: ["plan", "diff"],
    summary: "classify a replan without applying it: keep, continue, redo, add or drop for every task, and the live tasks it would cancel",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: ["kernel", "supervisor", "owner"],
    schema: "starci/plan-diff@1",
    flags: {
        workflow: { kind: "string", summary: "the workflow id", required: true, positional: true },
        to: { kind: "string", summary: "a starci/workflow-change@1 file, or a whole starci/workflow@1 file of the same id", required: true },
    },
    run: async (context, flags) => {
        const db = openExistingLedger(await repositoryRoot(context.cwd))
        if (db === undefined) throw new Refusal("WORKFLOW_UNKNOWN", `no workflow ${flags.workflow}: this project has no ledger yet`)
        try {
            const snapshot = snapshotOf(db, flags.workflow)
            const file = resolve(context.cwd, flags.to)
            const replan = buildReplan(db, snapshot, file, loadOps())
            const cancels = replan.classification.flatMap((row) => (row.cancel === null ? [] : [row.cancel]))
            const message = [
                `diff of ${snapshot.workflow.id} graph v${String(snapshot.workflow.graphVersion)} -> v${String(snapshot.workflow.graphVersion + 1)}: ${replan.unchanged ? "no change" : classCounts(replan.classification)}`,
                classificationTable(replan.classification),
                ...replan.notes.map((note) => `note: ${note}`),
                cancels.length === 0 ? "cancels no task" : `would cancel ${cancels.join(", ")}`,
            ].join("\n")
            return { data: { workflow: snapshot.workflow.id, from: snapshot.workflow.graphVersion, unchanged: replan.unchanged, classification: replan.classification, cancels, notes: replan.notes }, message }
        } finally {
            db.close()
        }
    },
})
