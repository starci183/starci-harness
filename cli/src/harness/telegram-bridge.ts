import { createHash } from "node:crypto"
import { basename } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { registeredRepositories } from "./project-workers.js"
import { asRefusal } from "../shared/errors.js"
import { now, openExistingLedger } from "./ledger.js"
import { readMachine, textOf } from "./machine.js"
import { askSupervisor } from "./owner-ask.js"
import { inOrder } from "./sequential.js"
import { liveSupervisors, projectOfRecord, supervisorTitle } from "./supervisor.js"
import { chatName, escapeHtml, getUpdates, loadTelegram, processAlive, readChannel, sendMessage, telegramBot, tokenSource, withChannelStore } from "./telegram.js"
import type { Channel, Keyboard, NoticeKind, TelegramBot, TelegramConfig, TelegramMessage, TelegramUpdate } from "./telegram.js"
import { handleTicketCallback, mutedUntil, openTicketsMessage, sendTicketCard, takePending, ticketCaption, ticketDetails, ticketKeyboard } from "./telegram-tickets.js"
import type { CardStage } from "./telegram-tickets.js"
import { closeTicket, findTicket, isLive, isQuestion, listTickets, ticketHostEscalations, wakeOnClose } from "./tickets.js"
import type { Ticket } from "./tickets.js"
import { projectOf } from "./work.js"
import type { Project } from "./work.js"
import { listWorkflows } from "./workflow.js"
import type { WorkflowRow } from "./workflow.js"

/**
 * One fact the owner hears about once, of one of the kinds ops/telegram.yaml `notices` switches: a question ticket put to the
 * owner and its reminder, a defect ticket opened, reopened by a repeat or closed, an owner request taken up, and a workflow that
 * ended. A kind left out of `notices` is never read, so it is never sent.
 */
interface Notice {
    readonly key: string
    readonly kind: "request" | "workflow" | "ticket"
    readonly project: Project
    readonly workflow: string | null
    readonly subject: string
    readonly text: string
    readonly at: string
    /** A ticket's notice is sent as its card: the ticket and which notice of it this is. */
    readonly card?: { readonly ticket: Ticket; readonly stage: CardStage }
    /** A reminder is a reply to the card it reminds of, by that card's message id. */
    readonly replyTo?: number
}

const clip = (text: string, chars: number): string => {
    const flat = text.replaceAll(/\s+/g, " ").trim()
    return flat.length <= chars ? flat : `${flat.slice(0, chars - 1)}…`
}

const ENDED: Readonly<Record<string, string>> = { done: "is done", blocked: "is blocked", stopped: "stopped" }

/**
 * The key of a workflow's notice: one per workflow, status and reason, so a workflow is noticed once per state it ends in. Its
 * goal and graph versions are no part of it: a Kernel amending a blocked workflow bumps them every minute without changing what
 * the owner would hear (2026-10-29: "lesson-ai is blocked" went out at 2:59, 3:00 and 3:02).
 */
export const workflowNoticeKey = (project: Project, workflow: Pick<WorkflowRow, "id" | "status" | "reason">): string =>
    `workflow:${project.key}:${workflow.id}:${workflow.status}:${createHash("sha256").update(workflow.reason ?? "").digest("hex").slice(0, 12)}`

/** The facts of one registered repository's ledger: workflows that ended, since `since`. */
const ledgerNotices = (repo: string, project: Project, since: string, chars: number): Notice[] => {
    const db = openExistingLedger(repo)
    if (db === undefined) return []
    try {
        const workflows = listWorkflows(db).flatMap((workflow): Notice[] => {
            const ended = ENDED[workflow.status]
            const at = workflow.updatedAt ?? workflow.createdAt
            if (ended === undefined || at <= since) return []
            const reason = workflow.reason === null ? "" : `: ${clip(workflow.reason, chars)}`
            const text = [`[StarCi] ${project.name} · workflow ${workflow.id} ${ended}${reason}`, `More to do: reply to this message, or send /ask ${project.name} <request>.`].join("\n")
            return [{ key: workflowNoticeKey(project, workflow), kind: "workflow", project, workflow: workflow.id, subject: workflow.id, text, at }]
        })
        return workflows
    } finally {
        db.close()
    }
}

