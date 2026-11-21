import { createHash } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { join, posix } from "node:path"
import { fileURLToPath } from "node:url"
import { parse, stringify } from "yaml"
import { z } from "zod"
import { Refusal } from "../../shared/errors.js"
import { forServer, resolveImages } from "./policy.js"
import type { ManagedServer, VpsPolicy } from "./policy.js"
import { fqdnOf, routerOf, SWARM_DNS_SEARCH } from "./plan.js"
import type { StepSecret, VpsPlan } from "./plan.js"
import { adminsPlaceholder, alertBotLines, alertRouting, ALERTMANAGER_CONFIG_ENV, BOT_CONFIG_ENV, BOT_WEBHOOK_PORT, chatPlaceholder, tokenEnvOf, tokenFile } from "./alerts.js"
import type { AlertBot, FilledFile } from "./alerts.js"
import { shellQuote } from "./ssh.js"

/**
 * The shared monitoring stack of a managed VPS (`starci vps monitor up`, contexts/project/monitoring.md). Every component is one entry of
 * ops/vps/monitor/components.yaml and one toggle: its default, turned on or off by the server's file. The plan assembles the stack file
 * and the config files of exactly the components that run (Prometheus jobs, alert groups, Grafana datasources and dashboards, the Alloy
 * pipeline each component adds), names every config and secret by its content's hash, and prints the memory budget of what runs.
 * Nothing here reaches a server; a secret's value reaches it only on the step's stdin (ssh.ts), never in the plan.
 */

const NAME = /^[a-z][a-z0-9-]*$/
const SIZE = /^(\d+(?:\.\d+)?)([MG])$/
const loose = z.record(z.string(), z.unknown())
const rollout = z.strictObject({
    parallelism: z.number().int().positive(),
    delay: z.string().optional(),
    order: z.enum(["stop-first", "start-first"]),
    failure_action: z.enum(["rollback", "pause", "continue"]),
    monitor: z.string(),
})

/** The kinds of secret a component reads, each a swarm secret named by its value's hash. */
export const MONITOR_SECRETS = {
    grafana: "MONITOR_GRAFANA_PASSWORD",
    glitchtipDb: "MONITOR_GLITCHTIP_DB_PASSWORD",
    glitchtipKey: "MONITOR_GLITCHTIP_SECRET_KEY",
} as const satisfies Record<string, StepSecret>

/** A monitoring secret kind. */
export type MonitorSecret = keyof typeof MONITOR_SECRETS

/** A component's default: on, off, or on when an app on the server has an alert bot ready (the monitor bot). */
const defaultSchema = z.union([z.boolean(), z.literal("alert-bots")])

