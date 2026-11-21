import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { hostname } from "node:os"
import { join } from "node:path"
import { Refusal } from "../shared/errors.js"
import { pidAlive } from "../shared/exec.js"
import { imageDigest, imageRepository, loadHostRoles, machineServices, placementImages, placementOf, roleService, validateChoice } from "./host-roles.js"
import type { HostRoles, Placement, ServedModel, Site } from "./host-roles.js"
import { sharedStateBase } from "./ledger.js"
import { allMachines, LOCAL, machineNamed, readMachines, siteOf } from "./machines.js"
import type { Machine, MachinesRead } from "./machines.js"
import { locateFleetOps } from "./vps/policy.js"
import { shellQuote } from "./vps/ssh.js"

/**
 * The role-driven host verbs' pure half (`starci host up|status|doctor --host <name>`, contexts/harness/host.md "Roles"): which services a
 * machine hosts, what a server's Docker says runs, how each service is judged (running, adopted, missing, unsupported, unbuilt), the plan of
 * `up`, the parity of the embedding vectors and the endpoint list the apps' router reads. The half that reaches a machine is core/host/machine.ts.
 */

/** One machine resolved: its name, entry, site, the catalog and the services its roles turn on. */
export interface MachineScope {
    readonly name: string
    readonly machine: Machine
    readonly site: Site
    readonly catalog: HostRoles
    readonly opsDir: string
    readonly services: readonly string[]
    readonly read: MachinesRead
    readonly machines: Readonly<Record<string, Machine>>
}

/** Resolves a machine of config.yaml (`local` always) with the services its roles turn on. */
export const machineScope = (name: string, opsDir: string = locateFleetOps(), read: MachinesRead = readMachines()): MachineScope => {
    const catalog = loadHostRoles(opsDir)
    const machines = allMachines(read, catalog.local)
    const machine = machineNamed(machines, name)
    validateChoice(catalog, machine)
    return { name, machine, site: siteOf(name), catalog, opsDir, services: machineServices(catalog, machine), read, machines }
}

/** What a server's Docker runs, as one read-only probe prints it. */
export interface Observed {
    readonly swarm: string
    readonly stacks: readonly string[]
    readonly services: readonly { readonly name: string; readonly replicas: string; readonly image: string }[]
    readonly containers: readonly { readonly name: string; readonly image: string; readonly project: string }[]
}

/** The read-only probe of a server: the swarm state, the stacks, the swarm services and the containers (with their compose project). */
export const observeScript = (): string =>
    [
        "echo \"swarm=$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || echo unknown)\"",
        "docker stack ls --format 'stack {{.Name}}' 2>/dev/null || true",
        "docker service ls --format 'svc {{.Name}}|{{.Replicas}}|{{.Image}}' 2>/dev/null || true",
        "docker ps --format 'ctr {{.Names}}|{{.Image}}|{{.Label \"com.docker.compose.project\"}}' 2>/dev/null || true",
    ].join("\n")

/** Reads the probe's output. */
export const readObserved = (stdout: string): Observed => {
    const lines = stdout.split(/\r?\n/).map((line) => line.trim())
    const swarm = lines.find((line) => line.startsWith("swarm="))?.slice("swarm=".length) ?? "unknown"
    const stacks = lines.filter((line) => line.startsWith("stack ")).map((line) => line.slice("stack ".length))
    const services = lines.filter((line) => line.startsWith("svc ")).map((line) => {
        const [name = "", replicas = "", image = ""] = line.slice("svc ".length).split("|")
        return { name, replicas, image }
    })
    const containers = lines.filter((line) => line.startsWith("ctr ")).map((line) => {
        const [name = "", image = "", project = ""] = line.slice("ctr ".length).split("|")
        return { name, image, project }
    })
    return { swarm, stacks, services, containers }
}

/** Where one service of a machine stands. */
export type ServiceStateKind = "running" | "adopted" | "partial" | "missing" | "unsupported" | "unbuilt" | "unobserved"

