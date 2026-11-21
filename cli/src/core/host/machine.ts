import { setTimeout as sleep } from "node:timers/promises"
import { hostDown, hostStatus, hostUp, loadHost, probeService, selectServices } from "../../harness/host.js"
import type { HostConfig } from "../../harness/host.js"
import { HOST_COMPOSE_ADAPTERS, hostComposeProjects, readPing } from "../../harness/host-compose.js"
import {
    embedBody,
    endpointsOf,
    engineLine,
    imagesOf,
    judgeParity,
    judgeRemote,
    jsonAt,
    lockOwner,
    machineScope,
    observeScript,
    planUp,
    readHttp,
    readObserved,
    remoteEmbedScript,
    remoteHttpScript,
    remoteLockScript,
    remoteUnlockScript,
    unsupported,
    vectorOf,
    withLocalLock,
} from "../../harness/host-machine.js"
import type { EmbedReading, MachineScope, ModelEndpoint, Observed, Parity, ServiceState, UpStep } from "../../harness/host-machine.js"
import { placementOf, roleService } from "../../harness/host-roles.js"
import type { Placement, ServedModel } from "../../harness/host-roles.js"
import { readMachines, writeMachines } from "../../harness/machines.js"
import { lookupSecret } from "../../harness/secret-env.js"
import { runSteps, sessionFor } from "../../harness/vps/fleet.js"
import { loadMonitorComponents } from "../../harness/vps/monitor.js"
import { inventoryDir, loadServer, loadVpsPolicy } from "../../harness/vps/policy.js"
import type { ManagedServer, VpsPolicy } from "../../harness/vps/policy.js"
import { ownerStore } from "../../harness/vps/sealed.js"
import type { SealedStore } from "../../harness/vps/sealed.js"
import { loadService } from "../../harness/vps/services.js"
import { shellQuote } from "../../harness/vps/ssh.js"
import type { SshSession } from "../../harness/vps/ssh.js"
import { Refusal } from "../../shared/errors.js"
import { headline } from "../../shared/exec.js"
import type { VerbContext } from "../../shared/verb.js"
import { vpsUiVerb } from "../vps/act.js"
import { vpsEdgeVerb } from "../vps/domain.js"
import { vpsMonitorVerb } from "../vps/monitor.js"
import { heldLine, registeredRoots, serverAlerts, serverRecipientOf } from "../../harness/vps/alerts.js"
import { vpsServiceVerb } from "../vps/service.js"

/**
 * The half of `starci host up|status|doctor --host <name>` that reaches a machine (contexts/harness/host.md "Roles"): it observes a server's
 * Docker over its login (read-only), judges each service of the machine's roles, deploys only what is missing through the deployer that already
 * existed for it (host up of this machine, vps service|monitor|ui|edge up of a server, a host-compose adapter), waits for its health and rolls it
 * back when it never turns healthy, adopts what runs under another name, and never touches an app stack. One writer per host: a local lock and a
 * lock on the server itself.
 */

/** How a run reaches a server: its policy, its managed-server view and an open session; `local` has none. */
interface Reach {
    readonly policy: VpsPolicy
    readonly server: ManagedServer
    readonly session: SshSession
    readonly store: () => Promise<SealedStore>
}

const POLL_MS = 10_000

/** A store that opens nothing: a config.yaml machine logs in with its key file, so its session needs no sealed login. */
const lazyStore = (): (() => Promise<SealedStore>) => {
    let opened: Promise<SealedStore> | undefined
    return () => (opened ??= ownerStore())
}

/** Opens the session of a server; `local` is never reached over ssh. */
const openReach = async (scope: MachineScope): Promise<Reach | null> => {
    if (scope.site === "local") return null
    const policy = loadVpsPolicy(scope.opsDir)
    const server = loadServer(policy, scope.name, inventoryDir(policy, scope.opsDir))
    const store = lazyStore()
    const session = await sessionFor(policy, server, server.login === undefined ? await store() : { open: () => ({}), write: () => undefined })
    return { policy, server, session, store }
}

const run = async (reach: Reach, script: string, secrets: Readonly<Record<string, string>> = {}): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }> =>
    reach.session.run({ script, root: true, secrets, timeoutMs: reach.policy.ssh.commandTimeoutSeconds * 1000 })

