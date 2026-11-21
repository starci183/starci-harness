import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { stateBase } from "../../harness/ledger.js"
import { lookupSecret, secretHome } from "../../harness/secret-env.js"
import { runSteps, sessionFor } from "../../harness/vps/fleet.js"
import type { StepOutcome } from "../../harness/vps/fleet.js"
import type { DesiredFile } from "../../harness/vps/drift.js"
import { withPrivateDir } from "../../harness/vps/local.js"
import { loadMonitorComponents, selectComponents } from "../../harness/vps/monitor.js"
import { inventoryDir, loadServer, loadVpsPolicy, locateFleetOps } from "../../harness/vps/policy.js"
import type { ManagedServer, VpsPolicy } from "../../harness/vps/policy.js"
import { ownerStore, requireKey } from "../../harness/vps/sealed.js"
import type { SealedStore } from "../../harness/vps/sealed.js"
import {
    capacityScript,
    chooseModel,
    judgeCapacity,
    loadService,
    megabytes,
    readCapacity,
    renderService,
    selectServiceComponents,
    serviceBudget,
    serviceDesiredFiles,
    serviceDownPlan,
    serviceImages,
    serviceNames,
    serviceStatusScript,
    serviceUpPlan,
    SERVICE_KEY,
} from "../../harness/vps/services.js"
import type { Keep, Measured, RunningShared, ServiceTarget, SharedService } from "../../harness/vps/services.js"
import type { SshSession } from "../../harness/vps/ssh.js"
import { Refusal, UsageError } from "../../shared/errors.js"
import { defineVerb } from "../../shared/verb.js"
import type { VerbContext, VerbResult } from "../../shared/verb.js"
import { runHfs } from "../app/hfs.js"
import { localSession } from "./monitor.js"
import { EXECUTE, OWNER, planResult, requireAction } from "./shared.js"
import type { VpsData } from "./shared.js"

/** The sealed file of the local swarm's shared-service keys: the state base of this machine, never tracked. */
const localSealedFile = (): string => join(stateBase(), "services", "local.enc.yaml")

/** The policy, the catalog entry and where it runs, for one run of the verb. */
interface Scope {
    readonly opsDir: string
    readonly policy: VpsPolicy
    readonly service: SharedService
    readonly server: ManagedServer | undefined
    readonly target: ServiceTarget
}

const scopeOf = (id: string | undefined, local: boolean, name: string): Scope => {
    if (local === (id !== undefined)) throw new UsageError("starci vps service takes a server id or --local, one of them")
    const opsDir = locateFleetOps()
    const policy = loadVpsPolicy(opsDir)
    const server = id === undefined ? undefined : loadServer(policy, id, inventoryDir(policy, opsDir))
    return { opsDir, policy, service: loadService(policy, opsDir, name), server, target: server === undefined ? { kind: "local" } : { kind: "server", server } }
}

const keepOf = (policy: VpsPolicy): Keep => ({ memoryMb: megabytes(policy.services.capacity.keepMemory), cpus: policy.services.capacity.keepCpus, diskMb: megabytes(policy.services.capacity.keepDisk) })

/**
 * The other shared stacks that run on the box: every other catalog service whose stack exists, with the components and model its server file
 * chooses, and the monitoring stack with its components; each counted by its memory limits and CPU reservations.
 */
const othersOf = (scope: Scope, measured: Measured): RunningShared[] => {
    const services = serviceNames(scope.policy, scope.opsDir).filter((name) => name !== scope.service.name).map((name) => loadService(scope.policy, scope.opsDir, name)).filter((other) => measured.stacks.includes(other.stack)).map((other): RunningShared => {
        const choice = scope.server?.services?.[other.name]
        const budget = serviceBudget(other, selectServiceComponents(other, choice?.components), chooseModel(other, choice?.model, true))
        return { stack: other.stack, memoryMb: budget.memoryMb, reserveCpus: budget.reserveCpus }
    })
    if (!measured.stacks.includes(scope.policy.monitor.stack)) return services
    const components = loadMonitorComponents(scope.policy, scope.opsDir)
    const selected = selectComponents(components, scope.server?.monitor?.components)
    const memoryMb = selected.reduce((total, name) => total + megabytes(components[name]?.resources.memory ?? "0M"), 0)
    const reserveCpus = Math.round(selected.reduce((total, name) => total + Number(components[name]?.resources.reserveCpus ?? "0"), 0) * 100) / 100
    return [...services, { stack: scope.policy.monitor.stack, memoryMb, reserveCpus }]
}