/** The owner requests a Supervisor command took up since `since`. */
const requestNotices = (since: string, chars: number): Notice[] =>
    readMachine((db) => db.prepare("SELECT * FROM owner_requests WHERE closed_at IS NOT NULL AND closed_at > ? ORDER BY closed_at, id").all(since), []).map((row): Notice => {
        const root = String(row.project_root)
        const project: Project = { key: String(row.project), root, name: basename(root) }
        const id = String(row.id)
        const workflow = textOf(row.workflow_id)
        const text = [`[StarCi] ${project.name}: request ${id} was taken up by ${String(row.closed_by)}${workflow === null ? "" : ` (workflow ${workflow})`}.`, `"${clip(String(row.text), chars)}"`].join("\n")
        return { key: `request:${id}`, kind: "request", project, workflow, subject: id, text, at: String(row.closed_at) }
    })

/** The registered repositories with the project each belongs to; a repository with no fit project is skipped. */
const repositoryProjects = async (): Promise<{ readonly repo: string; readonly project: Project }[]> => {
    const found = await inOrder(registeredRepositories(), async (repo) => {
        try {
            return [{ repo, project: await projectOf(repo, false) }]
        } catch {
            return []
        }
    })
    return found.flat()
}

/** A question's card as sent: when, and the message id its reminder replies to; undefined until it was sent. */
const sentCard = (key: string): { readonly sentAt: string; readonly messageId: number } | undefined =>
    withChannelStore((db) => {
        const row = db.prepare("SELECT sent_at, message_id FROM telegram_notices WHERE key = ? AND status = 'sent'").get(key)
        const sentAt = textOf(row?.sent_at)
        const messageId = row?.message_id
        return sentAt === null || typeof messageId !== "number" ? undefined : { sentAt, messageId }
    })

/**
 * The reminder of a live question whose card went out at least `hours` ago: one per `hours` elapsed since, keyed by that count,
 * so it goes out at most once in any `hours` however often the sweep runs, and only the latest one due after the bridge was down.
 */
const reminderOf = (ticket: Ticket, hours: number, at: number): { readonly key: string; readonly at: string; readonly replyTo: number } | undefined => {
    const card = sentCard(`ticket:${ticket.id}:ask`)
    if (card === undefined) return undefined
    const span = hours * 3_600_000
    const due = Math.floor((at - Date.parse(card.sentAt)) / span)
    if (due < 1) return undefined
    return { key: `ticket:${ticket.id}:remind:${String(due)}`, at: new Date(Date.parse(card.sentAt) + due * span).toISOString(), replyTo: card.messageId }
}

/**
 * The tickets' facts since `since`, of the kinds `kinds` holds, each sent as a ticket card (harness/telegram-tickets.ts: the
 * banner, the facts as its caption, the buttons). A question is put to the owner once, then reminded while it stays live
 * (`reminderOf`, every ops/telegram.yaml reminderHours). A defect is noticed once per state and round: its opening (and its
 * reopening by a repeat after a fix) and its end; one below blocking severity is harness-internal noise, noticed only once seen
 * more than ticketOccurrences times, and every defect notice waits while the owner muted them.
 */