/** What the server's Docker runs (one read-only probe). */
const observe = async (reach: Reach): Promise<Observed> => {
    const answer = await run(reach, observeScript())
    if (answer.exitCode !== 0) throw new Refusal("HOST_UNREACHABLE", `the read-only probe of ${reach.server.id} failed: ${headline(answer.stderr) || `exit ${String(answer.exitCode)}`}`)
    return readObserved(answer.stdout)
}

/** Judges every service of the machine: a server from its Docker, `local` from the ops/host.yaml checks of each placement's services. */
const judgeAll = async (scope: MachineScope, observed: Observed | null, host: HostConfig, cwd: string): Promise<ServiceState[]> => {
    const registry = hostComposeProjects()
    const states: ServiceState[] = []
    // One read of the ops/host.yaml checks for every local placement (the scheduler is listed once).
    const localIds = scope.site === "local" ? [...new Set(scope.services.flatMap((id) => {
        const placement = placementOf(scope.catalog, id, "local")
        return placement?.via === "host-stack" ? placement.ids : []
    }))] : []
    const local = localIds.length === 0 ? [] : (await hostStatus(host, selectServices(host, localIds), cwd)).services
    for (const id of scope.services) {
        const placement = placementOf(scope.catalog, id, scope.site)
        const summary = roleService(scope.catalog, id).summary
        if (placement === undefined) {
            states.push(unsupported(scope.catalog, id, scope.site))
            continue
        }
        const images = imagesOf(placement, scope.opsDir)
        if (scope.site === "local") {
            if (placement.via !== "host-stack") {
                states.push(unsupported(scope.catalog, id, scope.site))
                continue
            }
            const mine = local.filter((service) => placement.ids.includes(service.id))
            const down = mine.filter((service) => service.state !== "up" && service.state !== "other platform")
            const evidence = mine.map((service) => `${service.id} ${service.state}`).join(", ")
            states.push({ id, summary, state: down.length === 0 ? "running" : "missing", evidence: down.length === 0 ? evidence : `${evidence}; ${down.map((service) => `${service.id}: ${service.evidence}`).join("; ")}`, kind: placement.kind, via: placement.via, found: [], drift: [], images, endpoint: placement.endpoint ?? null })
            continue
        }
        if (observed === null) {
            states.push({ id, summary, state: "unobserved", evidence: "the server was not reached", kind: placement.kind, via: placement.via, found: [], drift: [], images, endpoint: placement.endpoint ?? null })
            continue
        }
        states.push(judgeRemote(id, summary, placement, images, observed, registry))
    }
    return states
}

/** What `host status --host` reports. */
export interface MachineStatus {
    readonly machine: string
    readonly site: "local" | "remote"
    readonly roles: readonly string[]
    readonly services: readonly ServiceState[]
    readonly engine: string | null
    readonly gaps: readonly string[]
    /** The endpoints of every served model across the machines, in the order the apps' router tries them (`starci.embed`: local, then the VPS). */
    readonly endpoints: Readonly<Record<string, readonly ModelEndpoint[]>>
    readonly reached: boolean
    readonly error: string | null
}

const GAP_STATES = new Set(["missing", "partial", "unsupported", "unbuilt", "unobserved"])

/** The endpoints of every service with a model, across all machines. */
const allEndpoints = (scope: MachineScope): Record<string, ModelEndpoint[]> =>
    Object.fromEntries(Object.entries(scope.catalog.roles).flatMap(([role, entry]) => Object.entries(entry.services).flatMap(([name, service]) => (service.model === undefined ? [] : [[`${role}.${name}`, endpointsOf(scope.catalog, scope.machines, `${role}.${name}`)]]))))

/** Reads a machine's services; changes nothing. A server that cannot be reached is reported, never refused. */
export const machineStatus = async (name: string, cwd: string): Promise<MachineStatus> => {
    const scope = machineScope(name)
    const host = loadHost(scope.opsDir)
    let reach: Reach | null = null
    let observed: Observed | null = null
    let error: string | null = null
    try {
        reach = await openReach(scope)
        if (reach !== null) observed = await observe(reach)
    } catch (caught: unknown) {
        error = caught instanceof Error ? caught.message : String(caught)
    } finally {
        reach?.session.close()
    }
    const services = await judgeAll(scope, observed, host, cwd)
    const gaps = services.filter((service) => GAP_STATES.has(service.state)).map((service) => `${service.id}: ${service.state}`)
    return { machine: name, site: scope.site, roles: scope.machine.roles, services, engine: engineLine(scope, scope.site === "local" ? null : observed), gaps, endpoints: allEndpoints(scope), reached: scope.site === "local" || observed !== null, error }
}

