/**
 * One polled bot of the monitor bot service: the app environments that share its token, the updates it answers and the notifications it
 * posts. Only the owner chat of an environment is answered; every other chat is ignored. The owner chat is the one the member seals
 * (ALERTS_TELEGRAM_CHAT_ID, legacy), or the private chat of the owner username (`monitoring.alerts.telegram.owner`) learned when he first writes
 * to the bot (owners.ts): the bot confirms the connection and posts the alerts that waited for it. A write (a silence) needs
 * an admin (config.ts accessOf) and a confirmation button pressed by an admin within 5 minutes; the confirmation lives in memory only, so a
 * restart drops it, and updates older than 2 minutes (a backlog after a restart) are skipped, never replayed.
 */
import { accessOf } from "./config.js"
import type { Access, BotEntry } from "./config.js"
import type { Matcher } from "./clients.js"
import { alertMessage, causeKind, silenceable } from "./alerting.js"
import type { WebhookAlert, WebhookPayload } from "./alerting.js"
import { parseCommand } from "./commands.js"
import type { Command } from "./commands.js"
import { dailyReport, readReply } from "./handlers.js"
import type { Reply, ScopeEnvs, Sources } from "./handlers.js"
import { stackMatcher, topCpu, topMemory } from "./queries.js"
import { escapeHtml, formatBytes, formatDuration, formatNumber } from "./render.js"
import type { Telegram, Update } from "./telegram.js"
import { alertQueue, memoryStore, ownerKey, QUEUE_LIMIT } from "./owners.js"
import type { AlertQueue, ChatStore } from "./owners.js"

/** How long a confirmation waits for its button. */
export const CONFIRM_MS = 300_000

/** How old a message may be and still be answered (a backlog after a restart is skipped). */
export const STALE_MS = 120_000

/** How long an alert's silence offer stays pressable, and how many the bot keeps. */
const OFFER_MS = 86_400_000
const OFFERS_KEPT = 500

/** A pending silence: its matchers and length, the chat it was asked in, and when it lapses. */
interface PendingSilence {
    readonly matchers: readonly Matcher[]
    readonly seconds: number
    readonly label: string
    readonly chat: number
    readonly expires: number
}

/** A silence offer under an alert. */
interface Offer {
    readonly alertname: string
    readonly stack: string
    readonly chat: number
    readonly expires: number
}

/** What a bot needs beyond its entries. */
export interface BotDeps {
    readonly telegram: Telegram
    readonly username: string
    readonly sources: Sources
    readonly id: () => string
    readonly log: (line: string) => void
    /** The learned owner chats, shared by every bot of the process (default: in memory). */
    readonly store?: ChatStore
    /** The notifications waiting for an owner's chat (default: a bounded queue of this bot). */
    readonly queue?: AlertQueue
}

/** The scope of the entries of one chat: the project and the stacks of its environments. */
export const scopeOf = (entries: readonly BotEntry[]): ScopeEnvs => ({
    project: entries[0]?.project ?? "?",
    stacks: entries.map((entry) => entry.stack),
    envs: entries.map((entry) => ({ env: entry.env, stack: entry.stack })),
})

/** The matchers of a silence an app's bot may set: always within its stacks, so it never silences another app's or a host alert. */
export const silenceMatchers = (scope: ScopeEnvs, target: string): Matcher[] => {
    stackMatcher(scope) // refuses an empty scope or a malformed stack name; a stack name holds no regex metacharacter
    const stack: Matcher = { name: "stack", value: scope.stacks.join("|"), isRegex: true, isEqual: true }
    return target === "all" ? [stack] : [{ name: "alertname", value: target, isRegex: false, isEqual: true }, stack]
}

const highest = (accesses: readonly Access[]): Access => (accesses.includes("write") ? "write" : accesses.includes("read") ? "read" : "none")

/** A bot serving the entries of one token: its update handler, its alert poster and its daily report. */
export interface MonitorBot {
    readonly entries: readonly BotEntry[]
    /** The owner chats known now: the sealed ones and the learned ones. */
    readonly chats: () => number[]
    /** Answers one update; an error is logged, never thrown (the poller goes on). */
    readonly handle: (update: Update) => Promise<void>
    /** Posts one notification of Alertmanager to the slot's chat, with its buttons; throws when Telegram refuses (Alertmanager retries). */
    readonly notify: (slot: number, payload: WebhookPayload) => Promise<void>
    /** Posts the daily report to every chat of this bot. */
    readonly report: (day: string) => Promise<void>
    /** The pending confirmations and offers (the specs read them). */
    readonly state: () => { readonly pending: number; readonly offers: number; readonly queued: number }
}

