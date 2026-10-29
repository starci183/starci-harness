import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import type { DatabaseSync } from "node:sqlite"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"
import { underPaths } from "./contract.js"
import { isGeneratedKey, isRelayKey, scopeSchema } from "./graph.js"
import type { PlanNode, Scope, WorkflowHeader } from "./graph.js"
import { inTransaction, now } from "./ledger.js"
import { recordEvent } from "./tasks.js"

/** The schema tag of a goal-change file: the Supervisor's (or the owner's) next goal of a workflow. */
export const GOAL_CHANGE_SCHEMA = "starci/goal-change@1"

const goalChangeSchema = z.strictObject({
    schema: z.literal(GOAL_CHANGE_SCHEMA),
    workflow: z.string().min(1),
    cmdId: z.string().min(1).max(128),
    basedOn: z.number().int().min(1).optional(),
    goal: z.string().min(1),
    acceptance: z.array(z.string().min(1)).optional(),
    scope: scopeSchema.optional(),
})

/** A goal-change file as read. */
export type GoalChange = z.infer<typeof goalChangeSchema>

/** One version of a workflow's goal: its text, the acceptance ids it must meet and its scope ceiling. */
export interface Goal {
    readonly version: number
    readonly text: string
    readonly acceptance: readonly string[]
    readonly scope: Scope | null
    readonly cmdId: string | null
    readonly role: string | null
    readonly createdAt: string | null
}

/**
 * Goal history lives in its own table, made on first use here (the ledger's base schema stays owned by ledger.ts): one row per
 * goal version, with the command file that produced it and its sha256, written in the same transaction as the version move.
 */
const GOALS_TABLE = `
CREATE TABLE IF NOT EXISTS goals (
  workflow_id TEXT NOT NULL REFERENCES workflows(id), goal_version INTEGER NOT NULL, text TEXT NOT NULL,
  acceptance_json TEXT NOT NULL, scope_json TEXT, cmd_id TEXT, command_json TEXT, command_sha256 TEXT, role TEXT,
  created_at TEXT NOT NULL, PRIMARY KEY (workflow_id, goal_version));
CREATE UNIQUE INDEX IF NOT EXISTS goals_cmd ON goals (workflow_id, cmd_id) WHERE cmd_id IS NOT NULL;
`

const ensureGoals = (db: DatabaseSync): void => {
    db.exec(GOALS_TABLE)
}

const text = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value))

const toGoal = (row: Record<string, unknown>): Goal => ({
    version: Number(row.goal_version),
    text: text(row.text),
    acceptance: JSON.parse(text(row.acceptance_json)) as string[],
    scope: row.scope_json === null || row.scope_json === undefined ? null : scopeSchema.parse(JSON.parse(text(row.scope_json))),
    cmdId: row.cmd_id === null || row.cmd_id === undefined ? null : text(row.cmd_id),
    role: row.role === null || row.role === undefined ? null : text(row.role),
    createdAt: text(row.created_at),
})

/** The goal a workflow header carries, as goal version `version`. */
const goalOfHeader = (header: WorkflowHeader, version: number): Goal => ({
    version,
    text: header.goal,
    acceptance: header.acceptance ?? [],
    scope: header.scope ?? null,
    cmdId: null,
    role: null,
    createdAt: null,
})

/** Records goal version 1 of a newly defined workflow, from its header; call it in the define transaction. */
export const recordFirstGoal = (db: DatabaseSync, workflowId: string, header: WorkflowHeader): void => {
    ensureGoals(db)
    db.prepare("INSERT OR IGNORE INTO goals (workflow_id, goal_version, text, acceptance_json, scope_json, created_at) VALUES (?, 1, ?, ?, ?, ?)").run(
        workflowId,
        header.goal,
        JSON.stringify(header.acceptance ?? []),
        header.scope === undefined ? null : JSON.stringify(header.scope),
        now(),
    )
}

/**
 * A workflow's current goal: its newest goal row, or (a workflow defined before goals were versioned) the goal its header
 * carries at the workflow's goal version.
 */
export const currentGoal = (db: DatabaseSync, workflowId: string, header: WorkflowHeader, goalVersion: number): Goal => {
    ensureGoals(db)
    const row = db.prepare("SELECT * FROM goals WHERE workflow_id = ? ORDER BY goal_version DESC LIMIT 1").get(workflowId)
    return row === undefined ? goalOfHeader(header, goalVersion) : toGoal(row)
}

/** Every recorded goal version of a workflow, oldest first. */
export const goalHistory = (db: DatabaseSync, workflowId: string): Goal[] => {
    ensureGoals(db)
    return db.prepare("SELECT * FROM goals WHERE workflow_id = ? ORDER BY goal_version").all(workflowId).map(toGoal)
}

