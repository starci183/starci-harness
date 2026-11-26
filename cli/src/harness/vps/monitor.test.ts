// The shared monitoring stack rendered without a server: the default components' files hold every token filled, the generic alerts of
// the house standard (replicas, postgres, redis, the edge's 5xx rate, a probe failing 2 minutes, the host thresholds of ops/vps.yaml
// health), the swarm-tasks and edge jobs, logs kept 7 days; and the alert routing of PROJECT-MONITORING-5: each app's own bot, read from
// its sealed alert member on the server, host alerts to every app's bot once, the rest held behind a null receiver; never the harness bot.
// Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"
import { edgeStackFile } from "./plan.js"
import { alertBotLines, appAlertBots, chatPlaceholder, heldLine, routableAlerts, serverAlerts } from "./alerts.js"
import type { AlertBot } from "./alerts.js"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { loadMonitorComponents, monitorDir, monitorImages, renderMonitor, selectComponents } from "./monitor.js"
import type { MonitorFacts } from "./monitor.js"
import { loadVpsPolicy, parseServer, resolvePins } from "./policy.js"
import { chooseModel, loadService, renderService, selectServiceComponents, serviceImages } from "./services.js"

const opsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "ops")
const policy = loadVpsPolicy(opsDir)
const components = loadMonitorComponents(policy, opsDir)
const exampleFile = join(opsDir, "vps", "servers", "example.yaml")
const server = parseServer(policy, { ...(parse(readFileSync(exampleFile, "utf8")) as Record<string, unknown>), ingress: { mode: "edge" } }, exampleFile, join(opsDir, "vps", "servers"))

const render = (facts: MonitorFacts, toggles: Record<string, boolean> = {}): Readonly<Record<string, string>> => {
    const selected = selectComponents(components, toggles, facts.alertBots.length > 0)
    return renderMonitor(policy, monitorDir(policy, opsDir), components, selected, monitorImages(components, selected, opsDir), facts).files
}

interface Rule { alert: string; expr: string; for?: string }
const rulesOf = (files: Readonly<Record<string, string>>): Rule[] => (parse(files["alerts.yml"] ?? "") as { groups: { rules: Rule[] }[] }).groups.flatMap((group) => group.rules)

void test("the default stack fills every token, keeps logs 7 days and metrics 15 days, and reads the host thresholds from ops/vps.yaml health", () => {
    const files = render({ target: { kind: "server", server }, alertBots: [] })
    // a Grafana dashboard's own {{device}} legends are Grafana's, not the plan's
    for (const [rel, text] of Object.entries(files)) if (!rel.endsWith(".json")) assert.doesNotMatch(text, /\{\{[A-Za-z0-9_.-]+\}\}/, `${rel} holds an unfilled token`)
    assert.match(files["loki.yaml"] ?? "", /retention_period: 168h/)
    assert.match(files["stack.yml"] ?? "", /--storage\.tsdb\.retention\.time=15d/)
    const rules = rulesOf(files)
    const expr = (name: string): string => rules.find((rule) => rule.alert === name)?.expr ?? ""
    assert.match(expr("HostDiskFull"), new RegExp(`\\(100 - ${String(policy.health.diskAlertPercent)}\\) / 100`))
    assert.match(expr("HostMemoryLow"), new RegExp(`\\(100 - ${String(policy.health.memoryAlertPercent)}\\) / 100`))
    for (const name of ["TargetDown", "ServiceRestarting", "ServiceReplicasBelowDesired", "PostgresDown", "PostgresConnectionsNearMax", "PostgresSlowQueries", "RedisDown", "RedisMemoryNearMax", "EdgeErrorRate"]) assert.notEqual(expr(name), "", `${name} is a rule`)
    assert.match(expr("EdgeErrorRate"), /code=~"5\.\."/)
    assert.match(expr("EdgeErrorRate"), /> 0\.02$/)
    assert.equal(rules.some((rule) => rule.alert === "ProbeFailed"), false, "blackbox is off by default, and so is its rule")
})