/** Runs the read-only capacity probe in a session and reads it. */
const measure = async (scope: Scope, session: SshSession, probeImage: string): Promise<Measured> => {
    const run = await session.run({ script: capacityScript(scope.target, probeImage), root: true, timeoutMs: scope.policy.ssh.commandTimeoutSeconds * 1000 })
    if (run.exitCode !== 0) throw new Refusal("VPS_SERVICE_CAPACITY_UNREAD", `the capacity probe failed (exit ${String(run.exitCode)}); nothing was changed`)
    return readCapacity(run.stdout)
}

/**
 * The gate's key: the one sealed in the server's <id>.enc.yaml (or the local file); on the first run made here (32 random bytes), or taken once from
 * the harness secret loader with --key-from-host, then sealed. A sealed key is never replaced by a run; the value is never printed.
 */
const keyOf = (store: SealedStore, file: string, service: SharedService, fromHost: string | undefined): string => {
    const sealed = existsSync(file) ? store.open(file) : {}
    const held = sealed[service.key.sealed] ?? ""
    if (held !== "") {
        if (fromHost !== undefined && lookupSecret(fromHost)?.value !== held) throw new Refusal("VPS_SERVICE_KEY_SEALED", `${file} already seals the key of ${service.name} (${service.key.sealed}) and ${fromHost} is another value; a run never replaces a sealed key. Rotation is the owner's: remove ${service.key.sealed} from the file, run up again, then grant every app again`)
        return held
    }
    let value: string
    if (fromHost === undefined) value = randomBytes(32).toString("base64url")
    else {
        const found = lookupSecret(fromHost)?.value
        if (found === undefined) throw new Refusal("VPS_SERVICE_KEY_MISSING", `${fromHost} is not set; ${secretHome(fromHost)}`)
        value = found
    }
    mkdirSync(dirname(file), { recursive: true })
    store.write(file, { [service.key.sealed]: value })
    return value
}

/** The app a grant names: an existing folder that holds `.starcistacks`. */
const appRoot = (path: string): string => {
    const root = resolve(path)
    if (!existsSync(join(root, ".starcistacks"))) throw new Refusal("VPS_SERVICE_GRANT_APP", `${root} holds no .starcistacks: --app names the app's root`)
    return root
}

interface UpFlags { readonly with: readonly string[]; readonly without: readonly string[]; readonly "acknowledge-reindex": boolean; readonly "key-from-host"?: string | undefined; readonly execute: boolean }

/** What `service up` renders: the components, the model, the budget, the images, the files under `base` and the plan; nothing is written. */
const renderUp = (scope: Scope, flags: Pick<UpFlags, "with" | "without" | "acknowledge-reindex">) => {
    const { service, server, target } = scope
    const choice = server?.services?.[service.name]
    const toggles = { ...(choice?.components ?? {}), ...Object.fromEntries(flags.with.map((name) => [name, true])), ...Object.fromEntries(flags.without.map((name) => [name, false])) }
    const selected = selectServiceComponents(service, toggles)
    const model = chooseModel(service, choice?.model, flags["acknowledge-reindex"])
    const budget = serviceBudget(service, selected, model)
    const images = serviceImages(service, selected, scope.opsDir)
    const render = renderService(service, selected, images, model)
    const base = target.kind === "local" ? join(stateBase(), "services", service.name, "stack").replaceAll("\\", "/") : `/opt/starci/services/${service.name}`
    return { selected, model, budget, images, render, base, plan: serviceUpPlan(service, target, render, budget, model, base) }
}

/**
 * The files `vps service up <id> --service <name>` (no toggles, the pinned model) writes on the server before it redeploys, rendered and never
 * written: `host up --host` compares them with the server's for its config drift (harness/vps/drift.ts).
 */
export const serviceDesired = (opsDir: string, id: string, name: string): DesiredFile[] => {
    const policy = loadVpsPolicy(opsDir)
    const server = loadServer(policy, id, inventoryDir(policy, opsDir))
    const scope: Scope = { opsDir, policy, service: loadService(policy, opsDir, name), server, target: { kind: "server", server } }
    const { render, base } = renderUp(scope, { with: [], without: [], "acknowledge-reindex": false })
    return serviceDesiredFiles(scope.service, render, base)
}

