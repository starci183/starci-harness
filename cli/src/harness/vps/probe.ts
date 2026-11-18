import type { ManagedServer, VpsPins, VpsPolicy } from "./policy.js"
import { cleanScript, openPorts } from "./plan.js"

/**
 * The read-only probes of `vps list` (health) and `vps doctor` (settings): one script each that prints `key=value` lines, and the
 * pure readers that judge them. A probe changes nothing on the server and prints no secret.
 */

/** The `key=value` lines of a probe's output, the last value of a key kept. */
export const probeValues = (stdout: string): ReadonlyMap<string, string> => {
    const values = new Map<string, string>()
    for (const line of stdout.split(/\r?\n/)) {
        const at = line.indexOf("=")
        if (at > 0) values.set(line.slice(0, at).trim(), line.slice(at + 1).trim())
    }
    return values
}

const failedLogins = (hours: number): string => `
if command -v journalctl >/dev/null 2>&1; then
  N=$(journalctl -q --no-pager --since "-${String(hours)} hours" -t sshd -t sshd-session 2>/dev/null | grep -cE 'Failed (password|publickey)|Invalid user|authentication failure' || true)
else
  N=$(cat /var/log/auth.log /var/log/secure 2>/dev/null | grep -cE 'Failed (password|publickey)|Invalid user' || true)
fi
echo "ssh.failed=\${N:-0}"`

/** The health probe: uptime, CPU, load, memory, disk, failed ssh logins of the window, swarm state, nodes and services. */
export const healthScript = (policy: VpsPolicy): string =>
    `
echo "uptime.seconds=$(cut -d. -f1 /proc/uptime)"
echo "cpu.count=$(nproc)"
echo "load.1=$(cut -d' ' -f1 /proc/loadavg)"
awk '/^MemTotal:/{t=$2} /^MemAvailable:/{a=$2} END{print "mem.totalKb=" t; print "mem.availableKb=" a}' /proc/meminfo
df -P / | awk 'NR==2{gsub("%","",$5); print "disk.usedPercent=" $5; print "disk.totalKb=" $2}'
${failedLogins(policy.health.failedLoginsHours)}
S=$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || echo none)
echo "swarm.state=\${S:-none}"
if [ "$S" = active ]; then
  echo "swarm.nodes=$(docker node ls -q 2>/dev/null | wc -l)"
  echo "swarm.services=$(docker service ls -q 2>/dev/null | wc -l)"
fi`.trim()

/** One server's health, as `vps list` and the UI show it. */
export interface VpsHealth {
    readonly reachable: boolean
    readonly error: string | null
    readonly uptimeSeconds: number | null
    readonly cpuCount: number | null
    readonly load1: number | null
    readonly memoryPercent: number | null
    readonly diskPercent: number | null
    readonly failedLogins: number | null
    readonly swarm: { readonly state: string; readonly nodes: number | null; readonly services: number | null } | null
    readonly alerts: readonly string[]
}

const num = (values: ReadonlyMap<string, string>, key: string): number | null => {
    const raw = values.get(key)
    if (raw === undefined || raw === "") return null
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
}

/** An unreachable server's health: the reason, no figures, one alert. */
export const unreachable = (error: string): VpsHealth => ({ reachable: false, error, uptimeSeconds: null, cpuCount: null, load1: null, memoryPercent: null, diskPercent: null, failedLogins: null, swarm: null, alerts: ["unreachable"] })

/** Reads the health probe's output and judges it against the policy's thresholds. */
export const readHealth = (policy: VpsPolicy, stdout: string): VpsHealth => {
    const values = probeValues(stdout)
    const total = num(values, "mem.totalKb")
    const available = num(values, "mem.availableKb")
    const memoryPercent = total === null || available === null || total === 0 ? null : Math.round(((total - available) / total) * 100)
    const diskPercent = num(values, "disk.usedPercent")
    const failed = num(values, "ssh.failed")
    const state = values.get("swarm.state") ?? "none"
    const alerts = [
        ...(failed !== null && failed >= policy.health.failedLoginsAlert ? [`${String(failed)} failed ssh logins in ${String(policy.health.failedLoginsHours)}h`] : []),
        ...(diskPercent !== null && diskPercent >= policy.health.diskAlertPercent ? [`disk ${String(diskPercent)}% used`] : []),
        ...(memoryPercent !== null && memoryPercent >= policy.health.memoryAlertPercent ? [`memory ${String(memoryPercent)}% used`] : []),
    ]
    return {
        reachable: true,
        error: null,
        uptimeSeconds: num(values, "uptime.seconds"),
        cpuCount: num(values, "cpu.count"),
        load1: num(values, "load.1"),
        memoryPercent,
        diskPercent,
        failedLogins: failed,
        swarm: { state, nodes: num(values, "swarm.nodes"), services: num(values, "swarm.services") },
        alerts,
    }
}

