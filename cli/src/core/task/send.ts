import { resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { contractProblems, normaliseRepoPath, readContract } from "../../harness/contract.js"
import type { Contract } from "../../harness/contract.js"
import { openLedger } from "../../harness/ledger.js"
import { acquireLeases, inTransaction } from "../../harness/leases.js"
import type { LeaseGrant } from "../../harness/leases.js"
import { loadOps } from "../../harness/ops.js"
import { createTask, getTask } from "../../harness/tasks.js"
import type { TaskRow } from "../../harness/tasks.js"
import { EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import type { VerbResult } from "../../shared/verb.js"
import { chooseLaunch, parseTimeout, routeLines, startSeat } from "../seat/start.js"
import type { SeatStartData } from "../seat/start.js"

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
    readonly launch: SeatStartData | null
}

/** The flags only a launch uses; each one without --launch is a usage error, not silently ignored. */
const LAUNCH_FLAGS = ["agent", "model", "effort", "worktree", "run", "timeout-ms"] as const

const pathSet = (contract: Contract): string => [...new Set(contract.context.allowPaths.map(normaliseRepoPath))].sort().join("\n")

/**
 * Refuses a retry that is not one: a retry is the same work (same label, same allowPaths) after a try that did not land, and
 * it stays within the try budget of both the previous contract and the new one; raising the budget is not a retry's to do.
 */
const assertRetry = (db: DatabaseSync, contract: Contract, retryOf: string): void => {
    const previous = getTask(db, retryOf)
    if (previous.status === "done") throw new Refusal("RETRY_OF_DONE", `task ${previous.id} is done; there is nothing to retry`)
    if (previous.label !== contract.label || pathSet(previous.contract) !== pathSet(contract)) {
        throw new Refusal(
            "RETRY_NOT_SAME_WORK",
            `a retry repeats the same work: task ${previous.id} is ${previous.label} on ${previous.contract.context.allowPaths.join(", ")}, this contract is ${contract.label} on ${contract.context.allowPaths.join(", ")}; send it as a new task instead`,
        )
    }
    const budget = Math.min(previous.contract.budget.tries, contract.budget.tries)
    if (previous.tryNo >= budget) {
        throw new Refusal("TRIES_EXHAUSTED", `task ${previous.id} was try ${String(previous.tryNo)} of ${String(budget)}; the try budget is spent, only the Supervisor or the owner raises it`)
    }
}

/** `starci task send <contract>`: registers a fit contract as a queued task and leases its allowPaths; --launch also starts its worker seat. */
export const taskSendVerb = defineVerb({
    path: ["task", "send"],
    summary: "queue a fit contract as a task and lease its allowPaths; --launch also starts an Orca worker on it; prints the task id",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["kernel", "supervisor", "owner", "coordinator"],
    schema: "starci/task-send@1",
    flags: {
        contract: { kind: "string", summary: "the contract json file", required: true, positional: true },
        workflow: { kind: "string", summary: "the workflow the task belongs to" },
        "retry-of": { kind: "string", summary: "the task this one retries (same label and allowPaths); it gets the next try number" },
        launch: { kind: "boolean", summary: "then start a worker seat on the task, as seat start does (the router picks agent and model unless both are given)" },
        agent: { kind: "string", summary: "with --launch: the Orca agent id (claude, codex, ...), together with --model" },
        model: { kind: "string", summary: "with --launch: the provider model id, together with --agent" },
        effort: { kind: "string", summary: "with --launch: the reasoning effort of the model" },
        worktree: { kind: "string", summary: "with --launch: where the worker runs, a path or an Orca worktree selector" },
        run: { kind: "string", summary: "with --launch: an existing Orca Run id (default: create one)" },
        "timeout-ms": { kind: "string", summary: "with --launch: how long Orca may wait for a ready worker" },
    },
    run: async (context, flags): Promise<VerbResult<SendData>> => {
        if (!flags.launch) {
            const given = LAUNCH_FLAGS.filter((name) => flags[name] !== undefined)
            if (given.length > 0) throw new Refusal("CLI_USAGE", `${given.map((name) => `--${name}`).join(", ")} only go with --launch`, EXIT_USAGE)
        } else if ((flags.agent === undefined) !== (flags.model === undefined)) {
            throw new Refusal("CLI_USAGE", "task send --launch takes both --agent and --model, or neither and the router picks them", EXIT_USAGE)
        }
        const timeoutMs = parseTimeout(flags["timeout-ms"])
        const file = resolve(context.cwd, flags.contract)
        const contract = readContract(file)
        const problems = contractProblems(contract, loadOps())
        if (problems.length > 0) throw new Refusal("CONTRACT_UNFIT", `the contract is not fit to send (see starci contract check):\n${problems.join("\n")}`)
        const root = await repositoryRoot(context.cwd)
        const db = openLedger(root)
        let sent: Omit<SendData, "launch">
        try {
            const workflowId = flags.workflow
            const retryOf = flags["retry-of"]
            if (workflowId !== undefined && db.prepare("SELECT id FROM workflows WHERE id = ?").get(workflowId) === undefined) {
                throw new Refusal("WORKFLOW_UNKNOWN", `no workflow ${workflowId} in this project's ledger`)
            }
            // The task and its leases land together: a lease conflict leaves no queued task behind.
            const { task, leases } = inTransaction(db, () => {
                if (retryOf !== undefined) assertRetry(db, contract, retryOf)
                const created = createTask(db, contract, { ...(workflowId === undefined ? {} : { workflowId }), ...(retryOf === undefined ? {} : { retryOf }) })
                return { task: created, leases: acquireLeases(db, created) }
            })
            sent = { task: task.id, status: task.status, label: task.label, hash: task.contractHash, tryNo: task.tryNo, retryOf: task.retryOf, workflow: task.workflowId, contract: file, leases }
        } finally {
            db.close()
        }
        if (!flags.launch) return { data: { ...sent, launch: null } satisfies SendData, message: sent.task }
        try {
            const choice = chooseLaunch(root, sent.task, flags, true)
            const started = await startSeat({ root, cwd: context.cwd, task: sent.task, agent: choice.agent, model: choice.model, effort: choice.effort, pick: choice.pick, worktree: flags.worktree, run: flags.run, timeoutMs })
            return { data: { ...sent, status: "running", launch: started.data } satisfies SendData, message: [sent.task, ...routeLines(choice), started.message].join("\n") }
        } catch (error: unknown) {
            if (!(error instanceof Refusal)) throw error
            throw new Refusal(error.code, `task ${sent.task} was sent, but its launch did not run a worker: ${error.message}`, error.exitCode)
        }
    },
})
