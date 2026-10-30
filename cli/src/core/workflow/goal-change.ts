import { resolve } from "node:path"
import { readGoalChange, recordGoalChange, scopeProblems } from "../../harness/goal.js"
import { openLedger } from "../../harness/ledger.js"
import { snapshotOf } from "../../harness/workflow.js"
import { Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { callerRole } from "../../shared/role.js"
import type { VerbContext, VerbResult } from "../../shared/verb.js"

/** Who may change a workflow's goal: the owner and the Supervisor, never the Kernel whose graph answers it. */
const GOAL_CHANGERS = ["owner", "supervisor"] as const

/**
 * `starci workflow amend <id> --goal <file> --based-on <n>`: records goal n+1 of a workflow from a starci/goal-change@1 file
 * (goal text, acceptance ids, scope ceiling: path prefixes and max tasks), compare-and-swap on goal n (STALE when the goal moved)
 * and idempotent by the file's cmdId. The graph is not touched: the Kernel answers with a desired graph (workflow amend
 * --desired), which is held to the new ceiling.
 */
export const regoal = async (context: VerbContext, workflowId: string, goalFile: string, basedOnFlag: string | undefined): Promise<VerbResult<unknown>> => {
    const role = callerRole()
    if (role !== undefined && !(GOAL_CHANGERS as readonly string[]).includes(role)) throw new Refusal("ROLE_REFUSED", `workflow amend --goal is for ${GOAL_CHANGERS.join(", ")}; STARCI_ROLE says this caller is ${role}`)
    const basedOn = Number(basedOnFlag)
    if (basedOnFlag === undefined || !Number.isInteger(basedOn) || basedOn < 1) throw new Refusal("FLAG_INVALID", `--goal needs --based-on <goal version> (a whole number from 1), not ${String(basedOnFlag)}`)
    const file = resolve(context.cwd, goalFile)
    const command = readGoalChange(file)
    if (command.change.workflow !== workflowId) throw new Refusal("WORKFLOW_MISMATCH", `${file} changes the goal of ${command.change.workflow}, not ${workflowId}`)
    if (command.change.basedOn !== undefined && command.change.basedOn !== basedOn) {
        throw new Refusal("FLAG_INVALID", `${file} says basedOn ${String(command.change.basedOn)}, the flag says ${String(basedOn)}`)
    }
    const db = openLedger(await repositoryRoot(context.cwd))
    try {
        const { workflow, nodes } = snapshotOf(db, workflowId)
        if (workflow.status === "stopping" || workflow.status === "stopped") throw new Refusal("WORKFLOW_STOPPED", `workflow ${workflow.id} is ${workflow.status}; its goal is not changed`)
        const recorded = recordGoalChange(db, workflow, command, basedOn, role ?? "owner")
        const { goal } = recorded
        const outside = scopeProblems(nodes, goal.scope)
        const maxTasks = goal.scope?.maxTasks === undefined ? "any number of" : String(goal.scope.maxTasks)
        const scope = goal.scope === null ? "no scope ceiling" : `scope ${goal.scope.paths?.join(", ") ?? "any path"}, at most ${maxTasks} tasks`
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
}