const ticketNotices = (since: string, config: TelegramConfig, kinds: ReadonlySet<NoticeKind>): Notice[] => {
    const chars = config.questionChars
    const muted = kinds.has("defect") && mutedUntil() !== null
    const at = Date.now()
    return listTickets({}).flatMap((ticket): Notice[] => {
        const question = isQuestion(ticket.kind)
        if (!kinds.has(question ? "question" : "defect")) return []
        const card = (stage: CardStage, key: string, noticeAt: string): Notice => ({ key, kind: "ticket", project: ticket.project, workflow: ticket.workflow, subject: ticket.id, text: ticketCaption(ticket, stage, chars), at: noticeAt, card: { ticket, stage } })
        if (question) {
            const reminder = isLive(ticket.state) ? reminderOf(ticket, config.reminderHours, at) : undefined
            const reminders = reminder === undefined ? [] : [{ ...card("remind", reminder.key, reminder.at), replyTo: reminder.replyTo }]
            return [card("ask", `ticket:${ticket.id}:ask`, ticket.openedAt), ...reminders].filter((notice) => notice.at > since)
        }
        if (muted || (ticket.severity !== "blocking" && ticket.occurrences <= config.ticketOccurrences)) return []
        const round = `r${String(ticket.round)}`
        const open = card("open", `ticket:${ticket.id}:open:${round}`, ticket.severity === "blocking" ? ticket.openedAt : ticket.lastSeenAt)
        const closedAt = ticket.closedAt
        const closed = closedAt === null || isLive(ticket.state) ? [] : [card("closed", `ticket:${ticket.id}:${ticket.state}:${round}`, closedAt)]
        return [open, ...closed].filter((notice) => notice.at > since)
    })
}

/** Every fact noticed since the channel was connected, of the kinds ops/telegram.yaml `notices` lists, oldest first. */
const pendingNotices = async (since: string, config: TelegramConfig): Promise<Notice[]> => {
    const chars = config.questionChars
    const kinds = new Set(config.notices)
    const ledgers = kinds.has("workflow") ? (await repositoryProjects()).flatMap(({ repo, project }) => ledgerNotices(repo, project, since, chars)) : []
    const requests = kinds.has("request") ? requestNotices(since, chars) : []
    return [...ledgers, ...requests, ...ticketNotices(since, config, kinds)].sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key))
}

/** Claims a notice to send: new, or failed with tries left; a notice sent or being sent is never claimed again. */
const claim = (notice: Notice, chatId: string, tries: number): boolean =>
    withChannelStore((db) => {
        const row = db.prepare("SELECT status, tries FROM telegram_notices WHERE key = ?").get(notice.key)
        if (row === undefined) {
            db.prepare("INSERT INTO telegram_notices (key, kind, project, project_root, workflow_id, subject, text, status, tries, chat_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, 'sending', 1, ?, ?)").run(
                notice.key,
                notice.kind,
                notice.project.key,
                notice.project.root,
                notice.workflow,
                notice.subject,
                notice.text,
                chatId,
                now(),
            )
            return true
        }
        if (row.status !== "failed" || Number(row.tries) >= tries) return false
        db.prepare("UPDATE telegram_notices SET status = 'sending', tries = tries + 1, chat_id = ? WHERE key = ?").run(chatId, notice.key)
        return true
    })

/** How many notices the minute's budget still allows. */
const allowance = (perMinute: number): number =>
    withChannelStore((db) => perMinute - Number(db.prepare("SELECT COUNT(*) AS n FROM telegram_notices WHERE status IN ('sent', 'sending') AND at > ?").get(new Date(Date.now() - 60_000).toISOString())?.n ?? 0))

/** Sends one notice: a plain text, a reminder as an HTML reply to its card with the card's buttons, or a ticket's card. */
const sendNotice = async (bot: TelegramBot, chatId: string, notice: Notice): Promise<number> => {
    if (notice.card === undefined) return sendMessage(bot, chatId, notice.text)
    const keyboard = ticketKeyboard(notice.card.ticket, notice.card.stage, bot.config)
    if (notice.replyTo !== undefined) return sendMessage(bot, chatId, notice.text, notice.replyTo, { html: true, keyboard })
    return sendTicketCard(bot, chatId, notice.text, keyboard)
}

/** What one sweep did. */
export interface Sweep {
    readonly sent: readonly string[]
    readonly failed: readonly string[]
    readonly deferred: number
}

/**
 * Sends the owner every fact not sent yet, oldest first, within the minute's budget: each fact is claimed once by its key before
 * it is sent (so no fact is sent twice), the rest wait for the next sweep. A send that fails is tried again up to sendTries. Every
 * escalation the Supervisor cannot rule is filed as its ticket first (`ticketHostEscalations`), so its question or defect is due.
 */
