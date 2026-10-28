import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"
import { scopeSchema } from "./graph.js"
import { inTransaction, now } from "./ledger.js"
import { isOwnerRequestId } from "./owner-requests.js"
import { assertRoute, isRouted, withRoutes } from "./routes.js"
import { assertNeedAnswer } from "./need-answer.js"
import { assertHold, holdSchema, isHold } from "./holds.js"
import { recordEvent } from "./tasks.js"
import { getWorkflow } from "./workflow.js"
import type { WorkflowRow } from "./workflow.js"

/**
 * The seven commands of the seat tree. Down: goal, goal-change, stop (Supervisor -> Kernel), and need-owner (the Supervisor gives a
 * shared need to one workflow, or rejects it); the Kernel's own graph: workflow-change (which also names the resolver of a shared
 * need, or rejects it); up: escalation and handoff (Kernel -> Supervisor). The Supervisor also submits a workflow-change or an
 * escalation in its Kernel's place to rule a `kernel-undecided` decision (`RULING_COMMANDS`). An Op's `result` is `task result`,
 * not a command file.
 */
export const KERNEL_COMMANDS = ["workflow-change", "escalation", "handoff"] as const
export const SUPERVISOR_COMMANDS = ["goal", "goal-change", "stop", "need-owner"] as const

/**
 * The Kernel commands a Supervisor submits to rule a Kernel decision its Kernel left undecided (`KERNEL_UNDECIDED`): the same
 * vocabulary the Kernel answers with, applied to that workflow under the Supervisor's authority.
 */
export const RULING_COMMANDS = ["workflow-change", "escalation"] as const

/** The Supervisor decision the host driver raises for a Kernel decision left undecided past stall.decisionStallMinutes. */
export const KERNEL_UNDECIDED = "kernel-undecided"

/** Who submits a command: the Kernel of a workflow, or the Supervisor of its project. */
export type CommandScope = "kernel" | "supervisor"

/** The kinds an escalation names (wave principle 5). */
export const ESCALATION_KINDS = ["budget", "scope", "conflict", "owner", "harness"] as const

/**
 * What an `owner` escalation asks about. `scope` (a change of the accepted goal), `money` (a price, a real charge), `credentials`
 * (an account, a key, custody), and `legal` are the owner's whatever default is proposed; a `product` choice inside the goal is
 * the Supervisor's to decide on the escalation's `default` when it carries one, and the owner's when it carries none.
 */
export const OWNER_TOPICS = ["scope", "money", "credentials", "legal", "product"] as const

/** The owner topics no default settles: the owner rules them even when the escalation proposes one. */
const OWNER_ONLY: readonly (typeof OWNER_TOPICS)[number][] = ["scope", "money", "credentials", "legal"]

/**
 * The escalation kinds the Supervisor does not rule: `owner` (the owner's decisions, `OWNER_TOPICS`; the Supervisor asks the owner
 * in its terminal), except a `product` one carrying a default, which the Supervisor's driver decides on that default
 * (`defaultRuling`); and `harness` (a harness defect, Debug's to fix; its answer arrives as Debug's `supervisor ask`). The
 * Supervisor relays either ruling (ops/coordinators/supervisor.md).
 */
const OWNER_RULED: readonly (typeof ESCALATION_KINDS)[number][] = ["owner", "harness"]

const escalationSchema = z
    .strictObject({
        kind: z.enum(ESCALATION_KINDS),
        question: z.string().min(1),
        paths: z.array(z.string()).optional(),
        // An owner escalation's topic, and the answer the Kernel proposes with its reason (the goal's words, or the plan's).
        topic: z.enum(OWNER_TOPICS).optional(),
        default: z.string().min(1).optional(),
        reason: z.string().min(1).optional(),
    })
    .superRefine((escalation, context) => {
        const problem = (message: string): void => {
            context.addIssue({ code: "custom", message })
        }
        if (escalation.kind !== "owner") {
            if (escalation.topic !== undefined || escalation.default !== undefined || escalation.reason !== undefined) problem(`topic, default and reason belong to an owner escalation; a ${escalation.kind} escalation is ruled by the Supervisor`)
            return
        }
        if (escalation.topic === undefined) problem(`an owner escalation names its topic (${OWNER_TOPICS.join(", ")}); a product choice inside the goal also names the default the goal or the plan implies, with its reason, and the Supervisor decides on it`)
        if ((escalation.default === undefined) !== (escalation.reason === undefined)) problem("an owner escalation names default and reason together: the answer it proposes and why (the goal's words or the plan's)")
    })