const componentSchema = z.strictObject({
    default: defaultSchema,
    purpose: z.string().min(1),
    why: z.string().min(1),
    requires: z.array(z.string().regex(NAME)).optional(),
    image: z.strictObject({ image: z.string().regex(/^[a-z0-9./-]+$/), pin: z.string().min(1) }),
    resources: z.strictObject({ memory: z.string().regex(SIZE), cpus: z.string().regex(/^\d+\.\d+$/), reserveMemory: z.string().regex(SIZE), reserveCpus: z.string().regex(/^\d+\.\d+$/) }),
    update: rollout.extend({ failure_action: z.literal("rollback") }),
    rollback: rollout.extend({ failure_action: z.enum(["pause", "continue"]) }),
    retention: z.record(z.string(), z.union([z.string(), z.number()])),
    global: z.boolean().optional(),
    networks: z.array(z.enum(["internal", "socket", "monitor", "edge", "glitchtip"])).min(1),
    volumes: z.record(z.string().regex(NAME), z.string().regex(/^\//)).optional(),
    configs: z.record(z.string(), z.string().regex(/^\//)).optional(),
    secrets: z.partialRecord(z.enum(Object.keys(MONITOR_SECRETS) as [MonitorSecret, ...MonitorSecret[]]), z.string().regex(/^[a-z][a-z0-9_]*$/)).optional(),
    door: z.strictObject({ subdomain: z.string().regex(/^(?:[a-z0-9-]|\{id\})+$/), port: z.number().int(), localPort: z.number().int() }).optional(),
    service: loose.optional(),
    scrape: z.array(loose).optional(),
    alerts: z.array(loose).optional(),
    datasources: z.array(loose).optional(),
    dashboards: z.array(z.string()).optional(),
    alloy: z.string().optional(),
})

const fileSchema = z.looseObject({ schema: z.literal("starci/vps-monitor@1"), components: z.record(z.string().regex(NAME), componentSchema) })

/** One component of the monitoring stack, as components.yaml declares it. */
export type MonitorComponent = z.infer<typeof componentSchema>

/** A component of the loaded file by name, refused when the name is none of them. */
const componentOf = (components: Readonly<Record<string, MonitorComponent>>, name: string): MonitorComponent => {
    const component = components[name]
    if (component === undefined) throw new Refusal("VPS_MONITOR_COMPONENT", `${name} is no monitoring component; the components are ${Object.keys(components).join(", ")}`)
    return component
}

/** The folder of the monitoring files: ops/vps/monitor beside the components file. */
export const monitorDir = (policy: VpsPolicy, opsDir: string): string => join(opsDir, posix.dirname(policy.monitor.components))

/** Loads and validates ops/vps/monitor/components.yaml. */
export const loadMonitorComponents = (policy: VpsPolicy, opsDir: string): Record<string, MonitorComponent> => {
    const file = join(opsDir, policy.monitor.components)
    let raw: unknown
    try {
        raw = parse(readFileSync(file, "utf8"))
    } catch (error: unknown) {
        throw new Refusal("OPS_INVALID", `${file} is not readable yaml: ${error instanceof Error ? error.message : String(error)}`)
    }
    const parsed = fileSchema.safeParse(raw)
    if (!parsed.success) throw new Refusal("OPS_INVALID", `${file} is invalid: ${z.prettifyError(parsed.error)}`)
    for (const [name, component] of Object.entries(parsed.data.components))
        for (const needed of component.requires ?? []) if (parsed.data.components[needed] === undefined) throw new Refusal("OPS_INVALID", `${file}: ${name} requires ${needed}, which is no component`)
    return parsed.data.components
}

/** Whether a component's default turns it on, given whether an app on the server has an alert bot ready. */
export const onByDefault = (component: MonitorComponent | undefined, alertBots: boolean): boolean => component?.default === true || (component?.default === "alert-bots" && alertBots)

/**
 * The components a server runs: each default, turned on or off by its file's `monitor.components`; a requirement turned off is refused.
 * `alertBots` says whether an app on the server has an alert bot ready (a default of `alert-bots` follows it).
 */
export const selectComponents = (components: Readonly<Record<string, MonitorComponent>>, toggles: Readonly<Record<string, boolean>> = {}, alertBots = false): string[] => {
    for (const name of Object.keys(toggles)) if (components[name] === undefined) throw new Refusal("VPS_MONITOR_COMPONENT", `the server file names the monitoring component ${name}; the components are ${Object.keys(components).join(", ")}`)
    const on = Object.keys(components).filter((name) => toggles[name] ?? onByDefault(components[name], alertBots))
    const missing = on.flatMap((name) => (components[name]?.requires ?? []).filter((needed) => !on.includes(needed)).map((needed) => `${name} needs ${needed}`))
    if (missing.length > 0) throw new Refusal("VPS_MONITOR_REQUIRES", `the monitoring components turned on need others that are off: ${missing.join("; ")}; turn them on in the server file's monitor.components`)
    return on
}

const megabytes = (size: string): number => {
    const [, value = "0", unit = "M"] = SIZE.exec(size) ?? []
    return Number(value) * (unit === "G" ? 1024 : 1)
}

/** One row of the memory budget. */
export interface BudgetRow {
    readonly component: string
    readonly memoryMb: number
    readonly reserveMb: number
    readonly cpus: number
}

/** The memory and CPU budget of the components that run: their limits (the most the stack can take) and reservations. */
export const monitorBudget = (components: Readonly<Record<string, MonitorComponent>>, selected: readonly string[]): { readonly rows: readonly BudgetRow[]; readonly memoryMb: number; readonly reserveMb: number; readonly cpus: number } => {
    const rows = selected.map((name): BudgetRow => {
        const resources = componentOf(components, name).resources
        return { component: name, memoryMb: megabytes(resources.memory), reserveMb: megabytes(resources.reserveMemory), cpus: Number(resources.cpus) }
    })
    const sum = (key: "memoryMb" | "reserveMb" | "cpus"): number => Math.round(rows.reduce((total, row) => total + row[key], 0) * 100) / 100
    return { rows, memoryMb: sum("memoryMb"), reserveMb: sum("reserveMb"), cpus: sum("cpus") }
}

/** Where the stack runs: a managed server (its door under the owner's domain) or the local swarm of this machine. */
export type MonitorTarget = { readonly kind: "server"; readonly server: ManagedServer } | { readonly kind: "local" }

/** The facts a render needs beyond the policy. */
export interface MonitorFacts {
    readonly target: MonitorTarget
    /** The alert bots of the apps the server runs (vps/alerts.ts); none holds every alert behind the null receiver. Never the harness bot. */
    readonly alertBots: readonly AlertBot[]
}

/** The rendered stack: its files (relative path to content), the stack file among them, and the secret kinds it reads. */
export interface MonitorRender {
    readonly files: Readonly<Record<string, string>>
    readonly secrets: readonly MonitorSecret[]
    readonly doors: readonly { readonly component: string; readonly url: string; readonly target: string }[]
    /** The bots whose members the server opens before the deploy (their order is their slot). */
    readonly alertBots: readonly AlertBot[]
    /** The files the server fills from their `.tmpl` with the bots' chat ids (alertmanager.yml, or the monitor bot's config). */
    readonly filled: readonly FilledFile[]
}

/** The daily report of the monitor bot: 08:00 Asia/Ho_Chi_Minh (UTC+7, no daylight saving), the owner's zone. */
export const BOT_REPORT = { hour: 8, offsetMinutes: 420 } as const

/** The folder of the monitor bot's compiled code beside this file (dist/harness/vps/monitor-bot), shipped as configs. */
export const botCodeDir = (): string => fileURLToPath(new URL("./monitor-bot/", import.meta.url))

/** The monitor bot's code files: every compiled module of its folder but the specs, their source-map comment dropped. */
export const botCodeFiles = (dir: string = botCodeDir()): Record<string, string> => {
    const names = readdirSync(dir).filter((name) => name.endsWith(".js") && !name.endsWith(".test.js")).sort((left, right) => left.localeCompare(right))
    if (!names.includes("main.js")) throw new Refusal("OPS_INVALID", `the monitor bot's code is not built in ${dir} (npm run build in cli)`)
    return Object.fromEntries(names.map((name) => [`monitor-bot/${name}`, readFileSync(join(dir, name), "utf8").replace(/\n\/\/# sourceMappingURL=.*\s*$/, "\n")]))
}

/** The monitor bot's config (monitor-bot/config.ts parseConfig): the stack's addresses and one entry per bot, its chat and admins left as placeholders the server fills. */
export const botConfig = (policy: VpsPolicy, server: string, bots: readonly AlertBot[], options: { readonly loki: boolean; readonly grafana: string | null }): string => {
    const config = {
        server,
        telegram: "https://api.telegram.org",
        // The full swarm names: a short one falls through to the host's search domain (contexts/project/monitoring.md, dns_search).
        prometheus: `http://${policy.monitor.stack}_prometheus:9090`,
        loki: options.loki ? `http://${policy.monitor.stack}_loki:3100` : null,
        alertmanager: `http://${policy.monitor.stack}_alertmanager:9093`,
        docker: `http://${policy.monitor.stack}_socket-proxy:2375`,
        grafana: options.grafana,
        renderer: false,
        listen: BOT_WEBHOOK_PORT,
        memoryAlertPercent: policy.health.memoryAlertPercent,
        diskAlertPercent: policy.health.diskAlertPercent,
        reportHour: BOT_REPORT.hour,
        reportOffsetMinutes: BOT_REPORT.offsetMinutes,
        bots: bots.map((bot, slot) => ({ slot, project: bot.project, env: bot.env, stack: bot.stack, tokenFile: `/run/secrets/${tokenFile(slot)}`, chat: chatPlaceholder(slot), admins: adminsPlaceholder(slot) })),
    }
    // The chat id is a JSON number once filled: its placeholder is written unquoted.
    return `${JSON.stringify(config, null, 2).replaceAll(/"(__STARCI_ALERTS_CHAT_\d+__)"/g, "$1")}\n`
}

/** The env name the stack file reads a secret's swarm name from. */
export const secretEnvOf = (kind: MonitorSecret): string => `STARCI_MON_${kind.toUpperCase()}`

const TOKEN = /\{\{([A-Za-z0-9_.-]+)\}\}/g

const fill = (text: string, tokens: Readonly<Record<string, string>>, where: string): string =>
    text.replaceAll(TOKEN, (_whole, key: string) => {
        const value = tokens[key]
        if (value === undefined) throw new Refusal("OPS_INVALID", `${where} names {{${key}}}, which the monitoring plan does not fill`)
        return value
    })

/** Fills every string of a parsed value. */
const fillDeep = (value: unknown, tokens: Readonly<Record<string, string>>, where: string): unknown => {
    if (typeof value === "string") return fill(value, tokens, where)
    if (Array.isArray(value)) return value.map((item) => fillDeep(item, tokens, where))
    if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fillDeep(item, tokens, where)]))
    return value
}

const hash = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 12)

const readText = (dir: string, rel: string): string => {
    try {
        return readFileSync(join(dir, rel), "utf8")
    } catch {
        throw new Refusal("OPS_INVALID", `the monitoring file ${rel} is not in ${dir}`)
    }
}

/** How many probe labels one environment may carry (`starci.monitor.probe.0` ... `.9`), one Prometheus job each. */
export const PROBE_SLOTS = 10

/**
 * The swarm name of a component of the stack (`<stack>_<component>`), the only name an in-stack address may use. The containers inherit the
 * host's resolv.conf; a short name the embedded DNS does not answer on the asking network falls through to the host's search domain, and a
 * provider's wildcard there answers with the server's public IP. Every service also sets `dns_search: ["."]` (SWARM_DNS_SEARCH).
 */
const swarmName = (stack: string, component: string): string => `${stack}_${component}`

const probeJobs = (stack: string, network: string): Record<string, unknown>[] =>
    Array.from({ length: PROBE_SLOTS }, (_unused, slot) => {
        const label = `__meta_dockerswarm_service_label_starci_monitor_probe_${String(slot)}`
        return {
            job_name: `probe-${String(slot)}`,
            metrics_path: "/probe",
            params: { module: ["https"] },
            dockerswarm_sd_configs: [{ host: `tcp://${swarmName(stack, "socket-proxy")}:2375`, role: "services", refresh_interval: "60s" }],
            relabel_configs: [
                { source_labels: [label], regex: "(.+)", action: "keep" },
                { source_labels: ["__meta_dockerswarm_network_name"], regex: network, action: "keep" },
                { source_labels: [label], target_label: "__param_target" },
                // A plain-http probe target takes the http module; written /{2} so the regex is no http URL literal (it matches the same targets).
                { source_labels: ["__param_target"], regex: "http:/{2}.*", target_label: "__param_module", replacement: "http" },
                { source_labels: ["__param_target"], target_label: "instance" },
                { source_labels: ["__meta_dockerswarm_service_label_starci_monitor_stack"], target_label: "stack" },
                { target_label: "__address__", replacement: `${swarmName(stack, "blackbox")}:9115` },
            ],
        }
    })

/** The door of a component: its public https name on a server, its local address on the local swarm. */
const doorOf = (policy: VpsPolicy, target: MonitorTarget, door: NonNullable<MonitorComponent["door"]>): { readonly url: string; readonly secure: string; readonly fqdn: string | null } => {
    if (target.kind === "local") return { url: `http://localhost:${String(door.localPort)}`, secure: "false", fqdn: null }
    const fqdn = fqdnOf(policy, forServer(door.subdomain, target.server.id))
    return { url: `https://${fqdn}`, secure: "true", fqdn }
}

/**
 * Renders the stack of the selected components: `stack.yml` and every config file it mounts, under the paths the plan writes them to.
 * `images` maps each selected component to its pinned `repo:tag@digest`.
 */
export const renderMonitor = (policy: VpsPolicy, dir: string, components: Readonly<Record<string, MonitorComponent>>, selected: readonly string[], images: Readonly<Record<string, string>>, facts: MonitorFacts): MonitorRender => {
    const on = (name: string): boolean => selected.includes(name)
    const target = facts.target
    const serverName = target.kind === "local" ? "local" : target.server.id
    const local = target.kind === "local"
    const doorTokens: Record<string, string> = {}
    const doors: { component: string; url: string; target: string }[] = []
    for (const name of selected) {
        const door = components[name]?.door
        if (door === undefined) continue
        const found = doorOf(policy, target, door)
        doorTokens[`door.${name}.url`] = found.url
        doors.push({ component: name, url: found.url, target: `${policy.monitor.stack}_${name}:${String(door.port)}` })
    }
    const base = {
        stack: policy.monitor.stack,
        network: policy.monitor.network,
        server: serverName,
        "edge.stack": policy.edge.stack,
        ...Object.fromEntries(Object.entries(policy.health).map(([key, value]) => [`health.${key}`, String(value)])),
        ...doorTokens,
    }
    const tokensOf = (name: string): Record<string, string> => {
        const component = componentOf(components, name)
        const door = component.door === undefined ? undefined : doorOf(policy, target, component.door)
        return {
            ...base,
            ...Object.fromEntries(Object.entries(component.retention).map(([key, value]) => [`retention.${key}`, String(value)])),
            ...(door === undefined ? {} : { "door.url": door.url, "door.secure": door.secure }),
        }
    }
    const files: Record<string, string> = {}
    const header = "# Written by `starci vps monitor up` (ops/vps/monitor); a later edit is overwritten.\n"

    // Prometheus: its own file, every component's jobs, the probe jobs with blackbox, the alerting block with Alertmanager.
    if (on("prometheus")) {
        const prometheus = fillDeep(parse(readText(dir, "prometheus.yml")), tokensOf("prometheus"), "prometheus.yml") as Record<string, unknown>
        const scrape = [...(prometheus.scrape_configs as unknown[]), ...selected.flatMap((name) => fillDeep(components[name]?.scrape ?? [], tokensOf(name), `components.yaml ${name}.scrape`) as unknown[]), ...(on("blackbox") ? probeJobs(policy.monitor.stack, policy.monitor.network) : [])]
        const assembled = { ...prometheus, ...(on("alertmanager") ? { alerting: { alertmanagers: [{ static_configs: [{ targets: [`${swarmName(policy.monitor.stack, "alertmanager")}:9093`] }] }] } } : {}), scrape_configs: scrape }
        files["prometheus.yml"] = header + stringify(assembled, { lineWidth: 0 })
        const alerts = parse(readText(dir, "alerts.yml")) as { groups: unknown[] }
        const groups = [...(fillDeep(alerts.groups, base, "alerts.yml") as unknown[]), ...selected.flatMap((name) => fillDeep(components[name]?.alerts ?? [], tokensOf(name), `components.yaml ${name}.alerts`) as unknown[])]
        files["alerts.yml"] = header + stringify({ groups }, { lineWidth: 0 })
    }
    // With the monitor bot on, Alertmanager's receivers are webhooks to it and the bot holds the tokens and chat ids; else the receivers are
    // Alertmanager's own telegram_configs. Either way the chat ids are filled on the server from the opened members (alertBotLines).
    const viaBot = on("monitor-bot")
    const bots = facts.alertBots.length > 0
    const filled: FilledFile[] = []
    if (on("alertmanager")) {
        const routing = alertRouting(facts.alertBots, viaBot, `${policy.monitor.stack}_monitor-bot`)
        const onServer = bots && !viaBot
        files[onServer ? "alertmanager.yml.tmpl" : "alertmanager.yml"] = fill(readText(dir, "alertmanager.yml"), routing, "alertmanager.yml")
        if (onServer) filled.push({ rel: "alertmanager.yml", env: ALERTMANAGER_CONFIG_ENV })
    }
    if (viaBot) {
        Object.assign(files, botCodeFiles())
        files["monitor-bot/package.json"] = `${JSON.stringify({ name: "starci-monitor-bot", private: true, type: "module" })}\n`
        files[bots ? "monitor-bot/config.json.tmpl" : "monitor-bot/config.json"] = botConfig(policy, serverName, facts.alertBots, { loki: on("loki"), grafana: on("grafana") ? (doorTokens["door.grafana.url"] ?? null) : null })
        if (bots) filled.push({ rel: "monitor-bot/config.json", env: BOT_CONFIG_ENV })
    }
    const tokenHolder = viaBot ? "monitor-bot" : "alertmanager"
    if (on("grafana")) {
        const datasources = parse(readText(dir, "grafana/datasources.yaml")) as { apiVersion: number; datasources: unknown[] }
        const own = fillDeep(datasources.datasources, tokensOf("grafana"), "grafana/datasources.yaml") as unknown[]
        const added = selected.flatMap((name) => fillDeep(components[name]?.datasources ?? [], tokensOf(name), `components.yaml ${name}.datasources`) as unknown[])
        files["grafana/datasources.yaml"] = header + stringify({ ...datasources, datasources: [...own, ...added] }, { lineWidth: 0 })
        files["grafana/dashboards.yaml"] = readText(dir, "grafana/dashboards.yaml")
        for (const name of selected) for (const board of components[name]?.dashboards ?? []) files[board] = readText(dir, board)
    }
    if (on("alloy")) files["config.alloy"] = [fill(readText(dir, "config.alloy"), tokensOf("alloy"), "config.alloy"), ...selected.flatMap((name) => { const extra = components[name]?.alloy; return extra === undefined ? [] : [fill(readText(dir, extra), tokensOf(name), extra)] })].join("")
    for (const name of selected) {
        for (const rel of Object.keys(components[name]?.configs ?? {})) {
            if (files[rel] !== undefined || files[`${rel}.tmpl`] !== undefined) continue
            files[rel] = fill(readText(dir, rel), tokensOf(name), rel)
        }
    }

    // The configs of the stack, each named by its content's hash, so a change is a new config and a rollback finds the old one.
    const configKey = (rel: string): string => rel.replaceAll(/[^a-z0-9]+/gi, "_").toLowerCase()
    const configs: Record<string, { file: string; name: string }> = {}
    const botFiles = Object.keys(files).filter((rel) => rel.startsWith("monitor-bot/"))
    const mountsOf = (name: string): { source: string; target: string; mode: number }[] => {
        const own = Object.entries(components[name]?.configs ?? {})
        const boards = name === "grafana" ? selected.flatMap((other) => (components[other]?.dashboards ?? []).map((board): [string, string] => [board, `/etc/grafana/dashboards/${posix.basename(board)}`])) : []
        const code = name === "monitor-bot" ? botFiles.map((rel): [string, string] => [rel.replace(/\.tmpl$/, ""), `/app/${posix.basename(rel.replace(/\.tmpl$/, ""))}`]) : []
        return [...own, ...boards, ...code].map(([rel, mount]) => {
            const key = configKey(rel)
            const onServer = filled.find((file) => file.rel === rel)
            configs[key] = { file: `./${rel}`, name: onServer !== undefined ? `\${${onServer.env}}` : `${policy.monitor.stack.replaceAll("-", "_")}_${key}_${hash(files[rel] ?? "")}` }
            return { source: key, target: mount, mode: 0o444 }
        })
    }

    const secrets = new Set<MonitorSecret>()
    const networks = new Set<string>()
    const volumes = new Set<string>()
    const services: Record<string, unknown> = {}
    for (const name of selected) {
        const component = componentOf(components, name)
        const service = fillDeep(component.service ?? {}, tokensOf(name), `components.yaml ${name}.service`) as Record<string, unknown>
        const text = JSON.stringify(service)
        if (/\$(?!\$)/.test(text.replaceAll("$$", ""))) throw new Refusal("OPS_INVALID", `components.yaml ${name}.service holds a single $; write $$ for a $ the container sees`)
        const mounted = Object.entries(component.secrets ?? {}) as [MonitorSecret, string][]
        const botMounts = name === tokenHolder ? facts.alertBots.map((_bot, slot) => tokenFile(slot)) : []
        for (const [kind] of mounted) secrets.add(kind)
        const ownNetworks = component.networks.filter((network) => !(local && network === "edge"))
        for (const network of ownNetworks) networks.add(network)
        for (const volume of Object.keys(component.volumes ?? {})) volumes.add(volume)
        const door = component.door
        const doorFound = door === undefined ? undefined : doorOf(policy, target, door)
        const router = doorFound?.fqdn === null || doorFound === undefined ? undefined : routerOf(doorFound.fqdn)
        const edgeLabels = router === undefined || door === undefined || target.kind !== "server" || target.server.ingressMode !== "edge" || doorFound?.fqdn == null ? [] : [
            "traefik.enable=true",
            `traefik.http.routers.${router}.rule=Host(\`${doorFound.fqdn}\`)`,
            `traefik.http.routers.${router}.entrypoints=websecure`,
            `traefik.http.routers.${router}.tls.certresolver=${policy.edge.resolver}`,
            `traefik.http.routers.${router}.service=${router}`,
            `traefik.http.services.${router}.loadbalancer.server.port=${String(door.port)}`,
        ]
        const volumeMounts = Object.entries(component.volumes ?? {}).map(([volume, mount]) => `${volume}:${mount}`)
        const configMounts = mountsOf(name)
        services[name] = {
            image: images[name],
            ...service,
            ...(volumeMounts.length + ((service.volumes as unknown[] | undefined)?.length ?? 0) > 0 ? { volumes: [...((service.volumes as unknown[] | undefined) ?? []), ...volumeMounts] } : {}),
            ...(configMounts.length > 0 ? { configs: configMounts } : {}),
            ...(mounted.length + botMounts.length > 0 ? { secrets: [...mounted.map(([, file]) => file), ...botMounts].map((file) => ({ source: file, target: file, mode: 0o444 })) } : {}),
            ...(local && door !== undefined ? { ports: [{ target: door.port, published: door.localPort, protocol: "tcp", mode: "host" }] } : {}),
            networks: ownNetworks,
            dns_search: [...SWARM_DNS_SEARCH],
            deploy: {
                ...(component.global === true ? { mode: "global" } : { mode: "replicated", replicas: 1, placement: { constraints: ["node.role == manager"] } }),
                resources: { limits: { memory: component.resources.memory, cpus: component.resources.cpus }, reservations: { memory: component.resources.reserveMemory, cpus: component.resources.reserveCpus } },
                update_config: component.update,
                rollback_config: component.rollback,
                restart_policy: { condition: "any", delay: "5s" },
                ...(edgeLabels.length > 0 ? { labels: edgeLabels } : {}),
            },
        }
    }
    const networkSpec: Record<string, Record<string, unknown>> = {
        internal: { driver: "overlay" },
        socket: { driver: "overlay", internal: true },
        glitchtip: { driver: "overlay", internal: true },
        monitor: { external: true, name: policy.monitor.network },
        edge: { external: true, name: policy.swarm.network },
    }
    const fileOf = (kind: MonitorSecret): string => selected.map((name) => components[name]?.secrets?.[kind]).find((file) => file !== undefined) ?? kind
    const stack = {
        version: "3.8",
        services,
        networks: Object.fromEntries([...networks].sort((left, right) => left.localeCompare(right)).map((network) => [network, networkSpec[network]])),
        ...(volumes.size > 0 ? { volumes: Object.fromEntries([...volumes].sort((left, right) => left.localeCompare(right)).map((volume) => [volume, {}])) } : {}),
        ...(Object.keys(configs).length > 0 ? { configs } : {}),
        ...(secrets.size + (on(tokenHolder) ? facts.alertBots.length : 0) > 0
            ? {
                  secrets: {
                      ...Object.fromEntries([...secrets].map((kind) => [fileOf(kind), { external: true, name: `\${${secretEnvOf(kind)}}` }])),
                      ...(on(tokenHolder) ? Object.fromEntries(facts.alertBots.map((_bot, slot) => [tokenFile(slot), { external: true, name: `\${${tokenEnvOf(slot)}}` }])) : {}),
                  },
              }
            : {}),
    }
    files["stack.yml"] = "# Written by `starci vps monitor up` from ops/vps/monitor/components.yaml: the components this server runs, nothing else.\n" + stringify(stack, { lineWidth: 0 })
    return { files, secrets: [...secrets], doors, alertBots: on(tokenHolder) ? facts.alertBots : [], filled }
}

/**
 * `vps monitor up <id>` (or `--local`): the monitoring network, the secrets named by the hash of their values, the files and the stack,
 * deployed again only when a file or a secret changed. `base` is where the files go (/opt/starci/monitor on a server).
 */
export const monitorUpPlan = (policy: VpsPolicy, target: MonitorTarget, render: MonitorRender, budget: ReturnType<typeof monitorBudget>, base: string): VpsPlan => {
    const marker = "STARCI_EOF"
    const network = shellQuote(policy.monitor.network)
    const stack = shellQuote(policy.monitor.stack)
    const writes = Object.entries(render.files).map(([rel, content]) => {
        if (content.includes(marker)) throw new Refusal("VPS_PLAN_INVALID", `${rel} holds ${marker}`)
        const file = shellQuote(`${base}/${rel}`)
        return [`mkdir -p "$(dirname ${file})"`, `cat > ${file}.starci-new <<'${marker}'`, content.trimEnd(), marker, `if ! cmp -s ${file}.starci-new ${file}; then mv ${file}.starci-new ${file}; C=changed; else rm -f ${file}.starci-new; fi`].join("\n")
    })
    const secretLines = render.secrets.flatMap((kind) => {
        const variable = MONITOR_SECRETS[kind]
        const env = secretEnvOf(kind)
        return [
            `export ${env}="starci_monitor_${kind.toLowerCase()}_$(printf '%s' "$${variable}" | sha256sum | cut -c1-12)"`,
            `if ! docker secret inspect "$${env}" >/dev/null 2>&1; then printf '%s' "$${variable}" | docker secret create --label starci.monitor=secret "$${env}" - >/dev/null; C=changed; fi`,
        ]
    })
    const name = target.kind === "local" ? "local" : target.server.id
    return {
        verb: "monitor up",
        server: name,
        steps: [
            {
                id: "monitor-network",
                summary: `the attachable overlay network ${policy.monitor.network} the opted-in app services join to be scraped`,
                root: true,
                secrets: [],
                script: `[ "$(docker info --format '{{.Swarm.LocalNodeState}}')" = active ] || { echo "no swarm: run ${target.kind === "local" ? "docker swarm init" : "starci vps swarm init"} first" >&2; exit 7; }\ndocker network inspect ${network} >/dev/null 2>&1 && { echo unchanged; exit 0; }\ndocker network create --driver overlay --attachable ${network} >/dev/null\necho changed`,
            },
            {
                id: "monitor-stack",
                summary: `the ${policy.monitor.stack} stack: ${budget.rows.map((row) => row.component).join(", ")} (memory limits ${String(budget.memoryMb)} MB, reservations ${String(budget.reserveMb)} MB, CPU limits ${String(budget.cpus)})`,
                root: true,
                secrets: render.secrets.map((kind) => MONITOR_SECRETS[kind]),
                script: [
                    "C=unchanged",
                    // chmod is a no-op where the folder system has no modes (the local swarm on Windows).
                    `mkdir -p ${shellQuote(base)}; chmod 700 ${shellQuote(base)} 2>/dev/null || true`,
                    ...secretLines,
                    ...writes,
                    ...alertBotLines(render.alertBots, base, marker, render.filled),
                    `docker stack ls --format '{{.Name}}' | grep -qx ${stack} || C=changed`,
                    // --prune removes a component turned off. Configs and secrets of an older hash stay, so a rollback finds them.
                    `if [ "$C" = changed ]; then docker stack deploy --quiet --prune -c ${shellQuote(`${base}/stack.yml`)} ${stack} >/dev/null; fi`,
                    'echo "$C"',
                ].join("\n"),
            },
        ],
        notes: [
            ...render.doors.map((door) => (target.kind === "local" ? `${door.component} answers on ${door.url}` : `${door.component} answers on ${door.url} once \`starci vps domain add ${target.server.id} ${door.url.replace(/^https:\/\//, "").split(".")[0] ?? ""} --to ${door.target} --execute\` opened its door; put a Cloudflare Access application in front of it as for the UI`)),
            `memory budget: ${budget.rows.map((row) => `${row.component} ${String(row.memoryMb)}M`).join(", ")}; total limits ${String(budget.memoryMb)} MB (reservations ${String(budget.reserveMb)} MB)`,
            "an app environment opts in with `environments.<env>.monitoring` of its .starcistacks/application-stacks.yaml (contexts/project/monitoring.md)",
        ],
    }
}

/** The images of the selected components, pinned by contexts/stack/pins.yaml. */
export const monitorImages = (components: Readonly<Record<string, MonitorComponent>>, selected: readonly string[], opsDir: string): Record<string, string> =>
    resolveImages(Object.fromEntries(selected.map((name) => [name, componentOf(components, name).image])), opsDir)
