import { randomBytes } from "node:crypto"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { awaitsOwner, getDecision } from "../../harness/coordinator-commands.js"
import { currentGoal } from "../../harness/goal.js"
import { getWorkflow } from "../../harness/workflow.js"
import { asRefusal, Refusal } from "../../shared/errors.js"
import { assertRole, ROLE_ENV } from "../../shared/role.js"
import { spellingOf } from "../../shared/verb.js"
import type { RawFlagValues, VerbContext } from "../../shared/verb.js"
import type { ActionResult, ConfigSet, Ruling } from "./contract.js"
import { placeHolding, places, readLedger } from "./places.js"

/** The workflow actions of `POST /api/workflows/:project/:workflow/:action`. */
export const WORKFLOW_ACTIONS = ["pause", "resume", "stop-graceful", "stop-hard"] as const

/** One workflow action. */
export type WorkflowAction = (typeof WORKFLOW_ACTIONS)[number]

// Writes run one after another, as the owner's typed verbs would: two clicks never race in one ledger.
let queue: Promise<unknown> = Promise.resolve()

/**
 * Runs one verb of this build (by its spelling) in-process as the owner, from `cwd`: the verb's roles must list owner (ROLE_REFUSED otherwise), and what it
 * refuses comes back as a red ActionResult with its code. A verb whose own verdict is red (exit 1) is not ok.
 */
const runAsOwner = async (spelling: string, context: VerbContext, cwd: string, flags: RawFlagValues): Promise<ActionResult> => {
    const run = async (): Promise<ActionResult> => {
        try {
            const verb = context.verbs.find((candidate) => spellingOf(candidate) === spelling)
            if (verb === undefined) throw new Refusal("VERB_MISSING", `this build offers no starci ${spelling} here`)
            assertRole(verb, { ...process.env, [ROLE_ENV]: "owner" })
            const result = await verb.run({ ...context, cwd }, flags)
            return { ok: (result.exitCode ?? 0) === 0, code: null, message: result.message }
        } catch (error: unknown) {
            const refusal = asRefusal(error)
            return { ok: false, code: refusal.code, message: refusal.message }
        }
    }
    const next = queue.then(run, run)
    queue = next
    return next
}

/** A refusal the server raises before any verb runs (an unknown workflow, a decision that is not the owner's), as an ActionResult. */
const refused = (error: unknown): ActionResult => {
    const refusal = asRefusal(error)
    return { ok: false, code: refusal.code, message: refusal.message }
}

const holdsWorkflow = (id: string) => (db: DatabaseSync): boolean => {
    try {
        getWorkflow(db, id)
        return true
    } catch {
        return false
    }
}

/** `POST /api/workflows/:project/:workflow/:action`: `workflow pause`, `workflow resume` or `workflow stop --graceful|--hard`, in the workflow's repository. */
export const workflowAction = async (context: VerbContext, project: string, workflow: string, action: WorkflowAction): Promise<ActionResult> => {
    let repo: string
    try {
        repo = placeHolding(await places(), project, holdsWorkflow(workflow), "WORKFLOW_UNKNOWN", `workflow ${workflow}`).repo
    } catch (error: unknown) {
        return refused(error)
    }
    switch (action) {
        case "pause":
            return runAsOwner("workflow pause", context, repo, { workflow, reason: "paused by the owner from starci ui" })
        case "resume":
            return runAsOwner("workflow resume", context, repo, { workflow })
        case "stop-graceful":
        case "stop-hard":
            return runAsOwner("workflow stop", context, repo, { workflow, graceful: action === "stop-graceful", hard: action === "stop-hard" })
    }
}

const holdsDecision = (id: string) => (db: DatabaseSync): boolean => getDecision(db, id) !== undefined

/**
 * `POST /api/inbox/:project/:decision/ruling`: the owner's ruling, relayed as the Supervisor relays one (ops/coordinators/supervisor.md):
 * a `goal-change` command of the decision's workflow that keeps its goal, acceptance and scope, carries the chosen option and the
 * note as its note and answers the decision, applied through `supervisor submit` as the owner.
 */
export const rule = async (context: VerbContext, project: string, decisionId: string, ruling: Ruling): Promise<ActionResult> => {
    let file: string
    let repo: string
    try {
        repo = placeHolding(await places(), project, holdsDecision(decisionId), "DECISION_UNKNOWN", `decision ${decisionId}`).repo
        const command = readLedger(
            repo,
            (db) => {
                const decision = getDecision(db, decisionId)
                if (decision === undefined) throw new Refusal("DECISION_UNKNOWN", `no decision ${decisionId}`)
                if (decision.answeredBy !== null) throw new Refusal("STALE", `decision ${decisionId} was answered already by ${decision.answeredBy}`)
                if (!awaitsOwner(decision)) throw new Refusal("DECISION_NOT_OWNERS", `decision ${decisionId} is the Supervisor's to rule, not the owner's`)
                const workflow = getWorkflow(db, decision.workflowId)
                const goal = currentGoal(db, workflow.id, workflow.header, workflow.goalVersion)
                const note = [ruling.option === null ? null : `option ${ruling.option}`, ruling.note.trim() === "" ? null : ruling.note.trim()].filter((part) => part !== null).join(": ")
                return {
                    schema: "starci/command@1",
                    cmdId: `owner-ruling-${decisionId}-${randomBytes(3).toString("hex")}`,
                    kind: "goal-change",
                    workflow: workflow.id,
                    basedOn: { goal: goal.version },
                    answers: [decisionId],
                    note: `owner ruling: ${note === "" ? "proceed" : note}`,
                    goal: goal.text,
                    ...(goal.acceptance.length === 0 ? {} : { acceptance: goal.acceptance }),
                    ...(goal.scope === null ? {} : { scope: goal.scope }),
                }
            },
            undefined,
        )
        if (command === undefined) throw new Refusal("DECISION_UNKNOWN", `no decision ${decisionId} in project ${project}`)
        file = join(mkdtempSync(join(tmpdir(), "starci-ui-")), `${command.cmdId}.json`)
        writeFileSync(file, JSON.stringify(command, null, 2))
    } catch (error: unknown) {
        return refused(error)
    }
    try {
        return await runAsOwner("supervisor submit", context, repo, { file, project: undefined })
    } finally {
        rmSync(join(file, ".."), { recursive: true, force: true })
    }
}

/** `POST /api/config`: `config set <key> <value>` as the owner, the value given as JSON. */
export const setConfig = async (context: VerbContext, change: ConfigSet): Promise<ActionResult> =>
    runAsOwner("config set", context, context.cwd, { key: change.key, value: JSON.stringify(change.value) })
