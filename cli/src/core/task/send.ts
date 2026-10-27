import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, posix, resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { contractProblems, normaliseRepoPath, parseContract, readContract } from "../../harness/contract.js"
import type { Contract } from "../../harness/contract.js"
import { openExistingLedger, openLedger, projectDir } from "../../harness/ledger.js"
import { acquireLeases, inTransaction } from "../../harness/leases.js"
import type { LeaseGrant } from "../../harness/leases.js"
import { loadOps } from "../../harness/ops.js"
import { createTask, getTask, recordEvent } from "../../harness/tasks.js"
import { worktreeSelector } from "../../harness/orca/client.js"
import type { TaskRow } from "../../harness/tasks.js"
import { assertRunPlace, freshRunId, locateWorkRoot, readUatRecord, uatBinding, uatContract } from "../../harness/work.js"
import type { WorkRoot } from "../../harness/work.js"
import { EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { repositoryRoot, resolveSha } from "../../shared/git.js"
import { callerRole, ROLE_ENV } from "../../shared/role.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
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
    readonly leases: LeaseGrant
    readonly root: string
    readonly uat: UatSent | null
    readonly launch: SeatStartData | null
}

/** The Work flow a `--uat` task walks: the record, the run folder it writes, and the Work root it was queued in. */
interface UatSent {
    readonly flow: string
    readonly record: string
    readonly run: string
    readonly workRoot: WorkRoot
}

/** The flags only a launch uses; each one without --launch is a usage error, not silently ignored. */
const LAUNCH_FLAGS = ["agent", "model", "effort", "worktree", "run", "timeout-ms"] as const

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
    if (previous.tryNo >= budget) {
        throw new Refusal("TRIES_EXHAUSTED", `task ${previous.id} was try ${String(previous.tryNo)} of ${String(budget)}; the try budget is spent, only the Supervisor or the owner raises it`)
    }
}

const roleMayLaunch = (): boolean => {
    const role = callerRole()
    return role === undefined || seatStartVerb.roles.includes(role)
}

/** The run folder a task's uat-flow check names, for a retry that must write the same one; undefined for a task that walks no flow. */
const runOfTask = (root: string, taskId: string): string | undefined => {
    const db = openExistingLedger(root)
    if (db === undefined) throw new Refusal("TASK_UNKNOWN", `no task ${taskId}: ${root} has no ledger yet`)
    try {
        return uatBinding(getTask(db, taskId).contract, loadOps())?.run
    } finally {
        db.close()
    }
}

/**
 * The contract of `--uat <flow>`, built from the Work record in the Work root and written to contracts/ of that project's state
 * folder. A retry walks into the run folder of the task it retries, so its allowPaths stay the same work. Refused when git
 * would commit the run folder or ignores the flow's evidence.yaml (assertRunPlace).
 */
