import { basename } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { registeredRepositories } from "../core/supervisor/driver.js"
import { asRefusal } from "../shared/errors.js"
import { openDecisions } from "./coordinator-commands.js"
import type { Decision } from "./coordinator-commands.js"
import { now, openExistingLedger } from "./ledger.js"
import { readMachine, textOf } from "./machine.js"
import { askSupervisor } from "./owner-ask.js"
import { inOrder } from "./sequential.js"
import { liveSupervisors, projectOfRecord, supervisorTitle } from "./supervisor.js"
import { chatName, getUpdates, loadTelegram, processAlive, readChannel, sendMessage, telegramBot, tokenPresent, withChannelStore } from "./telegram.js"
import type { Channel, TelegramBot, TelegramMessage, TelegramUpdate } from "./telegram.js"
import { projectOf } from "./work.js"
import type { Project } from "./work.js"
import { listWorkflows } from "./workflow.js"

/** One fact the owner hears about once: an `owner` escalation (a `harness` one is Debug's, never the owner's), an owner request taken up, a workflow that ended. */
interface Notice {
    readonly key: string
    readonly kind: "decision" | "request" | "workflow"
    readonly project: Project
    readonly workflow: string | null
    readonly subject: string
    readonly text: string
    readonly at: string
}

const clip = (text: string, chars: number): string => {
    const flat = text.replaceAll(/\s+/g, " ").trim()
    return flat.length <= chars ? flat : `${flat.slice(0, chars - 1)}…`
}

const field = (value: unknown, name: string): unknown => (typeof value === "object" && value !== null && name in value ? (value as Record<string, unknown>)[name] : undefined)

const escalationOf = (decision: Decision): { readonly kind: string; readonly question: string } => {
    const escalation = field(decision.evidence, "escalation")
    const kind = field(escalation, "kind")
    const question = field(escalation, "question")
    return { kind: typeof kind === "string" ? kind : "", question: typeof question === "string" ? question : decision.subject }
}

const decisionNotice = (project: Project, decision: Decision, chars: number): Notice => {
    const { kind, question } = escalationOf(decision)
    const text = [
        `[StarCi] ${project.name} · workflow ${decision.workflowId}`,
        `Question ${decision.id} (${kind}): ${clip(question, chars)}`,
        `Answer: reply to this message, or send /answer ${decision.id} <your answer>.`,
    ].join("\n")
    return { key: `decision:${decision.id}`, kind: "decision", project, workflow: decision.workflowId, subject: decision.id, text, at: decision.raisedAt }
}

const ENDED: Readonly<Record<string, string>> = { done: "is done", blocked: "is blocked", stopped: "stopped" }