/** `service up`: plan, capacity, key, steps. */
const up = async (scope: Scope, flags: UpFlags, progress: (line: string) => void): Promise<VerbResult<VpsData>> => {
    const { service, server, target } = scope
    const { selected, model, budget, images, render, plan } = renderUp(scope, flags)
    // The capacity probe runs in a throwaway container of the lightest image of the service on the local swarm.
    const probeImage = Object.entries(images).map(([name, image]) => ({ image, mb: megabytes(service.components[name]?.resources.memory ?? "0M") })).sort((left, right) => left.mb - right.mb)[0]?.image ?? ""
    const data = { service: service.name, components: selected, budget, model: model === null ? null : { id: model.id, name: model.variant.name, digest: model.variant.digest, reindex: model.reindex } }
    const capacity = async (session: SshSession): Promise<string[]> => {
        const measured = await measure(scope, session, probeImage)
        return judgeCapacity(service, budget, measured, othersOf(scope, measured), keepOf(scope.policy))
    }
    if (!flags.execute) {
        const lines = target.kind === "local" ? await capacity(localSession()) : ["  note: the capacity of the server is measured before the first step of --execute; a service that does not fit is refused there (VPS_SERVICE_CAPACITY)"]
        const result = planResult(plan, undefined, lines)
        return { ...result, data: { ...result.data, ...data } }
    }
    const store = await ownerStore()
    const key = render.keyed ? keyOf(store, server?.sealedFile ?? localSealedFile(), service, flags["key-from-host"]) : undefined
    const session = server === undefined ? localSession() : await sessionFor(scope.policy, server, store)
    let outcomes: StepOutcome[]
    let lines: string[]
    try {
        lines = await capacity(session)
        for (const line of lines) progress(line.trim())
        outcomes = await runSteps(scope.policy, session, plan.steps, key === undefined ? {} : { [SERVICE_KEY]: key }, progress)
    } finally {
        session.close()
    }
    const result = planResult(plan, outcomes, lines)
    return { ...result, data: { ...result.data, ...data } }
}

/** `service status`: the read-only state of the stack, its model line and its network. */
const status = async (scope: Scope): Promise<VerbResult<VpsData>> => {
    const session = scope.server === undefined ? localSession() : await sessionFor(scope.policy, scope.server, await ownerStore())
    try {
        const run = await session.run({ script: serviceStatusScript(scope.service), root: true, timeoutMs: scope.policy.ssh.commandTimeoutSeconds * 1000 })
        if (run.exitCode !== 0) throw new Refusal("VPS_SERVICE_STATUS", `the status probe of ${scope.service.name} failed (exit ${String(run.exitCode)})`)
        const lines = run.stdout.trim().split(/\r?\n/).filter((line) => line !== "")
        const where = scope.server?.id ?? "local"
        return { data: { service: scope.service.name, stack: scope.service.stack, lines }, message: [`service status ${scope.service.name} ${where}:`, ...lines.map((line) => `  ${line}`)].join("\n") }
    } finally {
        session.close()
    }
}

interface GrantFlags { readonly app?: string | undefined; readonly env?: string | undefined; readonly member?: string | undefined; readonly key?: string | undefined; readonly execute: boolean }

/**
 * `service grant`: seals the gate's key into one app environment's member through `starci app secret set` (PROJECT-STACKS-5), the copy its opt-in
 * `environments.<env>.services.<name>` grants to its consumers. Reaches no server: the key is opened from the sealed file `up` wrote.
 */
const grant = async (scope: Scope, flags: GrantFlags, context: VerbContext): Promise<VerbResult<VpsData>> => {
    if (flags.app === undefined || flags.env === undefined) throw new UsageError("starci vps service grant takes --app <path> and --env <env>")
    if (!/^[a-z][a-z0-9-]*$/.test(flags.env)) throw new UsageError(`--env ${flags.env} is no environment name`)
    const root = appRoot(flags.app)
    const member = flags.member ?? scope.service.app.member
    const key = flags.key ?? scope.service.app.key
    if (!/^[a-z][a-z0-9-]*$/.test(member) || !/^[A-Z][A-Z0-9_]*$/.test(key)) throw new UsageError("--member is a member name (ai) and --key a KEY name (EMBEDDINGS_API_KEY)")
    const file = scope.server?.sealedFile ?? localSealedFile()
    const step = `seal the key of ${scope.service.name} (${file}, ${scope.service.key.sealed}) as ${key} of ${root}/.starcistacks/${flags.env}/secrets/${member}.enc.yaml through starci app secret set`
    const optIn = `environments.${flags.env}.services.${scope.service.name}: {member: ${member}${key === scope.service.app.key ? "" : `, key: ${key}`}}`
    if (!flags.execute) return { data: { service: scope.service.name, app: root, env: flags.env, member, key, execute: false }, message: [`service grant ${scope.service.name}: dry run (add --execute to apply)`, `  1. ${step}`, `  note: the environment opts in with ${optIn}`].join("\n") }
    const store = await ownerStore()
    if (!existsSync(file)) throw new Refusal("VPS_SERVICE_KEY_MISSING", `${file} does not exist: run starci vps service up ${scope.server?.id ?? "--local"} --service ${scope.service.name} --execute first`)
    const value = requireKey(store.open(file), scope.service.key.sealed, file)
    const sealed = await withPrivateDir(async (dir) => {
        writeFileSync(join(dir, key), value, { mode: 0o600 })
        return runHfs({ ...context, cwd: root, treeRoot: root }, "secret", ["set", "--env", flags.env ?? "", member, key, "--from-file", `${key}=${join(dir, key)}`], false)
    })
    const failed = sealed.exitCode !== undefined && sealed.exitCode !== 0
    if (failed) throw new Refusal("VPS_SERVICE_GRANT_FAILED", `starci app secret set refused sealing ${key} into ${basename(root)} ${flags.env}/${member}; nothing else changed`)
    return { data: { service: scope.service.name, app: root, env: flags.env, member, key, execute: true }, message: [`service grant ${scope.service.name}: sealed ${key} into ${root}/.starcistacks/${flags.env}/secrets/${member}.enc.yaml`, `  note: the environment opts in with ${optIn}; commit the member with it`].join("\n") }
}

