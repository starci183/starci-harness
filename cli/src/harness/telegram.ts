import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"
import { inTransaction, now, openMachine } from "./ledger.js"
import { textOf } from "./machine.js"
import { locateOps } from "./ops.js"
import { lookupSecret, secretHome } from "./secret-env.js"
import type { SecretSource } from "./secret-env.js"

const configSchema = z.strictObject({
    schema: z.literal("starci/telegram@1"),
    tokenVariable: z.string().regex(/^[A-Z_][A-Z0-9_]*$/),
    apiBase: z.url(),
    pollSeconds: z.number().int().min(0).max(50),
    requestTimeoutSeconds: z.number().int().positive(),
    staleSeconds: z.number().int().positive(),
    sendPerMinute: z.number().int().positive(),
    sendTries: z.number().int().positive(),
    questionChars: z.number().int().min(80).max(3500),
    ticketOccurrences: z.number().int().positive(),
    banner: z.string().regex(/\.png$/),
    commitUrl: z.string().includes("{sha}"),
    muteMinutes: z.number().int().positive(),
})

/** ops/telegram.yaml, validated: the owner's Telegram channel. */
export type TelegramConfig = z.infer<typeof configSchema>

/** Replaces `apiBase` of ops/telegram.yaml; the bench points it at its stand-in. */
export const TELEGRAM_API_ENV = "STARCI_TELEGRAM_API"

/** Loads and validates ops/telegram.yaml from the ops folder (STARCI_OPS_DIR honoured). */
export const loadTelegram = (dir: string = locateOps()): TelegramConfig => {
    const file = join(dir, "telegram.yaml")
    let raw: unknown
    try {
        raw = parse(readFileSync(file, "utf8"))
    } catch (error: unknown) {
        throw new Refusal("OPS_INVALID", `${file} is not readable yaml: ${error instanceof Error ? error.message : String(error)}`)
    }
    const parsed = configSchema.safeParse(raw)
    if (!parsed.success) throw new Refusal("OPS_INVALID", `${file} is invalid: ${z.prettifyError(parsed.error)}`)
    return parsed.data
}

/** Where the bot token comes from (the environment or secret.env), or null when neither sets it; the value is never returned. */
export const tokenSource = (config: TelegramConfig): SecretSource | null => lookupSecret(config.tokenVariable)?.source ?? null

/** A ready Bot API client: the config, the API base and the token, which only `call` uses and every message redacts. */
export interface TelegramBot {
    readonly config: TelegramConfig
    readonly api: string
    /** Calls one Bot API method with a json body, or a multipart form (an upload). */
    readonly call: <T>(method: string, body: Readonly<Record<string, unknown>> | FormData, schema: z.ZodType<T>, waitSeconds?: number) => Promise<T>
}

const replySchema = z.looseObject({ ok: z.boolean(), result: z.unknown().optional(), description: z.string().optional(), error_code: z.number().optional() })

/**
 * The Bot API client of this host, the token read by the secret loader (harness/secret-env.ts), refused TELEGRAM_NOT_CONFIGURED
 * (naming the key and where the owner sets it) when neither the environment nor secret.env sets it. The token goes only into
 * the request URL; every error text has it replaced before it is shown.
 */
