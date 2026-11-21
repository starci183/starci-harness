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
import { alertBotLines, appAlertBots, chatPlaceholder, heldLine, serverAlerts } from "./alerts.js"
import type { AlertBot } from "./alerts.js"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { loadMonitorComponents, monitorDir, monitorImages, renderMonitor, selectComponents } from "./monitor.js"
import type { MonitorFacts } from "./monitor.js"
import { loadVpsPolicy, parseServer, resolvePins } from "./policy.js"

const opsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "ops")
const policy = loadVpsPolicy(opsDir)
const components = loadMonitorComponents(policy, opsDir)
const exampleFile = join(opsDir, "vps", "servers", "example.yaml")
const server = parseServer(policy, { ...(parse(readFileSync(exampleFile, "utf8")) as Record<string, unknown>), ingress: { mode: "edge" } }, exampleFile, join(opsDir, "vps", "servers"))

const render = (facts: MonitorFacts, toggles: Record<string, boolean> = {}): Readonly<Record<string, string>> => {
    const selected = selectComponents(components, toggles)
    return renderMonitor(policy, monitorDir(policy, opsDir), components, selected, monitorImages(components, selected, opsDir), facts).files
}

type Rule = { alert: string; expr: string; for?: string }
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
const appAt = (root: string, project: string, env: string, keys: readonly string[] | null): string => {
    const dir = join(root, project)
    mkdirSync(join(dir, ".starcistacks", env, "secrets"), { recursive: true })
    writeFileSync(join(dir, "hfs.json"), JSON.stringify({ project }))
    const monitoring = keys === null ? "" : "\n    monitoring:\n      alerts: {telegram: {member: alerts}}"
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
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const ready = appAt(root, "nivo", "production", ["ALERTS_TELEGRAM_BOT_TOKEN", "ALERTS_TELEGRAM_CHAT_ID"])
    const noChat = appAt(root, "next", "production", ["ALERTS_TELEGRAM_BOT_TOKEN"])
    const none = appAt(root, "plain", "staging", null)
    const found = appAlertBots(ready, SERVER)
    assert.deepEqual(found.bots.map((bot) => [bot.project, bot.env, bot.stack]), [["nivo", "production", "nivo-production"]])
    assert.equal(found.envs, 1, "an environment on another server is not this one's")
    const alerts = serverAlerts(["nivo", "next", "plain", "ghost"], [ready, noChat, none], SERVER)
    assert.equal(alerts.bots.length, 1)
    const line = heldLine(alerts) ?? ""
    assert.match(line, /alerts are held/)
    assert.match(line, /next\/production: alerts holds no ALERTS_TELEGRAM_CHAT_ID \(\/start the bot, then starci app alerts discover-chat --env production\)/)
    assert.match(line, /plain\/staging declares no alert bot/)
    assert.match(line, /ghost: no checkout of it is known here/)
    assert.equal(heldLine(serverAlerts([], [], SERVER)), null)
})

const bot = (project: string, env: string): AlertBot => ({ project, env, stack: `${project}-${env}`, file: `${project}.enc.yaml`, sealed: sealedMember(["ALERTS_TELEGRAM_BOT_TOKEN", "ALERTS_TELEGRAM_CHAT_ID"]) })

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
    const files = render({ target: { kind: "server", server }, alertBots: bots })
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