/** One service of a machine, judged. */
export interface ServiceState {
    readonly id: string
    readonly summary: string
    readonly state: ServiceStateKind
    readonly evidence: string
    readonly kind: Placement["kind"] | null
    readonly via: Placement["via"] | null
    /** What it was found running as (a swarm service or a container), when found. */
    readonly found: readonly { readonly as: string; readonly image: string; readonly replicas: string | null }[]
    /** Each running image that is not the catalog's pin: `host up` updates an owned running service for it, an adopted one only reports it. */
    readonly drift: readonly string[]
    /**
     * Each file its deployer would write now that differs from the one on the server (or is not there): the config drift of an owned running
     * service (vps/drift.ts), which `host up` updates; never read for an adopted, partial or local service.
     */
    readonly configDrift: readonly string[]
    readonly images: readonly string[]
    readonly endpoint: string | null
}

/** The deployers whose definition another lane builds: a host-compose project with no registered adapter yet is HOST_SERVICE_UNBUILT. */
export type HostComposeRegistry = ReadonlySet<string>

const driftOf = (pinned: readonly string[], found: readonly { readonly image: string }[]): string[] =>
    found.flatMap((item) => {
        const repo = imageRepository(item.image)
        const pin = pinned.find((ref) => imageRepository(ref) === repo)
        if (pin === undefined) return []
        const want = imageDigest(pin)
        const have = imageDigest(item.image)
        return want === null || have === want ? [] : [`${repo} runs ${have ?? item.image.split("@")[0] ?? item.image}, not the pinned ${want}`]
    })

/**
 * Judges one service of a server from what its Docker runs. Found under its stack (or compose project) it is running; a vps-monitor service whose
 * stack runs without its components is partial (an adopted stack `host up` never changes); found only by its image under another name it is adopted;
 * else it is missing. A host-compose project no adapter is registered for, and not running, is unbuilt.
 */
export const judgeRemote = (id: string, summary: string, placement: Placement, images: readonly string[], observed: Observed, registry: HostComposeRegistry): ServiceState => {
    const base = { id, summary, kind: placement.kind, via: placement.via, images, endpoint: placement.endpoint ?? null }
    const own = placement.kind === "swarm-stack" ? observed.services.filter((service) => service.name.startsWith(`${placement.stack}_`)).map((service) => ({ as: service.name, image: service.image, replicas: service.replicas })) : observed.containers.filter((container) => container.project === placement.stack).map((container) => ({ as: container.name, image: container.image, replicas: null }))
    if (own.length > 0) {
        if (placement.via === "vps-monitor") {
            const missing = placement.components.filter((component) => !own.some((item) => item.as === `${placement.stack}_${component}`))
            const mine = own.filter((item) => placement.components.some((component) => item.as === `${placement.stack}_${component}`))
            if (missing.length > 0) return { ...base, state: "partial", evidence: `the stack ${placement.stack} runs without ${missing.join(", ")}; host up never changes a running stack; adding them is the owner's choice (starci vps monitor up <name> --with ${missing.join(" --with ")})`, found: mine, drift: driftOf(images, mine), configDrift: [] }
            return { ...base, state: "running", evidence: mine.map((item) => `${item.as} ${item.replicas ?? ""}`.trim()).join(", "), found: mine, drift: driftOf(images, mine), configDrift: [] }
        }
        return { ...base, state: "running", evidence: `${placement.kind === "swarm-stack" ? "stack" : "compose project"} ${placement.stack}: ${own.map((item) => `${item.as}${item.replicas === null ? "" : ` ${item.replicas}`}`).join(", ")}`, found: own, drift: driftOf(images, own), configDrift: [] }
    }
    const repos = new Set([...placement.match, ...images.map(imageRepository)])
    const elsewhere = [
        ...observed.services.filter((service) => repos.has(imageRepository(service.image))).map((service) => ({ as: service.name, image: service.image, replicas: service.replicas })),
        ...observed.containers.filter((container) => repos.has(imageRepository(container.image)) && !observed.services.some((service) => container.name.startsWith(`${service.name}.`))).map((container) => ({ as: container.name, image: container.image, replicas: null })),
    ]
    if (elsewhere.length > 0) return { ...base, state: "adopted", evidence: `runs as ${elsewhere.map((item) => item.as).join(", ")} (not ${placement.stack}): adopted, recorded and checked, never redeployed or restarted`, found: elsewhere, drift: driftOf(images, elsewhere), configDrift: [] }
    if (placement.via === "host-compose" && !registry.has(placement.project)) return { ...base, state: "unbuilt", evidence: `its definition (ops/${placement.dir}) and its host-compose adapter are not built yet (HOST_SERVICE_UNBUILT); nothing is deployed for it`, found: [], drift: [], configDrift: [] }
    return { ...base, state: "missing", evidence: `no ${placement.kind === "swarm-stack" ? "stack" : "compose project"} ${placement.stack} and nothing runs ${[...repos].join(" or ") || "it"}`, found: [], drift: [], configDrift: [] }
}