export const sweepNotices = async (bot: TelegramBot, channel: Channel & { readonly chatId: string; readonly connectedAt: string }): Promise<Sweep> => {
    const { config } = bot
    await ticketHostEscalations()
    const notices = await pendingNotices(channel.connectedAt, config)
    const sent: string[] = []
    const failed: string[] = []
    let budget = allowance(config.sendPerMinute)
    let deferred = 0
    await inOrder(notices, async (notice) => {
        if (budget <= 0) {
            if (claimable(notice.key, config.sendTries)) deferred += 1
            return
        }
        if (!claim(notice, channel.chatId, config.sendTries)) return
        budget -= 1
        try {
            const messageId = await sendNotice(bot, channel.chatId, notice)
            withChannelStore((db) => db.prepare("UPDATE telegram_notices SET status = 'sent', message_id = ?, sent_at = ?, error = NULL WHERE key = ?").run(messageId, now(), notice.key))
            sent.push(notice.key)
        } catch (error: unknown) {
            const refusal = asRefusal(error)
            withChannelStore((db) => db.prepare("UPDATE telegram_notices SET status = 'failed', error = ? WHERE key = ?").run(`${refusal.code}: ${refusal.message}`, notice.key))
            failed.push(notice.key)
        }
    })
    return { sent, failed, deferred }
}

/**
 * The notice round of `supervisor tick`, so notices go out with no bridge running: nothing (and no call) until the owner's chat
 * is stored and the token set; a failure of Telegram or of the secret loader is reported, never thrown, so it never fails the tick. The claims make it
 * safe beside a running bridge.
 */
export const tickNotices = async (): Promise<{ readonly sweep: Sweep | null; readonly line: string | null }> => {
    const config = loadTelegram()
    const channel = withChannelStore(readChannel)
    if (channel.chatId === null || channel.connectedAt === null) return { sweep: null, line: null }
    try {
        if (tokenSource(config) === null) return { sweep: null, line: null }
        const sweep = await sweepNotices(telegramBot(config), { ...channel, chatId: channel.chatId, connectedAt: channel.connectedAt })
        const sent = sweep.sent.length + sweep.failed.length === 0 ? null : `telegram: sent ${String(sweep.sent.length)}, failed ${String(sweep.failed.length)}, deferred ${String(sweep.deferred)}`
        return { sweep, line: sent }
    } catch (error: unknown) {
        const refusal = asRefusal(error)
        return { sweep: null, line: `telegram: ${refusal.code}: ${refusal.message}` }
    }
}

const claimable = (key: string, tries: number): boolean =>
    withChannelStore((db) => {
        const row = db.prepare("SELECT status, tries FROM telegram_notices WHERE key = ?").get(key)
        return row === undefined || (row.status === "failed" && Number(row.tries) < tries)
    })

/** The notice a reply answers, by the message it replies to, or by the subject `/answer` names. */
interface NoticeRow {
    readonly kind: string
    readonly project: Project
    readonly workflow: string | null
    readonly subject: string
}

const toNoticeRow = (row: Record<string, unknown> | undefined): NoticeRow | undefined =>
    row === undefined
        ? undefined
        : { kind: String(row.kind), project: { key: String(row.project), root: String(row.project_root), name: basename(String(row.project_root)) }, workflow: textOf(row.workflow_id), subject: String(row.subject) }

const noticeByMessage = (chatId: string, messageId: number): NoticeRow | undefined =>
    withChannelStore((db) => toNoticeRow(db.prepare("SELECT * FROM telegram_notices WHERE chat_id = ? AND message_id = ?").get(chatId, messageId)))

const noticeBySubject = (subject: string): NoticeRow | undefined =>
    withChannelStore((db) => toNoticeRow(db.prepare("SELECT * FROM telegram_notices WHERE subject = ? ORDER BY at DESC LIMIT 1").get(subject)))

/**
 * The project an `/ask` names: by its name (the Work-root checkout's folder) or its key, among the projects with a Supervisor
 * and those of the registered repositories holding a ledger.
 */
