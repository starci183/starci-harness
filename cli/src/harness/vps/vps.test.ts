// The managed-VPS seams without a server or the network: ops/vps.yaml and the example server load and validate, the dry-run
// planners give idempotent steps that hold no secret, the probes are judged from fixed output, the Cloudflare planning is pure and
// its http seam keeps the token in the header, and the secret scan refuses a tracked server file and a password key.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"
import { loadPolicy, refusalRules } from "../policy.js"
import { refusedKeyFindings, refusedPathHits, scanDiff } from "../../shared/secrets.js"
import { CATCH_ALL, cloudflareCall, dnsAction, ingressWith, ingressWithout, wantedRecord } from "./cloudflare.js"
import { edgeNames } from "../../core/vps/domain.js"
import { bootstrapPlan, deployUser, edgeRouteStep, edgeStackFile, edgeUpPlan, grantPlan, routeOf, swarmInitPlan, uiStackFile, uiUpPlan } from "./plan.js"
import { loadServer, loadVpsPolicy, parseServer, resolvePins, serverIds } from "./policy.js"
import type { ManagedServer } from "./policy.js"
import { judgeDoctor, readHealth } from "./probe.js"
import { remoteCommand, remoteInput } from "./ssh.js"

const opsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "ops")
const policy = loadVpsPolicy(opsDir)
const pins = resolvePins(policy, opsDir)
const exampleFile = join(opsDir, "vps", "servers", "example.yaml")
const example = parseServer(policy, parse(readFileSync(exampleFile, "utf8")), exampleFile, join(opsDir, "vps", "servers"))

const variant = (patch: Record<string, unknown>): ManagedServer => {
    const raw = { ...(parse(readFileSync(exampleFile, "utf8")) as Record<string, unknown>), ...patch }
    return parseServer(policy, raw, exampleFile, join(opsDir, "vps", "servers"))
}

void test("ops/vps.yaml loads, holds no host, and its pins resolve to digests and an exact engine version", () => {
    assert.equal(policy.ingress.domain, "starci.org")
    assert.match(pins.uiServer, /^portainer\/portainer-ce:[\d.]+@sha256:[0-9a-f]{64}$/)
    assert.match(pins.uiAgent, /^portainer\/agent:[\d.]+@sha256:[0-9a-f]{64}$/)
    assert.match(pins.connector, /^cloudflare\/cloudflared:[\d.]+@sha256:[0-9a-f]{64}$/)
    assert.match(pins.edge, /^traefik:v[\d.]+@sha256:[0-9a-f]{64}$/)
    assert.match(pins.docker, /^\d+\.\d+\.\d+$/)
    const text = readFileSync(join(opsDir, "vps.yaml"), "utf8")
    assert.doesNotMatch(text, /\b(?:\d{1,3}\.){3}\d{1,3}\b/, "no IP address in the tracked policy")
})

void test("the example server validates; a bad id, an unknown os and a file named after another id are refused", () => {
    assert.equal(example.family, "debian")
    assert.equal(example.firewallKind, "ufw")
    assert.equal(example.ingressMode, "tunnel")
    assert.throws(() => variant({ id: "Bad_Id" }), /VPS_SERVER_INVALID|invalid/)
    assert.throws(() => variant({ os: "windows" }), /no OS ops\/vps.yaml osFamilies knows/)
    assert.throws(() => parseServer(policy, { ...(parse(readFileSync(exampleFile, "utf8")) as object), id: "other" }, exampleFile, "."), /named after its id/)
    assert.equal(variant({ os: "almalinux" }).firewallKind, "firewalld")
    assert.equal(variant({ firewall: "csf" }).firewallKind, "csf")
})

void test("the inventory lists real servers only, never the example or a sealed file, and an unknown id names the known ones", (t) => {
    const dir = mkdtempSync(join(tmpdir(), "vps-inventory-"))
    t.after(() => {
        rmSync(dir, { recursive: true, force: true })
    })
    const raw = readFileSync(exampleFile, "utf8")
    writeFileSync(join(dir, "example.yaml"), raw)
    writeFileSync(join(dir, "a1.yaml"), raw.replace("id: example", "id: a1"))
    writeFileSync(join(dir, "a1.enc.yaml"), "sops: {}\n")
    assert.deepEqual(serverIds(policy, dir), ["a1"])
    assert.equal(loadServer(policy, "a1", dir).sealedFile, join(dir, "a1.enc.yaml"))
    assert.throws(() => loadServer(policy, "b2", dir), /the servers are a1/)
})

