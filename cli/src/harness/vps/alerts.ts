import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"
import { openMachine } from "../ledger.js"
import { shellQuote } from "./ssh.js"

/**
 * The alerts of a server go to the bot of each app it runs, never the harness bot (ops/telegram.yaml). An app environment names its bot with
 * `monitoring.alerts.telegram` of its .starcistacks/application-stacks.yaml: `member`, a sealed member of that environment (its server, backup
 * and CI recipients) holding ALERTS_TELEGRAM_BOT_TOKEN, and `owner`, the owner's plain Telegram username. The monitor bot learns the owner's
 * chat on the server when he first writes to the bot (monitor-bot/owners.ts). A member that seals ALERTS_TELEGRAM_CHAT_ID (legacy) still names
 * the chat itself. This machine never opens the member: `vps monitor up` ships its ciphertext to the server, whose own key opens it there,
 * into a swarm secret (the token, read by file) and, when sealed, the chat id. Which keys a member holds is read from its sops envelope,
 * whose key names are plain; no value is read here.
 */

/** The keys of an app's alert-bot member (equal to @starci/hfs stack/monitoring.mts ALERT_BOT_KEYS). */
export const ALERT_BOT_KEYS = { token: "ALERTS_TELEGRAM_BOT_TOKEN", chat: "ALERTS_TELEGRAM_CHAT_ID" } as const

/**
 * The optional key of the same member listing the Telegram user ids that may run the monitor bot's write commands (a silence), comma
 * separated; without it only the owner chat's own user (a private chat) may.
 */
export const ALERT_BOT_ADMINS_KEY = "ALERTS_TELEGRAM_ADMIN_IDS"

/** Where the server's own age identity lives (@starci/hfs stack/server-key.mts SERVER_AGE_IDENTITY). */
export const SERVER_AGE_IDENTITY = "/root/.config/sops/age/keys.txt"

/** A Telegram username as the owner writes it: `@name` or `name`, 5 to 32 letters, digits and underscores, a letter first. */
export const TELEGRAM_USERNAME = /^@?[A-Za-z][A-Za-z0-9_]{4,31}$/

/** The owner username of a config value, lower case without its `@` (Telegram matches usernames case-insensitively), or null when it is none. */
export const ownerUsernameOf = (value: unknown): string | null => (typeof value === "string" && TELEGRAM_USERNAME.test(value.trim()) ? value.trim().replace(/^@/, "").toLowerCase() : null)

/** One app environment on a server with its own alert bot ready: its token sealed, and its chat sealed or its owner username declared. */
export interface AlertBot {
    readonly project: string
    readonly env: string
    /** The swarm stack of the environment (`deploy.stack`), the `stack` label its alerts carry. */
    readonly stack: string
    /** The sealed member file, and its ciphertext (safe to ship: only the server's key, its backup or its CI key opens it). */
    readonly file: string
    readonly sealed: string
    /** Whether the member holds ALERT_BOT_ADMINS_KEY. */
    readonly admins: boolean
    /** Whether the member seals the chat (ALERT_BOT_KEYS.chat, legacy); without it the monitor bot learns the chat of `owner`. */
    readonly chat: boolean
    /** The owner's Telegram username (`monitoring.alerts.telegram.owner`), lower case without its `@`, or null. */
    readonly owner: string | null
}

/** The alert bots of a server and what holds the rest of its alerts. */
export interface ServerAlerts {
    readonly bots: readonly AlertBot[]
    /** One line per app (or app environment) whose alerts are held, saying why. */
    readonly lacking: readonly string[]
}

/** The value at a dotted path of parsed YAML or JSON, read leniently; `starci app check` (HFS_STACKS_SHAPE) owns the shape's refusals. */
export const fieldAt = (value: unknown, path: string): unknown =>
    path.split(".").reduce<unknown>((at, key) => (typeof at === "object" && at !== null && key in at ? (at as Record<string, unknown>)[key] : undefined), value)

const recordOf = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {})

/** The key names of a sops YAML document (its top-level keys but `sops`), read without opening it. */
export const sealedKeyNames = (text: string): string[] => {
    return Object.keys(recordOf(parse(text))).filter((key) => key !== "sops")
}

/** The project an app checkout's hfs.json names, or null. */
export const projectOf = (root: string): string | null => {
    try {
        const project = fieldAt(JSON.parse(readFileSync(join(root, "hfs.json"), "utf8")), "project")
        return typeof project === "string" && project !== "" ? project : null
    } catch {
        return null
    }
}

