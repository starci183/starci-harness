import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { z } from "zod"
import { parse, parseDocument } from "yaml"
import { chatsOf } from "../../harness/telegram-bridge.js"
import { botWithToken, getUpdates, loadTelegram } from "../../harness/telegram.js"
import type { TelegramConfig } from "../../harness/telegram.js"
import { hostAgeIdentity } from "../../harness/secret-env.js"
import { promptHidden } from "../../harness/vps/local.js"
import { ALERT_BOT_KEYS, fieldAt, ownerUsernameOf, projectOf, sealedKeyNames } from "../../harness/vps/alerts.js"
import { Refusal, UsageError } from "../../shared/errors.js"
import { defineVerb } from "../../shared/verb.js"
import type { VerbContext, VerbResult } from "../../shared/verb.js"
import { runHfs } from "./hfs.js"

/**
 * `starci app alerts <setup|discover-chat> --env <env>`: an app environment's own alert bot (PROJECT-MONITORING-5).
 *
 * - `setup [--owner @username] [--token]` is the owner's one step: it writes `monitoring.alerts.telegram` (`member`, default `alerts`, and
 *   `owner`, the owner's plain Telegram username) into .starcistacks/application-stacks.yaml, and, when the member holds no
 *   ALERTS_TELEGRAM_BOT_TOKEN yet (or with `--token`), asks the token at a masked prompt, checks it with the Bot API (getMe) and seals it with
 *   `starci app secret set` (the member's own recipients). It then names the bot to open and Start: the server's monitor bot learns the chat
 *   from that message. Which keys the member holds is read from its plain sops key names, so the username path opens nothing, and works when
 *   the member is sealed only to the server and CI keys.
 * - `discover-chat [--chat <id>]` (legacy): after /start, reads the bot's updates with the member's token, finds the one private chat that
 *   wrote, and seals ALERTS_TELEGRAM_CHAT_ID back into the member. It needs an identity here that opens the member; no value is printed.
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
export const appStore = async (root: string): Promise<Pick<AlertChatSeams, "open" | "seal">> => {
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

/**
 * Sets one value of a YAML file and keeps every other line byte for byte: the document is edited through `yaml`, and every line its
 * re-serialisation merely reformats (a flow map's padding) is taken back from the original. Refused when the re-serialisation moves lines
 * (the edit is then made by hand).
 */
export const setYamlPreserving = (text: string, path: readonly string[], value: unknown): string => {
    const options = [{ lineWidth: 0, flowCollectionPadding: false }, { lineWidth: 0, flowCollectionPadding: true }] as const
    const original = text.split("\n")
    // The option that keeps the most lines as written: its round trip differs from the original only in reformatted lines, never in their count.
    const best = options
        .map((option) => ({ option, round: parseDocument(text).toString(option).split("\n") }))
        .filter((candidate) => candidate.round.length === original.length)
        .map((candidate) => ({ ...candidate, same: candidate.round.filter((line, index) => line === original[index]).length }))
        .sort((left, right) => right.same - left.same)[0]
    if (best === undefined) throw new Refusal("ALERTS_CONFIG_UNEDITABLE", `the YAML would be rewritten beyond the edit; set ${path.join(".")} by hand`)
    const doc = parseDocument(text)
    doc.setIn(path, value)
    const edited = doc.toString(best.option).split("\n")
    // A line diff of the round trip against the edit (LCS): an unchanged line is the original's, an added or changed one the edit's.
    const left = best.round
    const table = Array.from({ length: left.length + 1 }, () => new Array<number>(edited.length + 1).fill(0))
    for (let i = left.length - 1; i >= 0; i -= 1)
        for (let j = edited.length - 1; j >= 0; j -= 1) {
            const row = table[i] ?? []
            row[j] = left[i] === edited[j] ? (table[i + 1]?.[j + 1] ?? 0) + 1 : Math.max(table[i + 1]?.[j] ?? 0, row[j + 1] ?? 0)
        }
    const out: string[] = []
    let i = 0
    let j = 0
    while (i < left.length || j < edited.length) {
        if (i < left.length && j < edited.length && left[i] === edited[j]) {
            out.push(original[i] ?? "")
            i += 1
            j += 1
        } else if (j < edited.length && (i >= left.length || (table[i]?.[j + 1] ?? 0) >= (table[i + 1]?.[j] ?? 0))) {
            out.push(edited[j] ?? "")
            j += 1
        } else i += 1
    }
    return out.join("\n")
}