void test("bootstrap plans the ops user, sshd, firewall, intrusion guard, updates and docker, each step reading secrets only by name", () => {
    const plan = bootstrapPlan(policy, example, pins)
    assert.deepEqual(
        plan.steps.map((step) => step.id),
        ["preflight", "ops-user", "sshd", "firewall", "intrusion", "auto-updates", "docker"],
    )
    const byId = new Map(plan.steps.map((step) => [step.id, step]))
    assert.deepEqual(byId.get("ops-user")?.secrets, ["OPS_PUBLIC_KEY"])
    assert.match(byId.get("sshd")?.script ?? "", /PasswordAuthentication no/)
    assert.match(byId.get("sshd")?.script ?? "", /sshd -t/)
    assert.match(byId.get("preflight")?.script ?? "", /\/usr\/local\/directadmin/)
    assert.match(byId.get("preflight")?.script ?? "", /not a clean box/)
    assert.match(byId.get("firewall")?.script ?? "", /ufw allow 22\/tcp/)
    assert.match(byId.get("intrusion")?.script ?? "", /fail2ban/)
    assert.match(byId.get("docker")?.script ?? "", new RegExp(pins.docker.replaceAll(".", "\\.")))
    for (const step of plan.steps) assert.doesNotMatch(step.script, /PRIVATE KEY|password\s*=/i, step.id)
    const rhel = bootstrapPlan(policy, variant({ os: "rocky", sshPort: 2222 }), pins)
    const firewall = rhel.steps.find((step) => step.id === "firewall")?.script ?? ""
    assert.match(firewall, /firewall-cmd --permanent --add-port=2222\/tcp/)
    assert.match(rhel.steps.find((step) => step.id === "docker")?.script ?? "", /docker-ce\.repo/)
    const csf = bootstrapPlan(policy, variant({ firewall: "csf" }), pins)
    assert.match(csf.steps.find((step) => step.id === "intrusion")?.script ?? "", /lfd/)
    assert.doesNotMatch(csf.steps.find((step) => step.id === "intrusion")?.script ?? "", /fail2ban/)
    const csfFirewall = csf.steps.find((step) => step.id === "firewall")?.script ?? ""
    assert.match(csfFirewall, /DOCKER = "0"/)
    assert.match(csfFirewall, /csfpost\.sh/)
    const order = ["systemctl stop docker", "rm -f /etc/csf/csf.error", "systemctl restart csf lfd", "systemctl start docker"].map((text) => csfFirewall.indexOf(text))
    assert.deepEqual(order, [...order].sort((left, right) => left - right))
})

void test("swarm init is a manager's alone; the UI stack publishes no port and runs pinned digests", () => {
    assert.throws(() => swarmInitPlan(policy, variant({ swarm: { role: "worker" } })), /only a manager/)
    assert.deepEqual(swarmInitPlan(policy, example).steps.map((step) => step.id), ["swarm", "network"])
    const stack = uiStackFile(policy, pins)
    assert.doesNotMatch(stack, /ports:/)
    assert.ok(stack.includes(pins.uiServer) && stack.includes(pins.uiAgent))
    assert.match(uiUpPlan(policy, example, pins).notes.join("\n"), /ui-example\.starci\.org/)
})

void test("a grant names one project the server allows and one deploy user per project and environment", () => {
    assert.equal(deployUser(policy, "example-app", "production"), "deploy-example-app-production")
    assert.throws(() => deployUser(policy, "a-very-long-project-name-indeed", "production"), /longer than 32/)
    assert.throws(() => grantPlan(policy, example, "other-app", "production"), /add other-app/)
    const plan = grantPlan(policy, example, "example-app", "production")
    const user = plan.steps.at(0)
    assert.ok(user !== undefined)
    assert.deepEqual(user.secrets, ["DEPLOY_PUBLIC_KEY"])
    assert.match(user.script, /passwd -l/)
})

void test("the UI and SSH always go through the tunnel; an app service through the tunnel or the edge proxy by the server's mode", () => {
    assert.deepEqual(routeOf(policy, example, "ssh"), { via: "tunnel", origin: "ssh://host.starci.internal:22" })
    assert.deepEqual(routeOf(policy, example, "ui"), { via: "tunnel", origin: "http://starci-ui_portainer:9000" })
    assert.deepEqual(routeOf(policy, example, "web_app:3000"), { via: "tunnel", origin: "http://web_app:3000" })
    const edge = variant({ ingress: { mode: "edge" } })
    assert.deepEqual(routeOf(policy, edge, "web_app:3000"), { via: "edge", service: "web_app", port: 3000 })
    assert.equal(routeOf(policy, edge, "ui").via, "tunnel")
    assert.throws(() => routeOf(policy, edge, "8080"), /--to takes/)
})