const projectNamed = async (name: string): Promise<{ readonly project: Project | undefined; readonly known: readonly string[] }> => {
    const candidates = [...liveSupervisors().map(projectOfRecord), ...(await repositoryProjects()).map(({ project }) => project)]
    const projects = [...new Map(candidates.map((project) => [project.key, project])).values()]
    const wanted = name.toLowerCase()
    return { project: projects.find((project) => project.name.toLowerCase() === wanted || project.key === name), known: projects.map((project) => project.name) }
}

const HELP = "Reply to a StarCi question to answer it, or send /answer <ticket id> <answer>, /ask <project> <request>, /status for the workflows, /tickets for the open tickets."

const STATUS_ORDER = ["blocked", "running", "paused", "stopping", "defined", "done", "stopped"] as const

/**
 * `/status`: one message summing up the workflows of every registered repository on demand, the notices left out of
 * ops/telegram.yaml `notices` read here instead: per project the count by status, then each blocked workflow with its reason and
 * each running or paused one, then the questions awaiting the owner and the open defect tickets.
 */
const statusMessage = async (chars: number): Promise<string> => {
    const byProject = new Map<string, { readonly name: string; readonly workflows: Map<string, WorkflowRow> }>()
    for (const { repo, project } of await repositoryProjects()) {
        const db = openExistingLedger(repo)
        if (db === undefined) continue
        try {
            const entry = byProject.get(project.key) ?? { name: project.name, workflows: new Map<string, WorkflowRow>() }
            for (const workflow of listWorkflows(db)) if (!entry.workflows.has(workflow.id)) entry.workflows.set(workflow.id, workflow)
            byProject.set(project.key, entry)
        } finally {
            db.close()
        }
    }
    const projects = [...byProject.values()].filter((entry) => entry.workflows.size > 0).toSorted((a, b) => a.name.localeCompare(b.name))
    const lines = projects.flatMap(({ name, workflows }) => {
        const all = [...workflows.values()]
        const counts = STATUS_ORDER.flatMap((status) => {
            const n = all.filter((workflow) => workflow.status === status).length
            return n === 0 ? [] : [`${String(n)} ${status}`]
        })
        const live = STATUS_ORDER.slice(0, 3).flatMap((status) => all.filter((workflow) => workflow.status === status).toSorted((a, b) => a.id.localeCompare(b.id)))
        return [
            `<b>${escapeHtml(name)}</b>: ${counts.join(", ")}`,
            ...live.map((workflow) => `${workflow.status === "blocked" ? "🔴" : workflow.status === "paused" ? "⏸" : "🟢"} ${escapeHtml(workflow.id)} ${workflow.status}${workflow.status === "blocked" && workflow.reason !== null ? `: ${escapeHtml(clip(workflow.reason, chars))}` : ""}`),
        ]
    })
    const open = [...listTickets({ state: "open" }), ...listTickets({ state: "in-progress" })]
    const questions = open.filter((ticket) => isQuestion(ticket.kind)).length
    const tickets = `Câu hỏi chờ trả lời: ${String(questions)} · ticket lỗi đang mở: ${String(open.length - questions)} (/tickets)`
    const body = lines.length === 0 ? ["Không có workflow nào."] : lines
    // One Telegram message holds 4096 characters: whole lines are dropped from the end, never cut through an HTML tag.
    const kept: string[] = []
    let length = tickets.length + 40
    for (const line of body) {
        if (length + line.length + 1 > 4000) {
            kept.push("…")
            break
        }
        kept.push(line)
        length += line.length + 1
    }
    return ["📊 <b>Trạng thái workflow</b>", ...kept, tickets].join("\n")
}

/** What the owner's message asks: a request for a project, or a reply explaining why nothing was recorded. */
type Target = { readonly project: Project; readonly text: string; readonly ticket?: string; readonly body?: string } | { readonly reply: string; readonly outcome: string; readonly html?: boolean; readonly keyboard?: Keyboard }

const answerText = (notice: NoticeRow, body: string): string => {
    if (notice.kind === "decision") return `Owner answer to ${notice.subject}${notice.workflow === null ? "" : ` (workflow ${notice.workflow})`}, via Telegram: ${body}`
    return `Owner, via Telegram, about ${notice.kind} ${notice.subject}: ${body}`
}