/** One service's doctor call. */
export interface DoctorCall {
    readonly id: string
    readonly ok: boolean | null
    readonly evidence: string
}

/** What `host doctor --host` found. */
export interface MachineDoctor {
    readonly machine: string
    readonly calls: readonly DoctorCall[]
    readonly parity: Readonly<Record<string, Parity>>
    readonly red: boolean
}

/** The doctor's probe image (curl, pinned by digest in ops/host.yaml doctor). */
const probeImage = (host: HostConfig): string => host.doctor.probeImage

/** The gate key a server's embed service was sealed with (vps service up), opened from its sealed file. */
const remoteEmbedKey = async (reach: Reach, opsDir: string, placement: Placement): Promise<string> => {
    if (placement.via !== "vps-service") throw new Refusal("HOST_PROBE_INVALID", "the embed probe of a server reads the key of its vps-service")
    const service = loadService(reach.policy, opsDir, placement.name)
    const store = await reach.store()
    const value = store.open(reach.server.sealedFile)[service.key.sealed] ?? ""
    if (value === "") throw new Refusal("HOST_SECRET_MISSING", `${reach.server.sealedFile} holds no ${service.key.sealed}: starci vps service up ${reach.server.id} --service ${placement.name} --execute seals it`)
    return value
}

/** The embed probe on one machine: one fixed text, the vector it answers. */
const embedOn = async (scope: MachineScope, reach: Reach | null, host: HostConfig, model: ServedModel, placement: Placement): Promise<EmbedReading> => {
    try {
        if (reach === null) {
            const key = lookupSecret("EMBEDDINGS_API_KEY")?.value
            if (key === undefined) return { machine: scope.name, error: "EMBEDDINGS_API_KEY is not set (the harness secret.env)" }
            const url = `${(placement.endpoint ?? "").replace(/\/$/, "")}/embeddings`
            const answer = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: embedBody(model), signal: AbortSignal.timeout(60_000) })
            const text = await answer.text()
            if (answer.status !== 200) return { machine: scope.name, error: `POST ${url} answered ${String(answer.status)}` }
            const vector = vectorOf(text)
            return typeof vector === "string" ? { machine: scope.name, error: vector } : { machine: scope.name, vector }
        }
        const key = await remoteEmbedKey(reach, scope.opsDir, placement)
        const answer = await run(reach, remoteEmbedScript(probeImage(host), placement.network ?? "", placement.endpoint ?? "", model), { SERVICE_KEY: key })
        if (answer.exitCode !== 0) return { machine: scope.name, error: headline(answer.stderr) || `exit ${String(answer.exitCode)}` }
        const vector = vectorOf(answer.stdout.trim())
        return typeof vector === "string" ? { machine: scope.name, error: vector } : { machine: scope.name, vector }
    } catch (caught: unknown) {
        return { machine: scope.name, error: caught instanceof Error ? caught.message : String(caught) }
    }
}