void test("the edge proxy is a swarm stack on 80/443 in host mode with DNS-01 through Cloudflare, its token a hashed swarm secret", () => {
    const stack = edgeStackFile(policy, pins)
    assert.ok(stack.includes(pins.edge))
    assert.match(stack, /published: 443, protocol: tcp, mode: host/)
    assert.match(stack, /dnschallenge\.provider=cloudflare/)
    assert.match(stack, /CF_DNS_API_TOKEN_FILE: \/run\/secrets\/cf_dns_token/)
    const plan = edgeUpPlan(policy, example, pins)
    assert.deepEqual(plan.steps.map((step) => step.secrets), [["CLOUDFLARE_API_TOKEN"]])
    assert.match(plan.steps.at(0)?.script ?? "", /sha256sum/)
    const route = edgeRouteStep(policy, "a.starci.org", "web_app", 3000)
    assert.ok(route.script.includes("traefik.http.routers.a-starci-org.rule=Host(`a.starci.org`)"))
    assert.match(route.script, /--network-add edge/)
    const listed = ["web_app traefik.http.routers.a-starci-org.rule=Host(`a.starci.org`)", "web_app traefik.http.services.a-starci-org.loadbalancer.server.port=3000"].join("\n")
    assert.deepEqual(edgeNames(listed), [{ hostname: "a.starci.org", service: "web_app:3000", via: "edge" }])
})

void test("a remote script reads its secrets from exports on stdin, quoted, and a non-root login runs it through sudo -n", () => {
    const input = remoteInput({ script: "echo ok", root: true, secrets: { TUNNEL_TOKEN: "it's" }, timeoutMs: 1 })
    assert.equal(input, "set -euo pipefail\nexport TUNNEL_TOKEN='it'\\''s'\necho ok\n")
    assert.throws(() => remoteInput({ script: "", root: true, secrets: { "bad-name": "x" }, timeoutMs: 1 }), /no environment variable name/)
    assert.equal(remoteCommand("starci-ops", true), "sudo -n bash -s")
    assert.equal(remoteCommand("root", true), "bash -s")
})