/** The facts of one registered repository's ledger: open `owner` escalations and workflows that ended, since `since`. */
const ledgerNotices = (repo: string, project: Project, since: string, chars: number): Notice[] => {
    const db = openExistingLedger(repo)
    if (db === undefined) return []
    try {
        const decisions = openDecisions(db, "supervisor")
            .filter((decision) => decision.kind === "escalation" && escalationOf(decision).kind === "owner" && decision.raisedAt > since)
            .map((decision) => decisionNotice(project, decision, chars))
        const workflows = listWorkflows(db).flatMap((workflow): Notice[] => {
            const ended = ENDED[workflow.status]
            const at = workflow.updatedAt ?? workflow.createdAt
            if (ended === undefined || at <= since) return []
            const reason = workflow.reason === null ? "" : `: ${clip(workflow.reason, chars)}`
            const text = [`[StarCi] ${project.name} · workflow ${workflow.id} ${ended}${reason}`, `More to do: reply to this message, or send /ask ${project.name} <request>.`].join("\n")
            const key = `workflow:${project.key}:${workflow.id}:${workflow.status}:g${String(workflow.goalVersion)}v${String(workflow.graphVersion)}`
            return [{ key, kind: "workflow", project, workflow: workflow.id, subject: workflow.id, text, at }]
        })
        return [...decisions, ...workflows]
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

/** Every fact noticed since the channel was connected, oldest first. */
const pendingNotices = async (since: string, chars: number): Promise<Notice[]> => {
    const ledgers = (await repositoryProjects()).flatMap(({ repo, project }) => ledgerNotices(repo, project, since, chars))
    return [...ledgers, ...requestNotices(since, chars)].sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key))
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

/** What one sweep did. */
export interface Sweep {
    readonly sent: readonly string[]
    readonly failed: readonly string[]
    readonly deferred: number
}

/**
 * Sends the owner every fact not sent yet, oldest first, within the minute's budget: each fact is claimed once by its key before
 * it is sent (so no fact is sent twice), the rest wait for the next sweep. A send that fails is tried again up to sendTries.
 */
export const sweepNotices = async (bot: TelegramBot, channel: Channel & { readonly chatId: string; readonly connectedAt: string }): Promise<Sweep> => {
    const { config } = bot
    const notices = await pendingNotices(channel.connectedAt, config.questionChars)
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
            const messageId = await sendMessage(bot, channel.chatId, notice.text)
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
 * The notice round of `supervisor tick`, so notices go out with no bridge running: nothing (and no call) until the token is set
 * and the owner's chat stored; a failure of Telegram is reported, never thrown, so it never fails the tick. The claims make it
 * safe beside a running bridge.
 */
export const tickNotices = async (): Promise<{ readonly sweep: Sweep | null; readonly line: string | null }> => {
    const config = loadTelegram()
    const channel = withChannelStore(readChannel)
    if (!tokenPresent(config) || channel.chatId === null || channel.connectedAt === null) return { sweep: null, line: null }
    try {
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

const HELP = "Reply to a StarCi notice to answer it, or send /answer <decision-id> <answer>, or /ask <project> <request>."

/** What the owner's message asks: a request for a project, or a reply explaining why nothing was recorded. */
type Target = { readonly project: Project; readonly text: string } | { readonly reply: string; readonly outcome: string }

const answerText = (notice: NoticeRow, body: string): string => {
    if (notice.kind === "decision") return `Owner answer to ${notice.subject}${notice.workflow === null ? "" : ` (workflow ${notice.workflow})`}, via Telegram: ${body}`
    return `Owner, via Telegram, about ${notice.kind} ${notice.subject}: ${body}`
}

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
            return { project: notice.project, text: answerText(notice, body) }
        }
        if (verb === "ask") {
            const { project, known } = await projectNamed(first)
            if (project === undefined) return { reply: `No project ${first || "(no name)"}; projects: ${known.join(", ") || "none registered"}.`, outcome: "unknown project" }
            if (body === "") return { reply: `Say the request after the project: /ask ${project.name} <request>.`, outcome: "empty" }
            return { project, text: body }
        }
        return { reply: HELP, outcome: `help (/${verb})` }
    }
    const replied = message.reply_to_message?.message_id
    const notice = replied === undefined ? undefined : noticeByMessage(chatId, replied)
    if (notice === undefined) return { reply: HELP, outcome: "no target" }
    if (text === "") return { reply: "Only text replies are read.", outcome: "empty" }
    return { project: notice.project, text: answerText(notice, text) }
}

/** Claims an update once: false when an earlier run handled it already. */
const claimUpdate = (update: TelegramUpdate, owner: boolean): boolean =>
    withChannelStore(
        (db) =>
            db.prepare("INSERT INTO telegram_inbound (update_id, chat_id, owner, outcome, at) VALUES (?, ?, ?, 'reading', ?) ON CONFLICT DO NOTHING").run(update.update_id, update.message === undefined ? null : String(update.message.chat.id), owner ? 1 : 0, now()).changes > 0,
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
 * message is recorded as an owner request of the project it names (`askSupervisor`, as `supervisor ask` does, by the owner),
 * which wakes the Supervisor, and the owner gets a short receipt. An update handled before is skipped.
 */
export const handleUpdate = async (bot: TelegramBot, chatId: string, update: TelegramUpdate, cwd: string): Promise<Handled | undefined> => {
    const message = update.message
    const owner = message !== undefined && String(message.chat.id) === chatId
    if (!claimUpdate(update, owner)) return undefined
    if (message === undefined || !owner) {
        const outcome = message === undefined ? "ignored: no message" : `ignored: foreign chat ${String(message.chat.id)} (${message.chat.type})`
        settleUpdate(update.update_id, outcome, null, null)
        return { update: update.update_id, outcome, request: null }
    }
    const target = await targetOf(message, chatId)
    if ("reply" in target) {
        settleUpdate(update.update_id, target.outcome, null, null)
        await sendMessage(bot, chatId, target.reply, message.message_id).catch(() => undefined)
        return { update: update.update_id, outcome: target.outcome, request: null }
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