/** The doctor call of one running service. */
const callOne = async (scope: MachineScope, reach: Reach | null, host: HostConfig, state: ServiceState, observed: Observed | null, cwd: string, readings: Map<string, EmbedReading>): Promise<DoctorCall> => {
    const placement = placementOf(scope.catalog, state.id, scope.site)
    if (placement === undefined || (state.state !== "running" && state.state !== "adopted")) return { id: state.id, ok: null, evidence: `not called: ${state.state}` }
    const probe = placement.probe
    if (probe.kind === "host") {
        const status = await hostStatus(host, selectServices(host, placement.via === "host-stack" ? placement.ids : []), cwd)
        const down = status.services.filter((service) => service.state !== "up" && service.state !== "other platform")
        return { id: state.id, ok: down.length === 0, evidence: status.services.map((service) => `${service.id}: ${service.evidence}`).join("; ") }
    }
    if (probe.kind === "replicas") {
        const mine = state.found.filter((item) => item.replicas !== null)
        const bad = mine.filter((item) => !/^(\d+)\/\1\b/.test(item.replicas ?? "") || (item.replicas ?? "").startsWith("0/"))
        if (mine.length === 0) return { id: state.id, ok: observed !== null && state.found.length > 0, evidence: state.found.length > 0 ? `containers ${state.found.map((item) => item.as).join(", ")} run` : "nothing found" }
        return { id: state.id, ok: bad.length === 0, evidence: mine.map((item) => `${item.as} ${item.replicas ?? ""}`).join(", ") }
    }
    if (probe.kind === "hook") {
        const adapter = placement.via === "host-compose" ? HOST_COMPOSE_ADAPTERS.get(placement.project) : undefined
        if (adapter === undefined || reach === null) return { id: state.id, ok: null, evidence: `no ${probe.name} ping hook is registered (HOST_SERVICE_UNBUILT)` }
        const answer = await run(reach, adapter.ping(reach.server))
        const verdict = readPing(answer.stdout)
        return { id: state.id, ok: answer.exitCode === 0 && verdict.ok, evidence: verdict.evidence }
    }
    if (probe.kind === "embed") {
        const model = roleService(scope.catalog, state.id).model
        if (model === undefined) return { id: state.id, ok: false, evidence: "the catalog pins no model for it" }
        const reading = await embedOn(scope, reach, host, model, placement)
        readings.set(scope.name, reading)
        if ("error" in reading) return { id: state.id, ok: false, evidence: reading.error }
        const ok = reading.vector.length === model.dimensions
        return { id: state.id, ok, evidence: `${model.name} answered a vector of ${String(reading.vector.length)} dimensions${ok ? "" : `, not ${String(model.dimensions)} (HOST_EMBED_MISMATCH)`}` }
    }
    // http
    if (reach === null) {
        const found = await probeService({ http: { url: probe.url, status: probe.status }, ...(probe.json === undefined ? {} : { json: probe.json }) }, cwd, 30)
        return { id: state.id, ok: found.up, evidence: found.evidence }
    }
    const answer = await run(reach, remoteHttpScript(probeImage(host), probe.network ?? placement.network ?? "", probe.url))
    const read = readHttp(answer.stdout)
    if (read.status !== probe.status) return { id: state.id, ok: false, evidence: `GET ${probe.url} on ${probe.network ?? placement.network ?? "?"} answered ${String(read.status)}, not ${String(probe.status)}` }
    if (probe.json === undefined) return { id: state.id, ok: true, evidence: `GET ${probe.url} answered ${String(read.status)}` }
    let value: unknown
    try {
        value = jsonAt(JSON.parse(read.body), probe.json.path)
    } catch {
        value = undefined
    }
    return { id: state.id, ok: value === probe.json.equals, evidence: `GET ${probe.url}: ${probe.json.path} = ${value === undefined ? "absent" : JSON.stringify(value)}` }
}

/** The embed readings of the other machines serving a model, for the parity guard; a machine that cannot be reached is an error reading. */
const otherReadings = async (scope: MachineScope, id: string, host: HostConfig, model: ServedModel): Promise<EmbedReading[]> => {
    const others = endpointsOf(scope.catalog, scope.machines, id).filter((endpoint) => endpoint.machine !== scope.name)
    const readings: EmbedReading[] = []
    for (const endpoint of others) {
        const other = machineScope(endpoint.machine, scope.opsDir, scope.read)
        const placement = placementOf(other.catalog, id, other.site)
        if (placement === undefined) continue
        let reach: Reach | null = null
        try {
            reach = await openReach(other)
            readings.push(await embedOn(other, reach, host, model, placement))
        } catch (caught: unknown) {
            readings.push({ machine: endpoint.machine, error: caught instanceof Error ? caught.message : String(caught) })
        } finally {
            reach?.session.close()
        }
    }
    return readings
}