/** A service with no placement for the machine's site. */
export const unsupported = (catalog: HostRoles, id: string, site: Site): ServiceState => ({
    id,
    summary: roleService(catalog, id).summary,
    state: "unsupported",
    evidence: `ops/host-roles.yaml gives ${id} no on.${site} placement (HOST_SERVICE_UNSUPPORTED): turn it off on this machine with \`starci vps set <name> --roles -${id}\``,
    kind: null,
    via: null,
    found: [],
    drift: [],
    configDrift: [],
    images: [],
    endpoint: null,
})

/** The pinned images of a placement, or none when a pin cannot be read (the judgement still runs; the refusal comes at deploy). */
export const imagesOf = (placement: Placement, opsDir: string): string[] => {
    try {
        return placementImages(placement, opsDir)
    } catch {
        return []
    }
}

/** The swarm-engine line of a machine with the app-host role: the engine its role names and what the server's Docker says. */
export const engineLine = (scope: MachineScope, observed: Observed | null): string | null => {
    if (!scope.machine.roles.includes("app-host")) return null
    const engine = scope.catalog.roles["app-host"]?.engine ?? "swarm"
    if (observed === null) return `engine ${engine}: not observed`
    return engine === "swarm" ? `engine swarm: ${observed.swarm}${observed.swarm === "active" ? "" : " (starci vps swarm init <name> makes it one)"}` : `engine ${engine}: declared, not built`
}

/**
 * The config drift of one judged service: an owned running service (found under its own stack or compose project) gets the files its deployer
 * would write now that differ from the server's; any other state is left as it is (an adopted service is never compared: nothing of ours runs it).
 */
export const withConfigDrift = (state: ServiceState, drift: readonly string[]): ServiceState => (state.state === "running" ? { ...state, configDrift: drift } : state)

/** What `host up` will do for one service. */
export interface UpStep {
    readonly id: string
    readonly action: "keep" | "adopt" | "update" | "deploy" | "skip"
    readonly detail: string
    readonly rollback: string | null
}

const rollbackOf = (placement: Placement): string => {
    if (placement.via === "host-stack") return `starci host down ${placement.ids.join(" ")} (a stop; no container, volume or data is removed)`
    if (placement.via === "vps-service") return `starci vps service down <name> --service ${placement.name} --execute (docker stack rm ${placement.stack}; its volumes stay)`
    if (placement.via === "host-compose") return `docker compose -p ${placement.project} down (its volumes stay)`
    return `docker stack rm ${placement.stack} (its volumes stay)`
}

const deployOf = (placement: Placement): string => {
    if (placement.via === "host-stack") return `starci host up ${placement.ids.join(" ")} (compose up --no-recreate)`
    if (placement.via === "vps-service") return `starci vps service up <name> --service ${placement.name} --execute`
    if (placement.via === "vps-monitor") return `starci vps monitor up <name> with ${placement.components.join(", ")} --execute`
    if (placement.via === "vps-ui") return "starci vps ui up <name> --execute"
    if (placement.via === "vps-edge") return "starci vps edge up <name> --execute"
    return `the ${placement.project} host-compose adapter (ops/${placement.dir})`
}