/** The target of an answer to a notice: an owner request carrying it, and for a ticket's notice the ticket and the bare answer. */
const answerTarget = (notice: NoticeRow, body: string): Target => ({ project: notice.project, text: answerText(notice, body), ...(notice.kind === "ticket" ? { ticket: notice.subject, body } : {}) })

const COMMAND = /^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/

/** Reads what an owner message asks: `/answer <id> <text>`, `/ask <project> <text>`, or a reply to a notice. */
const targetOf = async (message: TelegramMessage, chatId: string): Promise<Target> => {
    const text = (message.text ?? "").trim()
    const command = COMMAND.exec(text)
    if (command !== null) {
        const verb = (command[1] ?? "").toLowerCase()
        const [first = "", ...rest] = (command[2] ?? "").trim().split(/\s+/)
        const body = rest.join(" ").trim()
        if (verb === "answer") {
            const notice = noticeBySubject(first)
            if (notice === undefined) return { reply: `No notice ${first || "(no id)"} was sent here. ${HELP}`, outcome: "unknown subject" }
            if (body === "") return { reply: `Say the answer after the id: /answer ${first} <your answer>.`, outcome: "empty" }
            return answerTarget(notice, body)
        }
        if (verb === "ask") {
            const { project, known } = await projectNamed(first)
            if (project === undefined) return { reply: `No project ${first || "(no name)"}; projects: ${known.join(", ") || "none registered"}.`, outcome: "unknown project" }
            if (body === "") return { reply: `Say the request after the project: /ask ${project.name} <request>.`, outcome: "empty" }
            return { project, text: body }
        }
        if (verb === "status") return { reply: await statusMessage(loadTelegram().questionChars), outcome: "status", html: true }
        if (verb === "tickets") {
            const list = openTicketsMessage()
            return { reply: list.text, outcome: "tickets", html: true, keyboard: list.keyboard }
        }
        if (verb === "ticket") {
            const ticket = findTicket(first)
            if (ticket === undefined) return { reply: `No ticket ${first || "(no id)"}; /tickets lists the open ones.`, outcome: "unknown ticket" }
            return { reply: ticketDetails(ticket), outcome: `ticket ${ticket.id}`, html: true }
        }
        return { reply: HELP, outcome: `help (/${verb})` }
    }
    const replied = message.reply_to_message?.message_id
    const notice = replied === undefined ? undefined : noticeByMessage(chatId, replied)
    const pending = notice === undefined && replied === undefined && text !== "" ? takePending() : null
    const asked = pending === null ? undefined : findTicket(pending)
    if (asked !== undefined && isLive(asked.state)) return { project: asked.project, text: `Owner, via Telegram, about ticket ${asked.id}: ${text}`, ticket: asked.id, body: text }
    if (notice === undefined) return { reply: HELP, outcome: "no target" }
    if (text === "") return { reply: "Only text replies are read.", outcome: "empty" }
    return answerTarget(notice, text)
}

const ACCEPT_DEFAULT = /^(?:default|accept|ok|yes)\.?$/i

/**
 * Answers a live question ticket with the owner's words (`default` accepts its proposed default), recorded as the owner's with
 * why, which releases what waits on it and wakes its Supervisor (`wakeOnClose`); undefined when the ticket is no live question,
 * whose answer then goes to the Supervisor as an owner request.
 */
const answerQuestion = async (id: string, body: string, cwd: string): Promise<{ readonly answer: string; readonly request: string | null } | undefined> => {
    const ticket = findTicket(id)
    if (ticket === undefined || !isQuestion(ticket.kind) || !isLive(ticket.state)) return undefined
    const proposed = ticket.proposedDefault
    const accepted = ACCEPT_DEFAULT.test(body.trim()) && proposed !== null
    const answer = accepted ? proposed : body
    const closed = closeTicket(id, { state: "answered", answer, why: accepted ? "the owner accepted the proposed default, via Telegram" : "the owner's call, via Telegram" }, "owner")
    const woken = await wakeOnClose(closed, "owner", cwd)
    return { answer, request: woken[0]?.request ?? null }
}

