import { advanceOffset, chatsOf, sweepNotices } from "../../harness/telegram-bridge.js"
import { bridgeLiveness, channelCounts, connectedChannel, getUpdates, loadTelegram, readChannel, sendMessage, storeChat, telegramBot, tokenHome, tokenPresent, withChannelStore } from "../../harness/telegram.js"
import { EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { callerRole } from "../../shared/role.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import type { VerbResult } from "../../shared/verb.js"

const ACTIONS = ["discover-chat", "status", "notify"] as const

const CONNECTED = "StarCi is connected: questions for you arrive here. Reply to a notice to answer it, or send /ask <project> <request>."

/**
 * `starci connect telegram <discover-chat|status|notify>`: the owner's Telegram channel. `discover-chat` reads the bot's updates
 * once and stores the chat that wrote to it (the owner sends the bot a message first; `--chat` picks one of several) in the host
 * store, never in a repository; facts older than that moment are never sent. `status` reports the channel without calling
 * Telegram; `notify` sends every fact due once (the bridge does it every cycle). The bot token is read by name from the
 * environment (ops/telegram.yaml tokenVariable) and refused TELEGRAM_NOT_CONFIGURED when unset.
 */
export const connectTelegramVerb = defineVerb({
    path: ["connect", "telegram"],
    summary: "the owner's Telegram channel: discover-chat stores the owner's chat, status reports it, notify sends the notices due once",
    editions: BOTH_EDITIONS,
    effect: "remote",
    roles: ["owner", "supervisor", "debug"],
    schema: "starci/telegram-channel@1",
    flags: {
        action: { kind: "string", required: true, positional: true, summary: "discover-chat, status or notify" },
        chat: { kind: "string", summary: "discover-chat: the chat id to store when several chats wrote to the bot" },
    },
    run: async (context, flags): Promise<VerbResult<unknown>> => {
        const action = ACTIONS.find((known) => known === flags.action)
        if (action === undefined) throw new Refusal("CLI_USAGE", `connect telegram takes ${ACTIONS.join(", ")}, not ${flags.action}`, EXIT_USAGE)
        const config = loadTelegram()
        if (action === "status") {
            const { channel, counts } = withChannelStore((db) => ({ channel: readChannel(db), counts: channelCounts(db) }))
            const configured = tokenPresent(config)
            const bridge = bridgeLiveness(channel, config)
            const data = { variable: config.tokenVariable, configured, chat: channel.chatId === null ? null : { id: channel.chatId, name: channel.chatName, connectedAt: channel.connectedAt }, bridge, ...counts }
            const token = configured ? `${config.tokenVariable} set` : `${config.tokenVariable} not set (the owner sets it in ${tokenHome(config)})`
            const chat = channel.chatId === null ? "no owner chat (connect telegram discover-chat)" : `owner chat ${channel.chatName ?? channel.chatId} since ${channel.connectedAt ?? "-"}`
            return { data, message: `telegram: ${token}; ${chat}; bridge ${bridge}; notices ${JSON.stringify(counts.notices)}; replies ${String(counts.inbound.owner)} from the owner, ${String(counts.inbound.ignored)} ignored` }
        }
        if (callerRole() === "debug") throw new Refusal("ROLE_REFUSED", `connect telegram ${action} is the owner's or the Supervisor's; Debug reads connect telegram status`)
        const bot = telegramBot(config)
        if (action === "notify") {
            const sweep = await sweepNotices(bot, connectedChannel())
            return { data: sweep, message: `telegram notify: sent ${String(sweep.sent.length)}, failed ${String(sweep.failed.length)}, deferred ${String(sweep.deferred)}` }
        }
        const offset = withChannelStore(readChannel).offset
        const updates = await getUpdates(bot, offset, 0)
        const chats = chatsOf(updates)
        const picked = flags.chat ?? (chats.size === 1 ? [...chats.keys()][0] : undefined)
        if (picked === undefined) {
            if (chats.size === 0) throw new Refusal("TELEGRAM_NO_CHAT", "no private chat wrote to the bot since the last read: the owner sends the bot any message (/start), then runs this again")
            throw new Refusal("TELEGRAM_CHAT_AMBIGUOUS", `several chats wrote to the bot; pick one with --chat: ${[...chats].map(([id, name]) => `${id} (${name})`).join(", ")}`)
        }
        const name = chats.get(picked)
        if (name === undefined) throw new Refusal("TELEGRAM_NO_CHAT", `chat ${picked} did not write to the bot since the last read; chats: ${[...chats.keys()].join(", ") || "none"}`)
        storeChat(picked, name, 0)
        advanceOffset(updates)
        await sendMessage(bot, picked, CONNECTED)
        return { data: { chat: { id: picked, name } }, message: `telegram: owner chat ${name} (${picked}) stored; facts from now on reach it` }
    },
})
