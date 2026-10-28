import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { asRefusal } from "../shared/errors.js"
import { redactSecrets } from "../shared/secrets.js"
import { now } from "./ledger.js"
import { textOf } from "./machine.js"
import { locateOps } from "./ops.js"
import { answerCallback, editKeyboard, escapeHtml, sendMessage, sendPhoto, withChannelStore } from "./telegram.js"
import type { Keyboard, TelegramBot, TelegramCallback, TelegramConfig } from "./telegram.js"
import { closeLine, closeTicket, findTicket, isLive, isQuestion, listTickets, reopenTicket, takeTicket, ticketsClosedSince, waitersOf, wakeOnClose } from "./tickets.js"
import type { Ticket, TicketKind } from "./tickets.js"

/** Which notice of a ticket a card is: a defect's opening, a question put to the owner, its reminder, or an end. */
export type CardStage = "open" | "ask" | "remind" | "closed"

const KIND_LABEL: Readonly<Record<TicketKind, string>> = {
    "harness-defect": "lỗi harness",
    package: "lỗi package",
    launch: "lỗi khởi chạy",
    verify: "lỗi kiểm tra",
    routing: "lỗi định tuyến",
    other: "lỗi khác",
    "question:business": "câu hỏi nghiệp vụ",
    "question:code": "câu hỏi code",
    "question:spec": "câu hỏi đặc tả",
}

const clip = (text: string, chars: number): string => {
    const flat = text.replaceAll(/\s+/g, " ").trim()
    return flat.length <= chars ? flat : `${flat.slice(0, chars - 1)}…`
}

const html = (text: string, chars: number): string => escapeHtml(clip(text, chars))

/** The tone marker of a card: red for a blocking defect, white for another, amber for a question, green for a fix or an answer, grey for any other end. */
const toneOf = (ticket: Ticket, stage: CardStage): string => {
    if (stage === "closed") return ticket.state === "fixed" || ticket.state === "answered" ? "🟢" : "⚪"
    if (isQuestion(ticket.kind)) return "🟠"
    return ticket.severity === "blocking" ? "🔴" : "⚪"
}

const where = (ticket: Ticket): string => `Dự án: ${escapeHtml(ticket.project.name || "harness")}${ticket.workflow === null ? "" : ` · workflow ${escapeHtml(ticket.workflow)}`}`

/**
 * A ticket card's caption, the facts the banner never carries (an HTML caption, at most Telegram's 1024 characters): the id, kind,
 * severity, title, project, workflow, occurrences and what was tried; a question's proposed default and how to answer; an end's
 * fix, reason or answer.
 */
export const ticketCaption = (ticket: Ticket, stage: CardStage, chars: number): string => {
    const field = Math.min(chars, 260)
    const head = `${toneOf(ticket, stage)} <b>${isQuestion(ticket.kind) ? "Câu hỏi" : "Ticket"} ${ticket.id}</b> · ${KIND_LABEL[ticket.kind]}${ticket.evidence.topic === undefined ? "" : ` (${escapeHtml(ticket.evidence.topic)})`}${isQuestion(ticket.kind) ? "" : `, ${ticket.severity === "blocking" ? "chặn" : "thường"}`}`
    const tried = ticket.tried === null ? [] : [`Đã thử: ${html(ticket.tried, field)}`]
    if (stage === "remind") return [`⏰ <b>Nhắc: câu hỏi ${ticket.id}</b> vẫn chờ câu trả lời.`, `<b>${html(ticket.title, field)}</b>`, where(ticket), `Trả lời: chọn nút, trả lời tin này, hoặc /answer ${ticket.id} &lt;câu trả lời&gt;.`].join("\n").slice(0, 1024)
    const lines =
        stage === "ask"
            ? [
                  head,
                  `<b>${html(ticket.title, field)}</b>`,
                  where(ticket),
                  ticket.proposedDefault === null ? "Chưa có mặc định đề xuất." : `Mặc định đề xuất: ${html(ticket.proposedDefault, field)}`,
                  ...tried,
                  `Trả lời: chọn nút, trả lời tin này, hoặc /answer ${ticket.id} &lt;câu trả lời&gt;.`,
              ]
            : stage === "open"
              ? [
                    head,
                    `<b>${html(ticket.title, field)}</b>`,
                    where(ticket),
                    `Đã gặp: ${String(ticket.occurrences)} lần${ticket.round > 1 ? ` · mở lại, bản sửa ${escapeHtml(ticket.fixedBy ?? "-")} chưa giữ được` : ""}`,
                    ...tried,
                    "Claude Debug xử lý; bạn không cần làm gì.",
                ]
              : [head, `<b>${html(ticket.title, field)}</b>`, where(ticket), endLine(ticket, field)]
    return lines.join("\n").slice(0, 1024)
}