/** The chat an update came from: its message's, or the chat of the message whose button was pressed. */
const chatOfUpdate = (update: TelegramUpdate): string | null => {
    const chat = update.message?.chat.id ?? update.callback_query?.message?.chat.id
    return chat === undefined ? null : String(chat)
}

/** Claims an update once: false when an earlier run handled it already. */
const claimUpdate = (update: TelegramUpdate, owner: boolean): boolean =>
    withChannelStore(
        (db) =>
            db.prepare("INSERT INTO telegram_inbound (update_id, chat_id, owner, outcome, at) VALUES (?, ?, ?, 'reading', ?) ON CONFLICT DO NOTHING").run(update.update_id, chatOfUpdate(update), owner ? 1 : 0, now()).changes > 0,
    )

const settleUpdate = (updateId: number, outcome: string, request: string | null, project: string | null): void => {
    withChannelStore((db) => db.prepare("UPDATE telegram_inbound SET outcome = ?, request_id = ?, project = ? WHERE update_id = ?").run(outcome, request, project, updateId))
}

/** What the bridge did with one update, as its log line says. */
export interface Handled {
    readonly update: number
    readonly outcome: string
    readonly request: string | null
}

/**
 * Handles one update: a message from a chat other than the owner's is ignored and logged by its chat id alone; the owner's
 * answer to a live question ticket answers it (`answerQuestion`); any other owner message is recorded as an owner request of the project it names (`askSupervisor`, as `supervisor ask` does, by the owner),
 * which wakes the Supervisor, and the owner gets a short receipt. An update handled before is skipped.
 */
export const handleUpdate = async (bot: TelegramBot, chatId: string, update: TelegramUpdate, cwd: string): Promise<Handled | undefined> => {
    const message = update.message
    const callback = update.callback_query
    const owner = chatOfUpdate(update) === chatId
    if (!claimUpdate(update, owner)) return undefined
    if (callback !== undefined) {
        const pressed = owner ? await handleTicketCallback(bot, chatId, callback, cwd) : { outcome: `ignored: foreign callback from chat ${chatOfUpdate(update) ?? "-"}`, request: null }
        settleUpdate(update.update_id, pressed.outcome, pressed.request, null)
        return { update: update.update_id, outcome: pressed.outcome, request: pressed.request }
    }
    if (message === undefined || !owner) {
        const outcome = message === undefined ? "ignored: no message" : `ignored: foreign chat ${String(message.chat.id)} (${message.chat.type})`
        settleUpdate(update.update_id, outcome, null, null)
        return { update: update.update_id, outcome, request: null }
    }
    const target = await targetOf(message, chatId)
    if ("reply" in target) {
        settleUpdate(update.update_id, target.outcome, null, null)
        await sendMessage(bot, chatId, target.reply, message.message_id, { ...(target.html === true ? { html: true } : {}), ...(target.keyboard === undefined ? {} : { keyboard: target.keyboard }) }).catch(() => undefined)
        return { update: update.update_id, outcome: target.outcome, request: null }
    }
    const answered = target.ticket === undefined ? undefined : await answerQuestion(target.ticket, target.body ?? "", cwd)
    if (answered !== undefined) {
        const outcome = `answered ${target.ticket ?? "-"}`
        settleUpdate(update.update_id, outcome, answered.request, target.project.key)
        await sendMessage(bot, chatId, `Answered ${target.ticket ?? "-"}: ${clip(answered.answer, 80)}`, message.message_id).catch(() => undefined)
        return { update: update.update_id, outcome, request: answered.request }
    }
    const { request, mail } = await askSupervisor(target.project, "owner", target.text, cwd)
    settleUpdate(update.update_id, "owner request", request.id, target.project.key)
    await sendMessage(bot, chatId, `Recorded ${request.id} for ${supervisorTitle(target.project.name)}: ${mail}.`, message.message_id).catch(() => undefined)
    return { update: update.update_id, outcome: `owner request ${request.id} for ${target.project.name}`, request: request.id }
}