/** Which app on the server has no alert bot ready: its alerts are held (PROJECT-MONITORING-5); a warning, never red. */
const alertBotsCall = (server: ManagedServer, opsDir: string): DoctorCall => {
    const alerts = serverAlerts(server.projects, registeredRoots(), serverRecipientOf(server.id, opsDir))
    const ready = alerts.bots.map((bot) => `${bot.project}/${bot.env}`)
    return { id: "monitor.alert-bots", ok: alerts.lacking.length === 0 ? true : null, evidence: `${ready.length === 0 ? "no app alert bot is ready" : `alert bots ready: ${ready.join(", ")}`}${alerts.lacking.length === 0 ? "" : `; ${heldLine(alerts) ?? ""}`}` }
}

/**
 * `host doctor --host`: one real call per running service (an embed vector of the pinned dimensions, the Grafana login page, a status API, a
 * BuildKit ping hook, each Swarm service at its replicas), then the parity of every served model across the machines that serve it.
 */
export const machineDoctor = async (name: string, cwd: string): Promise<MachineDoctor> => {
    const scope = machineScope(name)
    const host = loadHost(scope.opsDir)
    const reach = await openReach(scope)
    const calls: DoctorCall[] = []
    const readings = new Map<string, EmbedReading>()
    const parity: Record<string, Parity> = {}
    try {
        const observed = reach === null ? null : await observe(reach)
        const states = await judgeAll(scope, observed, host, cwd)
        for (const state of states) calls.push(await callOne(scope, reach, host, state, observed, cwd, readings))
        if (reach !== null && scope.services.includes("monitor.alertmanager")) calls.push(alertBotsCall(reach.server, scope.opsDir))
    } finally {
        reach?.session.close()
    }
    for (const id of scope.services) {
        const model = roleService(scope.catalog, id).model
        const own = readings.get(scope.name)
        if (model === undefined || own === undefined) continue
        parity[id] = judgeParity(model, [own, ...(await otherReadings(scope, id, host, model))])
    }
    const red = calls.some((call) => call.ok === false) || Object.values(parity).some((entry) => entry.code !== null)
    return { machine: name, calls, parity, red }
}

/** What `host up --host` did for one service. */
export interface UpOutcome {
    readonly id: string
    readonly action: UpStep["action"]
    readonly outcome: "kept" | "adopted" | "deployed" | "rolled back" | "failed" | "skipped" | "planned"
    readonly detail: string
}

/** The monitor components a run deploys: every component of the machine's monitor services; all other defaults turned off. */
const monitorToggles = (reach: Reach, opsDir: string, wanted: readonly string[]): { readonly with: string[]; readonly without: string[] } => {
    const components = loadMonitorComponents(reach.policy, opsDir)
    return { with: [...wanted], without: Object.keys(components).filter((name) => !wanted.includes(name) && components[name]?.default === true) }
}

/** Hands one missing placement to its deployer; true when the deployer reported no failure. */
const deploy = async (scope: MachineScope, reach: Reach | null, placement: Placement, monitor: readonly string[], context: VerbContext, host: HostConfig): Promise<{ readonly ok: boolean; readonly detail: string }> => {
    const id = scope.name
    if (placement.via === "host-stack") {
        const outcomes = await hostUp(host, selectServices(host, placement.ids), context.cwd, context.progress)
        const bad = outcomes.filter((outcome) => outcome.outcome === "still down" || outcome.outcome === "blocked" || outcome.outcome === "not startable")
        return { ok: bad.length === 0, detail: outcomes.map((outcome) => `${outcome.id} ${outcome.outcome}`).join(", ") }
    }
    if (reach === null) return { ok: false, detail: `${placement.via} runs on a server, not on local` }
    const result = await (async () => {
        if (placement.via === "vps-service") return vpsServiceVerb.run(context, { action: "up", id, service: placement.name, local: false, with: [], without: [], "acknowledge-reindex": false, "key-from-host": undefined, app: undefined, env: undefined, member: undefined, key: undefined, execute: true })
        if (placement.via === "vps-monitor") {
            const toggles = monitorToggles(reach, scope.opsDir, monitor)
            return vpsMonitorVerb.run(context, { action: "up", id, local: false, with: toggles.with, without: toggles.without, app: [], execute: true })
        }
        if (placement.via === "vps-ui") return vpsUiVerb.run(context, { action: "up", id, execute: true })
        if (placement.via === "vps-edge") return vpsEdgeVerb.run(context, { action: "up", id, execute: true })
        const adapter = HOST_COMPOSE_ADAPTERS.get(placement.project)
        if (adapter === undefined) throw new Refusal("HOST_SERVICE_UNBUILT", `no host-compose adapter for ${placement.project}`)
        const plan = adapter.up(reach.policy, reach.server, scope.opsDir)
        const outcomes = await runSteps(reach.policy, reach.session, plan.steps, {}, context.progress)
        return { data: {}, message: outcomes.map((outcome) => `${outcome.id}: ${outcome.outcome}`).join(", "), ...(outcomes.some((outcome) => outcome.outcome === "failed") ? { exitCode: 1 } : {}) }
    })()
    return { ok: result.exitCode === undefined || result.exitCode === 0, detail: result.message.split("\n").slice(-3).join(" | ") }
}