const endLine = (ticket: Ticket, chars: number): string => {
    if (ticket.state === "fixed") return `Đã sửa bởi commit ${escapeHtml(ticket.fixedBy ?? "-")}.`
    if (ticket.state === "wontfix") return `Không sửa: ${html(ticket.reason ?? "-", chars)}`
    if (ticket.state === "duplicate") return `Trùng với ${escapeHtml(ticket.duplicateOf ?? "-")}.`
    return `Đã trả lời (${escapeHtml(ticket.closedBy ?? "-")}): ${html(ticket.answer ?? "-", chars)}`
}

/** The callback data of a button, at most 64 bytes: `tk:<action>[:<ticket>[:<choice>]]`. */
const data = (action: string, id?: string, choice?: string): string => ["tk", action, ...(id === undefined ? [] : [id]), ...(choice === undefined ? [] : [choice])].join(":")

const LIST_BUTTON = { text: "Danh sách ticket", callback_data: data("l") }

/**
 * A card's inline keyboard. A defect: details, hand to Debug, the ticket list, mute for an hour. A question: accept the default,
 * one button per other answer its asker listed, and another answer (the next text the owner sends). A fix: the commit's link
 * and reopen.
 */
export const ticketKeyboard = (ticket: Ticket, stage: CardStage, config: TelegramConfig): Keyboard => {
    const id = ticket.id
    if (stage === "ask" || stage === "remind") {
        return [
            ...(ticket.proposedDefault === null ? [] : [[{ text: "Đồng ý mặc định", callback_data: data("a", id, "d") }]]),
            ...ticket.options.slice(0, 8).map((option, index) => [{ text: clip(option, 60), callback_data: data("a", id, String(index)) }]),
            [{ text: "Trả lời khác…", callback_data: data("r", id) }],
        ]
    }
    if (stage === "closed") {
        const commit = ticket.state === "fixed" && ticket.fixedBy !== null ? [{ text: "Xem commit", url: config.commitUrl.replace("{sha}", ticket.fixedBy) }] : []
        return [[...commit, ...(isQuestion(ticket.kind) ? [] : [{ text: "Mở lại", callback_data: data("o", id) }])], [{ text: "Xem chi tiết", callback_data: data("d", id) }]].filter((row) => row.length > 0)
    }
    return [
        [
            { text: "Xem chi tiết", callback_data: data("d", id) },
            { text: "Giao Debug", callback_data: data("g", id) },
        ],
        [LIST_BUTTON, { text: "Tắt tiếng 1h", callback_data: data("m") }],
    ]
}

/**
 * The channel's ticket tables, additive in the host store: the banner's Telegram file id per content hash (uploaded once, then
 * reused), the defect notices' mute, and the ticket the owner's next text answers ("Trả lời khác…").
 */
const TABLES = `
CREATE TABLE IF NOT EXISTS telegram_files (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, file_id TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS telegram_mutes (scope TEXT PRIMARY KEY, until TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS telegram_pending (id INTEGER PRIMARY KEY CHECK (id = 1), ticket_id TEXT NOT NULL, at TEXT NOT NULL);
`