/**
 * `starci vps service up|status|down|grant <id> --service <name>` (or `--local`): an opt-in shared service of a managed server, from the catalog
 * ops/vps/services/<name>/components.yaml (the embeddings server first); `up` and `down` are dry runs until --execute, `up` refuses a service that
 * does not fit the box, and `grant` seals the service's key into an app environment.
 */
export const vpsServiceVerb = defineVerb({
    path: ["vps", "service"],
    summary: "`service up|status|down|grant <id> --service <name>` (or `--local`): an opt-in shared service of a managed server from ops/vps/services/<name>/components.yaml (embeddings: one CPU embeddings server, qwen3-embedding:4b (2560 dimensions) pinned by digest, behind a bearer-key gate), one stack per server, its components toggled, digests pinned, refused when it does not fit the measured memory, CPUs and disk; `grant` seals its key into an app environment's member; a dry run until --execute",
    effect: "remote",
    roles: OWNER,
    schema: "starci/vps-service@1",
    flags: {
        action: { kind: "string", summary: "up | status | down | grant", required: true, positional: true },
        id: { kind: "string", summary: "the server id (its ops/vps/servers/<id>.yaml); omitted with --local", positional: true },
        service: { kind: "string", summary: "the shared service, a folder of ops/vps/services (embeddings)", required: true },
        local: { kind: "boolean", summary: "the swarm of this machine (Docker Desktop) instead of a server: the same stack and the same capacity check" },
        with: { kind: "list", summary: "up: a component to turn on for this run, beside the server file's services.<name>.components (repeat)" },
        without: { kind: "list", summary: "up: a component to turn off for this run (repeat)" },
        "acknowledge-reindex": { kind: "boolean", summary: "up: accept a model variant the server file chooses instead of the pinned default, which forces every app to re-embed its index" },
        "key-from-host": { kind: "string", summary: "up: take the gate's key once from this harness secret (EMBEDDINGS_API_KEY) instead of generating it; a sealed key is never replaced" },
        app: { kind: "string", summary: "grant: the app's root folder" },
        env: { kind: "string", summary: "grant: the app's stack environment (its .starcistacks/<env>)" },
        member: { kind: "string", summary: "grant: the sealed member that holds the key (default the catalog's app.member, ai)" },
        key: { kind: "string", summary: "grant: the key name in that member (default the catalog's app.key, EMBEDDINGS_API_KEY)" },
        execute: EXECUTE,
    },
    run: async (context, flags): Promise<VerbResult<VpsData>> => {
        const action = requireAction(flags.action, ["up", "status", "down", "grant"], "service")
        const scope = scopeOf(flags.id, flags.local, flags.service)
        if (action === "up") return up(scope, flags, context.progress)
        if (action === "status") return status(scope)
        if (action === "grant") return grant(scope, flags, context)
        const plan = serviceDownPlan(scope.service, scope.target)
        if (!flags.execute) return planResult(plan, undefined)
        if (scope.server === undefined) {
            const session = localSession()
            try {
                return planResult(plan, await runSteps(scope.policy, session, plan.steps, {}, context.progress))
            } finally {
                session.close()
            }
        }
        const store = await ownerStore()
        const session = await sessionFor(scope.policy, scope.server, store)
        try {
            return planResult(plan, await runSteps(scope.policy, session, plan.steps, {}, context.progress))
        } finally {
            session.close()
        }
    },
})
