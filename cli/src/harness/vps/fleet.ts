import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { Refusal } from "../../shared/errors.js"
import { headline } from "../../shared/exec.js"
import type { ToolRun } from "../../shared/exec.js"
import { inventoryDir, loadInventory } from "./policy.js"
import type { ManagedServer, VpsPolicy } from "./policy.js"
import { uiHost } from "./plan.js"
import type { PlanStep, StepSecret, VpsPlan } from "./plan.js"
import { healthScript, readHealth, unreachable } from "./probe.js"
import type { VpsHealth } from "./probe.js"
import { requireKey, SERVER_KEYS } from "./sealed.js"
import type { SealedStore } from "./sealed.js"
import { openSession } from "./ssh.js"
import type { SshSession } from "./ssh.js"

/** The user's own known_hosts (`~/.ssh/known_hosts`), which pins a config.yaml machine's host keys; refused when absent. */
export const userKnownHosts = (): string => {
    const file = join(homedir(), ".ssh", "known_hosts")
    if (!existsSync(file)) throw new Refusal("VPS_SSH_KNOWN_HOSTS", `${file} does not exist: log in once with ssh to pin the machine's host key (StrictHostKeyChecking stays on)`)
    return readFileSync(file, "utf8")
}

/**
 * Opens a session to a server with its sealed login; `as` logs in as another user with the same key (bootstrap's check). A machine of
 * config.yaml that is no inventory file logs in with its own key file as its user, its host key pinned by the user's known_hosts.
 */
export const sessionFor = async (policy: VpsPolicy, server: ManagedServer, store: SealedStore, as?: string): Promise<SshSession> => {
    if (server.login !== undefined) {
        const { keyFile, user } = server.login
        if (!existsSync(keyFile)) throw new Refusal("VPS_SSH_KEY", `the key file of ${server.id} (config.yaml sshKey) does not exist: ${keyFile}`)
        return openSession({ host: server.host, port: server.sshPort, user: as ?? user, privateKey: readFileSync(keyFile, "utf8"), knownHosts: userKnownHosts(), connectTimeoutSeconds: policy.ssh.connectTimeoutSeconds })
    }
    const sealed = store.open(server.sealedFile)
    return openSession({
        host: server.host,
        port: server.sshPort,
        user: as ?? requireKey(sealed, SERVER_KEYS.user, server.sealedFile),
        privateKey: requireKey(sealed, SERVER_KEYS.privateKey, server.sealedFile),
        knownHosts: requireKey(sealed, SERVER_KEYS.knownHosts, server.sealedFile),
        connectTimeoutSeconds: policy.ssh.connectTimeoutSeconds,
    })
}

/** What one executed step did. */
export interface StepOutcome {
    readonly id: string
    readonly outcome: "changed" | "unchanged" | "failed"
    readonly detail: string
}

const outcomeOf = (entry: PlanStep, run: ToolRun): StepOutcome => {
    if (run.timedOut) return { id: entry.id, outcome: "failed", detail: "timed out" }
    if (run.exitCode !== 0) return { id: entry.id, outcome: "failed", detail: headline(run.stderr) || `exit ${String(run.exitCode)}` }
    const last = run.stdout.trim().split(/\r?\n/).at(-1) ?? ""
    return { id: entry.id, outcome: last === "changed" ? "changed" : "unchanged", detail: last === "changed" || last === "unchanged" ? "" : last }
}

/** Runs the steps of a plan in order, each with the secrets it names; stops at the first failure. */
export const runSteps = async (policy: VpsPolicy, session: SshSession, steps: readonly PlanStep[], secrets: Partial<Record<StepSecret, string>>, progress: (line: string) => void): Promise<StepOutcome[]> => {
    const outcomes: StepOutcome[] = []
    for (const entry of steps) {
        const values: Record<string, string> = {}
        for (const name of entry.secrets) {
            const value = secrets[name]
            if (value === undefined) throw new Refusal("VPS_PLAN_SECRET", `${entry.id} needs ${name}, which this run did not resolve`)
            values[name] = value
        }
        const outcome = outcomeOf(entry, await session.run({ script: entry.script, root: entry.root, secrets: values, timeoutMs: policy.ssh.commandTimeoutSeconds * 1000 }))
        progress(`${entry.id}: ${outcome.outcome}${outcome.detail === "" ? "" : ` (${outcome.detail})`}`)
        outcomes.push(outcome)
        if (outcome.outcome === "failed") break
    }
    return outcomes
}

/** Runs a whole plan over one session, closing it after. */
export const runPlan = async (policy: VpsPolicy, server: ManagedServer, store: SealedStore, plan: VpsPlan, secrets: Partial<Record<StepSecret, string>>, progress: (line: string) => void): Promise<StepOutcome[]> => {
    const session = await sessionFor(policy, server, store)
    try {
        return await runSteps(policy, session, plan.steps, secrets, progress)
    } finally {
        session.close()
    }
}

/** One row of the fleet, as `vps list --json` and the harness app's Managed VPS page read it. */
export interface FleetRow {
    readonly id: string
    readonly provider: string
    readonly os: string
    readonly ingress: "tunnel" | "edge"
    readonly swarmRole: string
    readonly projects: readonly string[]
    readonly panelUrl: string | null
    readonly uiUrl: string
    readonly health: VpsHealth | null
}

/** The fleet: every server of the inventory with its health (probed in parallel over its sealed login, unless `probe` is false). */
export const fleetOf = async (policy: VpsPolicy, opsDir: string, probe: boolean, store: (() => Promise<SealedStore>) | undefined): Promise<FleetRow[]> => {
    const servers = loadInventory(policy, inventoryDir(policy, opsDir))
    const opened = probe && servers.length > 0 && store !== undefined ? await store() : undefined
    return Promise.all(
        servers.map(async (server): Promise<FleetRow> => {
            const base = { id: server.id, provider: server.provider, os: server.os, ingress: server.ingressMode, swarmRole: server.swarm.role, projects: server.projects, panelUrl: server.panel.url, uiUrl: `https://${uiHost(policy, server)}` }
            if (opened === undefined) return { ...base, health: null }
            let session: SshSession | undefined
            try {
                session = await sessionFor(policy, server, opened)
                const run = await session.run({ script: healthScript(policy), root: true, timeoutMs: policy.ssh.connectTimeoutSeconds * 3000 })
                return { ...base, health: run.exitCode === 0 ? readHealth(policy, run.stdout) : unreachable(headline(run.stderr) || `exit ${String(run.exitCode)}`) }
            } catch (error: unknown) {
                return { ...base, health: unreachable(error instanceof Error ? error.message : String(error)) }
            } finally {
                session?.close()
            }
        }),
    )
}
