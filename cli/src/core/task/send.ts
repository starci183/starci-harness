import { resolve } from "node:path"
import { contractProblems, readContract } from "../../harness/contract.js"
import { openLedger } from "../../harness/ledger.js"
import { acquireLeases, inTransaction } from "../../harness/leases.js"
import type { LeaseGrant } from "../../harness/leases.js"
import { loadOps } from "../../harness/ops.js"
import { createTask } from "../../harness/tasks.js"
import type { TaskRow } from "../../harness/tasks.js"
import { Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

interface SendData {
    readonly task: string
    readonly status: TaskRow["status"]
    readonly label: string
    readonly hash: string
    readonly tryNo: number
    readonly retryOf: string | null
    readonly workflow: string | null
    readonly contract: string
    readonly leases: LeaseGrant
}

/** `starci task send <contract>`: registers a fit contract as a queued task and leases its allowPaths; launching a worker is a separate step. */
export const taskSendVerb = defineVerb({
    path: ["task", "send"],
    summary: "queue a fit contract as a task and lease its allowPaths; prints the task id",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: ["kernel", "owner", "coordinator"],
    schema: "starci/task-send@1",
    flags: {
        contract: { kind: "string", summary: "the contract json file", required: true, positional: true },
        workflow: { kind: "string", summary: "the workflow the task belongs to" },
        "retry-of": { kind: "string", summary: "the task this one retries; it gets the next try number" },
    },
    run: async (context, flags) => {
        const file = resolve(context.cwd, flags.contract)
        const contract = readContract(file)
        const problems = contractProblems(contract, loadOps())
        if (problems.length > 0) throw new Refusal("CONTRACT_UNFIT", `the contract is not fit to send (see starci contract check):\n${problems.join("\n")}`)
        const root = await repositoryRoot(context.cwd)
        const db = openLedger(root)
        try {
            const workflowId = flags.workflow
            const retryOf = flags["retry-of"]
            if (workflowId !== undefined && db.prepare("SELECT id FROM workflows WHERE id = ?").get(workflowId) === undefined) {
                throw new Refusal("WORKFLOW_UNKNOWN", `no workflow ${workflowId} in this project's ledger`)
            }
            // The task and its leases land together: a lease conflict leaves no queued task behind.
            const { task, leases } = inTransaction(db, () => {
                const created = createTask(db, contract, { ...(workflowId === undefined ? {} : { workflowId }), ...(retryOf === undefined ? {} : { retryOf }) })
                return { task: created, leases: acquireLeases(db, created) }
            })
            const data: SendData = {
                task: task.id,
                status: task.status,
                label: task.label,
                hash: task.contractHash,
                tryNo: task.tryNo,
                retryOf: task.retryOf,
                workflow: task.workflowId,
                contract: file,
                leases,
            }
            return { data, message: task.id }
        } finally {
            db.close()
        }
    },
})
