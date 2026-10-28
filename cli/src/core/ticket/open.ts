import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { getDecision } from "../../harness/coordinator-commands.js"
import { openExistingLedger } from "../../harness/ledger.js"
import { textOf } from "../../harness/machine.js"
import { getTask, latestAttempt } from "../../harness/tasks.js"
import { isQuestion, openTicket, TICKET_KINDS, TICKET_SEVERITIES } from "../../harness/tickets.js"
import type { TicketEvidence, TicketKind, TicketSeverity, WaiterInput } from "../../harness/tickets.js"
import { EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { mainCheckout } from "../../shared/git.js"
import { evidenceTail } from "../../shared/output.js"
import { callerRole } from "../../shared/role.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { projectFrom } from "../supervisor/driver.js"

const oneOf = <T extends string>(values: readonly T[], value: string, flag: string): T => {
    const found = values.find((known) => known === value)
    if (found === undefined) throw new Refusal("CLI_USAGE", `--${flag} takes ${values.join(", ")}, not ${value}`, EXIT_USAGE)
    return found
}

/**
 * The evidence of the task and the escalation a ticket cites, read from the ledger of the checkout: the task's workflow, newest
 * attempt and seat, the escalation's workflow and question. Refused TASK_UNKNOWN or DECISION_UNKNOWN when the ledger holds neither.
 */
const ledgerEvidence = (repo: string, task: string | undefined, decision: string | undefined): TicketEvidence => {
    if (task === undefined && decision === undefined) return {}
    const db = openExistingLedger(repo)
    if (db === undefined) throw new Refusal("TASK_UNKNOWN", `no ledger for ${repo}; run ticket open from the checkout whose ledger holds the task or escalation`)
    try {
        let evidence: TicketEvidence = {}
        if (decision !== undefined) {
            const row = getDecision(db, decision)
            if (row === undefined) throw new Refusal("DECISION_UNKNOWN", `no decision ${decision} in this project's ledger`)
            const escalation = (row.evidence as { readonly escalation?: { readonly question?: unknown } } | null)?.escalation
            evidence = { decision, workflow: row.workflowId, ...(typeof escalation?.question === "string" ? { question: escalation.question } : {}) }
        }
        if (task !== undefined) {
            const row = getTask(db, task)
            const attempt = latestAttempt(db, task)
            const seat = textOf(db.prepare("SELECT id FROM seats WHERE task_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1").get(task)?.id)
            evidence = { ...evidence, task, ...(row.workflowId === null ? {} : { workflow: row.workflowId }), ...(attempt === undefined ? {} : { attempt: attempt.id }), ...(seat === null ? {} : { seat }) }
        }
        return evidence
    } finally {
        db.close()
    }
}

/**
 * `starci ticket open`: the Supervisor files what it cannot resolve within its authority (the monitor may too, as an observer) as
 * one ticket in the host store (harness/tickets.ts): a defect for Debug's queue, or a question (`question:business|code|spec`)
 * the owner answers on Telegram, with its proposed default. A repeat of the same defect or question (its fingerprint) bumps the
 * live ticket's occurrences, or reopens a fixed one, instead of opening a second. `--task` and `--decision` read their evidence
 * from the checkout's ledger and make that task and escalation wait on the ticket; `--evidence-file` keeps a red output's tail,
 * secrets redacted.
 */
export const ticketOpenVerb = defineVerb({
    path: ["ticket", "open"],
    summary: "file what the Supervisor cannot resolve: a defect for Debug or a question for the owner, deduped (a repeat bumps occurrences); --task and --decision wait on it",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["supervisor", "owner", "debug"],
    schema: "starci/ticket@1",
    flags: {
        kind: { kind: "string", required: true, summary: `what it is: ${TICKET_KINDS.join(", ")}` },
        title: { kind: "string", required: true, summary: "one line: the defect with its error code and module, or the question itself" },
        severity: { kind: "string", summary: `${TICKET_SEVERITIES.join(" or ")} (default: blocking for a question, normal for a defect)` },
        default: { kind: "string", summary: "a question's proposed default, which the owner may simply accept" },
        option: { kind: "list", summary: "another answer the question allows, offered to the owner as a button (repeatable)" },
        task: { kind: "string", summary: "the task it stops, in this checkout's ledger: its workflow, attempt and seat become evidence and it waits on the ticket" },
        decision: { kind: "string", summary: "the escalation it answers, in this checkout's ledger: it waits on the ticket" },
        "evidence-file": { kind: "string", summary: "a file holding the red output; its tail is kept, secrets redacted" },
        tried: { kind: "string", summary: "what was already done about it, by the Op, the Kernel and the Supervisor" },
        code: { kind: "string", summary: "a defect's error code to dedupe by (default: the first one the title or evidence names)" },
        module: { kind: "string", summary: "a defect's harness module to dedupe by (default: the first one the title or evidence names)" },
        project: { kind: "string", summary: "any checkout of the project it happened in (default: the working directory)" },
    },
    run: async (context, flags) => {
        const kind: TicketKind = oneOf(TICKET_KINDS, flags.kind, "kind")
        const severity: TicketSeverity = oneOf(TICKET_SEVERITIES, flags.severity ?? (isQuestion(kind) ? "blocking" : "normal"), "severity")
        const title = flags.title.replaceAll(/\s+/g, " ").trim()
        if (title === "") throw new Refusal("TICKET_TITLE_EMPTY", "ticket open needs a --title naming the defect or asking the question")
        const proposedDefault = flags.default?.trim() ?? ""
        const options = flags.option.map((option) => option.trim()).filter((option) => option !== "")
        if ((proposedDefault !== "" || options.length > 0) && !isQuestion(kind)) throw new Refusal("CLI_USAGE", "--default and --option are a question's answers; a defect carries none", EXIT_USAGE)
        const where = flags.project === undefined ? context.cwd : resolve(context.cwd, flags.project)
        const project = await projectFrom(context, flags.project, false)
        const repo = (await mainCheckout(where)).replaceAll("\\", "/")
        let tail: string | undefined
        if (flags["evidence-file"] !== undefined) {
            const file = resolve(context.cwd, flags["evidence-file"])
            try {
                tail = evidenceTail(readFileSync(file, "utf8"))
            } catch (error: unknown) {
                throw new Refusal("TICKET_EVIDENCE_UNREADABLE", `${file}: ${error instanceof Error ? error.message : String(error)}`)
            }
        }
        const evidence: TicketEvidence = { ...ledgerEvidence(repo, flags.task, flags.decision), ...(tail === undefined ? {} : { tail }) }
        const workflow = evidence.workflow ?? null
        const waiters: WaiterInput[] = [
            ...(flags.task === undefined ? [] : [{ repo, subject: `task:${flags.task}`, project, workflow }]),
            ...(flags.decision === undefined ? [] : [{ repo, subject: `decision:${flags.decision}`, project, workflow }]),
        ]
        const terminal = process.env.ORCA_TERMINAL_HANDLE
        const { ticket, outcome } = openTicket({
            kind,
            severity,
            title,
            evidence,
            tried: flags.tried ?? null,
            proposedDefault: proposedDefault === "" ? null : proposedDefault,
            options,
            project,
            workflow,
            by: callerRole() ?? "owner",
            seat: terminal === undefined || terminal === "" ? null : terminal,
            ...(flags.code === undefined ? {} : { code: flags.code }),
            ...(flags.module === undefined ? {} : { module: flags.module }),
            waiters,
        })
        const said =
            outcome === "opened"
                ? "opened"
                : outcome === "reopened"
                  ? `reopened (round ${String(ticket.round)}; ${ticket.fixedBy ?? "its fix"} did not hold)`
                  : ticket.state === "answered"
                    ? `answered already, ${ticket.answer ?? "-"} (by ${ticket.closedBy ?? "-"}); what waits on it is released`
                    : `repeat of ${ticket.state} ticket, occurrence ${String(ticket.occurrences)}`
        return { data: { ticket, outcome }, message: `ticket ${ticket.id} ${said}: ${ticket.severity} ${ticket.kind}: ${ticket.title}` }
    },
})