const withTicketTables = <T>(work: (db: DatabaseSync) => T): T =>
    withChannelStore((db) => {
        db.exec(TABLES)
        return work(db)
    })

/** Until when the defect notices are held back by "Tắt tiếng 1h", or null. */
export const mutedUntil = (): string | null =>
    withTicketTables((db) => {
        const until = textOf(db.prepare("SELECT until FROM telegram_mutes WHERE scope = 'defects'").get()?.until)
        return until !== null && until > now() ? until : null
    })

const mute = (minutes: number): string =>
    withTicketTables((db) => {
        const until = new Date(Date.now() + minutes * 60_000).toISOString()
        db.prepare("INSERT INTO telegram_mutes (scope, until) VALUES ('defects', ?) ON CONFLICT (scope) DO UPDATE SET until = excluded.until").run(until)
        return until
    })

/** Takes the question the owner's next text answers, once. */
export const takePending = (): string | null =>
    withTicketTables((db) => {
        const id = textOf(db.prepare("SELECT ticket_id FROM telegram_pending WHERE id = 1").get()?.ticket_id)
        db.prepare("DELETE FROM telegram_pending WHERE id = 1").run()
        return id
    })

/**
 * Sends a ticket card: the one banner (ops/telegram.yaml `banner`) with the caption and the keyboard, uploaded once and then sent
 * by the file id Telegram keeps it under (uploaded again when the banner's content changed or the id is refused); with no
 * banner file, the caption as an HTML message. Returns the message id the owner replies to.
 */
export const sendTicketCard = async (bot: TelegramBot, chatId: string, caption: string, keyboard: Keyboard): Promise<number> => {
    const file = join(locateOps(), bot.config.banner)
    if (!existsSync(file)) return sendMessage(bot, chatId, caption, undefined, { html: true, keyboard })
    const sha256 = createHash("sha256").update(readFileSync(file)).digest("hex")
    const known = withTicketTables((db) => textOf(db.prepare("SELECT file_id FROM telegram_files WHERE name = ? AND sha256 = ?").get(bot.config.banner, sha256)?.file_id))
    if (known !== null) {
        try {
            return (await sendPhoto(bot, chatId, { fileId: known }, caption, { keyboard })).messageId
        } catch (error: unknown) {
            if (asRefusal(error).code !== "TELEGRAM_API") throw error
        }
    }
    const sent = await sendPhoto(bot, chatId, { file }, caption, { keyboard })
    const fileId = sent.fileId
    if (fileId !== null) withTicketTables((db) => db.prepare("INSERT INTO telegram_files (name, sha256, file_id, at) VALUES (?, ?, ?, ?) ON CONFLICT (name) DO UPDATE SET sha256 = excluded.sha256, file_id = excluded.file_id, at = excluded.at").run(bot.config.banner, sha256, fileId, now()))
    return sent.messageId
}

