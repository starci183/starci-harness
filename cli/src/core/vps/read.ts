import { locateOps } from "../../harness/ops.js"
import { fleetOf, sessionFor } from "../../harness/vps/fleet.js"
import type { FleetRow } from "../../harness/vps/fleet.js"
import { loadVpsPolicy } from "../../harness/vps/policy.js"
import { doctorScript, judgeDoctor } from "../../harness/vps/probe.js"
import { ownerStore } from "../../harness/vps/sealed.js"
import { headline } from "../../shared/exec.js"
import { Refusal } from "../../shared/errors.js"
import { defineVerb } from "../../shared/verb.js"
import type { VerbResult } from "../../shared/verb.js"
import { pinsOf, READERS, scopeOf, SERVER_ID } from "./shared.js"
import type { VpsData } from "./shared.js"

const percent = (value: number | null): string => (value === null ? "-" : `${String(value)}%`)
const days = (seconds: number | null): string => (seconds === null ? "-" : `${(seconds / 86_400).toFixed(1)}d`)

const rowLine = (row: FleetRow): string => {
    const head = `${row.id}  ${row.provider} ${row.os} ${row.ingress} swarm:${row.swarmRole}  ${row.uiUrl}${row.panelUrl === null ? "" : `  panel ${row.panelUrl}`}`
    const health = row.health
    if (health === null) return `${head}\n  not probed (--offline)`
    if (!health.reachable) return `${head}\n  UNREACHABLE: ${health.error ?? "no answer"}`
    const swarm = health.swarm === null ? "-" : `${health.swarm.state}${health.swarm.nodes === null ? "" : ` ${String(health.swarm.nodes)} node(s) ${String(health.swarm.services ?? 0)} service(s)`}`
    const figures = `  up ${days(health.uptimeSeconds)}, ${String(health.cpuCount ?? "-")} cpu load ${String(health.load1 ?? "-")}, mem ${percent(health.memoryPercent)}, disk ${percent(health.diskPercent)}, failed ssh logins ${String(health.failedLogins ?? "-")}, swarm ${swarm}`
    return [head, figures, ...health.alerts.map((alert) => `  ALERT: ${alert}`)].join("\n")
}

/** `starci vps list [--offline]`: the managed fleet with each server's health; changes nothing. */
export const vpsListVerb = defineVerb({
    path: ["vps", "list"],
    summary: "list the managed VPS fleet of ops/vps/servers with each server's health over its sealed login (reachable, uptime, CPU, memory, disk, failed ssh logins, swarm nodes and services) and its UI and panel links; changes nothing",
    effect: "read",
    roles: READERS,
    schema: "starci/vps-list@1",
    flags: { offline: { kind: "boolean", summary: "only the inventory, no ssh (no owner key needed)" } },
    run: async (_context, flags): Promise<VerbResult<VpsData>> => {
        const opsDir = locateOps()
        const policy = loadVpsPolicy(opsDir)
        const rows = await fleetOf(policy, opsDir, !flags.offline, ownerStore)
        const alerts = rows.reduce((sum, row) => sum + (row.health?.alerts.length ?? 0), 0)
        const message = rows.length === 0 ? "no managed server yet: `starci vps add <id>` adds one (contexts/harness/managed-vps.md)" : rows.map(rowLine).join("\n")
        return { data: { servers: rows, alerts }, message }
    },
})

/** `starci vps doctor <id>`: read-only judgment of one server's settings against ops/vps.yaml. */
export const vpsDoctorVerb = defineVerb({
    path: ["vps", "doctor"],
    summary: "judge one managed server against ops/vps.yaml, read-only: sshd settings, public listening ports, firewall, intrusion guard, Docker version and swarm, pending security updates and reboots",
    effect: "read",
    roles: READERS,
    schema: "starci/vps-doctor@1",
    flags: { id: SERVER_ID },
    run: async (_context, flags): Promise<VerbResult<VpsData>> => {
        const scope = scopeOf(flags.id)
        const pins = pinsOf(scope)
        const session = await sessionFor(scope.policy, scope.server, await ownerStore())
        try {
            const run = await session.run({ script: doctorScript(scope.policy), root: true, timeoutMs: scope.policy.ssh.commandTimeoutSeconds * 1000 })
            if (run.exitCode !== 0) throw new Refusal("VPS_DOCTOR_FAILED", `the doctor probe failed on ${scope.server.id}: ${headline(run.stderr) || `exit ${String(run.exitCode)}`}`)
            const findings = judgeDoctor(scope.policy, scope.server, pins, run.stdout)
            const red = findings.filter((finding) => finding.status === "red").length
            const warn = findings.filter((finding) => finding.status === "warn").length
            const lines = [`${scope.server.id}: ${red === 0 ? (warn === 0 ? "green" : "green with warnings") : "red"}`, ...findings.map((finding) => `  ${finding.status.padEnd(4)} ${finding.check}: ${finding.detail}`)]
            if (red > 0 && findings.find((finding) => finding.check === "clean")?.status === "ok") lines.push(`  \`starci vps bootstrap ${scope.server.id}\` (a dry run first) brings it to the policy`)
            return { data: { server: scope.server.id, findings, verdict: red === 0 ? "green" : "red" }, message: lines.join("\n"), ...(red > 0 ? { exitCode: 1 } : {}) }
        } finally {
            session.close()
        }
    },
})