/** How an update that never turns healthy is rolled back: each Swarm service of the stack to its previous spec; a compose project keeps no previous version. */
const updateRollbackOf = (placement: Placement, state: ServiceState): string => {
    if (placement.kind === "host-compose") return `none: the ${placement.stack} compose project keeps no previous version; it stays for inspection`
    const services = state.found.map((item) => item.as)
    return services.length === 0 ? "none: no Swarm service was found" : `docker service rollback ${services.join(", ")} (each to its previous spec)`
}

/** What an update is for: the config drift (the files that differ) and the image drift (pinned images that moved). */
export const driftLine = (state: Pick<ServiceState, "drift" | "configDrift">): string =>
    [...(state.configDrift.length === 0 ? [] : [`config drift: ${state.configDrift.join(", ")}`]), ...(state.drift.length === 0 ? [] : [`image drift: ${state.drift.join("; ")}`])].join("; ")

/**
 * The plan of `host up`: keep what runs as rendered, update an owned running service whose deployer would render it otherwise (config drift) or
 * whose pinned images moved (image drift), adopt what runs under another name (its drift reported only, never acted on), deploy what is missing
 * (each with its rollback), skip the rest. A partial monitor stack is kept: adding components is the owner's choice.
 */
export const planUp = (scope: MachineScope, states: readonly ServiceState[]): UpStep[] =>
    states.map((state): UpStep => {
        const placement = placementOf(scope.catalog, state.id, scope.site)
        if (state.state === "running" && placement !== undefined && placement.via !== "host-stack" && (state.configDrift.length > 0 || state.drift.length > 0)) {
            return { id: state.id, action: "update", detail: `${driftLine(state)}: ${deployOf(placement).replaceAll("<name>", scope.name)}, then wait for its health`, rollback: updateRollbackOf(placement, state) }
        }
        if (state.state === "running" || state.state === "partial") return { id: state.id, action: "keep", detail: `${state.evidence}${state.drift.length === 0 ? "" : `; drift: ${state.drift.join("; ")}`}`, rollback: null }
        if (state.state === "adopted") return { id: state.id, action: "adopt", detail: `record ${state.found.map((item) => item.as).join(", ")} in config.yaml; never redeployed or restarted${state.drift.length === 0 ? "" : `; drift (reported only): ${state.drift.join("; ")}`}`, rollback: null }
        if (placement === undefined || state.state === "unsupported" || state.state === "unbuilt") return { id: state.id, action: "skip", detail: state.evidence, rollback: null }
        return { id: state.id, action: "deploy", detail: `${deployOf(placement).replaceAll("<name>", scope.name)}, then wait for its health`, rollback: rollbackOf(placement).replaceAll("<name>", scope.name) }
    })

/** What `host up --host` did for one service. */
export interface UpOutcome {
    readonly id: string
    readonly action: UpStep["action"]
    readonly outcome: "kept" | "adopted" | "updated" | "deployed" | "rolled back" | "failed" | "skipped" | "planned"
    readonly detail: string
}

/** The calls `runUpPlan` makes to reach a machine: its deployers, the health wait and the rollback (core/host/machine.ts; a spec's fakes). */
export interface UpHooks {
    /** Hands one placement to its deployer's normal up (the same call for a deploy and an update); ok when the deployer reported no failure. */
    readonly deploy: (step: UpStep, placement: Placement) => Promise<{ readonly ok: boolean; readonly detail: string }>
    /** Waits until the service judges running and its doctor call answers, or its wait passes. */
    readonly awaitHealthy: (step: UpStep, placement: Placement) => Promise<{ readonly ok: boolean | null; readonly evidence: string }>
    /** Rolls a step that never turned healthy back: a deploy is removed, an update returned to its previous spec. */
    readonly rollback: (step: UpStep, placement: Placement) => Promise<string>
    readonly progress: (line: string) => void
}

/**
 * Runs the plan of `host up --execute`: keep, adopt and skip change nothing; a deploy or an update goes to its deployer's normal up, then waits for
 * its health and is rolled back (unless `rollback` is off) when it never turns healthy. The monitor services of a machine are one stack: the first
 * monitor deploy or update runs `vps monitor up` once and the others share its outcome.
 */
