import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { stateBase } from "../../harness/ledger.js"
import { heldLine, registeredRoots, serverAlerts, serverRecipientOf } from "../../harness/vps/alerts.js"
import type { ServerAlerts } from "../../harness/vps/alerts.js"
import { runPlan, runSteps } from "../../harness/vps/fleet.js"
import { loadMonitorComponents, monitorBudget, monitorDir, monitorImages, monitorUpPlan, MONITOR_SECRETS, renderMonitor, selectComponents } from "../../harness/vps/monitor.js"
import type { MonitorSecret, MonitorTarget } from "../../harness/vps/monitor.js"
import { inventoryDir, loadServer, loadVpsPolicy, locateFleetOps } from "../../harness/vps/policy.js"
import { ownerStore } from "../../harness/vps/sealed.js"
import type { SealedStore } from "../../harness/vps/sealed.js"
import { remoteInput } from "../../harness/vps/ssh.js"
import type { SshSession } from "../../harness/vps/ssh.js"
import { Refusal, UsageError } from "../../shared/errors.js"
import { captureTool } from "../../shared/exec.js"
import { defineVerb } from "../../shared/verb.js"
import type { VerbResult } from "../../shared/verb.js"
import { EXECUTE, OWNER, planResult, requireAction } from "./shared.js"
import type { VpsData } from "./shared.js"

/** The keys of the sealed file (the server's <id>.enc.yaml, or the local one) that hold the generated monitoring secrets. */
const SEALED_KEYS: Readonly<Record<MonitorSecret, string>> = {
    grafana: "monitorGrafanaAdminPassword",
    glitchtipDb: "monitorGlitchtipDbPassword",
    glitchtipKey: "monitorGlitchtipSecretKey",
}

/** The sealed file of the local swarm's generated secrets: the state base of this machine, never tracked. */
const localSealedFile = (): string => join(stateBase(), "monitor", "local.enc.yaml")

/** The bash of this machine for the local swarm: Git for Windows' on win32 (never WSL's), bash elsewhere. */
export const localBash = (): string => {
    if (process.platform !== "win32") return "bash"
    const git = join(process.env.ProgramFiles ?? "C:/Program Files", "Git", "bin", "bash.exe")
    if (!existsSync(git)) throw new Refusal("VPS_MONITOR_LOCAL_BASH", `the local swarm's steps run in Git for Windows' bash, not found at ${git}`)
    return git
}

/** The steps of the local swarm run as a local bash, the same scripts as on a server. */
export const localSession = (): SshSession => {
    const bash = localBash()
    return {
        run: (remote) => captureTool(bash, ["-s"], process.cwd(), { input: remoteInput(remote), timeoutMs: remote.timeoutMs }),
        close: () => undefined,
    }
}

/** Opens the generated secrets of a sealed file, making and sealing each one the stack reads for the first time. */
const generatedSecrets = (store: SealedStore, file: string, kinds: readonly MonitorSecret[]): Partial<Record<string, string>> => {
    const sealed = existsSync(file) ? store.open(file) : {}
    const out: Record<string, string> = {}
    const made: Record<string, string> = {}
    for (const kind of kinds) {
        const key = SEALED_KEYS[kind]
        const value = sealed[key] ?? ""
        out[MONITOR_SECRETS[kind]] = value === "" ? (made[key] = randomBytes(24).toString("base64url")) : value
    }
    if (Object.keys(made).length > 0) {
        mkdirSync(dirname(file), { recursive: true })
        store.write(file, made)
    }
    return out
}

/**
 * `starci vps monitor up <id> [--with <component>] [--without <component>] [--execute]`, or `up --local`: the shared monitoring stack of a
 * managed server (or of this machine's swarm) with the components its file turns on; a dry run prints the plan and the memory budget.
 */
export const vpsMonitorVerb = defineVerb({
    path: ["vps", "monitor"],
    summary: "`monitor up <id>` (or `up --local`): deploy the shared monitoring stack of a managed server (ops/vps/monitor/components.yaml: Prometheus, Alertmanager to each app's own Telegram bot (monitoring.alerts; held behind a null receiver until one is ready), Grafana, Loki, Alloy, node-exporter, cAdvisor, a read-only socket proxy, and the optional components its file turns on), digests pinned, with its memory budget; a dry run until --execute",
    effect: "remote",
    roles: OWNER,
    schema: "starci/vps-monitor@1",
    flags: {
        action: { kind: "string", summary: "up", required: true, positional: true },
        id: { kind: "string", summary: "the server id (its ops/vps/servers/<id>.yaml); omitted with --local", positional: true },
        local: { kind: "boolean", summary: "the swarm of this machine (Docker Desktop) instead of a server: the same components, doors on localhost, no alert sent" },
        with: { kind: "list", summary: "a component to turn on for this run, beside the server file's monitor.components (repeat)" },
        without: { kind: "list", summary: "a component to turn off for this run (repeat)" },
        app: { kind: "list", summary: "an app checkout whose alert bots (environments.<env>.monitoring.alerts) this server's Alertmanager reads, beside the checkouts registered with this harness (repeat)" },
        execute: EXECUTE,
    },
    run: async (context, flags): Promise<VerbResult<VpsData>> => {
        requireAction(flags.action, ["up"], "monitor")
        if (flags.local === (flags.id !== undefined)) throw new UsageError("starci vps monitor up takes a server id or --local, one of them")
        const opsDir = locateFleetOps()
        const policy = loadVpsPolicy(opsDir)
        const server = flags.id === undefined ? undefined : loadServer(policy, flags.id, inventoryDir(policy, opsDir))
        const target: MonitorTarget = server === undefined ? { kind: "local" } : { kind: "server", server }
        const components = loadMonitorComponents(policy, opsDir)
        const toggles = { ...(server?.monitor?.components ?? {}), ...Object.fromEntries(flags.with.map((name) => [name, true])), ...Object.fromEntries(flags.without.map((name) => [name, false])) }
        const selected = selectComponents(components, toggles)
        const budget = monitorBudget(components, selected)
        const alerting = selected.includes("alertmanager") && server !== undefined
        const alerts: ServerAlerts = alerting ? serverAlerts(server.projects, [...flags.app.map((dir) => resolve(context.cwd, dir)), ...registeredRoots()], serverRecipientOf(server.id, opsDir)) : { bots: [], lacking: [] }
        const heldText = alerting ? heldLine(alerts) : null
        const held = heldText === null ? [] : [`  note: ${heldText}`]
        const render = renderMonitor(policy, monitorDir(policy, opsDir), components, selected, monitorImages(components, selected, opsDir), { target, alertBots: alerts.bots })
        const base = target.kind === "local" ? join(stateBase(), "monitor", "stack").replaceAll("\\", "/") : "/opt/starci/monitor"
        const plan = monitorUpPlan(policy, target, render, budget, base)
        const data = { budget, components: selected, alerts: { bots: alerts.bots.map((bot) => `${bot.project}/${bot.env}`), held: alerts.lacking } }
        if (!flags.execute) {
            const result = planResult(plan, undefined, held)
            return { ...result, data: { ...result.data, ...data } }
        }
        const store = await ownerStore()
        const secrets: Partial<Record<string, string>> = generatedSecrets(store, server?.sealedFile ?? localSealedFile(), render.secrets)
        const outcomes = server === undefined ? await runSteps(policy, localSession(), plan.steps, secrets, context.progress) : await runPlan(policy, server, store, plan, secrets, context.progress)
        const result = planResult(plan, outcomes, held)
        return { ...result, data: { ...result.data, ...data } }
    },
})
