import type { DatabaseSync } from "node:sqlite"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"
import { isAncestor } from "../shared/git.js"
import { inTransaction, mainCheckoutOf, now, openExistingLedger, runtimeRoot } from "./ledger.js"
import { readMachine, textOf } from "./machine.js"
import { ENDED_NEED_STATES, normalizeNeedKey, readNeed } from "./needs.js"
import { registeredRepositories } from "./project-workers.js"
import { harnessCause, HOLD_REVIVED } from "./revive.js"
import { inOrder } from "./sequential.js"
import { recordEvent } from "./tasks.js"
import { projectOf } from "./work.js"

/**
 * What a hold waits for, exactly one of: a ticket that closes or is answered, a commit that harness main contains, a shared need
 * that ends, or a time that passes. A hold names it so the harness can release the task itself. `tasks` names, by plan key, the
 * tasks it holds beside those whose decisions the command answers (a hold kept in answer to an escalation-answer or goal-change).
 */
export const holdSchema = z
    .strictObject({
        tasks: z.array(z.string().min(1)).min(1).optional(),
        ticket: z.string().regex(/^tk-[0-9a-f]{12}$/, "a ticket id, tk- and twelve hex digits").optional(),
        commit: z.string().regex(/^[0-9a-f]{7,40}$/, "a harness commit, 7 to 40 lowercase hex digits").optional(),
        need: z.string().min(1).optional(),
        time: z.iso.datetime().optional(),
    })
    .refine((hold) => [hold.ticket, hold.commit, hold.need, hold.time].filter((value) => value !== undefined).length === 1, { message: "a hold names exactly one of ticket, commit, need or time it waits for" })

/** A hold's release condition. */
export type Hold = z.infer<typeof holdSchema>

/** The event a command records on a task it holds, with the decision it answered and its release condition. */
export const TASK_HELD = "task-held"

/** The event recorded when a hold's condition is met and its task released. */
export const HOLD_RELEASED = "hold-released"

/** The decision kinds on a task that a command answering it without moving the task holds. */
const HELD_KINDS: readonly string[] = ["red", "question", "check-premise", "conflict"]

/** What a hold reads of the command that makes it. */
export interface HoldingCommand {
    readonly kind: string
    readonly cmdId: string
    readonly workflow: string
    readonly answers?: readonly string[] | undefined
    readonly change?: string | undefined
    readonly need?: unknown
    readonly hold?: Hold | undefined
}

/** The decisions on a task a workflow-change answers without a change or a need: the tasks it holds where they stand. */
const answeredOnTasks = (db: DatabaseSync, command: HoldingCommand): { readonly id: string | null; readonly task: string }[] => {
    if (command.kind !== "workflow-change" || command.change !== undefined || command.need !== undefined) return []
    return decidedTasks(db, command.answers ?? [])
}

/** The Kernel decisions on a task among `answers` (a red, question, check-premise or conflict), each with its task. */
export const decidedTasks = (db: DatabaseSync, answers: readonly string[]): { readonly id: string; readonly task: string }[] =>
    answers.flatMap((id) => {
        const row = db.prepare("SELECT kind, subject FROM decisions WHERE id = ? AND scope = 'kernel'").get(id)
        const subject = textOf(row?.subject) ?? ""
        return row !== undefined && HELD_KINDS.includes(String(row.kind)) && subject.startsWith("t-") ? [{ id, task: subject }] : []
    })

/**
 * Every task a hold keeps where it stands: those whose decisions the command answers, and the current task of each plan key
 * its `tasks` names, with the last Kernel decision on it (the one its release reopens), or none.
 */
