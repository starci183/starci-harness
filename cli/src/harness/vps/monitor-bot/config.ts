/**
 * The config of the monitor bot (`/app/config.json`, a swarm config `vps monitor up` writes and the server fills): the stack's addresses and
 * one entry per app bot. A bot's token is a swarm secret read by file; its owner chat and admins are filled on the server from the app's
 * sealed alert member (ALERTS_TELEGRAM_CHAT_ID, and ALERTS_TELEGRAM_ADMIN_IDS when it holds one). Read and checked by hand: the container
 * has Node's built-ins only.
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
    /** The one chat the bot answers and posts to (ALERTS_TELEGRAM_CHAT_ID). */
    readonly chat: number
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
    readonly bots: readonly BotEntry[]
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
        return {
            slot: int(bot, "slot", 0, 99),
            project: str(bot, "project"),
            env: str(bot, "env"),
            stack,
            tokenFile: str(bot, "tokenFile"),
            chat: typeof chat === "number" && Number.isSafeInteger(chat) ? chat : fail(`bots[${String(index)}].chat`, "is no Telegram chat id (the server did not fill it)"),
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
        bots: entries,
    }
}

/** What a chat may do with a bot: nothing (another chat, ignored), read, or read and write. */
export type Access = "none" | "read" | "write"

/**
 * The access of a message or a button press: only the owner chat is answered at all; a write needs the sender among the admins, or, with no
 * admin listed, the sender being the owner chat itself (a private chat, whose id is its user's id).
 */
export const accessOf = (entry: Pick<BotEntry, "chat" | "admins">, chat: number, from: number | undefined): Access => {
    if (chat !== entry.chat) return "none"
    if (from === undefined) return "read"
    const admin = entry.admins.length > 0 ? entry.admins.includes(from) : from === entry.chat
    return admin ? "write" : "read"
}