export const telegramBot = (config: TelegramConfig = loadTelegram()): TelegramBot => {
    const token = lookupSecret(config.tokenVariable)?.value
    if (token === undefined) throw new Refusal("TELEGRAM_NOT_CONFIGURED", `${config.tokenVariable} is not set; ${secretHome(config.tokenVariable)}`)
    const override = process.env[TELEGRAM_API_ENV]
    const api = (override === undefined || override === "" ? config.apiBase : override).replace(/\/+$/, "")
    const redact = (text: string): string => text.replaceAll(token, "<token>")
    const call = async <T>(method: string, body: Readonly<Record<string, unknown>> | FormData, schema: z.ZodType<T>, waitSeconds = 0): Promise<T> => {
        const form = body instanceof FormData
        let response: Response
        try {
            response = await fetch(`${api}/bot${token}/${method}`, {
                method: "POST",
                ...(form ? { body } : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
                signal: AbortSignal.timeout((config.requestTimeoutSeconds + waitSeconds) * 1000),
            })
        } catch (error: unknown) {
            const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : ""
            throw new Refusal("TELEGRAM_UNREACHABLE", redact(`${method}: ${error instanceof Error ? error.message : String(error)}${cause}`))
        }
        const reply = replySchema.safeParse(await response.json().catch(() => undefined))
        if (!reply.success) throw new Refusal("TELEGRAM_API", `${method}: HTTP ${String(response.status)} with no Bot API answer`)
        if (!reply.data.ok) {
            const code = reply.data.error_code === 401 || reply.data.error_code === 404 ? "TELEGRAM_TOKEN_REJECTED" : "TELEGRAM_API"
            throw new Refusal(code, redact(`${method}: ${String(reply.data.error_code ?? response.status)} ${reply.data.description ?? ""}`.trim()))
        }
        const result = schema.safeParse(reply.data.result)
        if (!result.success) throw new Refusal("TELEGRAM_API", `${method}: unexpected result shape: ${z.prettifyError(result.error)}`)
        return result.data
    }
    return { config, api, call }
}

const chatSchema = z.looseObject({ id: z.number(), type: z.string(), first_name: z.string().optional(), username: z.string().optional(), title: z.string().optional() })

/** One Telegram message as the bridge reads it. */
export const messageSchema = z.looseObject({
    message_id: z.number(),
    chat: chatSchema,
    from: z.looseObject({ id: z.number(), is_bot: z.boolean().optional() }).optional(),
    text: z.string().optional(),
    reply_to_message: z.looseObject({ message_id: z.number() }).optional(),
    photo: z.array(z.looseObject({ file_id: z.string() })).optional(),
})

/** A Telegram message. */
export type TelegramMessage = z.infer<typeof messageSchema>

/** A press of an inline keyboard button: who pressed it, on which message, and its callback data. */
export const callbackSchema = z.looseObject({
    id: z.string(),
    from: z.looseObject({ id: z.number() }),
    message: z.looseObject({ message_id: z.number(), chat: chatSchema }).optional(),
    data: z.string().optional(),
})

/** A button press. */
export type TelegramCallback = z.infer<typeof callbackSchema>

/** One getUpdates entry: messages and button presses are asked for. */
export const updateSchema = z.looseObject({ update_id: z.number(), message: messageSchema.optional(), callback_query: callbackSchema.optional() })

/** A getUpdates entry. */
export type TelegramUpdate = z.infer<typeof updateSchema>

/** Reads the updates from `offset` on, waiting up to `waitSeconds` for one (a long poll). */
export const getUpdates = async (bot: TelegramBot, offset: number, waitSeconds: number): Promise<TelegramUpdate[]> =>
    bot.call("getUpdates", { offset, timeout: waitSeconds, allowed_updates: ["message", "callback_query"] }, z.array(updateSchema), waitSeconds)

/** One inline keyboard button: a callback (its data at most 64 bytes) or a link. */
export type Button = { readonly text: string; readonly callback_data: string } | { readonly text: string; readonly url: string }

/** An inline keyboard: rows of buttons. */
export type Keyboard = readonly (readonly Button[])[]

/** How a message is sent: a reply to a message, HTML formatting, an inline keyboard. */
export interface SendOptions {
    readonly replyTo?: number
    readonly html?: boolean
    readonly keyboard?: Keyboard
}

const sendFields = (options: SendOptions): Record<string, unknown> => ({
    ...(options.replyTo === undefined ? {} : { reply_parameters: { message_id: options.replyTo, allow_sending_without_reply: true } }),
    ...(options.html === true ? { parse_mode: "HTML" } : {}),
    ...(options.keyboard === undefined ? {} : { reply_markup: { inline_keyboard: options.keyboard } }),
})

/** Sends one message (plain text unless `html`; a reply when `replyTo` names a message) and returns its message id. */
export const sendMessage = async (bot: TelegramBot, chatId: string, text: string, replyTo?: number, options: Omit<SendOptions, "replyTo"> = {}): Promise<number> => {
    const sent = await bot.call("sendMessage", { chat_id: chatId, text, link_preview_options: { is_disabled: true }, ...sendFields({ ...options, ...(replyTo === undefined ? {} : { replyTo }) }) }, messageSchema)
    return sent.message_id
}

/** Escapes text for an HTML message. */
export const escapeHtml = (text: string): string => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

/**
 * Sends a picture, uploading a PNG file or naming a file id Telegram already holds, with an HTML caption; returns its message
 * id and the file id Telegram keeps it under, which a later send reuses.
 */
export const sendPhoto = async (bot: TelegramBot, chatId: string, photo: { readonly file: string } | { readonly fileId: string }, caption: string, options: SendOptions = {}): Promise<{ readonly messageId: number; readonly fileId: string | null }> => {
    const fields: Record<string, unknown> = { chat_id: chatId, caption, ...sendFields({ ...options, html: true }) }
    let body: Readonly<Record<string, unknown>> | FormData
    if ("fileId" in photo) body = { ...fields, photo: photo.fileId }
    else {
        const form = new FormData()
        for (const [key, value] of Object.entries(fields)) form.append(key, typeof value === "string" ? value : JSON.stringify(value))
        form.append("photo", new Blob([readFileSync(photo.file)], { type: "image/png" }), "ticket.png")
        body = form
    }
    const sent = await bot.call("sendPhoto", body, messageSchema)
    return { messageId: sent.message_id, fileId: sent.photo?.at(-1)?.file_id ?? null }
}

/** Answers a button press (the small toast the owner sees). */
export const answerCallback = async (bot: TelegramBot, callbackId: string, text: string): Promise<void> => {
    await bot.call("answerCallbackQuery", { callback_query_id: callbackId, text: text.slice(0, 190) }, z.unknown())
}

/** Replaces the inline keyboard of a message the bot sent, to show what a press changed. */
export const editKeyboard = async (bot: TelegramBot, chatId: string, messageId: number, keyboard: Keyboard): Promise<void> => {
    await bot.call("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: keyboard } }, z.unknown())
}

/** The display name of a chat: its title, @username or first name. */
export const chatName = (chat: TelegramMessage["chat"]): string => chat.title ?? (chat.username === undefined ? (chat.first_name ?? String(chat.id)) : `@${chat.username}`)

/**
 * The channel's tables in the host store (machine.sqlite), additive like harness/machine.ts's:
 * - telegram_channel: the one owner chat (`connect telegram discover-chat`), when it was connected (no fact older is noticed),
 *   the getUpdates offset, and the running bridge's pid and beat.
 * - telegram_notices: one row per fact sent, keyed by the fact, so a fact is sent once: its project, workflow, subject (a
 *   decision, request or workflow id), text, status (sending, sent, failed), tries and the message id the owner replies to.
 * - telegram_inbound: one row per update read, so an update is handled once: its chat, whether it was the owner's, the outcome
 *   and the owner request it recorded. The text of a foreign chat is never stored.
 */
const TABLES = `
CREATE TABLE IF NOT EXISTS telegram_channel (
  id INTEGER PRIMARY KEY CHECK (id = 1), chat_id TEXT, chat_name TEXT, connected_at TEXT, update_offset INTEGER NOT NULL DEFAULT 0,
  bridge_pid INTEGER, bridge_beat TEXT);
CREATE TABLE IF NOT EXISTS telegram_notices (
  key TEXT PRIMARY KEY, kind TEXT NOT NULL, project TEXT NOT NULL, project_root TEXT NOT NULL, workflow_id TEXT, subject TEXT NOT NULL,
  text TEXT NOT NULL, status TEXT NOT NULL, tries INTEGER NOT NULL, chat_id TEXT, message_id INTEGER, at TEXT NOT NULL, sent_at TEXT, error TEXT);
CREATE INDEX IF NOT EXISTS telegram_notices_by_message ON telegram_notices (chat_id, message_id);
CREATE INDEX IF NOT EXISTS telegram_notices_by_subject ON telegram_notices (subject, at);
CREATE TABLE IF NOT EXISTS telegram_inbound (
  update_id INTEGER PRIMARY KEY, chat_id TEXT, owner INTEGER NOT NULL, outcome TEXT NOT NULL, request_id TEXT, project TEXT, at TEXT NOT NULL);
INSERT OR IGNORE INTO telegram_channel (id) VALUES (1);
`

/** Runs `work` on the host store with the channel's tables in place, atomically, and closes it. */
export const withChannelStore = <T>(work: (db: DatabaseSync) => T): T => {
    const db = openMachine()
    try {
        db.exec(TABLES)
        return inTransaction(db, () => work(db))
    } finally {
        db.close()
    }
}

/** The owner chat and the bridge's bookkeeping. */
export interface Channel {
    readonly chatId: string | null
    readonly chatName: string | null
    readonly connectedAt: string | null
    readonly offset: number
    readonly bridgePid: number | null
    readonly bridgeBeat: string | null
}

/** Reads the channel row. */
export const readChannel = (db: DatabaseSync): Channel => {
    const row = db.prepare("SELECT * FROM telegram_channel WHERE id = 1").get() ?? {}
    return {
        chatId: textOf(row.chat_id),
        chatName: textOf(row.chat_name),
        connectedAt: textOf(row.connected_at),
        offset: Number(row.update_offset ?? 0),
        bridgePid: typeof row.bridge_pid === "number" ? row.bridge_pid : null,
        bridgeBeat: textOf(row.bridge_beat),
    }
}

/** The channel, refused TELEGRAM_NO_CHAT until `connect telegram discover-chat` stored the owner's chat. */
export const connectedChannel = (): Channel & { readonly chatId: string; readonly connectedAt: string } => {
    const channel = withChannelStore(readChannel)
    if (channel.chatId === null || channel.connectedAt === null) throw new Refusal("TELEGRAM_NO_CHAT", "no owner chat is stored: the owner messages the bot once, then runs starci connect telegram discover-chat")
    return { ...channel, chatId: channel.chatId, connectedAt: channel.connectedAt }
}

/** Stores the owner's chat and the offset past every update read so far; facts older than now are never noticed. */
export const storeChat = (chatId: string, name: string, offset: number): void => {
    withChannelStore((db) => db.prepare("UPDATE telegram_channel SET chat_id = ?, chat_name = ?, connected_at = ?, update_offset = MAX(update_offset, ?) WHERE id = 1").run(chatId, name, now(), offset))
}

/** True while a process of this pid runs on this host. */
export const processAlive = (pid: number): boolean => {
    try {
        process.kill(pid, 0)
        return true
    } catch {
        return false
    }
}

/**
 * The bridge's liveness from its seat: alive while its process runs and it beat within staleSeconds, stale after, absent when no
 * bridge holds the seat.
 */
export const bridgeLiveness = (channel: Channel, config: TelegramConfig): "alive" | "stale" | "absent" => {
    if (channel.bridgeBeat === null || channel.bridgePid === null) return "absent"
    return processAlive(channel.bridgePid) && Date.now() - Date.parse(channel.bridgeBeat) <= config.staleSeconds * 1000 ? "alive" : "stale"
}

/** Counts of the channel's rows, for the status verbs. */
export const channelCounts = (db: DatabaseSync): { readonly notices: Readonly<Record<string, number>>; readonly inbound: { readonly owner: number; readonly ignored: number } } => {
    const notices = Object.fromEntries(db.prepare("SELECT status, COUNT(*) AS n FROM telegram_notices GROUP BY status").all().map((row) => [String(row.status), Number(row.n)]))
    const inbound = db.prepare("SELECT SUM(owner) AS owner, SUM(1 - owner) AS ignored FROM telegram_inbound").get() ?? {}
    return { notices, inbound: { owner: Number(inbound.owner ?? 0), ignored: Number(inbound.ignored ?? 0) } }
}