/** Rolls one deployed placement back: a stop of its ops/host.yaml services, `docker stack rm`, or its adapter's `compose down`; volumes stay. */
const rollback = async (scope: MachineScope, reach: Reach | null, placement: Placement, context: VerbContext, host: HostConfig): Promise<string> => {
    if (placement.via === "host-stack") {
        const outcomes = await hostDown(host, selectServices(host, placement.ids.filter((one) => one !== "docker" && one !== "orca")), context.cwd, context.progress)
        return outcomes.map((outcome) => `${outcome.id} ${outcome.outcome}`).join(", ")
    }
    if (reach === null) return "nothing to roll back"
    if (placement.via === "host-compose") {
        const adapter = HOST_COMPOSE_ADAPTERS.get(placement.project)
        if (adapter === undefined) return "no adapter"
        const outcomes = await runSteps(reach.policy, reach.session, adapter.down(reach.policy, reach.server).steps, {}, context.progress)
        return outcomes.map((outcome) => `${outcome.id}: ${outcome.outcome}`).join(", ")
    }
    const answer = await run(reach, `docker stack ls --format '{{.Name}}' | grep -qx ${shellQuote(placement.stack)} || { echo unchanged; exit 0; }\ndocker stack rm ${shellQuote(placement.stack)} >/dev/null\necho changed`)
    return `docker stack rm ${placement.stack}: ${answer.exitCode === 0 ? answer.stdout.trim().split("\n").at(-1) ?? "" : headline(answer.stderr)}`
}

/** Waits until a deployed service judges running and its doctor call answers, or its wait passes. */
const awaitHealthy = async (scope: MachineScope, reach: Reach | null, id: string, host: HostConfig, cwd: string, waitSeconds: number): Promise<DoctorCall> => {
    const deadline = Date.now() + waitSeconds * 1000
    for (;;) {
        const observed = reach === null ? null : await observe(reach).catch(() => null)
        const [state] = await judgeAll({ ...scope, services: [id] }, observed, host, cwd)
        const call = state === undefined ? { id, ok: false, evidence: "not judged" } : await callOne(scope, reach, host, state, observed, cwd, new Map())
        if (call.ok === true || Date.now() >= deadline) return call
        await sleep(POLL_MS)
    }
}

/** Records the adopted services in config.yaml (what runs, as what, since when); nothing else of the entry changes. */
const recordAdopted = (scope: MachineScope, states: readonly ServiceState[]): void => {
    const adopted = states.filter((state) => state.state === "adopted")
    if (adopted.length === 0) return
    const read = readMachines()
    const machine = read.doc.machines[scope.name] ?? { ...scope.machine }
    const at = new Date().toISOString()
    const next = { ...machine.adopted, ...Object.fromEntries(adopted.map((state) => [state.id, { as: state.found.map((item) => item.as).join(", "), image: state.found[0]?.image ?? "", at: machine.adopted[state.id]?.at ?? at }])) }
    writeMachines(read.file, { ...read.doc, machines: { ...read.doc.machines, [scope.name]: { ...machine, adopted: next } } })
}

/** Takes the lock on the server itself (one writer per host, whatever machine drives it); HOST_BUSY names the holder. */
const lockRemote = async (reach: Reach, owner: string): Promise<void> => {
    const answer = await run(reach, remoteLockScript(owner, 6))
    const last = answer.stdout.trim().split("\n").at(-1) ?? ""
    if (answer.exitCode !== 0 || last !== "acquired") throw new Refusal("HOST_BUSY", `${reach.server.id} is being changed by another writer (${last || headline(answer.stderr) || "no answer"}); one writer per host`)
}