/** The seams of the setup: the masked prompt, the seal through `app secret set`, the sealed store, and the http of the Bot API. */
export interface AlertSetupSeams {
    readonly prompt: (label: string) => Promise<string>
    readonly sealToken: (member: string, token: string) => Promise<void>
    readonly open: (file: string) => Readonly<Record<string, string>>
    readonly fetcher: typeof fetch
    readonly config: TelegramConfig
}

/** What the setup did. */
export interface AlertSetup {
    readonly member: string
    readonly owner: string
    /** The bot's username (getMe), or null when its token is sealed to keys this machine lacks. */
    readonly bot: string | null
    readonly tokenSealed: boolean
    readonly configChanged: boolean
}

/** The bot's username by its token (getMe); a rejected token is refused TELEGRAM_TOKEN_REJECTED. */
const botNameOf = async (token: string, seams: Pick<AlertSetupSeams, "config" | "fetcher">): Promise<string> =>
    (await botWithToken(seams.config, token, seams.fetcher).call("getMe", {}, z.looseObject({ username: z.string() }))).username

/** Declares the owner username (and the member) of one environment's alert bot, and seals its token when the member lacks it or `token` asks. */
export const setupAlerts = async (root: string, env: string, options: { readonly owner?: string; readonly member?: string; readonly token: boolean }, seams: AlertSetupSeams): Promise<AlertSetup> => {
    const file = join(root, ".starcistacks", "application-stacks.yaml")
    const text = readFileSync(file, "utf8")
    const environments = fieldAt(parse(text), "environments")
    const environment = typeof environments === "object" && environments !== null ? (environments as Record<string, unknown>)[env] : undefined
    if (environment === undefined) throw new Refusal("ALERTS_ENV_UNKNOWN", `environments.${env} is not declared in ${file}`)
    const declared = fieldAt(environment, "monitoring.alerts.telegram.member")
    const member = options.member ?? (typeof declared === "string" && declared !== "" ? declared : "alerts")
    if (!/^[a-z][a-z0-9-]*$/.test(member)) throw new UsageError(`--member ${member} is no member name`)
    const ownerField = options.owner ?? fieldAt(environment, "monitoring.alerts.telegram.owner")
    const ownerText = typeof ownerField === "string" ? ownerField : ownerField === undefined ? undefined : JSON.stringify(ownerField)
    if (ownerText === undefined) throw new Refusal("ALERTS_OWNER_MISSING", `environments.${env}.monitoring.alerts.telegram.owner is not set: pass --owner @<your Telegram username>`)
    const owner = ownerUsernameOf(ownerText)
    if (owner === null) throw new UsageError(`${ownerText} is no Telegram username (@name: 5 to 32 letters, digits and underscores, a letter first)`)
    const memberFile = join(root, ".starcistacks", env, "secrets", `${member}.enc.yaml`)
    const keys = existsSync(memberFile) ? sealedKeyNames(readFileSync(memberFile, "utf8")) : []
    let bot: string | null
    let tokenSealed = false
    if (options.token || !keys.includes(ALERT_BOT_KEYS.token)) {
        const token = (await seams.prompt(`${ALERT_BOT_KEYS.token} of ${env} (the token BotFather gave)`)).trim()
        if (token === "") throw new Refusal("ALERTS_TOKEN_MISSING", "no token was given; nothing was sealed")
        bot = await botNameOf(token, seams)
        await seams.sealToken(member, token)
        tokenSealed = true
    } else {
        try {
            const token = seams.open(memberFile)[ALERT_BOT_KEYS.token]?.trim() ?? ""
            bot = token === "" ? null : await botNameOf(token, seams)
        } catch {
            // The member is sealed to the server and CI keys only: the bot is named without its username.
            bot = null
        }
    }
    // Written as the owner typed it, with its `@`; matched case-insensitively on the server.
    const written = `@${ownerText.trim().replace(/^@/, "")}`
    const prefix = ["environments", env, "monitoring", "alerts", "telegram"]
    let next = text
    if (declared !== member) next = setYamlPreserving(next, [...prefix, "member"], member)
    if (fieldAt(environment, "monitoring.alerts.telegram.owner") !== written) next = setYamlPreserving(next, [...prefix, "owner"], written)
    const configChanged = next !== text
    if (configChanged) writeFileSync(file, next)
    return { member, owner: written, bot, tokenSealed, configChanged }
}