const heldDecisions = (db: DatabaseSync, command: HoldingCommand): { readonly id: string | null; readonly task: string }[] => {
    const answered = answeredOnTasks(db, command)
    if (command.kind !== "workflow-change" || command.change !== undefined) return answered
    const named = (command.hold?.tasks ?? []).flatMap((key) => {
        const task = textOf(db.prepare("SELECT id FROM tasks WHERE workflow_id = ? AND plan_key = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(command.workflow, key)?.id)
        if (task === null) throw new Refusal("COMMAND_INVALID", `hold names task ${key}, which workflow ${command.workflow} never dispatched`)
        if (answered.some((one) => one.task === task)) return []
        const decision = textOf(db.prepare("SELECT id FROM decisions WHERE scope = 'kernel' AND workflow_id = ? AND subject = ? ORDER BY raised_at DESC, id DESC LIMIT 1").get(command.workflow, task)?.id)
        return [{ id: decision, task }]
    })
    return [...answered, ...named]
}

/** True when a command is a hold: a workflow-change with a `hold` and no change, which answers any decision on a task off its route. */
export const isHold = (command: HoldingCommand): boolean => command.kind === "workflow-change" && command.change === undefined && command.hold !== undefined

/**
 * Refuses a hold with no release condition (HOLD_UNCONDITIONED): a workflow-change that answers a decision on a task without a
 * change or a need keeps the task where it stands, so it names what it waits for (`hold`); a `hold` on a command that holds
 * nothing is COMMAND_INVALID, and one naming a ticket the host does not know is TICKET_UNKNOWN.
 */
export const assertHold = (db: DatabaseSync, command: HoldingCommand): void => {
    const answered = answeredOnTasks(db, command)
    if (answered.length > 0 && command.hold === undefined) {
        throw new Refusal("HOLD_UNCONDITIONED", `${command.kind} ${command.cmdId} answers ${answered.map((one) => one.id ?? "-").join(", ")} without moving task ${answered.map((one) => one.task).join(", ")}: that is a hold, and a hold names what releases it (hold: {ticket: <id>} | {commit: <sha on harness main>} | {need: <key>} | {time: <iso>}), preferably the ticket it waits on; or move the task (retry, edit, remove) or escalate`)
    }
    if (command.hold === undefined) return
    if (heldDecisions(db, command).length === 0) throw new Refusal("COMMAND_INVALID", `hold belongs to a workflow-change with no change that answers a decision on a task or names the tasks it holds (hold.tasks); ${command.cmdId} holds nothing`)
    const ticket = command.hold.ticket
    if (ticket !== undefined && readMachine((machine) => machine.prepare("SELECT 1 FROM tickets WHERE id = ?").get(ticket), undefined) === undefined) throw new Refusal("TICKET_UNKNOWN", `hold names ticket ${ticket}, which this host does not know (starci ticket list)`)
    if (command.hold.need !== undefined) normalizeNeedKey(command.hold.need)
}

/** Records the holds a command applied makes: a `task-held` event on each task it holds, naming the decision and the condition. */
export const recordHolds = (db: DatabaseSync, command: HoldingCommand): string[] => {
    const hold = command.hold
    if (hold === undefined) return []
    return heldDecisions(db, command).map((one) => {
        recordEvent(db, TASK_HELD, one.task, { workflow: command.workflow, decision: one.id, cmdId: command.cmdId, until: hold })
        return one.task
    })
}

/** A hold in force: its task, the decision it answered, the command that made it, and its condition. */
export interface ActiveHold {
    readonly task: string
    readonly workflow: string
    readonly decision: string | null
    readonly cmdId: string
    readonly until: Hold
    readonly at: string
}

/** The holds in force in a ledger (of one workflow, or all): the newest hold of each task still stuck, not released yet. */
export const activeHolds = (db: DatabaseSync, workflowId?: string): ActiveHold[] =>
    db
        .prepare(
            `SELECT e.subject AS task, e.at, e.data_json FROM events e JOIN tasks t ON t.id = e.subject WHERE e.kind = ? AND t.status IN ('failed', 'cancelled', 'reported', 'awaiting_owner')
             AND e.id = (SELECT MAX(id) FROM events WHERE kind = ? AND subject = e.subject)
             AND NOT EXISTS (SELECT 1 FROM events r WHERE r.kind = ? AND r.subject = e.subject AND json_extract(r.data_json, '$.cmdId') = json_extract(e.data_json, '$.cmdId'))`,
        )
        .all(TASK_HELD, TASK_HELD, HOLD_RELEASED)
        .map((row) => {
            const data = JSON.parse(String(row.data_json)) as { readonly workflow: string; readonly decision: string | null; readonly cmdId: string; readonly until: Hold }
            return { task: String(row.task), workflow: data.workflow, decision: data.decision, cmdId: data.cmdId, until: data.until, at: String(row.at) }
        })
        .filter((hold) => workflowId === undefined || hold.workflow === workflowId)

/** True while a hold is in force on a task. */
export const isHeld = (db: DatabaseSync, taskId: string): boolean => activeHolds(db).some((hold) => hold.task === taskId)

/** How a hold's condition reads in one line. */
export const holdLine = (until: Hold): string =>
    until.ticket !== undefined ? `ticket ${until.ticket}` : until.commit !== undefined ? `commit ${until.commit} on harness main` : until.need !== undefined ? `need ${until.need}` : `time ${until.time ?? "-"}`

/** Why a hold's condition is met, or null while it is not: the ticket ended, harness main holds the commit, the need ended, or the time passed. */
const metBy = async (root: string, until: Hold): Promise<string | null> => {
    if (until.ticket !== undefined) {
        const id = until.ticket
        const state = textOf(readMachine((db) => db.prepare("SELECT state FROM tickets WHERE id = ?").get(id)?.state, undefined))
        return state !== null && !["open", "in-progress"].includes(state) ? `ticket ${id} is ${state}` : null
    }
    if (until.commit !== undefined) return (await isAncestor(mainCheckoutOf(runtimeRoot()), until.commit, "main")) ? `harness main contains ${until.commit}` : null
    if (until.need !== undefined) {
        const key = normalizeNeedKey(until.need)
        const need = readNeed((await projectOf(root, false)).key, key)
        return need !== undefined && ENDED_NEED_STATES.includes(need.state) ? `need ${key} is ${need.state}` : null
    }
    return until.time !== undefined && Date.parse(until.time) <= Date.now() ? `${until.time} passed` : null
}

/**
 * Releases every hold of a repository's ledger (one workflow's, or those naming one ticket) whose condition is met, each in its
 * own transaction: a `hold-released` event, then a task the harness ended (revive.ts `harnessCause`) comes back to ready at the
 * same try (`hold-revived`, past `reviveMax` too), and any other returns to its Kernel decision, reopened as of now so the Kernel
 * answers it on its next turn. Returns a line per release.
 */
export const releaseHolds = async (root: string, filter: { readonly workflow?: string; readonly ticket?: string } = {}): Promise<string[]> => {
    const db = openExistingLedger(root)
    if (db === undefined) return []
    let holds: ActiveHold[]
    try {
        holds = activeHolds(db, filter.workflow).filter((hold) => filter.ticket === undefined || hold.until.ticket === filter.ticket)
    } finally {
        db.close()
    }
    const lines = await inOrder(holds, async (hold): Promise<string[]> => {
        const why = await metBy(root, hold.until)
        if (why === null) return []
        const ledger = openExistingLedger(root)
        if (ledger === undefined) return []
        try {
            return [
                inTransaction(ledger, () => {
                    recordEvent(ledger, HOLD_RELEASED, hold.task, { workflow: hold.workflow, decision: hold.decision, cmdId: hold.cmdId, until: hold.until, why })
                    const cause = harnessCause(ledger, hold.task)
                    if (cause !== null) {
                        recordEvent(ledger, HOLD_REVIVED, hold.task, { workflow: hold.workflow, cmdId: hold.cmdId, cause })
                        return `${hold.workflow}: task ${hold.task} released (${why}); the harness ended it (${cause}), so it comes back at the same try`
                    }
                    if (hold.decision === null) return `${hold.workflow}: task ${hold.task} released (${why}); it had no Kernel decision to reopen`
                    ledger.prepare("UPDATE decisions SET answered_by = NULL, answered_at = NULL, raised_at = ? WHERE id = ? AND scope = 'kernel'").run(now(), hold.decision)
                    recordEvent(ledger, "decision-reopened", hold.workflow, { id: hold.decision, task: hold.task, by: HOLD_RELEASED, cmdId: hold.cmdId })
                    return `${hold.workflow}: task ${hold.task} released (${why}); decision ${hold.decision} is the Kernel's again`
                }),
            ]
        } finally {
            ledger.close()
        }
    })
    return lines.flat()
}

/** Releases, in every registered ledger, the holds that wait on one ticket, once it closed or was answered. */
export const releaseTicketHolds = async (ticket: string): Promise<string[]> => (await inOrder(registeredRepositories(), (repo) => releaseHolds(repo, { ticket }))).flat()