void test("Prometheus keeps one series per task Swarm wants running and scrapes the edge Traefik on the edge network", () => {
    const files = render({ target: { kind: "server", server }, alertBots: [] })
    const jobs = (parse(files["prometheus.yml"] ?? "") as { scrape_configs: Record<string, unknown>[] }).scrape_configs
    const tasks = jobs.find((job) => job.job_name === "swarm-tasks")
    assert.ok(tasks !== undefined)
    assert.equal(tasks.metrics_path, "/federate")
    assert.deepEqual(tasks.metric_relabel_configs, [{ source_labels: ["__name__"], regex: ".+", action: "drop" }])
    assert.ok(JSON.stringify(tasks.relabel_configs).includes("__meta_dockerswarm_task_desired_state"))
    const edge = jobs.find((job) => job.job_name === "edge")
    assert.deepEqual(edge?.dns_sd_configs, [{ names: [`tasks.${policy.edge.stack}_proxy`], type: "A", port: 8082 }])
    const stack = parse(files["stack.yml"] ?? "") as { services: Record<string, { networks: string[] }> }
    assert.ok(stack.services.prometheus?.networks.includes("edge"))
    const local = parse(render({ target: { kind: "local" }, alertBots: [] })["stack.yml"] ?? "") as { services: Record<string, { networks: string[] }> }
    assert.equal(local.services.prometheus?.networks.includes("edge"), false, "the local swarm has no edge network")
    const edgeFile = edgeStackFile(policy, resolvePins(policy, opsDir))
    assert.match(edgeFile, /--entrypoints\.metrics\.address=:8082/)
    assert.match(edgeFile, /--metrics\.prometheus\.entryPoint=metrics/)
    assert.doesNotMatch(edgeFile, /published: 8082/, "the metrics entrypoint is published on no port")
})

void test("with blackbox on, a health URL failing 2 minutes and a certificate expiring in under 14 days alert", () => {
    const rules = rulesOf(render({ target: { kind: "server", server }, alertBots: [] }, { blackbox: true }))
    assert.equal(rules.find((rule) => rule.alert === "ProbeFailed")?.for, "2m")
    assert.match(rules.find((rule) => rule.alert === "CertificateExpiresSoon")?.expr ?? "", /< 14$/)
})

const SERVER = "age1serverfixture"
/** A sealed member as sops writes it: key names plain, values sealed (fixture ciphertext). */
const sealedMember = (keys: readonly string[]): string => [...keys.map((key) => `${key}: ENC[AES256_GCM,data:fixture,type:str]`), "sops:", "    age:", `        - recipient: ${SERVER}`, ""].join("\n")

/** An app checkout with one environment on the server: its alert member holding `keys`, or no alerts block at all. */
const appAt = (root: string, project: string, env: string, keys: readonly string[] | null, owner?: string): string => {
    const dir = join(root, project)
    mkdirSync(join(dir, ".starcistacks", env, "secrets"), { recursive: true })
    writeFileSync(join(dir, "hfs.json"), JSON.stringify({ project }))
    const monitoring = keys === null ? "" : `\n    monitoring:\n      alerts: {telegram: {member: alerts${owner === undefined ? "" : `, owner: "${owner}"`}}}`
    writeFileSync(join(dir, ".starcistacks", "application-stacks.yaml"), `environments:
  ${env}:
    deploy:
      stack: ${project}-${env}
      remote: {serverRecipient: ${SERVER}}${monitoring}
  other:
    deploy: {remote: {serverRecipient: age1elsewhere}}
`)
    if (keys !== null) writeFileSync(join(dir, ".starcistacks", env, "secrets", "alerts.enc.yaml"), sealedMember(keys))
    return dir
}