export const runUpPlan = async (scope: MachineScope, plan: readonly UpStep[], hooks: UpHooks, options: { readonly rollback: boolean }): Promise<UpOutcome[]> => {
    const done: UpOutcome[] = []
    let monitorDone: UpOutcome | undefined
    for (const step of plan) {
        if (step.action === "keep") done.push({ id: step.id, action: step.action, outcome: "kept", detail: step.detail })
        else if (step.action === "adopt") done.push({ id: step.id, action: step.action, outcome: "adopted", detail: step.detail })
        else if (step.action === "skip") done.push({ id: step.id, action: step.action, outcome: "skipped", detail: step.detail })
        else {
            const placement = placementOf(scope.catalog, step.id, scope.site)
            if (placement === undefined) continue
            if (placement.via === "vps-monitor" && monitorDone !== undefined) {
                done.push({ ...monitorDone, id: step.id, action: step.action })
                continue
            }
            const verb = step.action === "update" ? "updating" : "deploying"
            hooks.progress(`${step.id}: ${verb} (${step.detail})`)
            let outcome: UpOutcome
            try {
                const deployed = await hooks.deploy(step, placement)
                const health = deployed.ok ? await hooks.awaitHealthy(step, placement) : { ok: false, evidence: deployed.detail }
                if (health.ok === true) outcome = { id: step.id, action: step.action, outcome: step.action === "update" ? "updated" : "deployed", detail: `${deployed.detail}; healthy: ${health.evidence}` }
                else if (options.rollback) outcome = { id: step.id, action: step.action, outcome: "rolled back", detail: `never healthy (${health.evidence}); rolled back: ${await hooks.rollback(step, placement)}` }
                else outcome = { id: step.id, action: step.action, outcome: "failed", detail: `never healthy (${health.evidence}); kept for inspection (--no-rollback)` }
            } catch (caught: unknown) {
                outcome = { id: step.id, action: step.action, outcome: "failed", detail: caught instanceof Error ? caught.message : String(caught) }
            }
            hooks.progress(`${step.id}: ${outcome.outcome}`)
            if (placement.via === "vps-monitor") monitorDone = outcome
            done.push(outcome)
        }
    }
    return done
}

/** One endpoint of a served model, as the apps' router reads it from `host status --json`. */
export interface ModelEndpoint {
    readonly machine: string
    readonly url: string
    readonly network: string | null
    readonly model: string
    readonly digest: string
    readonly dimensions: number
}

/**
 * Every endpoint of a service across the machines that host it, in the order a router tries them: `local` first (the owner's PC: "fallback lẫn vps
 * lẫn máy thầy nếu máy thầy k mở thì về vps!"), then the others in config.yaml order.
 */
export const endpointsOf = (catalog: HostRoles, machines: Readonly<Record<string, Machine>>, id: string): ModelEndpoint[] => {
    const service = roleService(catalog, id)
    const model: ServedModel | undefined = service.model
    const names = [LOCAL, ...Object.keys(machines).filter((name) => name !== LOCAL)]
    return names.flatMap((name) => {
        const machine = machines[name]
        if (machine === undefined || !machineServices(catalog, machine).includes(id)) return []
        const placement = placementOf(catalog, id, siteOf(name))
        if (placement?.endpoint === undefined) return []
        return [{ machine: name, url: placement.endpoint, network: placement.network, model: model?.name ?? "", digest: model?.digest ?? "", dimensions: model?.dimensions ?? 0 }]
    })
}

/** The cosine of two vectors of the same length. */
export const cosine = (left: readonly number[], right: readonly number[]): number => {
    let dot = 0
    let a = 0
    let b = 0
    for (let index = 0; index < left.length; index += 1) {
        const x = left[index] ?? 0
        const y = right[index] ?? 0
        dot += x * y
        a += x * x
        b += y * y
    }
    return a === 0 || b === 0 ? 0 : dot / Math.sqrt(a * b)
}

/** One machine's answer to the embed probe: its vector, or why there is none. */
export type EmbedReading = { readonly machine: string; readonly vector: readonly number[] } | { readonly machine: string; readonly error: string }