const uatSend = async (cwd: string, flow: string, retryOf: string | undefined): Promise<{ readonly file: string; readonly contract: Contract; readonly uat: UatSent }> => {
    const workRoot = await locateWorkRoot(cwd)
    const root = workRoot.root
    const record = readUatRecord(root, flow)
    const previous = retryOf === undefined ? undefined : runOfTask(root, retryOf)
    if (retryOf !== undefined && previous === undefined) throw new Refusal("RETRY_NOT_SAME_WORK", `task ${retryOf} walks no Work flow; send this one as a new task`)
    const runId = previous === undefined ? freshRunId() : posix.basename(previous)
    const contract = parseContract(uatContract(record, { revision: await resolveSha(root, "HEAD"), runId }))
    const run = posix.join(record.place.runs, runId)
    await assertRunPlace(root, { record: record.place.record, run })
    const file = join(projectDir(root), "contracts", `uat-${flow.replace(/[^a-z0-9-]+/g, "-")}-${runId}.json`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(contract, null, 2)}\n`)
    return { file, contract, uat: { flow, record: record.place.record, run, workRoot } }
}

/** Refuses launch flags (`given`) without --launch, a launch from a role that may not start a seat, and --agent without --model or back. */
const assertLaunchFlags = (launch: boolean, given: readonly string[], agent: string | undefined, model: string | undefined): void => {
    if (!launch) {
        const named = given.map((name) => `--${name}`).join(", ")
        if (given.length > 0) throw new Refusal("CLI_USAGE", `${named} only go with --launch`, EXIT_USAGE)
    } else if (!roleMayLaunch()) {
        // An inline agent sends its own task; launching an Orca seat stays with the roles of seat start.
        throw new Refusal("ROLE_REFUSED", `task send --launch starts a seat, which is for ${seatStartVerb.roles.join(", ")}; ${ROLE_ENV} says this caller is ${String(callerRole())}`)
    } else if ((agent === undefined) !== (model === undefined)) {
        throw new Refusal("CLI_USAGE", "task send --launch takes both --agent and --model, or neither and the router picks them", EXIT_USAGE)
    }
}

/** `starci task send <contract>`: registers a fit contract as a queued task and leases its allowPaths; --launch also starts its worker seat. */
export const taskSendVerb = defineVerb({
    path: ["task", "send"],
    summary: "queue a fit contract (or --uat: one built from a Work flow, in its Work root) as a task and lease its allowPaths; --launch also starts an Orca worker on it; prints the task id",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["kernel", "supervisor", "owner", "coordinator", "agent"],
    schema: "starci/task-send@1",
    flags: {
        contract: { kind: "string", summary: "the contract json file (or --uat instead)", positional: true },
        uat: { kind: "string", summary: "instead of a contract: walk the Work flow uat.<feature>.<flow>; the task is queued in the Work root (the app's hfs.json work.root, or this repository)" },
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
        assertLaunchFlags(flags.launch, LAUNCH_FLAGS.filter((name) => flags[name] !== undefined), flags.agent, flags.model)
        const timeoutMs = parseTimeout(flags["timeout-ms"])
        if ((flags.contract === undefined) === (flags.uat === undefined)) throw new Refusal("CLI_USAGE", "task send takes a contract file or --uat <flow>, exactly one of the two", EXIT_USAGE)
        const fromWork = flags.uat === undefined ? undefined : await uatSend(context.cwd, flags.uat, flags["retry-of"])
        const file = fromWork?.file ?? resolve(context.cwd, flags.contract ?? "")
        const contract = fromWork?.contract ?? readContract(file)
        // A uat task is queued where its Work is, so its run, its record and its harness commit share one repository.
        const root = fromWork?.uat.workRoot.root ?? (await repositoryRoot(context.cwd))
        const problems = contractProblems(contract, loadOps())
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
            // The task and its leases land together: a lease conflict leaves no queued task behind.
            const { task, leases } = inTransaction(db, () => {
                if (retryOf !== undefined) assertRetry(db, contract, retryOf)
                const created = createTask(db, contract, { worktree: checkout, ...(workflowId === undefined ? {} : { workflowId }), ...(retryOf === undefined ? {} : { retryOf }) })
                return { task: created, leases: acquireLeases(db, created) }
            })
            sent = { task: task.id, status: task.status, label: task.label, hash: task.contractHash, tryNo: task.tryNo, retryOf: task.retryOf, workflow: task.workflowId, contract: file, leases, root, uat: fromWork?.uat ?? null }
        } finally {
            db.close()
        }
        const where = sent.uat === null ? [] : [`walks ${sent.uat.flow} into ${sent.uat.run}; queued in the Work root ${root} (from ${sent.uat.workRoot.from}): file its result and verify it there`]
        if (!flags.launch) return { data: { ...sent, launch: null } satisfies SendData, message: [sent.task, ...where].join("\n") }
        try {
            const choice = chooseLaunch(root, sent.task, flags, true)
            const started = await startSeat({ root, cwd: context.cwd, task: sent.task, agent: choice.agent, model: choice.model, effort: choice.effort, pick: choice.pick, worktree: flags.worktree, run: flags.run, timeoutMs })
            return { data: { ...sent, status: "running", launch: started.data } satisfies SendData, message: [sent.task, ...where, ...routeLines(choice), started.message].join("\n") }
        } catch (error: unknown) {
            if (!(error instanceof Refusal)) throw error
            throw new Refusal(error.code, `task ${sent.task} was sent, but its launch did not run a worker: ${error.message}`, error.exitCode)
        }
    },
})