/** The alert bots of one app checkout for the environments that deploy to the server whose key is `serverRecipient`, and what lacks one. */
export const appAlertBots = (root: string, serverRecipient: string | null): { readonly bots: AlertBot[]; readonly lacking: string[]; readonly envs: number } => {
    const project = projectOf(root) ?? root
    const file = join(root, ".starcistacks", "application-stacks.yaml")
    if (!existsSync(file)) return { bots: [], lacking: [`${project}: no .starcistacks/application-stacks.yaml`], envs: 0 }
    const environments = recordOf(fieldAt(parse(readFileSync(file, "utf8")), "environments"))
    const bots: AlertBot[] = []
    const lacking: string[] = []
    let envs = 0
    for (const [env, value] of Object.entries(environments)) {
        const recipient = fieldAt(value, "deploy.remote.serverRecipient")
        if (serverRecipient === null || recipient !== serverRecipient) continue
        envs += 1
        const member = fieldAt(value, "monitoring.alerts.telegram.member")
        if (typeof member !== "string" || member === "") {
            lacking.push(`${project}/${env} declares no alert bot (environments.${env}.monitoring.alerts.telegram.member)`)
            continue
        }
        const memberFile = join(root, ".starcistacks", env, "secrets", `${member}.enc.yaml`)
        if (!existsSync(memberFile)) {
            lacking.push(`${project}/${env}: its alert member ${member} is not sealed (.starcistacks/${env}/secrets/${member}.enc.yaml)`)
            continue
        }
        const sealed = readFileSync(memberFile, "utf8")
        const keys = sealedKeyNames(sealed)
        if (!keys.includes(ALERT_BOT_KEYS.token)) {
            lacking.push(`${project}/${env}: ${member} holds no ${ALERT_BOT_KEYS.token} (the bot the owner makes with BotFather)`)
            continue
        }
        const owner = ownerUsernameOf(fieldAt(value, "monitoring.alerts.telegram.owner"))
        const chat = keys.includes(ALERT_BOT_KEYS.chat)
        if (!chat && owner === null) {
            lacking.push(`${project}/${env} names no owner (environments.${env}.monitoring.alerts.telegram.owner: "@<username>"; starci app alerts setup --env ${env})`)
            continue
        }
        const stack = fieldAt(value, "deploy.stack")
        bots.push({ project, env, stack: typeof stack === "string" && stack !== "" ? stack : `${project}-${env}`, file: memberFile, sealed, admins: keys.includes(ALERT_BOT_ADMINS_KEY), chat, owner })
    }
    return { bots, lacking, envs }
}

/** The public age recipient of a server's own key (ops/vps/recipients.yaml `servers.<id>.server`), or null. */
export const serverRecipientOf = (id: string, opsDir: string): string | null => {
    const file = join(opsDir, "vps", "recipients.yaml")
    if (!existsSync(file)) return null
    const recipient = fieldAt(recordOf(fieldAt(parse(readFileSync(file, "utf8")), "servers"))[id], "server")
    return typeof recipient === "string" && recipient !== "" ? recipient : null
}

/** The repository roots this harness knows (its registered ledgers, retired ones left out). */
export const registeredRoots = (): string[] => {
    const db = openMachine()
    try {
        return (db.prepare("SELECT repo_root FROM ledgers WHERE state != 'retired'").all() as { repo_root: string }[]).map((row) => row.repo_root)
    } finally {
        db.close()
    }
}

/**
 * The alert bots of a server: for each of its projects, the checkout of that project (one of `roots` whose hfs.json names it) and its
 * environments that deploy there. A project with no known checkout, no environment on this server, or no ready bot is held, by name.
 */
export const serverAlerts = (projects: readonly string[], roots: readonly string[], serverRecipient: string | null): ServerAlerts => {
    const byProject = new Map<string, string>()
    for (const root of roots) {
        const project = projectOf(root)
        if (project !== null && !byProject.has(project)) byProject.set(project, root)
    }
    const bots: AlertBot[] = []
    const lacking: string[] = []
    for (const project of projects) {
        const root = byProject.get(project)
        if (root === undefined) {
            lacking.push(`${project}: no checkout of it is known here (vps monitor up --app <dir>, or a checkout registered with this harness)`)
            continue
        }
        const found = appAlertBots(root, serverRecipient)
        if (found.envs === 0) lacking.push(`${project}: no environment deploys to this server (deploy.remote.serverRecipient)`)
        bots.push(...found.bots)
        lacking.push(...found.lacking)
    }
    return { bots, lacking }
}

/**
 * The bots a run can route, given whether the monitor bot runs: it learns an owner's chat, so without it (Alertmanager's own telegram
 * receivers) a bot whose member seals no chat is held, by name.
 */