/** An escalation as a Kernel files it. */
export type Escalation = z.infer<typeof escalationSchema>

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
    escalation: escalationSchema.optional(),
    handoff: z.strictObject({ summary: z.string().min(1) }).optional(),
    mode: z.enum(["graceful", "hard"]).optional(),
    project: z.string().min(1).optional(),
    // The answer to a shared-need decision (harness/needs.ts): the task key, or keys, that resolve it in the command's workflow
    // (a Kernel's workflow-change, or a need-owner naming tasks its owner workflow holds), or why it is not shared; a need-owner
    // with neither gives the need to its workflow's Kernel.
    need: z.strictObject({ key: z.string().min(1), resolver: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(), reject: z.string().min(1).optional() }).optional(),
    // What releases a workflow-change that answers a decision on a task without moving it (harness/holds.ts): one ticket, harness
    // commit, need or time.
    hold: holdSchema.optional(),
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
    "need-owner": ["need"],
}

/** Reads and validates a command file (json or yaml) for a scope: a Kernel submits its three, the Supervisor its four and its rulings. */
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
    const allowed: readonly string[] = scope === "kernel" ? KERNEL_COMMANDS : [...SUPERVISOR_COMMANDS, ...RULING_COMMANDS]
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
 * refuses ROUTE_ILLEGAL (harness/routes.ts). A Supervisor's ruling (`assertRuling`) is held to the same route and need checks as
 * the Kernel's own command on the Kernel decisions it rules. The intent row `applying` lets recovery reconcile instead of guess.
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
        if (scope === "kernel") {
            assertHold(db, command)
            if (!isHold(command)) assertRoute(db, command, file.dir)
            assertNeedAnswer(db, scope, command, file.dir)
        } else if (isRuling(command)) {
            assertRuling(db, command)
            const ruled = rulingAsKernel(db, command)
            assertHold(db, ruled)
            if (!isHold(ruled)) assertRoute(db, ruled, file.dir)
            assertNeedAnswer(db, "kernel", ruled, file.dir)
        } else {
            assertNeedAnswer(db, scope, command, file.dir)
            if (command.hold !== undefined) throw new Refusal("COMMAND_INVALID", `a ${command.kind} carries no hold; a hold is a workflow-change's, the Kernel's or a ruling's`)
        }
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
export type KernelDecisionKind = "red" | "check-premise" | "stale" | "question" | "conflict" | "goal" | "goal-change" | "escalation-answer" | "shared-need" | "done"

/** The decision kinds `supervisor next` returns. */
export type SupervisorDecisionKind = "escalation" | "handoff" | "shared-need" | typeof KERNEL_UNDECIDED

/** The decision kind a shared need is routed as, to a Kernel or to the Supervisor (core/needs/tend.ts). */
export const SHARED_NEED = "shared-need"

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

/** The escalation a decision carries (its evidence's `escalation`), when it is one. */
export const escalationOf = (decision: Decision): Partial<Escalation> | null => {
    const evidence = decision.evidence
    if (decision.kind !== "escalation" || typeof evidence !== "object" || evidence === null || !("escalation" in evidence)) return null
    const escalation = evidence.escalation
    return typeof escalation === "object" && escalation !== null ? escalation : null
}

/**
 * The ruling the Supervisor's driver takes on an owner escalation without the owner: its proposed `default` with its reason, for
 * a `product` choice inside the goal. Null for any other decision, and for an owner topic no default settles (`OWNER_ONLY`).
 */
export const defaultRuling = (decision: Decision): { readonly ruling: string; readonly reason: string } | null => {
    const escalation = escalationOf(decision)
    if (escalation?.kind !== "owner" || escalation.default === undefined || escalation.topic === undefined || OWNER_ONLY.includes(escalation.topic)) return null
    return { ruling: escalation.default, reason: escalation.reason ?? "" }
}