void test("each app's ready bot is found from its sealed member's key names; the rest are held by name, never refused", (t) => {
    const root = mkdtempSync(join(tmpdir(), "starci-alert-bots-"))
    t.after(() => {
        rmSync(root, { recursive: true, force: true })
    })
    const ready = appAt(root, "nivo", "production", ["ALERTS_TELEGRAM_BOT_TOKEN", "ALERTS_TELEGRAM_CHAT_ID"])
    const noChat = appAt(root, "next", "production", ["ALERTS_TELEGRAM_BOT_TOKEN"])
    const owned = appAt(root, "shop", "production", ["ALERTS_TELEGRAM_BOT_TOKEN"], "@StarCi183")
    const none = appAt(root, "plain", "staging", null)
    const found = appAlertBots(ready, SERVER)
    assert.deepEqual(found.bots.map((bot) => [bot.project, bot.env, bot.stack, bot.chat, bot.owner]), [["nivo", "production", "nivo-production", true, null]], "a legacy member names its chat")
    assert.equal(found.envs, 1, "an environment on another server is not this one's")
    assert.deepEqual(appAlertBots(owned, SERVER).bots.map((bot) => [bot.chat, bot.owner]), [[false, "starci183"]], "an owner username is ready with no chat id, lower-cased")
    const alerts = serverAlerts(["nivo", "next", "shop", "plain", "ghost"], [ready, noChat, owned, none], SERVER)
    assert.equal(alerts.bots.length, 2)
    const line = heldLine(alerts) ?? ""
    assert.match(line, /alerts are held/)
    assert.match(line, /next\/production names no owner \(environments\.production\.monitoring\.alerts\.telegram\.owner: "@<username>"; starci app alerts setup --env production\)/)
    const noBot = routableAlerts(alerts, false)
    assert.deepEqual(noBot.bots.map((bot) => bot.project), ["nivo"], "without the monitor bot an owner username cannot be routed")
    assert.match(heldLine(noBot) ?? "", /shop\/production: its owner @starci183 is connected by the monitor bot, which is off on this server/)
    assert.equal(routableAlerts(alerts, true), alerts)
    assert.match(line, /plain\/staging declares no alert bot/)
    assert.match(line, /ghost: no checkout of it is known here/)
    assert.equal(heldLine(serverAlerts([], [], SERVER)), null)
})

const bot = (project: string, env: string, admins = false, owner: string | null = null): AlertBot => ({ project, env, stack: `${project}-${env}`, file: `${project}.enc.yaml`, sealed: sealedMember(owner === null ? ["ALERTS_TELEGRAM_BOT_TOKEN", "ALERTS_TELEGRAM_CHAT_ID"] : ["ALERTS_TELEGRAM_BOT_TOKEN"]), admins, chat: owner === null, owner })

void test("with no app bot ready every alert goes to the null receiver, no token is mounted and nothing is opened", () => {
    const files = render({ target: { kind: "server", server }, alertBots: [] })
    const manager = parse(files["alertmanager.yml"] ?? "") as { route: { receiver: string; routes?: unknown[] }; receivers: { name: string }[] }
    assert.equal(manager.route.receiver, "held")
    assert.equal(manager.route.routes, undefined)
    assert.deepEqual(manager.receivers, [{ name: "held" }])
    assert.doesNotMatch(files["stack.yml"] ?? "", /alerts_0|telegram/)
    assert.deepEqual(alertBotLines([], "/opt/starci/monitor", "STARCI_EOF"), [])
})

