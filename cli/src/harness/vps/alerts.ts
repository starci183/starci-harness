import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"
import { openMachine } from "../ledger.js"
import { shellQuote } from "./ssh.js"

/**
 * The alerts of a server go to the bot of each app it runs, never the harness bot (ops/telegram.yaml). The owner's words (2026-11-21): "bot giám
 * sát server là bot khác nhé, setup trong từng dự án ở starcistacks". An app environment names its bot with `monitoring.alerts.telegram.member`
 * of its .starcistacks/application-stacks.yaml: a sealed member of that environment (its server, backup and CI recipients) holding
 * ALERTS_TELEGRAM_BOT_TOKEN and ALERTS_TELEGRAM_CHAT_ID. This machine never opens it: `vps monitor up` ships the member's ciphertext to the
 * server, whose own key opens it there, into a swarm secret (the token, read by file) and the receiver's chat id. Which keys a member holds is
 * read from its sops envelope, whose key names are plain; no value is read here.
 */

/** The keys of an app's alert-bot member (equal to @starci/hfs stack/monitoring.mts ALERT_BOT_KEYS). */
export const ALERT_BOT_KEYS = { token: "ALERTS_TELEGRAM_BOT_TOKEN", chat: "ALERTS_TELEGRAM_CHAT_ID" } as const

/** Where the server's own age identity lives (@starci/hfs stack/server-key.mts SERVER_AGE_IDENTITY). */
export const SERVER_AGE_IDENTITY = "/root/.config/sops/age/keys.txt"

/** One app environment on a server with its own alert bot ready: both keys sealed. */
export interface AlertBot {
    readonly project: string
    readonly env: string
    /** The swarm stack of the environment (`deploy.stack`), the `stack` label its alerts carry. */
    readonly stack: string
    /** The sealed member file, and its ciphertext (safe to ship: only the server's key, its backup or its CI key opens it). */
    readonly file: string
    readonly sealed: string
}

/** The alert bots of a server and what holds the rest of its alerts. */
export interface ServerAlerts {
    readonly bots: readonly AlertBot[]
    /** One line per app (or app environment) whose alerts are held, saying why. */
    readonly lacking: readonly string[]
}

// reason: the declaration is parsed YAML, read leniently here; `starci app check` (HFS_STACKS_SHAPE) owns its refusals
type Parsed = any

/** The key names of a sops YAML document (its top-level keys but `sops`), read without opening it. */
export const sealedKeyNames = (text: string): string[] => {
    const doc = parse(text) as Parsed
    return doc !== null && typeof doc === "object" ? Object.keys(doc).filter((key) => key !== "sops") : []
}