/**
 * Whether a decision awaits an answer from outside the Supervisor: an escalation of kind `owner` the owner rules (every one but a
 * defaulted product choice, `defaultRuling`) or `harness` (Debug rules it). Its Supervisor waits for that answer, so it is no work
 * of the Supervisor's own: `supervisor next` hands it over once, after every decision the Supervisor rules, and it never makes an
 * idle Supervisor stalled.
 */
export const awaitsOwner = (decision: Decision): boolean => {
    const kind = escalationOf(decision)?.kind
    return kind !== undefined && OWNER_RULED.includes(kind) && defaultRuling(decision) === null
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

/** True for a Supervisor command that rules in its Kernel's place: a workflow-change or an escalation (`RULING_COMMANDS`). */
export const isRuling = (command: Command): boolean => (RULING_COMMANDS as readonly string[]).includes(command.kind)

/** The `kernel-undecided` decisions of a command's workflow its answers name. */
export const undecidedAnswered = (db: DatabaseSync, command: Command): Decision[] =>
    ledgerAnswers(command, "supervisor")
        .map((id) => getDecision(db, id))
        .filter((decision): decision is Decision => decision?.kind === KERNEL_UNDECIDED && decision.workflowId === command.workflow)

/** The open Kernel decision a `kernel-undecided` decision names (its evidence's `decision.id`), while it is still open. */
const openKernelDecisionOf = (db: DatabaseSync, decision: Decision): string | null => {
    const evidence = decision.evidence
    const named = typeof evidence === "object" && evidence !== null && "decision" in evidence ? evidence.decision : null
    const id = typeof named === "object" && named !== null && "id" in named && typeof named.id === "string" ? named.id : null
    if (id === null) return null
    const open = getDecision(db, id)
    return open?.scope === "kernel" && open.answeredBy === null ? id : null
}

/**
 * A Supervisor's ruling as the Kernel's own command: its answers are the open Kernel decisions the `kernel-undecided` decisions it
 * answers name, so the route, the need and the decision it closes are the Kernel's (a stuck task whose decision was answered
 * already names none, as a Kernel's own amend of it would).
 */
export const rulingAsKernel = (db: DatabaseSync, command: Command): Command => ({
    ...command,
    answers: undecidedAnswered(db, command).flatMap((decision) => {
        const id = openKernelDecisionOf(db, decision)
        return id === null ? [] : [id]
    }),
})

/**
 * Refuses a ruling outside the Supervisor's authority: a workflow-change or escalation that answers no open `kernel-undecided`
 * decision of its workflow is the Kernel's to submit (COMMAND_NOT_YOURS); a ruling escalation goes only where the Supervisor
 * cannot rule, to the owner (kind owner, on an owner topic) or to Debug (kind harness), so one of kind budget, scope or conflict,
 * or a product choice carrying a default, is the Supervisor's own to rule (RULING_WITHIN_AUTHORITY).
 */
const assertRuling = (db: DatabaseSync, command: Command): void => {
    if (undecidedAnswered(db, command).length === 0) throw new Refusal("COMMAND_NOT_YOURS", `a Supervisor submits a ${command.kind} only to rule a ${KERNEL_UNDECIDED} decision of workflow ${command.workflow}, named in answers; otherwise it is the Kernel's`)
    const escalation = command.escalation
    if (command.kind !== "escalation" || escalation === undefined) return
    if (!OWNER_RULED.includes(escalation.kind)) throw new Refusal("RULING_WITHIN_AUTHORITY", `a ${escalation.kind} escalation is the Supervisor's own to rule: rule it with a workflow-change (or a goal-change, or budget raise); a ruling escalates only to the owner (kind owner) or to Debug (kind harness)`)
    if (escalation.topic === "product" && escalation.default !== undefined) throw new Refusal("RULING_WITHIN_AUTHORITY", "a product choice that carries a default is the Supervisor's to rule on that default: rule it with a workflow-change")
}