/** What `host up --host` returns. */
export interface MachineUp {
    readonly machine: string
    readonly execute: boolean
    readonly plan: readonly UpStep[]
    readonly outcomes: readonly UpOutcome[]
    readonly status: MachineStatus
}

/**
 * `host up --host <name> [--execute]`: plans the union of the machine's role services; with --execute it adopts what runs under another name,
 * deploys each missing service through its deployer, waits for its health and rolls it back when it never turns healthy, all under the host's
 * lock. A running service is never redeployed or restarted, and no app stack is touched.
 */
export const machineUp = async (name: string, context: VerbContext, options: { readonly execute: boolean; readonly rollback: boolean }): Promise<MachineUp> => {
    const status = await machineStatus(name, context.cwd)
    if (!status.reached && options.execute) throw new Refusal("HOST_UNREACHABLE", `${name} could not be observed (${status.error ?? "no answer"}); nothing is deployed blind`)
    const scope = machineScope(name)
    const plan = planUp(scope, status.services)
    if (!options.execute) return { machine: name, execute: false, plan, outcomes: plan.map((step) => ({ id: step.id, action: step.action, outcome: "planned" as const, detail: step.detail })), status }
    const host = loadHost(scope.opsDir)
    const outcomes = await withLocalLock(name, async () => {
        const reach = await openReach(scope)
        const owner = lockOwner()
        const done: UpOutcome[] = []
        try {
            if (reach !== null) await lockRemote(reach, owner)
            recordAdopted(scope, status.services)
            // The monitor components of every monitor service the machine hosts deploy as one stack, once.
            const monitor = plan.flatMap((step) => {
                const placement = placementOf(scope.catalog, step.id, scope.site)
                return step.action === "deploy" && placement?.via === "vps-monitor" ? placement.components : []
            })
            let monitorDone: UpOutcome | undefined
            for (const step of plan) {
                if (step.action === "keep") done.push({ id: step.id, action: step.action, outcome: "kept", detail: step.detail })
                else if (step.action === "adopt") done.push({ id: step.id, action: step.action, outcome: "adopted", detail: step.detail })
                else if (step.action === "skip") done.push({ id: step.id, action: step.action, outcome: "skipped", detail: step.detail })
                else {
                    const placement = placementOf(scope.catalog, step.id, scope.site)
                    if (placement === undefined) continue
                    if (placement.via === "vps-monitor" && monitorDone !== undefined) {
                        done.push({ ...monitorDone, id: step.id })
                        continue
                    }
                    context.progress(`${step.id}: deploying (${step.detail})`)
                    let outcome: UpOutcome
                    try {
                        const deployed = await deploy(scope, reach, placement, monitor, context, host)
                        const health = deployed.ok ? await awaitHealthy(scope, reach, step.id, host, context.cwd, placement.waitSeconds ?? scope.catalog.waitSeconds) : { id: step.id, ok: false, evidence: deployed.detail }
                        if (health.ok === true) outcome = { id: step.id, action: "deploy", outcome: "deployed", detail: `${deployed.detail}; healthy: ${health.evidence}` }
                        else if (options.rollback) outcome = { id: step.id, action: "deploy", outcome: "rolled back", detail: `never healthy (${health.evidence}); rolled back: ${await rollback(scope, reach, placement, context, host)}` }
                        else outcome = { id: step.id, action: "deploy", outcome: "failed", detail: `never healthy (${health.evidence}); kept for inspection (--no-rollback)` }
                    } catch (caught: unknown) {
                        outcome = { id: step.id, action: "deploy", outcome: "failed", detail: caught instanceof Error ? caught.message : String(caught) }
                    }
                    context.progress(`${step.id}: ${outcome.outcome}`)
                    if (placement.via === "vps-monitor") monitorDone = outcome
                    done.push(outcome)
                }
            }
            return done
        } finally {
            if (reach !== null) {
                await run(reach, remoteUnlockScript(owner)).catch(() => undefined)
                reach.session.close()
            }
        }
    })
    return { machine: name, execute: true, plan, outcomes, status: await machineStatus(name, context.cwd) }
}
