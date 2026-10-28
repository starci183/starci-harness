import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"
import { scopeSchema } from "./graph.js"
import { now } from "./ledger.js"
import { inTransaction } from "./leases.js"
import { isOwnerRequestId } from "./owner-requests.js"
import { assertRoute, isRouted, withRoutes } from "./routes.js"
import { recordEvent } from "./tasks.js"
import { getWorkflow } from "./workflow.js"
import type { WorkflowRow } from "./workflow.js"

/**
 * The seven commands of the seat tree (wave principle 5). Down: goal, goal-change, stop (Supervisor -> Kernel); the Kernel's own
 * graph: workflow-change; up: escalation and handoff (Kernel -> Supervisor). An Op's `result` is `task result`, not a command file.
 */
export const KERNEL_COMMANDS = ["workflow-change", "escalation", "handoff"] as const
export const SUPERVISOR_COMMANDS = ["goal", "goal-change", "stop"] as const

/** Who submits a command: the Kernel of a workflow, or the Supervisor of its project. */
export type CommandScope = "kernel" | "supervisor"

/** The kinds an escalation names (wave principle 5). */
export const ESCALATION_KINDS = ["budget", "scope", "conflict", "owner", "harness"] as const

/** The escalation kinds the owner rules: the Supervisor asks the owner in its terminal and relays the ruling (ops/coordinators/supervisor.md). */
const OWNER_RULED: readonly (typeof ESCALATION_KINDS)[number][] = ["owner", "harness"]

const commandSchema = z.strictObject({
    schema: z.literal("starci/command@1"),
    cmdId: z.string().regex(/^[\w.:-]{6,80}$/, "cmdId is 6..80 of letters, digits, _ . : -"),
    kind: z.enum([...KERNEL_COMMANDS, ...SUPERVISOR_COMMANDS]),
    workflow: z.string().min(1),
    basedOn: z.strictObject({ graph: z.number().int().nonnegative().optional(), goal: z.number().int().positive().optional() }),
    answers: z.array(z.string().min(1)).optional(),
    note: z.string().optional(),
    goal: z.string().min(1).optional(),
    acceptance: z.array(z.string().min(1)).optional(),
    scope: scopeSchema.optional(),
    accept: z.array(z.string().min(1)).optional(),
    keepEffect: z.array(z.string().min(1)).optional(),
    change: z.string().min(1).optional(),
    // The legal route (ops/routes.yaml) a workflow-change takes for the red or question decisions it answers (harness/routes.ts).
    route: z.string().min(1).optional(),
    escalation: z.strictObject({ kind: z.enum(ESCALATION_KINDS), question: z.string().min(1), paths: z.array(z.string()).optional() }).optional(),
    handoff: z.strictObject({ summary: z.string().min(1) }).optional(),
    mode: z.enum(["graceful", "hard"]).optional(),
    project: z.string().min(1).optional(),
})

/** A command file as parsed: what it asks, plus the sha256 of its bytes (stored with it). */
export type Command = z.infer<typeof commandSchema>

/** A parsed command with the hash of the exact bytes submitted and the folder its change file is named from. */
export interface CommandFile {
    readonly command: Command
    readonly sha256: string
    readonly dir: string
}

const needs: Readonly<Record<Command["kind"], readonly (keyof Command)[]>> = {
    "workflow-change": [],
    escalation: ["escalation"],
    handoff: ["handoff"],
    goal: ["goal"],
    "goal-change": ["goal"],
    stop: [],
}

