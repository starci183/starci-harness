import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { parse } from "yaml"
import { chatsOf } from "../../harness/telegram-bridge.js"
import { botWithToken, getUpdates, loadTelegram } from "../../harness/telegram.js"
import type { TelegramConfig } from "../../harness/telegram.js"
import { hostAgeIdentity } from "../../harness/secret-env.js"
import { ALERT_BOT_KEYS, fieldAt } from "../../harness/vps/alerts.js"
import { Refusal, UsageError } from "../../shared/errors.js"
import { defineVerb } from "../../shared/verb.js"
import type { VerbResult } from "../../shared/verb.js"

/**
 * `starci app alerts discover-chat --env <env> [--chat <id>]`: the chat of an app environment's own alert bot (PROJECT-MONITORING-5). After the
 * owner sends /start to the bot, it reads the bot's updates with the token of the environment's alert member (`monitoring.alerts.telegram.member`),
 * finds the one private chat that wrote, and seals ALERTS_TELEGRAM_CHAT_ID back into the member, to the same recipients it is sealed to. The
 * member opens with the age identity `starci app secret` would use; no id is typed, and no value is printed.
 */

/** The seams of the discovery: the sealed store of the app and the http of the Bot API (a spec replaces both). */
export interface AlertChatSeams {
    readonly open: (file: string) => Readonly<Record<string, string>>
    readonly seal: (file: string, values: Readonly<Record<string, string>>) => void
    readonly fetcher: typeof fetch
    readonly config: TelegramConfig
}

/** The app root above `cwd`: the nearest folder holding hfs.json and .starcistacks/application-stacks.yaml. */
export const appRootOf = (cwd: string): string => {
    let dir = resolve(cwd)
    for (;;) {
        if (existsSync(join(dir, "hfs.json")) && existsSync(join(dir, ".starcistacks", "application-stacks.yaml"))) return dir
        const parent = dirname(dir)
        if (parent === dir) throw new Refusal("APP_NOT_FOUND", `${cwd} is in no app (no hfs.json with .starcistacks/application-stacks.yaml above it)`)
        dir = parent
    }
}

/** The alert member file of one environment, refused when the environment declares none. */
export const alertMemberFile = (root: string, env: string): string => {
    // The declaration is parsed YAML, read leniently; HFS_STACKS_SHAPE owns its shape. An env name is a single key, never dotted.
    const environments: unknown = fieldAt(parse(readFileSync(join(root, ".starcistacks", "application-stacks.yaml"), "utf8")), "environments")
    const member = fieldAt(typeof environments === "object" && environments !== null ? (environments as Record<string, unknown>)[env] : undefined, "monitoring.alerts.telegram.member")
    if (typeof member !== "string" || member === "") throw new Refusal("ALERTS_NOT_DECLARED", `environments.${env}.monitoring.alerts.telegram.member is not declared; declare the member that holds ${ALERT_BOT_KEYS.token} first`)
    const file = join(root, ".starcistacks", env, "secrets", `${member}.enc.yaml`)
    if (!existsSync(file)) throw new Refusal("ALERTS_MEMBER_MISSING", `${file} is not sealed: starci app secret set --env ${env} ${member} ${ALERT_BOT_KEYS.token} (the token BotFather gave)`)
    return file
}

/** Finds the private chat that wrote to the environment's alert bot and seals its id into the member; refused when none (or several, without --chat) wrote. */
export const discoverAlertChat = async (root: string, env: string, chat: string | undefined, seams: AlertChatSeams): Promise<{ readonly file: string; readonly chat: string; readonly name: string }> => {
    const file = alertMemberFile(root, env)
    let values: Readonly<Record<string, string>>
    try {
        values = seams.open(file)
    } catch (error: unknown) {
        throw new Refusal("ALERTS_MEMBER_UNREADABLE", `${file} does not open on this machine (it is sealed to its server, backup and CI keys): ${error instanceof Error ? (error.message.split("\n")[0] ?? "") : "sops refused"}`)
    }
    const token = values[ALERT_BOT_KEYS.token] ?? ""
    if (token.trim() === "") throw new Refusal("ALERTS_TOKEN_MISSING", `${file} holds no ${ALERT_BOT_KEYS.token}`)
    const bot = botWithToken(seams.config, token.trim(), seams.fetcher)
    const chats = chatsOf(await getUpdates(bot, 0, 0))
    const picked = chat ?? (chats.size === 1 ? [...chats.keys()][0] : undefined)
    if (picked === undefined) {
        if (chats.size === 0) throw new Refusal("ALERTS_NO_CHAT", `no private chat wrote to the alert bot of ${env} yet: send it /start from the chat the alerts should reach, then run this again`)
        throw new Refusal("ALERTS_CHAT_AMBIGUOUS", `several chats wrote to the alert bot of ${env}; pick one with --chat: ${[...chats].map(([id, name]) => `${id} (${name})`).join(", ")}`)
    }
    const name = chats.get(picked)
    if (name === undefined) throw new Refusal("ALERTS_NO_CHAT", `chat ${picked} did not write to the alert bot of ${env}; chats: ${[...chats.keys()].join(", ") || "none"}`)
    seams.seal(file, { [ALERT_BOT_KEYS.chat]: picked })
    return { file, chat: picked, name }
}

/** The app's sealed store: opens and re-seals a member with the identity and the recipients `starci app secret` uses (the member's own recipients). */
const appStore = async (root: string): Promise<Pick<AlertChatSeams, "open" | "seal">> => {
    const { defaultSops } = await import("@starci/hfs/runtime/scripts/hfs/secret-sops.mjs")
    const { readMap, writeSecret } = await import("@starci/hfs/runtime/scripts/hfs/secret-store.mjs")
    const { envelopeOf } = await import("@starci/hfs/runtime/scripts/hfs/secret-document.mjs")
    const sops = (): unknown => defaultSops(process.env, root, process.platform, undefined, hostAgeIdentity(root))
    return {
        open: (file) => readMap(file, sops()),
        seal: (file, values) => {
            writeSecret({ file, values: { ...values }, age: [...envelopeOf(readFileSync(file, "utf8")).recipients], sops: sops() })
        },
    }
}

export const appAlertsVerb = defineVerb({
    path: ["app", "alerts"],
    summary: "`alerts discover-chat --env <env>`: after /start to the environment's own alert bot, find the private chat that wrote and seal ALERTS_TELEGRAM_CHAT_ID into its alert member (monitoring.alerts.telegram.member), to the member's own recipients; never the harness bot",
    effect: "local-write",
    roles: ["owner", "supervisor"],
    schema: "starci/app-alerts@1",
    flags: {
        action: { kind: "string", summary: "discover-chat", required: true, positional: true },
        env: { kind: "string", summary: "the environment whose alert bot it is", required: true },
        chat: { kind: "string", summary: "the chat id to seal when several chats wrote to the bot" },
    },
    run: async (context, flags): Promise<VerbResult<unknown>> => {
        if (flags.action !== "discover-chat") throw new UsageError(`starci app alerts takes discover-chat; ${flags.action} is not it`)
        const root = appRootOf(context.cwd)
        const found = await discoverAlertChat(root, flags.env, flags.chat, { ...(await appStore(root)), fetcher: fetch, config: loadTelegram() })
        return { data: { file: found.file, chat: { id: found.chat, name: found.name } }, message: `alerts: the chat ${found.name} is sealed as ${ALERT_BOT_KEYS.chat} in ${found.file}; the next vps monitor up routes ${flags.env}'s alerts to it` }
    },
})