/** The verdict of the parity of the embed vectors across machines. */
export interface Parity {
    readonly verdict: "equal" | "mismatch" | "single" | "unjudged"
    readonly code: "HOST_EMBED_MISMATCH" | null
    readonly detail: string
    readonly pairs: readonly { readonly left: string; readonly right: string; readonly cosine: number }[]
}

/**
 * Judges the vectors the machines serving one model gave for the same text: every one has the model's dimensions and every pair has a cosine of at
 * least `minCosine`, else HOST_EMBED_MISMATCH (mixed vectors would corrupt every app's search). A machine that did not answer leaves it unjudged.
 */
export const judgeParity = (model: ServedModel, readings: readonly EmbedReading[]): Parity => {
    const vectors = readings.flatMap((reading) => ("vector" in reading ? [reading] : []))
    const failed = readings.flatMap((reading) => ("error" in reading ? [`${reading.machine}: ${reading.error}`] : []))
    const wrong = vectors.filter((reading) => reading.vector.length !== model.dimensions)
    if (wrong.length > 0) return { verdict: "mismatch", code: "HOST_EMBED_MISMATCH", detail: `${wrong.map((reading) => `${reading.machine} gave ${String(reading.vector.length)} dimensions`).join(", ")}, not the ${String(model.dimensions)} of ${model.name}`, pairs: [] }
    const pairs = vectors.flatMap((left, index) => vectors.slice(index + 1).map((right) => ({ left: left.machine, right: right.machine, cosine: Math.round(cosine(left.vector, right.vector) * 1e6) / 1e6 })))
    const low = pairs.filter((pair) => pair.cosine < model.minCosine)
    if (low.length > 0) return { verdict: "mismatch", code: "HOST_EMBED_MISMATCH", detail: `${low.map((pair) => `${pair.left} and ${pair.right} have cosine ${String(pair.cosine)}`).join(", ")}, below ${String(model.minCosine)}: not the same vector space (a different model digest or quantization)`, pairs }
    if (failed.length > 0) return { verdict: "unjudged", code: null, detail: `not every machine answered: ${failed.join("; ")}`, pairs }
    if (vectors.length < 2) return { verdict: "single", code: null, detail: `one machine serves ${model.name}; nothing to compare`, pairs }
    return { verdict: "equal", code: null, detail: `${String(vectors.length)} machines give ${String(model.dimensions)} dimensions, every cosine >= ${String(model.minCosine)}`, pairs }
}

/** The OpenAI-compatible body of the embed probe. */
export const embedBody = (model: ServedModel): string => JSON.stringify({ model: model.name, input: model.probeText })

/** The vector of an OpenAI-compatible embeddings answer (`data[0].embedding`), or why there is none. */
export const vectorOf = (text: string): readonly number[] | string => {
    let parsed: unknown
    try {
        parsed = JSON.parse(text)
    } catch {
        return `the answer is not json (${text.slice(0, 120)})`
    }
    const data = (parsed as { data?: { embedding?: unknown }[] }).data
    const vector = Array.isArray(data) ? data[0]?.embedding : undefined
    if (!Array.isArray(vector) || !vector.every((value) => typeof value === "number")) return `the answer holds no data[0].embedding (${text.slice(0, 120)})`
    return vector
}

/**
 * The remote half of the embed probe: one POST from a throwaway container on the service's network, the key read from the step's environment
 * (`SERVICE_KEY`, put on stdin by the session, never argv), the body from a heredoc.
 */
export const remoteEmbedScript = (probeImage: string, network: string, url: string, model: ServedModel): string => {
    const marker = "STARCI_EOF"
    const body = embedBody(model)
    if (body.includes(marker)) throw new Refusal("HOST_PROBE_INVALID", `the probe text holds ${marker}`)
    // The URL comes from the catalog; only these characters reach the container's shell inside its single-quoted command.
    const target = `${url.replace(/\/$/, "")}/embeddings`
    if (!/^https?:\/\/[A-Za-z0-9._:/-]+$/.test(target)) throw new Refusal("HOST_PROBE_INVALID", `${target} holds characters the probe does not pass to a shell`)
    const command = `curl -sS -m 60 -H "Authorization: Bearer $SERVICE_KEY" -H "Content-Type: application/json" --data-binary @- ${target}`
    return [`cat <<'${marker}' | docker run --rm -i -e SERVICE_KEY --network ${shellQuote(network)} --entrypoint sh ${shellQuote(probeImage)} -c ${shellQuote(command)}`, body, marker].join("\n")
}