void test("an app's alerts go to its own bot, a host alert to one bot of every app once, and the server opens the members", () => {
    const bots = [bot("nivo", "staging"), bot("nivo", "production"), bot("next", "production")]
    const files = render({ target: { kind: "server", server }, alertBots: bots }, { "monitor-bot": false })
    assert.equal(files["alertmanager.yml"], undefined, "the chat ids are filled on the server")
    const manager = parse(files["alertmanager.yml.tmpl"] ?? "") as { route: { receiver: string; routes: { matchers: string[]; receiver: string; continue?: boolean }[] }; receivers: { name: string; telegram_configs?: { bot_token_file: string; chat_id: string }[] }[] }
    assert.equal(manager.route.receiver, "held")
    const host = manager.route.routes.filter((route) => route.matchers[0] === 'stack=""')
    assert.deepEqual(host.map((route) => [route.receiver, route.continue]), [["nivo-staging", true], ["next-production", true]], "one bot per app, each once")
    assert.deepEqual(manager.route.routes.filter((route) => route.matchers[0] !== 'stack=""').map((route) => [route.matchers[0], route.receiver]), [['stack="nivo-staging"', "nivo-staging"], ['stack="nivo-production"', "nivo-production"], ['stack="next-production"', "next-production"]])
    assert.deepEqual(manager.receivers.find((receiver) => receiver.name === "next-production")?.telegram_configs?.[0], { bot_token_file: "/run/secrets/alerts_2", chat_id: chatPlaceholder(2), send_resolved: true })
    const stack = parse(files["stack.yml"] ?? "") as { services: Record<string, { secrets?: { source: string }[] }>; secrets: Record<string, { name: string }>; configs: Record<string, { name: string }> }
    assert.deepEqual(stack.services.alertmanager?.secrets?.map((secret) => secret.source), ["alerts_0", "alerts_1", "alerts_2"])
    assert.equal(stack.secrets.alerts_1?.name, "${STARCI_MON_ALERTS_1}")
    assert.equal(stack.configs.alertmanager_yml?.name, "${STARCI_MON_ALERTMANAGER}")
    const lines = alertBotLines(bots, "/opt/starci/monitor", "STARCI_EOF").join("\n")
    assert.match(lines, /SOPS_AGE_KEY_FILE='\/root\/\.config\/sops\/age\/keys\.txt' sops -d --extract '\["ALERTS_TELEGRAM_BOT_TOKEN"\]'/)
    assert.match(lines, /docker secret create --label starci\.monitor=alerts/)
    assert.match(lines, /s\/__STARCI_ALERTS_CHAT_2__\/\$K\//)
    assert.doesNotMatch(lines, /echo "\$T"|echo "\$K"/, "no value is echoed")
})

// A container inherits the host's resolv.conf; a short name the embedded DNS does not answer is completed with the host's search domain,
// and a provider wildcard there answers with the public IP (sv-hk-1 scraped alertmanager, alloy, cadvisor and grafana at it). So every
// in-stack address is the full swarm name and every service sets dns_search to the root.
const shortNames = (files: Readonly<Record<string, string>>, stacks: readonly string[], names: readonly string[]): string[] =>
    Object.entries(files).flatMap(([rel, text]) => {
        // The bot's own JavaScript is code, not an address list (its `tasks.filter` is an array method).
        if (rel.endsWith(".json") || rel.startsWith("monitor-bot/")) return []
        const lines = text.split("\n").filter((line) => !/^\s*(?:#|\/\/)/.test(line))
        const tasks = lines.flatMap((line) => [...line.matchAll(/tasks\.([A-Za-z0-9_.-]+)/g)].map((found) => found[1] ?? "")).filter((name) => !stacks.some((stack) => name.startsWith(`${stack}_`)))
        const hosts = names.filter((name) => lines.some((line) => new RegExp(String.raw`(?<![\w.@-]|(?<!/)/)${name}:\d`).test(line)))
        return [...tasks.map((name) => `${rel}: tasks.${name}`), ...hosts.map((name) => `${rel}: ${name}:<port>`)]
    })

void test("every in-stack address of the whole monitor stack is the full swarm name, and every service sets dns_search to the root", () => {
    // The check itself: a short task name and a short URL host are found, an image's repository path and a full name are not.
    const sample = ["url: http://loki:3100", "names: [tasks.loki]", "image: grafana/loki:3.5.0@sha256:0", "ok: http://m_loki:3100 tasks.m_loki"].join("\n")
    assert.deepEqual(shortNames({ "x.yml": sample }, ["m"], ["loki"]), ["x.yml: tasks.loki", "x.yml: loki:<port>"])
    const all = Object.fromEntries(Object.keys(components).map((name) => [name, true]))
    for (const target of [{ kind: "server", server } as const, { kind: "local" } as const]) {
        const files = render({ target, alertBots: [] }, all)
        assert.deepEqual(shortNames(files, [policy.monitor.stack, policy.edge.stack], Object.keys(components)), [])
        const prometheus = files["prometheus.yml"] ?? ""
        for (const name of ["alertmanager", "alloy", "cadvisor", "grafana", "loki", "node-exporter"]) assert.ok(prometheus.includes(`tasks.${policy.monitor.stack}_${name}`), `prometheus.yml discovers ${name} by its swarm name`)
        assert.ok(prometheus.includes(`${policy.monitor.stack}_alertmanager:9093`))
        assert.ok((files["config.alloy"] ?? "").includes(`http://${policy.monitor.stack}_loki:3100/`))
        assert.ok((files["grafana/datasources.yaml"] ?? "").includes(`http://${policy.monitor.stack}_prometheus:9090`))
        const services = (parse(files["stack.yml"] ?? "") as { services: Record<string, { dns_search?: string[] }> }).services
        assert.deepEqual(new Set(Object.keys(services)), new Set(Object.keys(components)))
        for (const [name, service] of Object.entries(services)) assert.deepEqual(service.dns_search, ["."], `${name} sets dns_search`)
    }
})

void test("the embeddings stack reaches its model by the swarm name and every service sets dns_search to the root", () => {
    const service = loadService(policy, opsDir, "embeddings")
    const selected = selectServiceComponents(service)
    const rendered = renderService(service, selected, serviceImages(service, selected, opsDir), chooseModel(service, undefined, false)).files
    assert.deepEqual(shortNames(rendered, [service.stack], Object.keys(service.components)), [])
    assert.match(rendered.Caddyfile ?? "", new RegExp(`reverse_proxy ${service.stack}_model:11434 `))
    const services = (parse(rendered["stack.yml"] ?? "") as { services: Record<string, { dns_search?: string[] }> }).services
    assert.ok(Object.keys(services).length > 0)
    for (const [name, one] of Object.entries(services)) assert.deepEqual(one.dns_search, ["."], `${name} sets dns_search`)
})

void test("the monitor bot runs by default only where an app has a bot ready; Alertmanager then posts through its webhook and the bot holds the tokens", () => {
    assert.equal(selectComponents(components, {}, false).includes("monitor-bot"), false, "no bot ready: nothing to poll")
    assert.equal(selectComponents(components, {}, true).includes("monitor-bot"), true)
    assert.equal(selectComponents(components, { "monitor-bot": false }, true).includes("monitor-bot"), false, "the server file turns it off")
    const bots = [bot("nivo", "staging"), bot("nivo", "production", true), bot("next", "production")]
    const files = render({ target: { kind: "server", server }, alertBots: bots })
    const manager = parse(files["alertmanager.yml"] ?? "") as { route: { routes: { matchers: string[]; receiver: string; continue?: boolean }[] }; receivers: { name: string; webhook_configs?: { url: string; send_resolved: boolean }[]; telegram_configs?: unknown }[] }
    assert.equal(files["alertmanager.yml.tmpl"], undefined, "Alertmanager holds no chat id: the bot does")
    assert.deepEqual(manager.route.routes.filter((route) => route.matchers[0] === 'stack=""').map((route) => [route.receiver, route.continue]), [["nivo-staging", true], ["next-production", true]], "the routing of PROJECT-MONITORING-5 is the same")
    assert.deepEqual(manager.receivers.find((receiver) => receiver.name === "next-production")?.webhook_configs, [{ url: `http://${policy.monitor.stack}_monitor-bot:9095/alert/2`, send_resolved: true, max_alerts: 20 }])
    assert.equal(manager.receivers.some((receiver) => receiver.telegram_configs !== undefined), false)
    const config = files["monitor-bot/config.json.tmpl"] ?? ""
    assert.match(config, /"chat": __STARCI_ALERTS_CHAT_1__,/, "the chat id is a number once the server fills it")
    assert.match(config, /"admins": "__STARCI_ALERTS_ADMINS_1__"/)
    assert.ok(config.includes(`"loki": "http://${policy.monitor.stack}_loki:3100"`))
    assert.match(config, /"memoryAlertPercent": 90/)
    assert.ok(files["monitor-bot/main.js"]?.includes("long-polls every distinct bot"), "the bot's code is the CLI's compiled folder")
    for (const [rel, text] of Object.entries(files)) if (rel.startsWith("monitor-bot/")) assert.doesNotMatch(text, /sourceMappingURL|\.test\.js/, rel)
    const stack = parse(files["stack.yml"] ?? "") as { services: Record<string, { image: string; networks: string[]; user?: string; read_only?: boolean; secrets?: { source: string }[]; configs?: { source: string; target: string }[]; deploy: { update_config: { order: string } } }>; configs: Record<string, { name: string; file: string }> }
    const service = stack.services["monitor-bot"]
    assert.ok(service !== undefined)
    assert.match(service.image, /^node:22\.20\.0-alpine3\.21@sha256:[0-9a-f]{64}$/)
    assert.deepEqual(service.networks, ["internal", "socket"])
    assert.equal(service.user, "1000:1000")
    assert.equal(service.read_only, true)
    assert.equal(service.deploy.update_config.order, "stop-first", "two pollers of one token conflict")
    assert.deepEqual(service.secrets?.map((secret) => secret.source), ["alerts_0", "alerts_1", "alerts_2"])
    assert.equal(stack.services.alertmanager?.secrets, undefined, "Alertmanager needs no token behind the bot")
    assert.ok(service.configs?.some((mount) => mount.target === "/app/main.js"))
    assert.ok(service.configs?.some((mount) => mount.target === "/app/package.json"))
    assert.equal(stack.configs.monitor_bot_config_json?.name, "${STARCI_MON_BOT_CONFIG}")
    assert.equal(stack.configs.monitor_bot_config_json.file, "./monitor-bot/config.json")
    assert.match(stack.configs.alertmanager_yml?.name ?? "", /^starci_monitor_alertmanager_yml_[0-9a-f]{12}$/, "Alertmanager's file is shipped whole")
    const lines = alertBotLines(bots, "/opt/starci/monitor", "STARCI_EOF", [{ rel: "monitor-bot/config.json", env: "STARCI_MON_BOT_CONFIG" }]).join("\n")
    assert.match(lines, /cp '\/opt\/starci\/monitor\/monitor-bot\/config\.json\.tmpl' '\/opt\/starci\/monitor\/monitor-bot\/config\.json'\.starci-new/)
    assert.match(lines, /s\/__STARCI_ALERTS_CHAT_1__\/\$K\/; s\/__STARCI_ALERTS_ADMINS_1__\/\$A\//)
    assert.equal((lines.match(/--extract '\["ALERTS_TELEGRAM_ADMIN_IDS"\]'/g) ?? []).length, 1, "the admin ids are opened only where the member holds them")
    assert.match(lines, /export STARCI_MON_BOT_CONFIG="starci_monitor_monitor_bot_config_json_\$\(sha256sum/)
    assert.doesNotMatch(lines, /alertmanager\.yml/, "behind the bot Alertmanager's file is not filled on the server")
    const none = render({ target: { kind: "server", server }, alertBots: [] }, { "monitor-bot": true })
    assert.match(none["monitor-bot/config.json"] ?? "", /"bots": \[\]/, "turned on with no bot it polls nothing")
})

void test("a bot with only its owner username: the config carries the owner, its chat is null on the server, and the bot keeps what it learns on a volume", () => {
    const bots = [bot("nivo", "staging", false, "starci183"), bot("next", "production")]
    const files = render({ target: { kind: "server", server }, alertBots: bots })
    const config = files["monitor-bot/config.json.tmpl"] ?? ""
    assert.match(config, /"chat": __STARCI_ALERTS_CHAT_0__,\s*"owner": "starci183",/)
    assert.match(config, /"chat": __STARCI_ALERTS_CHAT_1__,\s*"owner": null,/)
    assert.match(config, /"state": "\/home\/node\/owner-chats\.json"/)
    const lines = alertBotLines(bots, "/opt/starci/monitor", "STARCI_EOF", [{ rel: "monitor-bot/config.json", env: "STARCI_MON_BOT_CONFIG" }]).join("\n")
    assert.equal((lines.match(/--extract '\["ALERTS_TELEGRAM_CHAT_ID"\]'/g) ?? []).length, 1, "the chat is opened only where the member seals it")
    assert.match(lines, /K=null\n/)
    const stack = parse(files["stack.yml"] ?? "") as { services: Record<string, { volumes?: string[] }>; volumes: Record<string, unknown> }
    assert.deepEqual(stack.services["monitor-bot"]?.volumes, ["monitor-bot-data:/home/node"])
    assert.ok("monitor-bot-data" in stack.volumes)
    assert.throws(() => render({ target: { kind: "server", server }, alertBots: bots }, { "monitor-bot": false }), /needs the monitor bot/)
})