/** A goal-change file read and validated, with the sha256 of its bytes. */
export const readGoalChange = (file: string): { readonly change: GoalChange; readonly sha256: string; readonly raw: string } => {
    let raw: string
    try {
        raw = readFileSync(file, "utf8")
    } catch (error: unknown) {
        throw new Refusal("GOAL_UNREADABLE", `${file} is not readable: ${error instanceof Error ? error.message : String(error)}`)
    }
    let document: unknown
    try {
        document = parse(raw)
    } catch (error: unknown) {
        throw new Refusal("GOAL_UNREADABLE", `${file} is neither yaml nor json: ${error instanceof Error ? error.message : String(error)}`)
    }
    const parsed = goalChangeSchema.safeParse(document)
    if (!parsed.success) throw new Refusal("GOAL_INVALID", `${file} is not a valid ${GOAL_CHANGE_SCHEMA} file:\n${z.prettifyError(parsed.error)}`)
    return { change: parsed.data, sha256: createHash("sha256").update(raw).digest("hex"), raw }
}

/** What recording a goal change did: the goal now current and whether this command had been applied already. */
export interface GoalRecorded {
    readonly goal: Goal
    readonly duplicate: boolean
}

/**
 * Records goal n+1 of a workflow from a goal-change command, compare-and-swap on `basedOn` (STALE when the goal moved on).
 * Idempotent by cmdId: the same command again returns the goal it made; a cmdId reused for another command is refused. The
 * header's goal, acceptance and scope move with it, so the next graph the Kernel submits is held to the new ceiling.
 */
