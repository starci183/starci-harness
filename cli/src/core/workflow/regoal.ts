import { resolve } from "node:path"
import { readGoalChange, recordGoalChange, scopeProblems } from "../../harness/goal.js"
import { openLedger } from "../../harness/ledger.js"
import { snapshotOf } from "../../harness/workflow.js"
import { Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { callerRole } from "../../shared/role.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

/**
 * `starci workflow regoal <id> --goal <file> --based-on <n>`: records goal n+1 of a workflow from a starci/goal-change@1 file
 * (goal text, acceptance ids, scope ceiling: path prefixes and max tasks), compare-and-swap on goal n (STALE when the goal moved)
 * and idempotent by the file's cmdId. The graph is not touched: the Kernel answers with a desired graph (workflow amend
 * --desired), which is held to the new ceiling.
 */
export const workflowRegoalVerb = defineVerb({
    path: ["workflow", "regoal"],
    summary: "record goal n+1 of a workflow from a goal-change file (goal, acceptance, scope ceiling), based on goal n; idempotent by cmdId",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: ["owner", "supervisor"],
    schema: "starci/workflow-regoal@1",
    flags: {
        workflow: { kind: "string", summary: "the workflow id", required: true, positional: true },
        goal: { kind: "string", summary: "a starci/goal-change@1 file, yaml or json", required: true },
        "based-on": { kind: "string", summary: "the goal version this change was built on", required: true },
    },
    run: async (context, flags) => {
        const basedOn = Number(flags["based-on"])
        if (!Number.isInteger(basedOn) || basedOn < 1) throw new Refusal("FLAG_INVALID", `--based-on takes a goal version (a whole number from 1), not ${flags["based-on"]}`)
        const file = resolve(context.cwd, flags.goal)
        const command = readGoalChange(file)
        if (command.change.workflow !== flags.workflow) throw new Refusal("WORKFLOW_MISMATCH", `${file} changes the goal of ${command.change.workflow}, not ${flags.workflow}`)
        if (command.change.basedOn !== undefined && command.change.basedOn !== basedOn) {
            throw new Refusal("FLAG_INVALID", `${file} says basedOn ${String(command.change.basedOn)}, the flag says ${String(basedOn)}`)
        }
        const db = openLedger(await repositoryRoot(context.cwd))
        try {
            const { workflow, nodes } = snapshotOf(db, flags.workflow)
            if (workflow.status === "stopping" || workflow.status === "stopped") throw new Refusal("WORKFLOW_STOPPED", `workflow ${workflow.id} is ${workflow.status}; its goal is not changed`)
            const recorded = recordGoalChange(db, workflow, command, basedOn, callerRole() ?? "owner")
            const { goal } = recorded
            const outside = scopeProblems(nodes, goal.scope)
            const scope = goal.scope === null ? "no scope ceiling" : `scope ${goal.scope.paths?.join(", ") ?? "any path"}, at most ${goal.scope.maxTasks === undefined ? "any number of" : String(goal.scope.maxTasks)} tasks`
            const message = [
                `${recorded.duplicate ? "already recorded" : "recorded"}: workflow ${workflow.id} goal v${String(goal.version)} (${command.change.cmdId}): ${goal.text}`,
                `acceptance: ${goal.acceptance.join(", ") || "-"}; ${scope}`,
                ...outside.map((problem) => `outside the new ceiling: ${problem}`),
                `next: the Kernel submits the desired graph, starci workflow amend ${workflow.id} --desired <file> --based-on ${String(workflow.graphVersion)}`,
            ].join("\n")
            return { data: { workflow: workflow.id, goal, duplicate: recorded.duplicate, graphVersion: workflow.graphVersion, outside }, message }
        } finally {
            db.close()
        }
    },
})