/** The remote half of an http probe: one GET from a throwaway container on the network, printing the status and then the body. */
export const remoteHttpScript = (probeImage: string, network: string, url: string): string =>
    `docker run --rm --network ${shellQuote(network)} ${shellQuote(probeImage)} -sS -m 30 -o /dev/stdout -w '\\nstatus=%{http_code}\\n' ${shellQuote(url)} || echo status=000`

/** Reads the http probe: its status and body. */
export const readHttp = (stdout: string): { readonly status: number; readonly body: string } => {
    const match = /\nstatus=(\d{3})\s*$/.exec(stdout) ?? /^status=(\d{3})\s*$/m.exec(stdout)
    const status = Number(match?.[1] ?? "0")
    return { status, body: match === null ? stdout : stdout.slice(0, match.index) }
}

/** The value at a dotted path of a parsed json value. */
export const jsonAt = (value: unknown, path: string): unknown =>
    path.split(".").reduce<unknown>((at, key) => (typeof at === "object" && at !== null && key in at ? (at as Record<string, unknown>)[key] : undefined), value)

const lockDir = (): string => join(sharedStateBase(), "locks")

/** The local lock of one machine's writer: `<shared state>/locks/host-<name>.lock`, holding the pid. */
export const localLockFile = (name: string): string => join(lockDir(), `host-${name}.lock`)

/** Holds the one local writer of a machine for the work's duration: HOST_BUSY while another live process holds it (a dead holder's lock is taken over). */
export const withLocalLock = async <T>(name: string, work: () => Promise<T>): Promise<T> => {
    mkdirSync(lockDir(), { recursive: true })
    const file = localLockFile(name)
    if (existsSync(file)) {
        const holder = Number(readFileSync(file, "utf8").trim())
        if (Number.isInteger(holder) && holder > 0 && holder !== process.pid && pidAlive(holder)) throw new Refusal("HOST_BUSY", `another host up of ${name} runs on this machine (pid ${String(holder)}); one writer per host`)
    }
    writeFileSync(file, String(process.pid), "utf8")
    try {
        return await work()
    } finally {
        rmSync(file, { force: true })
    }
}

/** The lock on a server itself: one writer per host whatever machine it is driven from; a lock older than `staleHours` is taken over. */
export const REMOTE_LOCK = "/run/starci-host-up.lock"

/** Who holds the remote lock: this harness host and process. */
export const lockOwner = (): string => `${hostname().replace(/[^A-Za-z0-9._-]/g, "-")}:${String(process.pid)}`

/** Takes the remote lock: prints `acquired` or `busy <owner> <age seconds>`. */
export const remoteLockScript = (owner: string, staleHours: number): string =>
    [
        `L=${REMOTE_LOCK}`,
        `if mkdir "$L" 2>/dev/null; then printf '%s\\n' ${shellQuote(owner)} > "$L/owner"; echo acquired; exit 0; fi`,
        `age=$(( $(date +%s) - $(stat -c %Y "$L" 2>/dev/null || date +%s) ))`,
        `if [ "$age" -gt ${String(staleHours * 3600)} ]; then rm -rf "$L"; mkdir "$L" && printf '%s\\n' ${shellQuote(owner)} > "$L/owner" && echo acquired && exit 0; fi`,
        `echo "busy $(cat "$L/owner" 2>/dev/null || echo unknown) $age"`,
    ].join("\n")

/** Releases the remote lock when this process holds it. */
export const remoteUnlockScript = (owner: string): string => `L=${REMOTE_LOCK}\n[ "$(cat "$L/owner" 2>/dev/null)" = ${shellQuote(owner)} ] && rm -rf "$L" || true\necho unchanged`