export const recordGoalChange = (
    db: DatabaseSync,
    workflow: { readonly id: string; readonly header: WorkflowHeader },
    command: { readonly change: GoalChange; readonly sha256: string },
    basedOn: number,
    role: string,
): GoalRecorded =>
    inTransaction(db, () => {
        ensureGoals(db)
        const { change, sha256 } = command
        const seen = db.prepare("SELECT * FROM goals WHERE workflow_id = ? AND cmd_id = ?").get(workflow.id, change.cmdId)
        if (seen !== undefined) {
            if (text(seen.command_sha256) !== sha256) throw new Refusal("CMD_REUSED", `command ${change.cmdId} was applied to ${workflow.id} already with other content; give a new cmdId`)
            return { goal: toGoal(seen), duplicate: true }
        }
        const row = db.prepare("SELECT goal_version, goal_json FROM workflows WHERE id = ?").get(workflow.id)
        if (row === undefined) throw new Refusal("WORKFLOW_UNKNOWN", `no workflow ${workflow.id} in this project's ledger`)
        const current = currentGoal(db, workflow.id, workflow.header, Number(row.goal_version))
        if (current.version !== basedOn) throw new Refusal("STALE", `workflow ${workflow.id} is at goal v${String(current.version)}, not v${String(basedOn)}; read it again (starci workflow status ${workflow.id}) and resubmit`)
        if (current.cmdId === null && db.prepare("SELECT 1 FROM goals WHERE workflow_id = ? AND goal_version = ?").get(workflow.id, current.version) === undefined) {
            // A workflow from before goals were versioned: its current goal becomes a row first, so the history is whole.
            db.prepare("INSERT INTO goals (workflow_id, goal_version, text, acceptance_json, scope_json, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
                workflow.id,
                current.version,
                current.text,
                JSON.stringify(current.acceptance),
                current.scope === null ? null : JSON.stringify(current.scope),
                now(),
            )
        }
        const version = current.version + 1
        const at = now()
        db.prepare("INSERT INTO goals (workflow_id, goal_version, text, acceptance_json, scope_json, cmd_id, command_json, command_sha256, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
            workflow.id,
            version,
            change.goal,
            JSON.stringify(change.acceptance ?? []),
            change.scope === undefined ? null : JSON.stringify(change.scope),
            change.cmdId,
            JSON.stringify(change),
            sha256,
            role,
            at,
        )
        const header: WorkflowHeader = withGoal(JSON.parse(text(row.goal_json)) as WorkflowHeader, { text: change.goal, acceptance: change.acceptance ?? [], scope: change.scope ?? null })
        db.prepare("UPDATE workflows SET goal_json = ?, goal_version = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(header), version, at, workflow.id)
        recordEvent(db, "goal-changed", workflow.id, { goalVersion: version, basedOn, cmdId: change.cmdId, sha256, role })
        const recorded = db.prepare("SELECT * FROM goals WHERE workflow_id = ? AND goal_version = ?").get(workflow.id, version)
        if (recorded === undefined) throw new Refusal("LEDGER_DRIFT", `goal v${String(version)} of ${workflow.id} was not recorded`)
        return { goal: toGoal(recorded), duplicate: false }
    })

/** A header carrying a goal's text, acceptance and scope in place of its own; a replan's header always carries the current goal. */
export const withGoal = (header: WorkflowHeader, goal: Pick<Goal, "text" | "acceptance" | "scope">): WorkflowHeader => {
    const rest: WorkflowHeader = { ...header }
    delete rest.acceptance
    delete rest.scope
    return {
        ...rest,
        goal: goal.text,
        ...(goal.acceptance.length === 0 ? {} : { acceptance: [...goal.acceptance] }),
        ...(goal.scope === null ? {} : { scope: goal.scope }),
    }
}

/**
 * The ways a graph exceeds a scope ceiling: a task whose allowPaths leave the scope's path prefixes (a relay node aside: it
 * writes what a shared need's owner built), or more tasks than its maxTasks (the generated revert and relay nodes not
 * counted). Empty when the graph fits or the goal has no ceiling.
 */
export const scopeProblems = (nodes: readonly Pick<PlanNode, "key" | "contract">[], scope: Scope | null | undefined): string[] => {
    if (scope === null || scope === undefined) return []
    const problems: string[] = []
    const { paths, maxTasks } = scope
    if (paths !== undefined) {
        for (const node of nodes.filter((one) => !isRelayKey(one.key))) {
            const outside = node.contract.context.allowPaths.filter((path) => !underPaths(path, paths))
            if (outside.length > 0) problems.push(`task ${node.key} writes ${outside.join(", ")}, outside the scope ${paths.join(", ")}`)
        }
    }
    const counted = nodes.filter((node) => !isGeneratedKey(node.key)).length
    if (maxTasks !== undefined && counted > maxTasks) problems.push(`the graph holds ${String(counted)} tasks, over the scope's maxTasks ${String(maxTasks)}`)
    return problems
}

/** Refuses SCOPE_EXCEEDED, naming every problem, when a graph exceeds its goal's ceiling; the Kernel escalates (kind scope). */
export const assertScope = (workflowId: string, nodes: readonly Pick<PlanNode, "key" | "contract">[], goal: Pick<Goal, "version" | "scope">): void => {
    const problems = scopeProblems(nodes, goal.scope)
    if (problems.length === 0) return
    throw new Refusal("SCOPE_EXCEEDED", `the graph of ${workflowId} exceeds the scope ceiling of goal v${String(goal.version)}; escalate (kind scope) instead:\n${problems.map((problem) => "- " + problem).join("\n")}`)
}

/** The nodes of a graph the deliverables rule reads: each key and the paths it owns. */
type Owned = readonly Pick<PlanNode, "key" | "contract">[]

/**
 * The deliverables of the goal a replan would drop. The task keys of a graph planned under the current goal version are what
 * that goal asks for, so a replan removes one only when it is a revert or relay node the harness generated, or when keys the replan
 * adds take it over (every allowPath of the removed key lies under theirs). The first replan after a goal change answers that
 * change: the graph it replaces was planned under an older goal version (`plannedUnder`), so it may drop any key.
 */
export const droppedDeliverables = (before: Owned, after: Owned, plannedUnder: number, goal: Pick<Goal, "version">): string[] => {
    if (plannedUnder < goal.version) return []
    const previous = new Set(before.map((node) => node.key))
    const next = new Set(after.map((node) => node.key))
    const added = after.filter((node) => !previous.has(node.key) && !isGeneratedKey(node.key)).flatMap((node) => node.contract.context.allowPaths)
    return before
        .filter((node) => !next.has(node.key) && !isGeneratedKey(node.key))
        .filter((node) => !node.contract.context.allowPaths.every((path) => underPaths(path, added)))
        .map((node) => node.key)
}

/**
 * Refuses GOAL_SHRUNK, naming the keys, when a replan drops a deliverable of the current goal (droppedDeliverables): no replan
 * shrinks the owner's goal on its own. The Kernel escalates (kind scope), and the Supervisor's goal-change lets the next replan drop it.
 */
export const assertDeliverables = (workflowId: string, before: Owned, after: Owned, plannedUnder: number, goal: Pick<Goal, "version">): void => {
    const dropped = droppedDeliverables(before, after, plannedUnder, goal)
    if (dropped.length === 0) return
    throw new Refusal(
        "GOAL_SHRUNK",
        `the replan of ${workflowId} drops ${dropped.join(", ")}, planned under goal v${String(goal.version)} and taken over by no added task; a replan never shrinks the owner's goal: escalate (kind scope) to the Supervisor, whose goal-change lets the next replan drop it`,
    )
}
