/**
 * The owner chats the monitor bot learns (PROJECT-MONITORING-5). An app environment names its owner by Telegram username
 * (`monitoring.alerts.telegram.owner`), and the Bot API cannot message a user by username: a bot reaches a user only after he wrote to it.
 * So the bot learns the chat when that user (matched case-insensitively) sends it /start, or any message, in a private chat, and keeps it here:
 * one JSON file on the container's volume, so a restart or a redeploy keeps it. Once learned, a chat is pinned: a later private chat under the
 * same username is ignored (a username can change hands), and a changed owner in the config drops the old chat. Until the chat is known, the
 * environment's alerts wait in a bounded queue in memory, posted when the owner connects.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { at } from "./json.js"
import { normalizeUsername } from "./config.js"
import type { WebhookPayload } from "./alerting.js"

/** The key of an environment in the store: stable across renders (a slot is not). */
export const ownerKey = (entry: { readonly project: string; readonly env: string }): string => `${entry.project}/${entry.env}`

/** One learned chat: the username it was learned for and when. */
export interface LearnedChat {
    readonly username: string
    readonly chat: number
    readonly at: string
}

/** The learned chats of every bot of the process; shared by the bots, persisted on every change. */
export interface ChatStore {
    /** The chat learned for `key`, when it was learned for `username` (a changed owner reads none). */
    readonly get: (key: string, username: string) => number | null
    /** Records the chat of `key` and persists the store. */
    readonly set: (key: string, username: string, chat: number, atMs: number) => void
}

/** Parses the store file leniently: an entry that is not a learned chat is dropped (it is learned again on the next /start). */
export const parseStore = (text: string): Map<string, LearnedChat> => {
    const found = new Map<string, LearnedChat>()
    let raw: unknown
    try {
        raw = JSON.parse(text)
    } catch {
        return found
    }
    const chats = at(raw, "chats")
    if (typeof chats !== "object" || chats === null || Array.isArray(chats)) return found
    for (const [key, value] of Object.entries(chats as Record<string, unknown>)) {
        const username = normalizeUsername(at(value, "username"))
        const chat = at(value, "chat")
        const when = at(value, "at")
        if (username !== null && typeof chat === "number" && Number.isSafeInteger(chat) && chat > 0) found.set(key, { username, chat, at: typeof when === "string" ? when : "" })
    }
    return found
}

/** The store's file text. */
export const storeText = (chats: ReadonlyMap<string, LearnedChat>): string => `${JSON.stringify({ version: 1, chats: Object.fromEntries([...chats].sort(([left], [right]) => left.localeCompare(right))) }, null, 2)}\n`

/** A store in memory, persisted through `write` (null: memory only). */
export const memoryStore = (initial: ReadonlyMap<string, LearnedChat>, write: ((text: string) => void) | null): ChatStore => {
    const chats = new Map(initial)
    return {
        get: (key, username) => {
            const found = chats.get(key)
            return found !== undefined && found.username === username ? found.chat : null
        },
        set: (key, username, chat, atMs) => {
            chats.set(key, { username, chat, at: new Date(atMs).toISOString() })
            write?.(storeText(chats))
        },
    }
}

/** The store of the container: `file` on its volume, written whole to a temporary file and renamed, so a crash never leaves half a file. */
export const fileStore = (file: string | null, log: (line: string) => void): ChatStore => {
    if (file === null) return memoryStore(new Map(), null)
    let initial = new Map<string, LearnedChat>()
    try {
        initial = parseStore(readFileSync(file, "utf8"))
    } catch {
        // No file yet: nothing learned.
    }
    return memoryStore(initial, (text) => {
        try {
            mkdirSync(dirname(file), { recursive: true })
            writeFileSync(`${file}.tmp`, text, { mode: 0o600 })
            renameSync(`${file}.tmp`, file)
        } catch (error: unknown) {
            log(`the learned owner chats are not persisted (${file}): ${error instanceof Error ? error.message : String(error)}`)
        }
    })
}

/** How many notifications wait per environment before its owner connects; the oldest is dropped past it. */
export const QUEUE_LIMIT = 50

/** The notifications that wait for an owner's chat, per environment key. */
export interface AlertQueue {
    readonly push: (key: string, payload: WebhookPayload) => void
    /** Takes every waiting notification of `key`, oldest first, and how many were dropped past the limit. */
    readonly take: (key: string) => { readonly payloads: WebhookPayload[]; readonly dropped: number }
    readonly size: (key: string) => number
}

/** A bounded queue of notifications per key. */
export const alertQueue = (limit: number = QUEUE_LIMIT): AlertQueue => {
    const waiting = new Map<string, { payloads: WebhookPayload[]; dropped: number }>()
    return {
        push: (key, payload) => {
            const held = waiting.get(key) ?? { payloads: [], dropped: 0 }
            held.payloads.push(payload)
            while (held.payloads.length > limit) {
                held.payloads.shift()
                held.dropped += 1
            }
            waiting.set(key, held)
        },
        take: (key) => {
            const held = waiting.get(key) ?? { payloads: [], dropped: 0 }
            waiting.delete(key)
            return held
        },
        size: (key) => waiting.get(key)?.payloads.length ?? 0,
    }
}