/** The owner's next step: open the bot and press Start, in the owner's words. */
export const startLine = (setup: AlertSetup, project: string, env: string): string =>
    setup.bot === null ? `Mở bot cảnh báo của ${project} ${env} và bấm Start (từ tài khoản ${setup.owner}).` : `Mở bot @${setup.bot} và bấm Start (từ tài khoản ${setup.owner}).`

export const appAlertsVerb = defineVerb({
    path: ["app", "alerts"],
    summary: "`alerts setup --env <env> --owner @username`: declare the environment's own alert bot (monitoring.alerts.telegram: member and the owner's plain Telegram username), seal its token at a masked prompt when the member lacks it, and name the bot to Start: the server's monitor bot learns the owner's chat from that message; `alerts discover-chat --env <env>` (legacy) seals ALERTS_TELEGRAM_CHAT_ID instead; never the harness bot",
    effect: "local-write",
    roles: ["owner", "supervisor"],
    schema: "starci/app-alerts@1",
    flags: {
        action: { kind: "string", summary: "setup, or discover-chat (legacy)", required: true, positional: true },
        env: { kind: "string", summary: "the environment whose alert bot it is", required: true },
        owner: { kind: "string", summary: "setup: the owner's Telegram username (@name); kept from the config when omitted" },
        member: { kind: "string", summary: "setup: the sealed member of the token (default: the declared one, else alerts)" },
        token: { kind: "boolean", summary: "setup: ask and seal the token again even when the member holds one" },
        chat: { kind: "string", summary: "discover-chat: the chat id to seal when several chats wrote to the bot" },
    },
    run: async (context, flags): Promise<VerbResult<unknown>> => {
        if (flags.action === "setup") return runSetup(context, flags)
        if (flags.action !== "discover-chat") throw new UsageError(`starci app alerts takes setup or discover-chat; ${flags.action} is not it`)
        const root = appRootOf(context.cwd)
        const found = await discoverAlertChat(root, flags.env, flags.chat, { ...(await appStore(root)), fetcher: fetch, config: loadTelegram() })
        return { data: { file: found.file, chat: { id: found.chat, name: found.name } }, message: `alerts: the chat ${found.name} is sealed as ${ALERT_BOT_KEYS.chat} in ${found.file}; the next vps monitor up routes ${flags.env}'s alerts to it` }
    },
})

/** `app alerts setup`: the prompt is the masked one of `vps` (a redirected stdin gives the token), the seal is `app secret set` with the token as its stdin. */
const runSetup = async (context: VerbContext, flags: { readonly env: string; readonly owner?: string | undefined; readonly member?: string | undefined; readonly token: boolean }): Promise<VerbResult<unknown>> => {
    const root = appRootOf(context.cwd)
    const store = await appStore(root)
    const setup = await setupAlerts(root, flags.env, { ...(flags.owner === undefined ? {} : { owner: flags.owner }), ...(flags.member === undefined ? {} : { member: flags.member }), token: flags.token }, {
        prompt: (label) => promptHidden(label, false),
        sealToken: async (member, token) => {
            const sealed = await runHfs({ ...context, cwd: root }, "secret", ["set", "--env", flags.env, member, ALERT_BOT_KEYS.token], false, () => token)
            if ((sealed.exitCode ?? 0) !== 0) throw new Refusal("ALERTS_TOKEN_NOT_SEALED", `starci app secret set --env ${flags.env} ${member} ${ALERT_BOT_KEYS.token} failed; nothing else was changed`)
        },
        open: store.open,
        fetcher: fetch,
        config: loadTelegram(),
    })
    const project = projectOf(root) ?? root
    const start = startLine(setup, project, flags.env)
    const done = [
        setup.configChanged ? `environments.${flags.env}.monitoring.alerts.telegram is {member: ${setup.member}, owner: "${setup.owner}"}` : `environments.${flags.env}.monitoring.alerts.telegram already names ${setup.owner}`,
        setup.tokenSealed ? `${ALERT_BOT_KEYS.token} is sealed into ${setup.member}` : `${setup.member} already holds ${ALERT_BOT_KEYS.token}`,
    ]
    return {
        data: { env: flags.env, member: setup.member, owner: setup.owner, bot: setup.bot, tokenSealed: setup.tokenSealed, configChanged: setup.configChanged },
        message: `alerts: ${done.join("; ")}.\n${start}\nThe next vps monitor up routes ${flags.env}'s alerts to the server's monitor bot, which connects the chat when ${setup.owner} writes to the bot and posts the alerts that waited.`,
    }
}