void test("health and doctor are judged from the probe output", () => {
    const health = readHealth(policy, ["uptime.seconds=86400", "cpu.count=2", "load.1=0.5", "mem.totalKb=1000", "mem.availableKb=50", "disk.usedPercent=91", "ssh.failed=240", "swarm.state=active", "swarm.nodes=1", "swarm.services=3"].join("\n"))
    assert.equal(health.memoryPercent, 95)
    assert.equal(health.swarm?.services, 3)
    assert.equal(health.alerts.length, 3)
    const good = ["clean.panels=", "clean.listeners=", "os=ubuntu", "sshd.passwordauthentication=no", "sshd.kbdinteractiveauthentication=no", "sshd.permitrootlogin=without-password", "sshd.permitemptypasswords=no", "listen=22,80,443", "firewall=ufw", "firewall.active=yes", "intrusion.fail2ban=active", `docker.version=${pins.docker}`, "swarm.state=active", "updates.security=0", "reboot.required=no"]
    assert.ok(judgeDoctor(policy, example, pins, good.join("\n")).every((finding) => finding.status === "ok"))
    const bad = judgeDoctor(policy, example, pins, good.map((line) => (line.startsWith("sshd.passwordauthentication") ? "sshd.passwordauthentication=yes" : line.startsWith("listen") ? "listen=22,80,443,9000" : line)).join("\n"))
    assert.equal(bad.find((finding) => finding.check === "sshd.password")?.status, "red")
    assert.equal(bad.find((finding) => finding.check === "ports")?.status, "warn")
    const panel = judgeDoctor(policy, example, pins, good.map((line) => (line === "clean.panels=" ? "clean.panels=directadmin" : line)).join("\n"))
    const clean = panel.find((finding) => finding.check === "clean")
    assert.ok(clean !== undefined)
    assert.equal(clean.status, "red")
    assert.match(clean.detail, /not a clean box \(panel: directadmin/)
})

void test("tunnel ingress keeps the catch-all last and a DNS record is created, updated, left or refused", () => {
    const added = ingressWith([CATCH_ALL], "a.starci.org", "http://web:3000")
    assert.deepEqual(added.rules, [{ hostname: "a.starci.org", service: "http://web:3000" }, CATCH_ALL])
    assert.equal(ingressWith(added.rules, "a.starci.org", "http://web:3000").changed, false)
    assert.deepEqual(ingressWithout(added.rules, "a.starci.org").rules, [CATCH_ALL])
    const want = wantedRecord("a.starci.org", "tunnel", { tunnelId: "t1", host: "203.0.113.10" })
    assert.deepEqual(want, { type: "CNAME", name: "a.starci.org", content: "t1.cfargotunnel.com", proxied: true })
    assert.equal(dnsAction([], want).kind, "create")
    assert.equal(dnsAction([{ id: "r", type: "CNAME", name: "a.starci.org", content: "t1.cfargotunnel.com", proxied: true }], want).kind, "none")
    assert.equal(dnsAction([{ id: "r", type: "CNAME", name: "a.starci.org", content: "t0.cfargotunnel.com", proxied: true }], want).kind, "update")
    assert.equal(dnsAction([{ id: "r", type: "A", name: "a.starci.org", content: "198.51.100.1" }], want).kind, "conflict")
    assert.deepEqual(wantedRecord("b.starci.org", "edge", { host: "203.0.113.10" }), { type: "A", name: "b.starci.org", content: "203.0.113.10", proxied: false })
    assert.throws(() => wantedRecord("b.starci.org", "edge", { host: "vps.example.net" }), /is a name, not an IP/)
})

void test("the Cloudflare seam sends the token as a bearer header only and refuses an API error without echoing it", async () => {
    const token = ["fixture", "token", "value", "0123456789abcdef"].join("-")
    const seen: { url: string; auth: string | null }[] = []
    const fake = ((input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
        seen.push({ url, auth: new Headers(init?.headers).get("Authorization") })
        const ok = url.endsWith("/zones?name=starci.org")
        return Promise.resolve(new Response(JSON.stringify(ok ? { success: true, result: [{ id: "z1" }] } : { success: false, errors: [{ code: 10000, message: "Authentication error" }] }), { status: ok ? 200 : 403 }))
    }) as typeof fetch
    const call = cloudflareCall("https://api.example.test/v4", token, fake)
    assert.deepEqual(await call("GET", "/zones?name=starci.org"), [{ id: "z1" }])
    await assert.rejects(call("GET", "/user/tokens/verify"), (error: unknown) => error instanceof Error && error.message.includes("10000 Authentication error") && !error.message.includes(token))
    assert.ok(seen.every((entry) => entry.auth === `Bearer ${token}` && !entry.url.includes(token)))
})

void test("the secret scan refuses a tracked server file and a password key anywhere, a sealed envelope included", () => {
    const rules = refusalRules(loadPolicy())
    assert.deepEqual(refusedPathHits(["ops/vps/servers/a1.yaml", "ops/vps/servers/a1.enc.yaml", "ops/vps/cloudflare.enc.yaml", "ops/vps/servers/example.yaml", "ops/vps.yaml"], rules).map((hit) => hit.file), ["ops/vps/servers/a1.yaml", "ops/vps/servers/a1.enc.yaml", "ops/vps/cloudflare.enc.yaml"])
    const key = ["VPS", "PASSWORD"].join("_")
    assert.deepEqual(refusedKeyFindings(`${key}: x`, rules), ["server-password-key"])
    assert.deepEqual(refusedKeyFindings(`export ${["ROOT", "PASSWORD"].join("_")}=x`, rules), ["server-password-key"])
    assert.deepEqual(refusedKeyFindings(`  "${["ssh", "Password"].join("")}": "x"`, rules), ["server-password-key"])
    assert.deepEqual(refusedKeyFindings(`${["MYSQL", "ROOT", "PASSWORD"].join("_")}=x`, rules), [])
    assert.deepEqual(refusedKeyFindings("const rootPass = 1", rules), [])
    const envelope = ["+++ b/x.enc.yaml", "@@ -0,0 +1,2 @@", `+${key}: ENC[AES256_GCM,data:abc,type:str]`, "+sops: {}"].join("\n")
    assert.deepEqual(
        scanDiff(envelope, [], () => `${key}: ENC[AES256_GCM,data:abc]\nsops: {}\n`, rules).map((hit) => hit.pattern),
        ["server-password-key"],
    )
})

void test("an empty inventory folder lists nothing", (t) => {
    const dir = mkdtempSync(join(tmpdir(), "vps-empty-"))
    t.after(() => {
        rmSync(dir, { recursive: true, force: true })
    })
    mkdirSync(join(dir, "servers"))
    assert.deepEqual(serverIds(policy, join(dir, "servers")), [])
    assert.deepEqual(serverIds(policy, join(dir, "absent")), [])
})
