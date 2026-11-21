/**
 * The Bot API calls of the monitor bot: long-polled updates (no public webhook), messages in HTML parse mode with inline buttons, edits and
 * callback answers. The token is read from its swarm secret file by the caller and only ever put in the request path; an error names the
 * method, never the URL.
 */
import type { Fetch } from "./clients.js"
import { at } from "./json.js"

/** One inline button: its label and the callback it sends (at most 64 bytes). */
export interface Button {
    readonly text: string
    readonly data: string
}

/** Rows of inline buttons. */
export type Keyboard = readonly (readonly Button[])[]

/** One update of getUpdates, the fields the bot reads. */
export interface Update {
    readonly update_id: number
    readonly message?: { readonly message_id: number; readonly date: number; readonly text?: string; readonly chat: { readonly id: number; readonly type: string }; readonly from?: { readonly id: number } }
    readonly callback_query?: { readonly id: string; readonly data?: string; readonly from: { readonly id: number }; readonly message?: { readonly message_id: number; readonly chat: { readonly id: number } } }
}

/** Telegram's limit of a callback's data. */
export const CALLBACK_LIMIT = 64

/** The keyboard as the API takes it; a button whose data passes the limit is refused, not cut. */
export const replyMarkup = (keyboard: Keyboard): { inline_keyboard: { text: string; callback_data: string }[][] } => ({
    inline_keyboard: keyboard.map((row) =>
        row.map((button) => {
            if (Buffer.byteLength(button.data, "utf8") > CALLBACK_LIMIT) throw new Error(`the callback ${button.data} passes ${String(CALLBACK_LIMIT)} bytes`)
            return { text: button.text, callback_data: button.data }
        }),
    ),
})

/** The Bot API calls of one bot. */
export interface Telegram {
    /** This bot's username (getMe). */
    readonly username: () => Promise<string>
    /** The updates after `offset`, long-polled for `seconds`. */
    readonly updates: (offset: number, seconds: number) => Promise<Update[]>
    /** Sends an HTML message, with buttons when given; its message id. */
    readonly send: (chat: number, html: string, keyboard?: Keyboard) => Promise<number>
    /** Replaces a message's text and buttons. */
    readonly edit: (chat: number, message: number, html: string, keyboard?: Keyboard) => Promise<void>
    /** Answers a pressed button (the spinner stops), with a short notice when given. */
    readonly answer: (callback: string, notice?: string) => Promise<void>
}

/** The Bot API of one bot. `base` is https://api.telegram.org in the container. */
export const telegram = (base: string, token: string, fetcher: Fetch): Telegram => {
    const api = async (method: string, payload: Record<string, unknown>, timeoutMs = 15_000): Promise<unknown> => {
        const response = await fetcher(`${base}/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs) })
        const body: unknown = await response.json().catch(() => ({}))
        if (at(body, "ok") !== true) {
            const code = at(body, "error_code")
            const description = at(body, "description")
            throw new TelegramError(method, typeof code === "number" ? code : response.status, typeof description === "string" ? description : "no description")
        }
        return at(body, "result")
    }
    return {
        username: async () => {
            const name = at(await api("getMe", {}), "username")
            if (typeof name !== "string") throw new Error("getMe answered no username")
            return name
        },
        updates: async (offset, seconds) => {
            const result = await api("getUpdates", { offset, timeout: seconds, allowed_updates: ["message", "callback_query"] }, (seconds + 15) * 1000)
            if (!Array.isArray(result)) throw new Error("getUpdates answered no list")
            // The update fields the bot reads are checked where read (bot.ts compares chat and sender ids, parses the text).
            return result as Update[]
        },
        send: async (chat, html, keyboard) => {
            const id = at(await api("sendMessage", { chat_id: chat, text: html, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...(keyboard === undefined || keyboard.length === 0 ? {} : { reply_markup: replyMarkup(keyboard) }) }), "message_id")
            return typeof id === "number" ? id : 0
        },
        edit: async (chat, message, html, keyboard) => {
            await api("editMessageText", { chat_id: chat, message_id: message, text: html, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...(keyboard === undefined ? {} : { reply_markup: replyMarkup(keyboard) }) })
        },
        answer: async (callback, notice) => {
            await api("answerCallbackQuery", { callback_query_id: callback, ...(notice === undefined ? {} : { text: notice, show_alert: false }) })
        },
    }
}

/** A Bot API call that failed: the method and Telegram's code (409: another poller holds the bot). */
export class TelegramError extends Error {
    constructor(
        readonly method: string,
        readonly code: number,
        description: string,
    ) {
        super(`${method} failed (${String(code)}): ${description}`)
        this.name = "TelegramError"
    }
}