/** Moves the stored offset past the updates read. */
export const advanceOffset = (updates: readonly TelegramUpdate[]): void => {
    const next = Math.max(...updates.map((update) => update.update_id + 1))
    if (Number.isFinite(next)) withChannelStore((db) => db.prepare("UPDATE telegram_channel SET update_offset = MAX(update_offset, ?) WHERE id = 1").run(next))
}

/** The chats that wrote to the bot among the updates, newest message last, by chat id. */
export const chatsOf = (updates: readonly TelegramUpdate[]): Map<string, string> =>
    new Map(updates.flatMap((update) => (update.message === undefined || update.message.from?.is_bot === true || update.message.chat.type !== "private" ? [] : [[String(update.message.chat.id), chatName(update.message.chat)] as const])))

/**
 * Takes the bridge's one seat on this host: false when another live bridge beat within staleSeconds. The seat's holder stamps
 * its beat every cycle; a holder that finds another pid in the seat stops.
 */
export const takeBridge = (staleSeconds: number): boolean =>
    withChannelStore((db) => {
        const channel = readChannel(db)
        const fresh = channel.bridgeBeat !== null && Date.now() - Date.parse(channel.bridgeBeat) <= staleSeconds * 1000
        if (channel.bridgePid !== null && channel.bridgePid !== process.pid && fresh && processAlive(channel.bridgePid)) return false
        db.prepare("UPDATE telegram_channel SET bridge_pid = ?, bridge_beat = ? WHERE id = 1").run(process.pid, now())
        return true
    })

/** Gives the bridge's seat back, when this process holds it. */
export const releaseBridge = (): void => {
    withChannelStore((db) => db.prepare("UPDATE telegram_channel SET bridge_pid = NULL, bridge_beat = NULL WHERE id = 1 AND bridge_pid = ?").run(process.pid))
}

/** Stamps the bridge's beat; false when another bridge holds the seat now. */
const beat = (): boolean => withChannelStore((db) => db.prepare("UPDATE telegram_channel SET bridge_beat = ? WHERE id = 1 AND bridge_pid = ?").run(now(), process.pid).changes > 0)

/** What one bridge cycle did. */
export interface Cycle {
    readonly sweep: Sweep
    readonly handled: readonly Handled[]
}

/** One bridge cycle: send what is due, then read the owner's messages (waiting up to `waitSeconds`) and record each. */
export const bridgeCycle = async (bot: TelegramBot, cwd: string, waitSeconds: number): Promise<Cycle> => {
    const channel = withChannelStore(readChannel)
    if (channel.chatId === null || channel.connectedAt === null) return { sweep: { sent: [], failed: [], deferred: 0 }, handled: [] }
    const connected = { ...channel, chatId: channel.chatId, connectedAt: channel.connectedAt }
    const sweep = await sweepNotices(bot, connected)
    const updates = await getUpdates(bot, channel.offset, waitSeconds)
    const handled = (await inOrder(updates, async (update) => handleUpdate(bot, connected.chatId, update, cwd))).filter((done): done is Handled => done !== undefined)
    advanceOffset(updates)
    return { sweep, handled }
}

/** Runs bridge cycles until another bridge takes the seat; a failed cycle is logged and retried after a pause. */
export const runBridge = async (bot: TelegramBot, cwd: string, log: (line: string) => void): Promise<void> => {
    for (;;) {
        if (!beat()) {
            log("telegram bridge: another bridge holds the seat; stopping")
            return
        }
        try {
            const cycle = await bridgeCycle(bot, cwd, bot.config.pollSeconds)
            for (const key of cycle.sweep.sent) log(`sent ${key}`)
            for (const key of cycle.sweep.failed) log(`send failed ${key}`)
            for (const done of cycle.handled) log(`update ${String(done.update)}: ${done.outcome}`)
        } catch (error: unknown) {
            const refusal = asRefusal(error)
            log(`telegram bridge: ${refusal.code}: ${refusal.message}`)
            if (refusal.code === "TELEGRAM_TOKEN_REJECTED") throw refusal
            await sleep(5000)
        }
    }
}