/** A bot serving `entries` (one token). */
export const createBot = (entries: readonly BotEntry[], deps: BotDeps): MonitorBot => {
    const pending = new Map<string, PendingSilence>()
    const offers = new Map<string, Offer>()
    const store = deps.store ?? memoryStore(new Map(), null)
    const queue = deps.queue ?? alertQueue()
    /** The owner chat of an entry: sealed, else learned for its owner username, else none yet. */
    const chatOf = (entry: BotEntry): number | null => entry.chat ?? (entry.owner === null ? null : store.get(ownerKey(entry), entry.owner))
    const chats = (): number[] => [...new Set(entries.map(chatOf).filter((chat): chat is number => chat !== null))]
    const entriesOf = (chat: number): BotEntry[] => entries.filter((entry) => chatOf(entry) === chat)
    const access = (chat: number, from: number | undefined): Access => highest(entriesOf(chat).map((entry) => accessOf({ chat: chatOf(entry), admins: entry.admins }, chat, from)))
    const now = (): number => deps.sources.now()

    const prune = (): void => {
        for (const [key, value] of pending) if (value.expires <= now()) pending.delete(key)
        for (const [key, value] of offers) if (value.expires <= now()) offers.delete(key)
        while (offers.size > OFFERS_KEPT) {
            const oldest = offers.keys().next().value
            if (oldest === undefined) break
            offers.delete(oldest)
        }
    }

    const send = async (chat: number, reply: Reply): Promise<void> => {
        await deps.telegram.send(chat, reply.html, reply.keyboard)
    }

    /** Asks an admin to confirm a silence; the buttons carry the pending id. */
    const askSilence = async (chat: number, matchers: readonly Matcher[], seconds: number, label: string): Promise<void> => {
        prune()
        const key = deps.id()
        pending.set(key, { matchers, seconds, label, chat, expires: now() + CONFIRM_MS })
        await send(chat, {
            html: `🔕 Im lặng <b>${escapeHtml(label)}</b> trong ${formatDuration(seconds)}?\n<i>Chỉ cảnh báo của ${escapeHtml(scopeOf(entriesOf(chat)).project)}; hết hạn xác nhận sau 5 phút.</i>`,
            keyboard: [[{ text: "✅ Xác nhận", data: `s:${key}` }, { text: "Hủy", data: `x:${key}` }]],
        })
    }

    const refuseWrite = async (chat: number): Promise<void> => {
        await send(chat, { html: "⛔ Chỉ admin mới được im lặng cảnh báo (ALERTS_TELEGRAM_ADMIN_IDS của app)." })
    }

    const run = async (chat: number, from: number | undefined, command: Command): Promise<void> => {
        const scope = scopeOf(entriesOf(chat))
        if (command.name === "silence") {
            if (access(chat, from) !== "write") {
                await refuseWrite(chat)
                return
            }
            await askSilence(chat, silenceMatchers(scope, command.target), command.seconds, command.target === "all" ? "mọi cảnh báo" : command.target)
            return
        }
        await send(chat, await readReply(command, scope, deps.sources))
    }

    /** Posts one notification to the entry's chat, with its buttons and the likely cause. */
    const post = async (chat: number, payload: WebhookPayload): Promise<void> => {
        const scope = scopeOf(entriesOf(chat))
        prune()
        const offer = (alert: WebhookAlert): string => {
            const key = deps.id()
            if (silenceable(scope, alert.labels)) offers.set(key, { alertname: alert.labels.alertname ?? "", stack: alert.labels.stack ?? "", chat, expires: now() + OFFER_MS })
            return `q:${key}`
        }
        const kind = causeKind(payload)
        let cause: string | undefined
        if (kind !== null) {
            const top = await deps.sources.prometheus.query(kind === "cpu" ? topCpu(scope, 1) : topMemory(scope, 1)).catch(() => [])
            const first = top[0]
            if (first !== undefined) cause = `${first.labels.service ?? "?"} (${kind === "cpu" ? `${formatNumber(first.value * 100)}% CPU` : formatBytes(first.value)}) trong các service của ${scope.project}`
        }
        const message = alertMessage(payload, scope, now(), offer, cause)
        if (message.html === "") return
        await send(chat, message)
    }

    /**
     * Learns the owner chat from a private message of an owner username, matched case-insensitively, for every entry of that owner whose chat
     * is not known yet; confirms the connection and posts what waited. Any other sender, a group, or an entry already connected learns nothing.
     * A backlog counts: the owner may press Start before the bot runs (Telegram keeps an update 24 hours).
     */
    const learn = async (message: NonNullable<Update["message"]>): Promise<void> => {
        const username = message.from?.username?.toLowerCase()
        if (username === undefined || message.chat.type !== "private" || message.from?.id !== message.chat.id) return
        const waiting = entries.filter((entry) => entry.chat === null && entry.owner === username && chatOf(entry) === null)
        if (waiting.length === 0) return
        for (const entry of waiting) store.set(ownerKey(entry), username, message.chat.id, now())
        deps.log(`learned the owner chat of ${waiting.map(ownerKey).join(", ")} from @${username}`)
        const names = waiting.map((entry) => `${escapeHtml(entry.project)} ${escapeHtml(entry.env)}`).join(", ")
        await send(message.chat.id, { html: `✅ Đã kết nối cảnh báo cho <b>${names}</b>.\nTừ giờ cảnh báo của ${waiting.length > 1 ? "các môi trường này" : "môi trường này"} sẽ gửi về đây; /help để xem các lệnh.` })
        for (const entry of waiting) {
            const held = queue.take(ownerKey(entry))
            for (const payload of held.payloads)
                await post(message.chat.id, payload).catch((error: unknown) => {
                    deps.log(`a queued alert of ${ownerKey(entry)}: ${error instanceof Error ? error.message : String(error)}`)
                })
            if (held.dropped > 0) await send(message.chat.id, { html: `<i>${String(held.dropped)} cảnh báo cũ hơn của ${escapeHtml(ownerKey(entry))} đã bị bỏ khi chờ kết nối (giữ tối đa ${String(QUEUE_LIMIT)}).</i>` })
        }
    }

    const onMessage = async (message: NonNullable<Update["message"]>): Promise<void> => {
        await learn(message)
        if (access(message.chat.id, message.from?.id) === "none") return
        if (message.date * 1000 < now() - STALE_MS) return
        const parsed = parseCommand(message.text ?? "", deps.username)
        if (parsed.kind === "ignore") return
        if (parsed.kind === "usage") {
            await send(message.chat.id, { html: escapeHtml(parsed.text) })
            return
        }
        await run(message.chat.id, message.from?.id, parsed.command)
    }

    const onCallback = async (callback: NonNullable<Update["callback_query"]>): Promise<void> => {
        const chat = callback.message?.chat.id
        const message = callback.message?.message_id
        const level = chat === undefined ? "none" : access(chat, callback.from.id)
        if (chat === undefined || message === undefined || level === "none") {
            await deps.telegram.answer(callback.id)
            return
        }
        const data = callback.data ?? ""
        const kind = data.slice(0, 2)
        const rest = data.slice(2)
        prune()
        if (kind === "c:") {
            await deps.telegram.answer(callback.id)
            const parsed = parseCommand(rest, deps.username)
            if (parsed.kind === "command") await run(chat, callback.from.id, parsed.command)
            return
        }
        if (level !== "write") {
            await deps.telegram.answer(callback.id, "Chỉ admin mới làm được việc này")
            return
        }
        if (kind === "q:") {
            const offer = offers.get(rest)
            await deps.telegram.answer(callback.id)
            if (offer?.chat !== chat) {
                await send(chat, { html: "<i>Nút này đã hết hạn; dùng /silence.</i>" })
                return
            }
            await askSilence(chat, [{ name: "alertname", value: offer.alertname, isRegex: false, isEqual: true }, { name: "stack", value: offer.stack, isRegex: false, isEqual: true }], 3600, `${offer.alertname} · ${offer.stack}`)
            return
        }
        if (kind === "s:" || kind === "x:") {
            const silence = pending.get(rest)
            pending.delete(rest)
            if (silence?.chat !== chat) {
                await deps.telegram.answer(callback.id, "Đã hết hạn xác nhận")
                await deps.telegram.edit(chat, message, "<i>Đã hết hạn xác nhận.</i>")
                return
            }
            if (kind === "x:") {
                await deps.telegram.answer(callback.id, "Đã hủy")
                await deps.telegram.edit(chat, message, `<i>Đã hủy im lặng ${escapeHtml(silence.label)}.</i>`)
                return
            }
            const start = new Date(now())
            const end = new Date(now() + silence.seconds * 1000)
            const id = await deps.sources.alertmanager.silence(silence.matchers, start, end, `telegram:${String(callback.from.id)}`, `monitor-bot ${scopeOf(entriesOf(chat)).project}: ${silence.label}`)
            await deps.telegram.answer(callback.id, "Đã im lặng")
            await deps.telegram.edit(chat, message, `🔕 Đã im lặng <b>${escapeHtml(silence.label)}</b> đến ${end.toISOString().slice(11, 16)} UTC (${formatDuration(silence.seconds)}).\n<code>${escapeHtml(id)}</code>`)
            return
        }
        await deps.telegram.answer(callback.id)
    }

    return {
        entries,
        chats,
        handle: async (update) => {
            try {
                if (update.message !== undefined) await onMessage(update.message)
                else if (update.callback_query !== undefined) await onCallback(update.callback_query)
            } catch (error: unknown) {
                deps.log(`update ${String(update.update_id)}: ${error instanceof Error ? error.message : String(error)}`)
            }
        },
        notify: async (slot, payload) => {
            const entry = entries.find((one) => one.slot === slot)
            if (entry === undefined) throw new Error(`slot ${String(slot)} is not this bot's`)
            const chat = chatOf(entry)
            if (chat === null) {
                // The owner has not written to the bot yet: the notification waits, accepted, so Alertmanager does not retry it.
                queue.push(ownerKey(entry), payload)
                deps.log(`${ownerKey(entry)}: an alert waits for @${entry.owner ?? "?"} to /start the bot (${String(queue.size(ownerKey(entry)))} waiting)`)
                return
            }
            await post(chat, payload)
        },
        report: async (day) => {
            for (const chat of chats()) await send(chat, await dailyReport(scopeOf(entriesOf(chat)), day, deps.sources))
        },
        state: () => ({ pending: pending.size, offers: offers.size, queued: entries.reduce((sum, entry) => sum + queue.size(ownerKey(entry)), 0) }),
    }
}