export const routableAlerts = (alerts: ServerAlerts, monitorBot: boolean): ServerAlerts => {
    if (monitorBot) return alerts
    const unroutable = alerts.bots.filter((bot) => !bot.chat)
    return {
        bots: alerts.bots.filter((bot) => bot.chat),
        lacking: [...alerts.lacking, ...unroutable.map((bot) => `${bot.project}/${bot.env}: its owner @${bot.owner ?? "?"} is connected by the monitor bot, which is off on this server (--with monitor-bot)`)],
    }
}

/** The receiver name of a bot. */
const receiverOf = (bot: AlertBot): string => `${bot.project}-${bot.env}`.replaceAll(/[^a-z0-9-]/g, "-")

/** The placeholder of a bot's chat id in alertmanager.yml or the monitor bot's config, filled on the server from the opened member (`null` in the config when the member seals none). */
export const chatPlaceholder = (slot: number): string => `__STARCI_ALERTS_CHAT_${String(slot)}__`

/** The swarm secret file a bot's token is mounted at. */
export const tokenFile = (slot: number): string => `alerts_${String(slot)}`

/** The placeholder of a bot's admin ids in the monitor bot's config, filled on the server (empty when the member lists none). */
export const adminsPlaceholder = (slot: number): string => `__STARCI_ALERTS_ADMINS_${String(slot)}__`

/** The port the monitor bot serves Alertmanager's webhooks on, inside the stack's internal network. */
export const BOT_WEBHOOK_PORT = 9095

/**
 * The routes and receivers of Alertmanager: an app's alerts (its stack's label) to its environment's bot; a host alert (no stack label: disk,
 * memory, a node, the edge) to one bot of every app, each once (continue); everything else, and everything when no bot is ready, to the null
 * receiver `held`. A receiver is a telegram_config of the bot, or, with the monitor bot on (`viaBot`), a webhook to the bot's slot, so the
 * bot posts the same notification with its buttons; the routes are the same either way. `botHost` is the bot's full swarm name
 * (`<stack>_monitor-bot`): a short name falls through to the host's search domain.
 */
export const alertRouting = (bots: readonly AlertBot[], viaBot = false, botHost = "monitor-bot"): { readonly routes: string; readonly receivers: string } => {
    if (bots.length === 0) return { routes: "  # no app on this server has an alert bot ready: every alert is held", receivers: "" }
    const hostBots = bots.filter((bot, slot) => bots.findIndex((other) => other.project === bot.project) === slot).map((bot) => ({ bot }))
    const routes = [
        "  routes:",
        ...hostBots.flatMap(({ bot }) => [`    - matchers: ['stack=""']`, `      receiver: ${receiverOf(bot)}`, "      continue: true"]),
        ...bots.flatMap((bot) => [`    - matchers: ['stack="${bot.stack}"']`, `      receiver: ${receiverOf(bot)}`]),
    ]
    const receivers = bots.flatMap((bot, slot) =>
        viaBot
            ? [`  - name: ${receiverOf(bot)}`, "    webhook_configs:", `      - url: http://${botHost}:${String(BOT_WEBHOOK_PORT)}/alert/${String(slot)}`, "        send_resolved: true", "        max_alerts: 20"]
            : [`  - name: ${receiverOf(bot)}`, "    telegram_configs:", `      - bot_token_file: /run/secrets/${tokenFile(slot)}`, `        chat_id: ${chatPlaceholder(slot)}`, "        send_resolved: true"],
    )
    return { routes: routes.join("\n"), receivers: receivers.join("\n") }
}

/** The env name the stack file reads a bot token's swarm secret name from, and the ones of the configs filled on the server. */
export const tokenEnvOf = (slot: number): string => `STARCI_MON_ALERTS_${String(slot)}`
export const ALERTMANAGER_CONFIG_ENV = "STARCI_MON_ALERTMANAGER"
export const BOT_CONFIG_ENV = "STARCI_MON_BOT_CONFIG"

/** A file the server fills from its `.tmpl` with each bot's chat id (and admin ids), and the env its config's hashed name is exported to. */
export interface FilledFile {
    readonly rel: string
    readonly env: string
}

/** The swarm config name of a file filled on the server, hashed there (equal to monitor.ts's naming of the other configs, but for the hash). */
const filledName = (rel: string): string => `starci_monitor_${rel.replaceAll(/[^a-z0-9]+/gi, "_").toLowerCase()}`

