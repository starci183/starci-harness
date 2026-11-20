import { resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { contractProblems, normaliseRepoPath, readContract } from "../../harness/contract.js"
import type { Contract } from "../../harness/contract.js"
import { inTransaction, openLedger } from "../../harness/ledger.js"
import { loadOps } from "../../harness/ops.js"
import { createTask, getTask, isAdmitted, recordEvent, tryAfter } from "../../harness/tasks.js"
import { worktreeSelector } from "../../harness/orca/client.js"
import type { TaskRow } from "../../harness/tasks.js"
import { EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { callerRole, ROLE_ENV } from "../../shared/role.js"
import { defineVerb } from "../../shared/verb.js"
import type { VerbResult } from "../../shared/verb.js"
import { chooseLaunch, parseTimeout, routeLines, seatStartVerb, startSeat } from "../seat/start.js"
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
    readonly root: string
    readonly launch: SeatStartData | null
}

/** The flags only a launch uses; each one without --launch is a usage error, not silently ignored. */
const LAUNCH_FLAGS = ["agent", "model", "effort", "worktree", "run", "timeout"] as const

const pathSet = (contract: Contract): string => [...new Set(contract.context.allowPaths.map(normaliseRepoPath))].sort((left, right) => left.localeCompare(right)).join("\n")

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
    if (tryAfter(db, previous) > budget) {
        throw new Refusal("TRIES_EXHAUSTED", `task ${previous.id} was try ${String(previous.tryNo)} of ${String(budget)}; the try budget is spent, only the Supervisor or the owner raises it`)
    }
}

const roleMayLaunch = (): boolean => {
    const role = callerRole()
    return role === undefined || seatStartVerb.roles.includes(role)
}

/** Refuses launch flags (`given`) on a send without --launch. */
const assertNoLaunchFlags = (given: readonly string[]): void => {
    if (given.length === 0) return
    const named = given.map((name) => `--${name}`).join(", ")
    throw new Refusal("CLI_USAGE", `${named} only go with --launch`, EXIT_USAGE)
}

/** Refuses a --launch from a role that may not start a seat, and --agent without --model or back. */
const assertLaunchAllowed = (agent: string | undefined, model: string | undefined): void => {
    if (!roleMayLaunch()) {
        // An inline agent sends its own task; launching an Orca seat stays with the roles of seat start.
        throw new Refusal("ROLE_REFUSED", `task send --launch starts a seat, which is for ${seatStartVerb.roles.join(", ")}; ${ROLE_ENV} says this caller is ${String(callerRole())}`)
    }
    if ((agent === undefined) !== (model === undefined)) {
        throw new Refusal("CLI_USAGE", "task send --launch takes both --agent and --model, or neither and the router picks them", EXIT_USAGE)
    }
}

/** `starci task send <contract>`: registers a fit contract as a queued task; --launch also starts its worker seat. */
export const taskSendVerb = defineVerb({
    path: ["task", "send"],
    summary: "queue a fit contract as a task; --launch also starts an Orca worker on it; prints the task id",
    effect: "host",
    roles: ["kernel", "supervisor", "owner", "coordinator", "agent"],
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
        timeout: { kind: "string", summary: "with --launch: seconds Orca may wait for a ready worker" },
    },
    run: async (context, flags): Promise<VerbResult<SendData>> => {
        if (flags.launch) assertLaunchAllowed(flags.agent, flags.model)
        else assertNoLaunchFlags(LAUNCH_FLAGS.filter((name) => flags[name] !== undefined))
        const timeoutMs = parseTimeout(flags.timeout)
        const file = resolve(context.cwd, flags.contract)
        const contract = readContract(file)
        const root = await repositoryRoot(context.cwd)
        // A contract this ledger admitted already (a retry of the same hash) keeps the context budget it passed then.
        const problems = contractProblems(contract, loadOps(), { budget: !isAdmitted(root, contract) })
        if (problems.length > 0) {
            // The refusal queues nothing, but the ledger keeps its evidence: what was refused and why.
            const db = openLedger(root)
            try {
                recordEvent(db, "send-refused", null, { contract: file, label: contract.label, allowPaths: contract.context.allowPaths, problems })
            } finally {
                db.close()
            }
            throw new Refusal("CONTRACT_UNFIT", `the contract is not fit to send (see starci contract check):\n${problems.join("\n")}`)
        }
        // The checkout the task's work lives in (its workflow's worktree wins, see createTask): where a launched worker runs when
        // --worktree names a folder, else this checkout. An Orca selector names no folder here, so this checkout stands until recordTaskWorktree corrects it.
        const selector = flags.launch ? worktreeSelector(flags.worktree, context.cwd, root) : undefined
        const checkout = selector?.startsWith("path:") === true ? await repositoryRoot(selector.slice("path:".length)) : root
        const db = openLedger(root)
        let sent: Omit<SendData, "launch">
        try {
            const workflowId = flags.workflow
            const retryOf = flags["retry-of"]
            if (workflowId !== undefined && db.prepare("SELECT id FROM workflows WHERE id = ?").get(workflowId) === undefined) {
                throw new Refusal("WORKFLOW_UNKNOWN", `no workflow ${workflowId} in this project's ledger`)
            }
            const task = inTransaction(db, () => {
                if (retryOf !== undefined) assertRetry(db, contract, retryOf)
                return createTask(db, contract, { worktree: checkout, ...(workflowId === undefined ? {} : { workflowId }), ...(retryOf === undefined ? {} : { retryOf }) })
            })
            sent = { task: task.id, status: task.status, label: task.label, hash: task.contractHash, tryNo: task.tryNo, retryOf: task.retryOf, workflow: task.workflowId, contract: file, root }
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
