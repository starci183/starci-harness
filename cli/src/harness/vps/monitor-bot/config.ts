/**
 * The config of the monitor bot (`/app/config.json`, a swarm config `vps monitor up` writes and the server fills): the stack's addresses and
 * one entry per app bot. A bot's token is a swarm secret read by file; its admins (and, for a legacy member, its owner chat) are filled on
 * the server from the app's sealed alert member (ALERTS_TELEGRAM_ADMIN_IDS, ALERTS_TELEGRAM_CHAT_ID). An entry names its owner by the plain
 * Telegram username of `monitoring.alerts.telegram.owner` instead: the bot learns that user's chat when he writes to it (owners.ts). Read and
 * checked by hand: the container has Node's built-ins only.
 */
import { asArray, at } from "./json.js"
import { STACK_NAME } from "./queries.js"

/** One app bot: the environment it belongs to, its stack, its token file, its owner chat and its admins. */
export interface BotEntry {
    readonly slot: number
    readonly project: string
    readonly env: string
    readonly stack: string
    readonly tokenFile: string
    /** The one chat the bot answers and posts to when the member seals it (ALERTS_TELEGRAM_CHAT_ID, legacy); null: learned from `owner`. */
    readonly chat: number | null
    /** The owner's Telegram username, lower case without its `@` (`monitoring.alerts.telegram.owner`); null: `chat` alone. */
    readonly owner: string | null
    /** The Telegram user ids that may run a write command; empty: the owner chat's own user, when it is a private chat. */
    readonly admins: readonly number[]
}

/** The whole config. */
export interface BotConfig {
    readonly server: string
    readonly telegram: string
    readonly prometheus: string
    readonly loki: string | null
    readonly alertmanager: string
    readonly docker: string
    readonly grafana: string | null
    /** Whether Grafana's image renderer runs in the stack (no component ships it yet: /chart draws text). */
    readonly renderer: boolean
    readonly listen: number
    readonly memoryAlertPercent: number
    readonly diskAlertPercent: number
    /** The daily report: its hour and the zone's offset from UTC in minutes (Asia/Ho_Chi_Minh is +420, no daylight saving). */
    readonly reportHour: number
    readonly reportOffsetMinutes: number
    /** The file the learned owner chats persist in (a volume of the container), or null: kept in memory only. */
    readonly state: string | null
    readonly bots: readonly BotEntry[]
}

/** A Telegram username as the owner writes it (`@name` or `name`), lower case without its `@`: 5 to 32 letters, digits and underscores, a letter first. */
export const USERNAME = /^[a-z][a-z0-9_]{4,31}$/

/** The username of a config or a message, normalised (case-insensitive: Telegram matches usernames that way), or null when it is none. */
export const normalizeUsername = (raw: unknown): string | null => {
    if (typeof raw !== "string") return null
    const name = raw.trim().replace(/^@/, "").toLowerCase()
    return USERNAME.test(name) ? name : null
}


const fail = (field: string, why: string): never => {
    throw new Error(`config.json ${field} ${why}`)
}

const str = (raw: unknown, field: string): string => {
    const value = at(raw, field)
    return typeof value === "string" && value !== "" ? value : fail(field, "is no string")
}
const url = (raw: unknown, field: string): string => {
    const value = str(raw, field)
    return /^https?:\/\/\S+$/.test(value) ? value.replace(/\/$/, "") : fail(field, "is no http(s) URL")
}
const optionalUrl = (raw: unknown, field: string): string | null => (at(raw, field) === null || at(raw, field) === undefined ? null : url(raw, field))
const int = (raw: unknown, field: string, min: number, max: number): number => {
    const value = at(raw, field)
    return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fail(field, `is no integer in ${String(min)}..${String(max)}`)
}

/** Admin ids as the server fills them: a comma list of integers, or empty. */
export const parseAdmins = (text: string): number[] => {
    if (text.trim() === "") return []
    if (!/^-?\d+(?:\s*,\s*-?\d+)*$/.test(text.trim())) throw new Error("the admin ids are no comma list of Telegram ids")
    return text.split(",").map((part) => Number(part.trim()))
}

/** Reads and checks the config text. */
export const parseConfig = (text: string): BotConfig => {
    const raw: unknown = JSON.parse(text)
    if (!Array.isArray(at(raw, "bots"))) fail("bots", "is no list")
    const entries = asArray(at(raw, "bots")).map((bot, index): BotEntry => {
        const stack = str(bot, "stack")
        if (!STACK_NAME.test(stack)) fail(`bots[${String(index)}].stack`, "is no swarm stack name")
        const chat = at(bot, "chat")
        const admins = at(bot, "admins")
        const ownerRaw = at(bot, "owner")
        const owner = ownerRaw === null || ownerRaw === undefined ? null : (normalizeUsername(ownerRaw) ?? fail(`bots[${String(index)}].owner`, "is no Telegram username"))
        const chatId = chat === null ? null : typeof chat === "number" && Number.isSafeInteger(chat) ? chat : fail(`bots[${String(index)}].chat`, "is no Telegram chat id (the server did not fill it)")
        if (chatId === null && owner === null) fail(`bots[${String(index)}]`, "names neither a chat nor an owner username")
        return {
            slot: int(bot, "slot", 0, 99),
            project: str(bot, "project"),
            env: str(bot, "env"),
            stack,
            tokenFile: str(bot, "tokenFile"),
            chat: chatId,
            owner,
            admins: parseAdmins(typeof admins === "string" ? admins : ""),
        }
    })
    return {
        server: str(raw, "server"),
        telegram: url(raw, "telegram"),
        prometheus: url(raw, "prometheus"),
        loki: optionalUrl(raw, "loki"),
        alertmanager: url(raw, "alertmanager"),
        docker: url(raw, "docker"),
        grafana: optionalUrl(raw, "grafana"),
        renderer: at(raw, "renderer") === true,
        listen: int(raw, "listen", 1, 65_535),
        memoryAlertPercent: int(raw, "memoryAlertPercent", 1, 100),
        diskAlertPercent: int(raw, "diskAlertPercent", 1, 100),
        reportHour: int(raw, "reportHour", 0, 23),
        reportOffsetMinutes: int(raw, "reportOffsetMinutes", -720, 840),
        state: at(raw, "state") === null || at(raw, "state") === undefined ? null : str(raw, "state"),
        bots: entries,
    }
}

/** What a chat may do with a bot: nothing (another chat, ignored), read, or read and write. */
export type Access = "none" | "read" | "write"

/**
 * The access of a message or a button press: only the owner chat is answered at all (`entry.chat`, the sealed one or the one learned from the
 * owner username; null, not known yet: nobody); a write needs the sender among the admins, or, with no admin listed, the sender being the
 * owner chat itself (a private chat, whose id is its user's id).
 */
export const accessOf = (entry: Pick<BotEntry, "chat" | "admins">, chat: number, from: number | undefined): Access => {
    if (entry.chat === null || chat !== entry.chat) return "none"
    if (from === undefined) return "read"
    const admin = entry.admins.length > 0 ? entry.admins.includes(from) : from === entry.chat
    return admin ? "write" : "read"
}