/** The doctor probe: whether the box is clean (no control panel, nothing but Docker on 80/443), sshd's effective settings, public listening ports, firewall, intrusion guard, Docker, swarm, pending security updates. */
export const doctorScript = (policy: VpsPolicy): string =>
    `
${cleanScript(policy)}
. /etc/os-release; echo "os=$ID"
sshd -T 2>/dev/null | awk '$1 ~ /^(passwordauthentication|permitrootlogin|kbdinteractiveauthentication|pubkeyauthentication|permitemptypasswords)$/ {print "sshd." $1 "=" $2}'
echo "listen=$(ss -Htln 2>/dev/null | awk '{print $4}' | grep -vE '^(127\\.|\\[::1\\]|::1)' | sed -E 's/.*:([0-9]+)$/\\1/' | sort -un | paste -sd, -)"
if command -v csf >/dev/null 2>&1; then echo firewall=csf; csf -l >/dev/null 2>&1 && echo firewall.active=yes || echo firewall.active=no
elif command -v ufw >/dev/null 2>&1; then echo firewall=ufw; ufw status 2>/dev/null | grep -q '^Status: active' && echo firewall.active=yes || echo firewall.active=no
elif command -v firewall-cmd >/dev/null 2>&1; then echo firewall=firewalld; [ "$(firewall-cmd --state 2>/dev/null)" = running ] && echo firewall.active=yes || echo firewall.active=no
else echo firewall=none; echo firewall.active=no; fi
systemctl is-active --quiet fail2ban && echo intrusion.fail2ban=active || echo intrusion.fail2ban=inactive
systemctl is-active --quiet lfd && echo intrusion.lfd=active || echo intrusion.lfd=inactive
echo "docker.version=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo none)"
echo "swarm.state=$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || echo none)"
if command -v apt-get >/dev/null 2>&1; then N=$(apt-get -s -o Debug::NoLocking=1 upgrade 2>/dev/null | grep -cE '^Inst .*-security' || true)
elif command -v dnf >/dev/null 2>&1; then N=$(dnf -q updateinfo list --security 2>/dev/null | wc -l)
else N=unknown; fi
echo "updates.security=\${N:-0}"
[ -f /var/run/reboot-required ] && echo reboot.required=yes || echo reboot.required=no`.trim()

/** One judged fact of a doctor run. */
export interface DoctorFinding {
    readonly check: string
    readonly status: "ok" | "warn" | "red"
    readonly detail: string
}

const ROOT_LOGINS = new Set(["prohibit-password", "without-password", "no"])

/** Judges the doctor probe's output against the policy and the server's own file. */
export const judgeDoctor = (policy: VpsPolicy, server: ManagedServer, pins: VpsPins, stdout: string): DoctorFinding[] => {
    const values = probeValues(stdout)
    const value = (key: string): string => values.get(key) ?? "unknown"
    const finding = (check: string, ok: boolean, detail: string, otherwise: "warn" | "red" = "red"): DoctorFinding => ({ check, status: ok ? "ok" : otherwise, detail })
    const allowed = new Set(openPorts(policy, server).filter((port) => port.endsWith("/tcp")).map((port) => port.slice(0, -"/tcp".length)))
    const listening = value("listen").split(",").filter((port) => port !== "" && port !== "unknown")
    const swarmPorts = new Set(["2377", "7946"])
    const extra = listening.filter((port) => !allowed.has(port) && !swarmPorts.has(port))
    const security = value("updates.security")
    const guard = server.firewallKind === "csf" ? value("intrusion.lfd") : value("intrusion.fail2ban")
    const wantedSwarm = server.swarm.role === "none" ? "inactive" : "active"
    const panels = values.get("clean.panels") ?? ""
    const listeners = values.get("clean.listeners") ?? ""
    const clean = panels === "" && listeners === ""
    return [
        finding("clean", clean, clean ? "a clean box: no control panel, nothing but Docker on the web ports" : `not a clean box (panel: ${panels || "none"}; listening on the web ports: ${listeners || "none"}): starci vps bootstrap refuses it, handle it by hand`),
        finding("os", value("os") === server.os, `runs ${value("os")}, its file says ${server.os}`),
        finding("sshd.password", value("sshd.passwordauthentication") === "no", `PasswordAuthentication ${value("sshd.passwordauthentication")}`),
        finding("sshd.keyboard", value("sshd.kbdinteractiveauthentication") === "no", `KbdInteractiveAuthentication ${value("sshd.kbdinteractiveauthentication")}`),
        finding("sshd.root", ROOT_LOGINS.has(value("sshd.permitrootlogin")), `PermitRootLogin ${value("sshd.permitrootlogin")}`),
        finding("sshd.empty", value("sshd.permitemptypasswords") === "no", `PermitEmptyPasswords ${value("sshd.permitemptypasswords")}`),
        finding("firewall", value("firewall") === server.firewallKind && value("firewall.active") === "yes", `${value("firewall")} ${value("firewall.active") === "yes" ? "active" : "not active"}, the file says ${server.firewallKind}`),
        finding("ports", extra.length === 0, extra.length === 0 ? `listening publicly on ${listening.join(", ") || "nothing"}` : `listening publicly beyond the policy on ${extra.join(", ")} (the firewall must close them)`, "warn"),
        finding("intrusion", guard === "active", `${server.firewallKind === "csf" ? "lfd" : "fail2ban"} ${guard}`),
        finding("docker", value("docker.version") === pins.docker, `Docker ${value("docker.version")}, the pin is ${pins.docker}`, value("docker.version") === "none" ? "red" : "warn"),
        finding("swarm", value("swarm.state") === wantedSwarm, `swarm ${value("swarm.state")}, the file says ${server.swarm.role}`, "warn"),
        finding("updates", security === "0", `${security} security update(s) pending`, "warn"),
        finding("reboot", value("reboot.required") !== "yes", value("reboot.required") === "yes" ? "a reboot is pending" : "no reboot pending", "warn"),
    ]
}