/** The project an app checkout's hfs.json names, or null. */
export const projectOf = (root: string): string | null => {
    try {
        const project: unknown = (JSON.parse(readFileSync(join(root, "hfs.json"), "utf8")) as Parsed)?.project
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
    const environments = ((parse(readFileSync(file, "utf8")) as Parsed)?.environments ?? {}) as Record<string, Parsed>
    const bots: AlertBot[] = []
    const lacking: string[] = []
    let envs = 0
    for (const [env, value] of Object.entries(environments)) {
        const recipient: unknown = value?.deploy?.remote?.serverRecipient
        if (serverRecipient === null || recipient !== serverRecipient) continue
        envs += 1
        const member: unknown = value?.monitoring?.alerts?.telegram?.member
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
        if (!keys.includes(ALERT_BOT_KEYS.chat)) {
            lacking.push(`${project}/${env}: ${member} holds no ${ALERT_BOT_KEYS.chat} (/start the bot, then starci app alerts discover-chat --env ${env})`)
            continue
        }
        const stack: unknown = value?.deploy?.stack
        bots.push({ project, env, stack: typeof stack === "string" && stack !== "" ? stack : `${project}-${env}`, file: memberFile, sealed })
    }
    return { bots, lacking, envs }
}

/** The public age recipient of a server's own key (ops/vps/recipients.yaml `servers.<id>.server`), or null. */
export const serverRecipientOf = (id: string, opsDir: string): string | null => {
    const file = join(opsDir, "vps", "recipients.yaml")
    if (!existsSync(file)) return null
    const recipient: unknown = (parse(readFileSync(file, "utf8")) as Parsed)?.servers?.[id]?.server
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

/** The receiver name of a bot. */
const receiverOf = (bot: AlertBot): string => `${bot.project}-${bot.env}`.replaceAll(/[^a-z0-9-]/g, "-")

/** The placeholder of a bot's chat id in alertmanager.yml, filled on the server from the opened member. */
export const chatPlaceholder = (slot: number): string => `__STARCI_ALERTS_CHAT_${String(slot)}__`

/** The swarm secret file a bot's token is mounted at. */
export const tokenFile = (slot: number): string => `alerts_${String(slot)}`

/**
 * The routes and receivers of Alertmanager: an app's alerts (its stack's label) to its environment's bot; a host alert (no stack label: disk,
 * memory, a node, the edge) to one bot of every app, each once (continue); everything else, and everything when no bot is ready, to the null
 * receiver `held`.
 */
export const alertRouting = (bots: readonly AlertBot[]): { readonly routes: string; readonly receivers: string } => {
    if (bots.length === 0) return { routes: "  # no app on this server has an alert bot ready: every alert is held", receivers: "" }
    const hostBots = bots.filter((bot, slot) => bots.findIndex((other) => other.project === bot.project) === slot).map((bot) => ({ bot }))
    const routes = [
        "  routes:",
        ...hostBots.flatMap(({ bot }) => [`    - matchers: ['stack=""']`, `      receiver: ${receiverOf(bot)}`, "      continue: true"]),
        ...bots.flatMap((bot) => [`    - matchers: ['stack="${bot.stack}"']`, `      receiver: ${receiverOf(bot)}`]),
    ]
    const receivers = bots.flatMap((bot, slot) => [`  - name: ${receiverOf(bot)}`, "    telegram_configs:", `      - bot_token_file: /run/secrets/${tokenFile(slot)}`, `        chat_id: ${chatPlaceholder(slot)}`, "        send_resolved: true"])
    return { routes: routes.join("\n"), receivers: receivers.join("\n") }
}

/** The env name the stack file reads a bot token's swarm secret name from, and the one of the filled alertmanager.yml's config name. */
export const tokenEnvOf = (slot: number): string => `STARCI_MON_ALERTS_${String(slot)}`
export const ALERTMANAGER_CONFIG_ENV = "STARCI_MON_ALERTMANAGER"

/**
 * The server-side lines that open each bot's member with the server's own key (sops, SERVER_AGE_IDENTITY): the token becomes a swarm secret named
 * by its hash, the chat id fills alertmanager.yml from its template, and the filled file names its config by its hash. No value is echoed; a
 * member the server key does not open stops the step naming it.
 */
export const alertBotLines = (bots: readonly AlertBot[], base: string, marker: string): string[] => {
    if (bots.length === 0) return []
    const dir = `${base}/alerts`
    const identity = shellQuote(SERVER_AGE_IDENTITY)
    const template = shellQuote(`${base}/alertmanager.yml.tmpl`)
    const target = shellQuote(`${base}/alertmanager.yml`)
    const lines = [
        `command -v sops >/dev/null 2>&1 || { echo "no sops on this server: the app alert bots are opened here with its own key" >&2; exit 7; }`,
        `[ -r ${identity} ] || { echo "no server age identity at ${SERVER_AGE_IDENTITY} (starci app secret server-key makes it)" >&2; exit 7; }`,
        `install -d -m 700 ${shellQuote(dir)}`,
        `cp ${template} ${target}.starci-new`,
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
            `K="$(SOPS_AGE_KEY_FILE=${identity} sops -d --extract '["${ALERT_BOT_KEYS.chat}"]' ${sealedFile})" || { echo "the server key does not open the alert chat of ${name}" >&2; exit 7; }`,
            `printf '%s' "$K" | grep -Eqx -- '-?[0-9]+' || { echo "the alert chat of ${name} is no Telegram chat id" >&2; exit 7; }`,
            `export ${env}="starci_monitor_alerts_${String(slot)}_$(printf '%s' "$T" | sha256sum | cut -c1-12)"`,
            `if ! docker secret inspect "$${env}" >/dev/null 2>&1; then printf '%s' "$T" | docker secret create --label starci.monitor=alerts "$${env}" - >/dev/null; C=changed; fi`,
            `sed -i "s/${chatPlaceholder(slot)}/$K/" ${target}.starci-new`,
            "unset T K",
        )
    })
    lines.push(
        `if ! cmp -s ${target}.starci-new ${target}; then mv ${target}.starci-new ${target}; C=changed; else rm -f ${target}.starci-new; fi`,
        `export ${ALERTMANAGER_CONFIG_ENV}="starci_monitor_alertmanager_yml_$(sha256sum < ${target} | cut -c1-12)"`,
    )
    return lines
}

/** The one line a run prints when alerts are held: the apps that lack a ready bot. */
export const heldLine = (alerts: ServerAlerts): string | null =>
    alerts.lacking.length === 0 ? null : `alerts are held (a null receiver) for: ${alerts.lacking.join("; ")}`