/** Reads and validates a command file (json or yaml) for a scope: a Kernel submits only its three, the Supervisor only its three. */
export const readCommand = (file: string, scope: CommandScope): CommandFile => {
    let bytes: Buffer
    try {
        bytes = readFileSync(file)
    } catch (error: unknown) {
        throw new Refusal("COMMAND_UNREADABLE", `${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
    let raw: unknown
    try {
        raw = parse(bytes.toString("utf8"))
    } catch (error: unknown) {
        throw new Refusal("COMMAND_INVALID", `${file} is not json or yaml: ${error instanceof Error ? error.message : String(error)}`)
    }
    const parsed = commandSchema.safeParse(raw)
    if (!parsed.success) throw new Refusal("COMMAND_INVALID", `${file}: ${z.prettifyError(parsed.error)}`)
    const command = parsed.data
    const allowed: readonly string[] = scope === "kernel" ? KERNEL_COMMANDS : SUPERVISOR_COMMANDS
    if (!allowed.includes(command.kind)) throw new Refusal("COMMAND_NOT_YOURS", `a ${scope} submits ${allowed.join(", ")}, not ${command.kind}`)
    const missing = needs[command.kind].filter((field) => command[field] === undefined)
    if (missing.length > 0) throw new Refusal("COMMAND_INVALID", `${command.kind} needs ${missing.join(", ")}`)
    if (command.kind === "workflow-change" && command.change === undefined && (command.answers ?? []).length === 0) {
        throw new Refusal("COMMAND_INVALID", "workflow-change needs change (a workflow-change or whole workflow file), or answers that close decisions without one")
    }
    return { command, sha256: createHash("sha256").update(bytes).digest("hex"), dir: dirname(file) }
}

/** A command row of the ledger. */
export interface CommandRow {
    readonly cmdId: string
    readonly scope: CommandScope
    readonly workflowId: string
    readonly kind: string
    readonly sha256: string
    readonly status: "applying" | "applied" | "failed"
    readonly body: Command
    readonly outcome: unknown
    readonly receivedAt: string
}

const toCommand = (row: Record<string, unknown>): CommandRow => ({
    cmdId: String(row.cmd_id),
    scope: String(row.scope) as CommandScope,
    workflowId: String(row.workflow_id),
    kind: String(row.kind),
    sha256: String(row.sha256),
    status: String(row.status) as CommandRow["status"],
    body: JSON.parse(String(row.body_json)) as Command,
    outcome: typeof row.outcome_json === "string" ? JSON.parse(row.outcome_json) : null,
    receivedAt: String(row.received_at),
})

/** One command by id, if the ledger holds it. */
export const getCommand = (db: DatabaseSync, cmdId: string): CommandRow | undefined => {
    const row = db.prepare("SELECT * FROM commands WHERE cmd_id = ?").get(cmdId)
    return row === undefined ? undefined : toCommand(row)
}

/** The goal version of a workflow (goal@1 is the defined goal; workflow regoal and a goal-change move it). */
export const goalVersionOf = (db: DatabaseSync, workflowId: string): number => getWorkflow(db, workflowId).goalVersion

/**
 * The decisions of the ledger a command answers: its `answers` but, for a Supervisor command, the owner requests of the host
 * store it closes (harness/owner-requests.ts), which `supervisor submit` validates and closes itself.
 */
export const ledgerAnswers = (command: Command, scope: CommandScope): string[] => (command.answers ?? []).filter((id) => scope === "kernel" || !isOwnerRequestId(id))

/** The admission of a command: `new` (an intent row is written, apply it), or `replay` of a command already applied. */
export type Admission = { readonly kind: "new" } | { readonly kind: "replay"; readonly row: CommandRow }

/** Refuses a basedOn that is not the workflow's current graph or goal version (STALE), or one its kind must name and does not. */
const assertBasedOn = (db: DatabaseSync, command: Command, workflow: WorkflowRow): void => {
    const graph = command.basedOn.graph
    if (graph !== undefined && graph !== workflow.graphVersion) throw new Refusal("STALE", `basedOn graph v${String(graph)}, but workflow ${workflow.id} is at graph v${String(workflow.graphVersion)}; re-read and resubmit`)
    const goal = command.basedOn.goal
    const goalNow = goalVersionOf(db, workflow.id)
    if (goal !== undefined && goal !== goalNow) throw new Refusal("STALE", `basedOn goal v${String(goal)}, but workflow ${workflow.id} is at goal v${String(goalNow)}; re-read and resubmit`)
    if (command.kind === "workflow-change" && graph === undefined) throw new Refusal("COMMAND_INVALID", "a workflow-change names basedOn.graph")
    if (command.kind === "goal-change" && goal === undefined) throw new Refusal("COMMAND_INVALID", "a goal-change names basedOn.goal")
}

/**
 * Admits a command under compare-and-swap, before any side effect: a known cmdId with the same bytes replays its recorded
 * outcome (a failed one is applied again), with other bytes refuses CMD_CONFLICT; a basedOn that is not the current graph or
 * goal version refuses STALE (re-read and resubmit); a workflow-change answering a red or question decision off its legal route
 * refuses ROUTE_ILLEGAL (harness/routes.ts). The intent row `applying` lets recovery reconcile instead of guess.
 */
export const admitCommand = (db: DatabaseSync, scope: CommandScope, file: CommandFile): Admission =>
    inTransaction(db, () => {
        const { command, sha256 } = file
        const known = getCommand(db, command.cmdId)
        if (known !== undefined && known.sha256 !== sha256) throw new Refusal("CMD_CONFLICT", `cmdId ${command.cmdId} was submitted with other content; mint a new cmdId`)
        if (known?.status === "applied") return { kind: "replay", row: known }
        if (known?.status === "applying") throw new Refusal("CMD_IN_FLIGHT", `command ${command.cmdId} is being applied; read its outcome with the next ${scope} next`)
        const workflow = getWorkflow(db, command.workflow)
        assertBasedOn(db, command, workflow)
        for (const id of ledgerAnswers(command, scope)) {
            const decision = getDecision(db, id)
            if (decision?.scope !== scope) throw new Refusal("DECISION_UNKNOWN", `answers names ${id}, which is no ${scope} decision in this ledger`)
            if (decision.answeredBy !== null) throw new Refusal("STALE", `decision ${id} was answered already by ${decision.answeredBy}; re-read with ${scope} next`)
        }
        if (scope === "kernel") assertRoute(db, command, file.dir)
        db.prepare("DELETE FROM commands WHERE cmd_id = ? AND status = 'failed'").run(command.cmdId)
        db.prepare("INSERT INTO commands (cmd_id, scope, workflow_id, kind, based_on_json, sha256, body_json, status, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'applying', ?)").run(
            command.cmdId,
            scope,
            workflow.id,
            command.kind,
            JSON.stringify(command.basedOn),
            sha256,
            JSON.stringify(command),
            now(),
        )
        return { kind: "new" }
    })

/** Records how a command ended and closes the decisions it answers, in one transaction. */
export const finishCommand = (db: DatabaseSync, scope: CommandScope, command: Command, status: "applied" | "failed", outcome: unknown): CommandRow =>
    inTransaction(db, () => {
        const at = now()
        db.prepare("UPDATE commands SET status = ?, outcome_json = ?, applied_at = ? WHERE cmd_id = ?").run(status, JSON.stringify(outcome), at, command.cmdId)
        if (status === "applied") for (const id of ledgerAnswers(command, scope)) answerDecision(db, id, command.cmdId, scope)
        recordEvent(db, `command-${status}`, command.workflow, { cmdId: command.cmdId, scope, kind: command.kind })
        const row = getCommand(db, command.cmdId)
        if (row === undefined) throw new Refusal("CMD_LOST", `command ${command.cmdId} vanished from the ledger`)
        return row
    })

/** The decision kinds `kernel next` returns. */
export type KernelDecisionKind = "red" | "stale" | "question" | "conflict" | "goal" | "goal-change" | "escalation-answer" | "done"

/** The decision kinds `supervisor next` returns. */
export type SupervisorDecisionKind = "escalation" | "handoff"

/** One decision a coordinator must take: raised by the deterministic driver, answered by a command naming its id. */
export interface Decision {
    readonly id: string
    readonly scope: CommandScope
    readonly workflowId: string
    readonly kind: KernelDecisionKind | SupervisorDecisionKind
    readonly subject: string
    readonly evidence: unknown
    readonly raisedAt: string
    readonly answeredBy: string | null
}

const toDecision = (row: Record<string, unknown>): Decision => ({
    id: String(row.id),
    scope: String(row.scope) as CommandScope,
    workflowId: String(row.workflow_id),
    kind: String(row.kind) as Decision["kind"],
    subject: String(row.subject),
    evidence: JSON.parse(String(row.evidence_json)),
    raisedAt: String(row.raised_at),
    answeredBy: typeof row.answered_by === "string" ? row.answered_by : null,
})

/** The stable id of a decision: the same fact raised twice is one decision. */
export const decisionId = (scope: CommandScope, workflowId: string, kind: string, subject: string): string =>
    "d-" + createHash("sha256").update(`${scope}\0${workflowId}\0${kind}\0${subject}`).digest("hex").slice(0, 12)

/**
 * Raises a decision once (a fact already raised, answered or not, is not raised again); returns its id. A red or question
 * decision on a task carries its cause and legal route (harness/routes.ts withRoutes) in its evidence.
 */
export const raiseDecision = (db: DatabaseSync, input: { readonly scope: CommandScope; readonly workflowId: string; readonly kind: Decision["kind"]; readonly subject: string; readonly evidence: unknown }): string => {
    const id = decisionId(input.scope, input.workflowId, input.kind, input.subject)
    if (getDecision(db, id) !== undefined) return id
    const evidence = isRouted(input) ? withRoutes(db, input.workflowId, input.kind, input.subject, input.evidence) : input.evidence
    const inserted = db
        .prepare("INSERT INTO decisions (id, scope, workflow_id, kind, subject, evidence_json, raised_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING")
        .run(id, input.scope, input.workflowId, input.kind, input.subject, JSON.stringify(evidence), now())
    if (inserted.changes > 0) recordEvent(db, "decision-raised", input.workflowId, { id, scope: input.scope, kind: input.kind, subject: input.subject })
    return id
}

/** The open decisions of a scope (one workflow, or all), oldest first. */
export const openDecisions = (db: DatabaseSync, scope: CommandScope, workflowId?: string): Decision[] =>
    (workflowId === undefined
        ? db.prepare("SELECT * FROM decisions WHERE scope = ? AND answered_at IS NULL ORDER BY raised_at, id").all(scope)
        : db.prepare("SELECT * FROM decisions WHERE scope = ? AND workflow_id = ? AND answered_at IS NULL ORDER BY raised_at, id").all(scope, workflowId)
    ).map(toDecision)

/**
 * Whether a decision awaits the owner: an escalation whose kind the owner rules. Its Supervisor waits for the owner's answer, so
 * it is no work of the Supervisor's own: `supervisor next` returns it after every decision the Supervisor rules, and it never
 * makes an idle Supervisor stalled.
 */
export const awaitsOwner = (decision: Decision): boolean => {
    const evidence = decision.evidence
    if (decision.kind !== "escalation" || typeof evidence !== "object" || evidence === null || !("escalation" in evidence)) return false
    const escalation = evidence.escalation
    return typeof escalation === "object" && escalation !== null && "kind" in escalation && OWNER_RULED.includes(escalation.kind as (typeof OWNER_RULED)[number])
}

/** One decision by id. */
export const getDecision = (db: DatabaseSync, id: string): Decision | undefined => {
    const row = db.prepare("SELECT * FROM decisions WHERE id = ?").get(id)
    return row === undefined ? undefined : toDecision(row)
}

/** Closes a decision by the command (or `superseded:<why>`) that answered it; a decision of another scope is refused. */
export const answerDecision = (db: DatabaseSync, id: string, by: string, scope: CommandScope): void => {
    const decision = getDecision(db, id)
    if (decision === undefined) throw new Refusal("DECISION_UNKNOWN", `no decision ${id} in this ledger`)
    if (decision.scope !== scope) throw new Refusal("DECISION_NOT_YOURS", `decision ${id} is the ${decision.scope}'s to answer`)
    db.prepare("UPDATE decisions SET answered_by = ?, answered_at = ? WHERE id = ? AND answered_at IS NULL").run(by, now(), id)
}