/** One ticket in full, redacted, for `/ticket <id>` and "Xem chi tiết": its facts, evidence, waiters and the red tail. */
export const ticketDetails = (ticket: Ticket): string => {
    const evidence = ticket.evidence
    const waiters = waitersOf(ticket.id)
    const tail = evidence.tail === undefined ? "" : redactSecrets(evidence.tail).split("\n").slice(-25).join("\n").slice(-1500)
    return [
        `${toneOf(ticket, isLive(ticket.state) ? (isQuestion(ticket.kind) ? "ask" : "open") : "closed")} <b>${ticket.id}</b> · ${KIND_LABEL[ticket.kind]} · ${escapeHtml(isLive(ticket.state) ? ticket.state : closeLine(ticket))}`,
        `<b>${html(ticket.title, 400)}</b>`,
        where(ticket),
        `Mức: ${ticket.severity === "blocking" ? "chặn" : "thường"} · đã gặp ${String(ticket.occurrences)} lần · vòng ${String(ticket.round)}`,
        `Mở bởi: ${escapeHtml(ticket.openedBy)} · báo bởi: ${escapeHtml(ticket.reporters.join(", "))}${ticket.takenBy === null ? "" : ` · nhận bởi: ${escapeHtml(ticket.takenBy)}`}`,
        ...(["task", "attempt", "seat", "decision"] as const).flatMap((key) => (evidence[key] === undefined ? [] : [`${key}: ${escapeHtml(evidence[key])}`])),
        ...(ticket.tried === null ? [] : [`Đã thử: ${html(ticket.tried, 400)}`]),
        ...(ticket.proposedDefault === null ? [] : [`Mặc định đề xuất: ${html(ticket.proposedDefault, 300)}`]),
        ...ticket.options.map((option, index) => `Lựa chọn ${String(index + 1)}: ${html(option, 200)}`),
        ...waiters.map((waiter) => `Chờ: ${escapeHtml(waiter.subject)}${waiter.releasedAt === null ? "" : " (đã giải phóng)"}`),
        ...(tail === "" ? [] : [`<pre>${escapeHtml(tail)}</pre>`]),
    ].join("\n")
}

/** The open tickets, blocking first then by occurrences, as a message with one button per ticket and "Đã đóng hôm nay". */
export const openTicketsMessage = (): { readonly text: string; readonly keyboard: Keyboard } => {
    const open = [...listTickets({ state: "open" }), ...listTickets({ state: "in-progress" })].toSorted((a, b) => Number(a.severity !== "blocking") - Number(b.severity !== "blocking") || b.occurrences - a.occurrences)
    const text = open.length === 0 ? "📋 Không có ticket nào đang mở." : [`📋 <b>Ticket đang mở (${String(open.length)})</b>`, ...open.map((ticket) => `${toneOf(ticket, isQuestion(ticket.kind) ? "ask" : "open")} ${ticket.id} · ${html(ticket.title, 80)} (${String(ticket.occurrences)} lần)`)].join("\n")
    return { text, keyboard: [...open.slice(0, 20).map((ticket) => [{ text: `${ticket.id} · ${clip(ticket.title, 32)}`, callback_data: data("d", ticket.id) }]), [{ text: "Đã đóng hôm nay", callback_data: data("c") }]] }
}

const closedTodayMessage = (): string => {
    const midnight = new Date()
    midnight.setHours(0, 0, 0, 0)
    const closed = ticketsClosedSince(midnight.toISOString())
    return closed.length === 0 ? "Hôm nay chưa đóng ticket nào." : [`✅ <b>Đã đóng hôm nay (${String(closed.length)})</b>`, ...closed.map((ticket) => `${ticket.id} · ${html(ticket.title, 80)}: ${html(closeLine(ticket), 120)}`)].join("\n")
}

const CALLBACK = /^tk:([dglcmaro])(?::(tk-[0-9a-f]{12}))?(?::(d|\d{1,2}))?$/

/** What a button press did, as the bridge logs it. */
export interface Pressed {
    readonly outcome: string
    readonly request: string | null
}

/**
 * Handles a press of a ticket card's button by the owner's chat (a press from any other chat is the caller's to ignore): it
 * acts through the ticket verbs' functions (details, hand to Debug, the lists, mute, an answer by the default or an option, the
 * next text as the answer, reopen), answers the press with a short toast, and edits the card's keyboard to show the new state.
 */