/**
 * The server-side lines that open each bot's member with the server's own key (sops, SERVER_AGE_IDENTITY): the token becomes a swarm secret named
 * by its hash, the chat id (and the admin ids, when the member lists them) fill each of `filled` from its template, and each filled file names
 * its config by its hash. No value is echoed; a member the server key does not open stops the step naming it.
 */
export const alertBotLines = (bots: readonly AlertBot[], base: string, marker: string, filled: readonly FilledFile[] = [{ rel: "alertmanager.yml", env: ALERTMANAGER_CONFIG_ENV }]): string[] => {
    if (bots.length === 0) return []
    const dir = `${base}/alerts`
    const identity = shellQuote(SERVER_AGE_IDENTITY)
    const targets = filled.map((file) => ({ ...file, template: shellQuote(`${base}/${file.rel}.tmpl`), target: shellQuote(`${base}/${file.rel}`) }))
    const lines = [
        `command -v sops >/dev/null 2>&1 || { echo "no sops on this server: the app alert bots are opened here with its own key" >&2; exit 7; }`,
        `[ -r ${identity} ] || { echo "no server age identity at ${SERVER_AGE_IDENTITY} (starci app secret server-key makes it)" >&2; exit 7; }`,
        `install -d -m 700 ${shellQuote(dir)}`,
        ...targets.map((file) => `cp ${file.template} ${file.target}.starci-new`),
    ]
    bots.forEach((bot, slot) => {
        if (bot.sealed.includes(marker)) throw new Error(`${bot.file} holds ${marker}`)
        const sealedFile = shellQuote(`${dir}/${String(slot)}.enc.yaml`)
        const name = `${bot.project}/${bot.env}`
        const env = tokenEnvOf(slot)
        lines.push(
            `cat > ${sealedFile} <<'${marker}'`,
            bot.sealed.trimEnd(),
            marker,
            `chmod 600 ${sealedFile}`,
            `T="$(SOPS_AGE_KEY_FILE=${identity} sops -d --extract '["${ALERT_BOT_KEYS.token}"]' ${sealedFile})" || { echo "the server key does not open the alert bot of ${name}" >&2; exit 7; }`,
            // A member without the chat (an owner username): the monitor bot's config takes null and the bot learns the chat (never alertmanager.yml: routableAlerts).
            ...(bot.chat
                ? [
                      `K="$(SOPS_AGE_KEY_FILE=${identity} sops -d --extract '["${ALERT_BOT_KEYS.chat}"]' ${sealedFile})" || { echo "the server key does not open the alert chat of ${name}" >&2; exit 7; }`,
                      `printf '%s' "$K" | grep -Eqx -- '-?[0-9]+' || { echo "the alert chat of ${name} is no Telegram chat id" >&2; exit 7; }`,
                  ]
                : [`K=null`]),
            bot.admins
                ? `A="$(SOPS_AGE_KEY_FILE=${identity} sops -d --extract '["${ALERT_BOT_ADMINS_KEY}"]' ${sealedFile} | tr -d ' ')" || { echo "the server key does not open the admin ids of ${name}" >&2; exit 7; }`
                : `A=""`,
            `[ -z "$A" ] || printf '%s' "$A" | grep -Eqx -- '-?[0-9]+(,-?[0-9]+)*' || { echo "the ${ALERT_BOT_ADMINS_KEY} of ${name} is no comma list of Telegram ids" >&2; exit 7; }`,
            `export ${env}="starci_monitor_alerts_${String(slot)}_$(printf '%s' "$T" | sha256sum | cut -c1-12)"`,
            `if ! docker secret inspect "$${env}" >/dev/null 2>&1; then printf '%s' "$T" | docker secret create --label starci.monitor=alerts "$${env}" - >/dev/null; C=changed; fi`,
            ...targets.map((file) => `sed -i "s/${chatPlaceholder(slot)}/$K/; s/${adminsPlaceholder(slot)}/$A/" ${file.target}.starci-new`),
            "unset T K A",
        )
    })
    for (const file of targets)
        lines.push(
            `if ! cmp -s ${file.target}.starci-new ${file.target}; then mv ${file.target}.starci-new ${file.target}; C=changed; else rm -f ${file.target}.starci-new; fi`,
            `export ${file.env}="${filledName(file.rel)}_$(sha256sum < ${file.target} | cut -c1-12)"`,
        )
    return lines
}

/** The one line a run prints when alerts are held: the apps that lack a ready bot. */
export const heldLine = (alerts: ServerAlerts): string | null =>
    alerts.lacking.length === 0 ? null : `alerts are held (a null receiver) for: ${alerts.lacking.join("; ")}`