export const handleTicketCallback = async (bot: TelegramBot, chatId: string, callback: TelegramCallback, cwd: string): Promise<Pressed> => {
    const match = CALLBACK.exec(callback.data ?? "")
    const messageId = callback.message?.message_id
    const toast = async (text: string): Promise<void> => {
        await answerCallback(bot, callback.id, text).catch(() => undefined)
    }
    const edit = async (keyboard: Keyboard): Promise<void> => {
        if (messageId !== undefined) await editKeyboard(bot, chatId, messageId, keyboard).catch(() => undefined)
    }
    if (match === null) {
        await toast("Nút không còn dùng được.")
        return { outcome: `callback: unknown ${callback.data ?? "-"}`, request: null }
    }
    const [, action = "", id, choice] = match
    const ticket = id === undefined ? undefined : findTicket(id)
    if (id !== undefined && ticket === undefined) {
        await toast(`Không có ticket ${id}.`)
        return { outcome: `callback ${action}: no ticket ${id}`, request: null }
    }
    try {
        if (action === "l") {
            const list = openTicketsMessage()
            await sendMessage(bot, chatId, list.text, undefined, { html: true, keyboard: list.keyboard })
            await toast("Đã gửi danh sách.")
            return { outcome: "callback: list", request: null }
        }
        if (action === "c") {
            await sendMessage(bot, chatId, closedTodayMessage(), undefined, { html: true })
            await toast("Đã gửi danh sách đã đóng.")
            return { outcome: "callback: closed today", request: null }
        }
        if (action === "m") {
            const until = mute(bot.config.muteMinutes)
            await toast(`Tắt tiếng lỗi đến ${until.slice(11, 16)} UTC.`)
            return { outcome: `callback: muted until ${until}`, request: null }
        }
        if (ticket === undefined) throw new Error(`tk:${action} needs a ticket`)
        if (action === "d") {
            await sendMessage(bot, chatId, ticketDetails(ticket), messageId, { html: true })
            await toast("Đã gửi chi tiết.")
            return { outcome: `callback: details ${ticket.id}`, request: null }
        }
        if (action === "g") {
            const taken = takeTicket(ticket.id, "debug (owner)")
            await edit([[{ text: "✅ Đã giao Debug", callback_data: data("d", taken.id) }], [LIST_BUTTON]])
            await toast("Đã giao cho Debug.")
            return { outcome: `callback: ${ticket.id} handed to Debug`, request: null }
        }
        if (action === "o") {
            const reopened = reopenTicket(ticket.id)
            await edit([[{ text: "🔁 Đã mở lại", callback_data: data("d", reopened.id) }]])
            await toast("Đã mở lại ticket.")
            return { outcome: `callback: ${ticket.id} reopened`, request: null }
        }
        if (action === "r") {
            withTicketTables((db) => db.prepare("INSERT INTO telegram_pending (id, ticket_id, at) VALUES (1, ?, ?) ON CONFLICT (id) DO UPDATE SET ticket_id = excluded.ticket_id, at = excluded.at").run(ticket.id, now()))
            await toast("Gửi câu trả lời ở tin nhắn tiếp theo.")
            return { outcome: `callback: next text answers ${ticket.id}`, request: null }
        }
        const answer = choice === "d" ? ticket.proposedDefault : ticket.options[Number(choice)]
        if (answer === undefined || answer === null) {
            await toast("Lựa chọn này không còn.")
            return { outcome: `callback: ${ticket.id} has no choice ${choice ?? "-"}`, request: null }
        }
        const closed = closeTicket(ticket.id, { state: "answered", answer, why: choice === "d" ? "the owner accepted the proposed default, via Telegram" : "the owner chose a listed answer, via Telegram" }, "owner")
        const woken = await wakeOnClose(closed, "owner", cwd)
        await edit([[{ text: `✅ Đã trả lời: ${clip(answer, 40)}`, callback_data: data("d", ticket.id) }]])
        await toast("Đã ghi câu trả lời.")
        return { outcome: `callback: answered ${ticket.id}`, request: woken[0]?.request ?? null }
    } catch (error: unknown) {
        const refusal = asRefusal(error)
        await toast(clip(`${refusal.code}: ${refusal.message}`, 180))
        return { outcome: `callback ${action}: ${refusal.code}`, request: null }
    }
}
