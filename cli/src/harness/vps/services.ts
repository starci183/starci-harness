import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse, stringify } from "yaml"
import { z } from "zod"
import { Refusal } from "../../shared/errors.js"
import { resolveImages } from "./policy.js"
import type { ManagedServer, VpsPolicy } from "./policy.js"
import { SWARM_DNS_SEARCH } from "./plan.js"
import type { VpsPlan } from "./plan.js"
import { shellQuote } from "./ssh.js"

/**
 * The opt-in shared services of a managed VPS (`starci vps service up|status|down|grant <id> --service <name>`, contexts/project/shared-services.md).
 * Each is one catalog entry, ops/vps/services/<name>/components.yaml: one stack per server, its components toggled like the monitoring stack's,
 * its images pinned by digest, its limits, reservations, rollouts and retention its own, and what it needs from the box declared so `up` can
 * refuse a service that does not fit. A service with a `model` pins the model by digest; a variant other than the default is an explicit choice
 * of one server's file and forces a reindex. Nothing here reaches a server; the gate's key reaches it only on the step's stdin (ssh.ts).
 */

const NAME = /^[a-z][a-z0-9-]*$/
const SIZE = /^(\d+(?:\.\d+)?)([MG])$/
const HEX64 = /^[0-9a-f]{64}$/
const loose = z.record(z.string(), z.unknown())
const rollout = z.strictObject({
    parallelism: z.number().int().positive(),
    delay: z.string().optional(),
    order: z.enum(["stop-first", "start-first"]),
    failure_action: z.enum(["rollback", "pause", "continue"]),
    monitor: z.string(),
})

const componentSchema = z.strictObject({
    default: z.boolean(),
    purpose: z.string().min(1),
    why: z.string().min(1),
    requires: z.array(z.string().regex(NAME)).optional(),
    image: z.strictObject({ image: z.string().regex(/^[a-z0-9./-]+$/), pin: z.string().min(1) }),
    resources: z.strictObject({ memory: z.string().regex(SIZE), cpus: z.string().regex(/^\d+\.\d+$/), reserveMemory: z.string().regex(SIZE), reserveCpus: z.string().regex(/^\d+\.\d+$/) }),
    update: rollout.extend({ failure_action: z.literal("rollback") }),
    rollback: rollout.extend({ failure_action: z.enum(["pause", "continue"]) }),
    restart: z.strictObject({ condition: z.enum(["on-failure", "any"]), delay: z.string(), max_attempts: z.number().int().positive().optional() }),
    retention: z.record(z.string(), z.union([z.string(), z.number()])),
    // backend: the stack's own overlay; shared: the external network apps join (the component answers there on `app.alias`).
    networks: z.array(z.enum(["backend", "shared"])).min(1),
    volumes: z.record(z.string().regex(NAME), z.string().regex(/^\//)).optional(),
    configs: z.record(z.string(), z.string().regex(/^\//)).optional(),
    // true: the component reads the service's key, mounted at /run/secrets/<key.file>.
    secret: z.boolean().optional(),
    service: loose.optional(),
})

const variantSchema = z.strictObject({
    name: z.string().regex(/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9._-]+)?:[a-z0-9._-]+$/),
    digest: z.string().regex(HEX64),
    blob: z.string().regex(HEX64),
    quantization: z.string().min(1),
    dimensions: z.number().int().positive(),
    needs: z.strictObject({ memory: z.string().regex(SIZE), disk: z.string().regex(SIZE) }),
    reindex: z.union([z.literal(false), z.string().min(1)]),
})

const fileSchema = z.looseObject({
    schema: z.literal("starci/vps-service@1"),
    purpose: z.string().min(1),
    stack: z.string().regex(NAME),
    network: z.string().regex(/^[a-z][a-z0-9_-]*$/),
    app: z.strictObject({ alias: z.string().regex(NAME), url: z.url(), urlEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/), key: z.string().regex(/^[A-Z][A-Z0-9_]*$/), member: z.string().regex(NAME) }),
    key: z.strictObject({ sealed: z.string().regex(/^[a-z][A-Za-z0-9]*$/), file: z.string().regex(/^[a-z][a-z0-9_]*$/) }),
    model: z.strictObject({ default: z.string().regex(NAME), variants: z.record(z.string().regex(/^[a-z0-9][a-z0-9.-]*$/), variantSchema) }).optional(),
    components: z.record(z.string().regex(NAME), componentSchema),
})

/** One component of a shared service, as its components.yaml declares it. */
export type ServiceComponent = z.infer<typeof componentSchema>
/** One model variant of a shared service. */
export type ModelVariant = z.infer<typeof variantSchema>

/** A loaded shared service: its catalog name and folder, and its validated file. */
export interface SharedService extends z.infer<typeof fileSchema> {
    readonly name: string
    readonly dir: string
}

/** The catalog folder of the policy, absolute. */
export const servicesDir = (policy: VpsPolicy, opsDir: string): string => join(opsDir, policy.services.dir)

/** The names of the catalog: every folder of it that holds a components.yaml. */
export const serviceNames = (policy: VpsPolicy, opsDir: string): string[] => {
    const dir = servicesDir(policy, opsDir)
    if (!existsSync(dir)) return []
    return readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && NAME.test(entry.name) && existsSync(join(dir, entry.name, "components.yaml"))).map((entry) => entry.name).sort((left, right) => left.localeCompare(right))
}

/** Loads and validates ops/vps/services/<name>/components.yaml; a name the catalog lacks is refused naming the catalog. */
export const loadService = (policy: VpsPolicy, opsDir: string, name: string): SharedService => {
    const names = serviceNames(policy, opsDir)
    if (!names.includes(name)) throw new Refusal("VPS_SERVICE_UNKNOWN", `${name} is no shared service of ${servicesDir(policy, opsDir)}; the catalog holds ${names.join(", ") || "nothing"}`)
    const dir = join(servicesDir(policy, opsDir), name)
    const file = join(dir, "components.yaml")
    let raw: unknown
    try {
        raw = parse(readFileSync(file, "utf8"))
    } catch (error: unknown) {
        throw new Refusal("OPS_INVALID", `${file} is not readable yaml: ${error instanceof Error ? error.message : String(error)}`)
    }
    const parsed = fileSchema.safeParse(raw)
    if (!parsed.success) throw new Refusal("OPS_INVALID", `${file} is invalid: ${z.prettifyError(parsed.error)}`)
    const service = parsed.data
    for (const [component, entry] of Object.entries(service.components))
        for (const needed of entry.requires ?? []) if (service.components[needed] === undefined) throw new Refusal("OPS_INVALID", `${file}: ${component} requires ${needed}, which is no component`)
    if (service.model !== undefined) {
        const fallback = service.model.variants[service.model.default]
        if (fallback === undefined) throw new Refusal("OPS_INVALID", `${file}: model.default ${service.model.default} is no variant`)
        if (fallback.reindex !== false) throw new Refusal("OPS_INVALID", `${file}: the default model variant cannot be one that forces a reindex`)
    }
    return { ...service, name, dir }
}

/** The components a server runs: each default, turned on or off by its file and the run's flags; a requirement turned off is refused. */
export const selectServiceComponents = (service: SharedService, toggles: Readonly<Record<string, boolean>> = {}): string[] => {
    const names = Object.keys(service.components)
    for (const name of Object.keys(toggles)) if (service.components[name] === undefined) throw new Refusal("VPS_SERVICE_COMPONENT", `${name} is no component of ${service.name}; its components are ${names.join(", ")}`)
    const on = names.filter((name) => toggles[name] ?? service.components[name]?.default === true)
    if (on.length === 0) throw new Refusal("VPS_SERVICE_COMPONENT", `every component of ${service.name} is turned off`)
    const missing = on.flatMap((name) => (service.components[name]?.requires ?? []).filter((needed) => !on.includes(needed)).map((needed) => `${name} needs ${needed}`))
    if (missing.length > 0) throw new Refusal("VPS_SERVICE_REQUIRES", `the components of ${service.name} turned on need others that are off: ${missing.join("; ")}`)
    return on
}

/** The model a server serves: the catalog default, or the variant its file names. */
export interface ChosenModel {
    readonly id: string
    readonly variant: ModelVariant
    /** Why the variant forces a full reindex, or null for the default. */
    readonly reindex: string | null
}

/**
 * The model of a run: the server file's explicit choice, else the default. A variant that forces a reindex is refused (VPS_SERVICE_REINDEX) unless
 * the run acknowledges it; acknowledged, it is still returned with its reason so the plan prints it as a finding.
 */
export const chooseModel = (service: SharedService, choice: string | undefined, acknowledged: boolean): ChosenModel | null => {
    if (service.model === undefined) {
        if (choice !== undefined) throw new Refusal("VPS_SERVICE_MODEL_UNKNOWN", `${service.name} serves no model; remove services.${service.name}.model from the server file`)
        return null
    }
    const id = choice ?? service.model.default
    const variant = service.model.variants[id]
    if (variant === undefined) throw new Refusal("VPS_SERVICE_MODEL_UNKNOWN", `${id} is no model variant of ${service.name}; the variants are ${Object.keys(service.model.variants).join(", ")}`)
    const reindex = variant.reindex === false ? null : variant.reindex
    if (reindex !== null && !acknowledged)
        throw new Refusal("VPS_SERVICE_REINDEX", `the server file chooses the model ${variant.name} for ${service.name} instead of the pinned default ${service.model.variants[service.model.default]?.name ?? service.model.default}: ${reindex}. Every app that calls it must re-embed its whole index before it reads a vector again. Run again with --acknowledge-reindex once that reindex is planned, or remove services.${service.name}.model from the server file`)
    return { id, variant, reindex }
}

/** Megabytes of a `512M` / `10G` size. */
export const megabytes = (size: string): number => {
    const [, value = "0", unit = "M"] = SIZE.exec(size) ?? []
    return Number(value) * (unit === "G" ? 1024 : 1)
}

const round = (value: number): number => Math.round(value * 100) / 100

/** What one shared service takes from the box: the limits and reservations of its components, and the resident memory and disk its model needs. */
export interface ServiceBudget {
    readonly rows: readonly { readonly component: string; readonly memoryMb: number; readonly reserveMb: number; readonly cpus: number; readonly reserveCpus: number }[]
    readonly memoryMb: number
    readonly reserveMb: number
    readonly cpus: number
    readonly reserveCpus: number
    /** The memory the service holds once it serves (its model resident, the other components' reservations), and the disk its images and model take. */
    readonly needs: { readonly memoryMb: number; readonly diskMb: number }
}

/** The budget of the selected components and the chosen model. */
export const serviceBudget = (service: SharedService, selected: readonly string[], model: ChosenModel | null): ServiceBudget => {
    const rows = selected.map((name) => {
        const resources = service.components[name]?.resources
        if (resources === undefined) throw new Refusal("VPS_SERVICE_COMPONENT", `${name} is no component of ${service.name}`)
        return { component: name, memoryMb: megabytes(resources.memory), reserveMb: megabytes(resources.reserveMemory), cpus: Number(resources.cpus), reserveCpus: Number(resources.reserveCpus) }
    })
    const sum = (key: "memoryMb" | "reserveMb" | "cpus" | "reserveCpus"): number => round(rows.reduce((total, row) => total + row[key], 0))
    const reserveMb = sum("reserveMb")
    return {
        rows,
        memoryMb: sum("memoryMb"),
        reserveMb,
        cpus: sum("cpus"),
        reserveCpus: sum("reserveCpus"),
        needs: model === null ? { memoryMb: reserveMb, diskMb: 0 } : { memoryMb: Math.max(reserveMb, megabytes(model.variant.needs.memory)), diskMb: megabytes(model.variant.needs.disk) },
    }
}

/** Where a service runs: a managed server or the local swarm of this machine. */
export type ServiceTarget = { readonly kind: "server"; readonly server: ManagedServer } | { readonly kind: "local" }

/** The rendered stack: its files (relative path to content), the stack file among them, and whether it reads the key. */
export interface ServiceRender {
    readonly files: Readonly<Record<string, string>>
    readonly keyed: boolean
}

const TOKEN = /\{\{([A-Za-z0-9_.-]+)\}\}/g

const fill = (text: string, tokens: Readonly<Record<string, string>>, where: string): string =>
    text.replaceAll(TOKEN, (_whole, key: string) => {
        const value = tokens[key]
        if (value === undefined) throw new Refusal("OPS_INVALID", `${where} names {{${key}}}, which the shared-service plan does not fill`)
        return value
    })

const fillDeep = (value: unknown, tokens: Readonly<Record<string, string>>, where: string): unknown => {
    if (typeof value === "string") return fill(value, tokens, where)
    if (Array.isArray(value)) return value.map((item) => fillDeep(item, tokens, where))
    if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fillDeep(item, tokens, where)]))
    return value
}

const hash = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 12)

/** The path of a model's manifest below Ollama's models/manifests: `library/<name>/<tag>` for an official model, `<user>/<name>/<tag>` else. */
export const manifestPath = (name: string): string => {
    const [repo = "", tag = "latest"] = name.split(":")
    return `registry.ollama.ai/${repo.includes("/") ? repo : `library/${repo}`}/${tag}`
}

/** The env name the stack file reads the key's swarm name from. */
export const KEY_ENV = "STARCI_SERVICE_KEY_NAME"

/** Renders the stack of the selected components: `stack.yml` and every config file it mounts. `images` maps each component to its `repo:tag@digest`. */
export const renderService = (service: SharedService, selected: readonly string[], images: Readonly<Record<string, string>>, model: ChosenModel | null): ServiceRender => {
    const base: Record<string, string> = {
        stack: service.stack,
        network: service.network,
        "key.file": service.key.file,
        "app.alias": service.app.alias,
        ...(model === null ? {} : { "model.name": model.variant.name, "model.digest": model.variant.digest, "model.id": model.variant.digest.slice(0, 12), "model.manifest": manifestPath(model.variant.name) }),
    }
    const tokensOf = (component: ServiceComponent): Record<string, string> => ({ ...base, ...Object.fromEntries(Object.entries(component.retention).map(([key, value]) => [`retention.${key}`, String(value)])) })
    const header = `# Written by \`starci vps service up\` from ops/vps/services/${service.name}; a later edit is overwritten.\n`
    const files: Record<string, string> = {}
    const configs: Record<string, { file: string; name: string }> = {}
    const services: Record<string, unknown> = {}
    const volumes = new Set<string>()
    const networks = new Set<string>()
    let keyed = false
    for (const name of selected) {
        const component = service.components[name]
        if (component === undefined) throw new Refusal("VPS_SERVICE_COMPONENT", `${name} is no component of ${service.name}`)
        const tokens = tokensOf(component)
        const own = fillDeep(component.service ?? {}, tokens, `components.yaml ${name}.service`) as Record<string, unknown>
        if (/\$(?!\$)/.test(JSON.stringify(own).replaceAll("$$", ""))) throw new Refusal("OPS_INVALID", `components.yaml ${name}.service holds a single $; write $$ for a $ the container sees`)
        const mounts = Object.entries(component.configs ?? {}).map(([rel, target]) => {
            let text: string
            try {
                text = readFileSync(join(service.dir, rel), "utf8")
            } catch {
                throw new Refusal("OPS_INVALID", `the config ${rel} of ${service.name} is not in ${service.dir}`)
            }
            files[rel] = fill(text, tokens, rel)
            const key = rel.replaceAll(/[^a-z0-9]+/gi, "_").toLowerCase()
            configs[key] = { file: `./${rel}`, name: `${service.stack.replaceAll("-", "_")}_${key}_${hash(files[rel] ?? "")}` }
            return { source: key, target, mode: 0o444 }
        })
        for (const volume of Object.keys(component.volumes ?? {})) volumes.add(volume)
        for (const network of component.networks) networks.add(network)
        if (component.secret === true) keyed = true
        services[name] = {
            image: images[name],
            ...own,
            ...(component.volumes === undefined ? {} : { volumes: Object.entries(component.volumes).map(([volume, mount]) => `${volume}:${mount}`) }),
            ...(mounts.length > 0 ? { configs: mounts } : {}),
            ...(component.secret === true ? { secrets: [{ source: service.key.file, target: service.key.file, mode: 0o444 }] } : {}),
            networks: Object.fromEntries(component.networks.map((network) => [network, network === "shared" ? { aliases: [service.app.alias] } : {}])),
            dns_search: [...SWARM_DNS_SEARCH],
            deploy: {
                mode: "replicated",
                replicas: 1,
                placement: { constraints: ["node.role == manager"] },
                resources: { limits: { memory: component.resources.memory, cpus: component.resources.cpus }, reservations: { memory: component.resources.reserveMemory, cpus: component.resources.reserveCpus } },
                update_config: component.update,
                rollback_config: component.rollback,
                restart_policy: component.restart,
                labels: [`starci.shared-service=${service.name}`, ...(model === null || name !== "model" ? [] : [`starci.shared-service.model=${model.variant.name}@${model.variant.digest.slice(0, 12)}`])],
            },
        }
    }
    const networkSpec: Record<string, Record<string, unknown>> = { backend: { driver: "overlay" }, shared: { external: true, name: service.network } }
    const stack = {
        version: "3.8",
        services,
        networks: Object.fromEntries([...networks].sort((left, right) => left.localeCompare(right)).map((network) => [network, networkSpec[network]])),
        // A named volume keeps its data across a redeploy and a stack rm; it is named after the stack, never `<stack>_<volume>`.
        ...(volumes.size > 0 ? { volumes: Object.fromEntries([...volumes].sort((left, right) => left.localeCompare(right)).map((volume) => [volume, { name: `${service.stack}-${volume}` }])) } : {}),
        ...(Object.keys(configs).length > 0 ? { configs } : {}),
        ...(keyed ? { secrets: { [service.key.file]: { external: true, name: `\${${KEY_ENV}}` } } } : {}),
    }
    files["stack.yml"] = header + stringify(stack, { lineWidth: 0 })
    return { files, keyed }
}

/** The images of the selected components, pinned by contexts/stack/pins.yaml. */
export const serviceImages = (service: SharedService, selected: readonly string[], opsDir: string): Record<string, string> =>
    resolveImages(Object.fromEntries(selected.map((name) => [name, service.components[name]?.image ?? { image: "", pin: "" }])), opsDir)

/** The secret a service step reads from its environment: the gate's key. */
export const SERVICE_KEY = "SERVICE_KEY" as const

const noSwarm = (target: ServiceTarget): string => `[ "$(docker info --format '{{.Swarm.LocalNodeState}}')" = active ] || { echo "no swarm: run ${target.kind === "local" ? "docker swarm init" : "starci vps swarm init"} first" >&2; exit 7; }`

/**
 * `vps service up`: the shared network, the key as a swarm secret named by its hash, the files and the stack, deployed again only when a file or
 * the key changed. `base` is where the files go (/opt/starci/services/<name> on a server).
 */
export const serviceUpPlan = (service: SharedService, target: ServiceTarget, render: ServiceRender, budget: ServiceBudget, model: ChosenModel | null, base: string): VpsPlan => {
    const marker = "STARCI_EOF"
    const network = shellQuote(service.network)
    const stack = shellQuote(service.stack)
    const writes = Object.entries(render.files).map(([rel, content]) => {
        if (content.includes(marker)) throw new Refusal("VPS_PLAN_INVALID", `${rel} holds ${marker}`)
        const file = shellQuote(`${base}/${rel}`)
        return [`mkdir -p "$(dirname ${file})"`, `cat > ${file}.starci-new <<'${marker}'`, content.trimEnd(), marker, `if ! cmp -s ${file}.starci-new ${file}; then mv ${file}.starci-new ${file}; C=changed; else rm -f ${file}.starci-new; fi`].join("\n")
    })
    const prefix = `${service.stack.replaceAll("-", "_")}_key`
    const keyLines = render.keyed
        ? [
              `export ${KEY_ENV}="${prefix}_$(printf '%s' "$${SERVICE_KEY}" | sha256sum | cut -c1-12)"`,
              `if ! docker secret inspect "$${KEY_ENV}" >/dev/null 2>&1; then printf '%s' "$${SERVICE_KEY}" | docker secret create --label starci.shared-service=${service.name} "$${KEY_ENV}" - >/dev/null; C=changed; fi`,
          ]
        : []
    const name = target.kind === "local" ? "local" : target.server.id
    return {
        verb: `service up ${service.name}`,
        server: name,
        steps: [
            {
                id: "service-network",
                summary: `the attachable overlay network ${service.network} the opted-in app services join to call ${service.name}`,
                root: true,
                secrets: [],
                script: `${noSwarm(target)}\ndocker network inspect ${network} >/dev/null 2>&1 && { echo unchanged; exit 0; }\ndocker network create --driver overlay --attachable ${network} >/dev/null\necho changed`,
            },
            {
                id: "service-stack",
                summary: `the ${service.stack} stack: ${budget.rows.map((row) => row.component).join(", ")}${model === null ? "" : `, serving ${model.variant.name} (${model.variant.quantization}, manifest ${model.variant.digest.slice(0, 12)})`} (memory limits ${String(budget.memoryMb)} MB, reservations ${String(budget.reserveMb)} MB, CPU limits ${String(budget.cpus)}, reserved ${String(budget.reserveCpus)})`,
                root: true,
                secrets: render.keyed ? [SERVICE_KEY] : [],
                script: [
                    "C=unchanged",
                    `mkdir -p ${shellQuote(base)}; chmod 700 ${shellQuote(base)} 2>/dev/null || true`,
                    ...keyLines,
                    ...writes,
                    `docker stack ls --format '{{.Name}}' | grep -qx ${stack} || C=changed`,
                    // --prune removes a component turned off. Configs and secrets of an older hash stay, so a rollback finds them.
                    `if [ "$C" = changed ]; then docker stack deploy --quiet --prune -c ${shellQuote(`${base}/stack.yml`)} ${stack} >/dev/null; fi`,
                    'echo "$C"',
                ].join("\n"),
            },
        ],
        notes: [
            `memory budget: ${budget.rows.map((row) => `${row.component} ${String(row.memoryMb)}M`).join(", ")}; total limits ${String(budget.memoryMb)} MB (reservations ${String(budget.reserveMb)} MB); it holds about ${String(budget.needs.memoryMb)} MB once it serves and takes ${String(budget.needs.diskMb)} MB of disk`,
            ...(model === null ? [] : [`the model is ${model.variant.name}, ${model.variant.quantization}, ${String(model.variant.dimensions)} dimensions, manifest sha256 ${model.variant.digest}; the model service refuses to serve any other`]),
            ...(model?.reindex == null ? [] : [`FINDING (reindex acknowledged): ${model.variant.name} is not the catalog default; ${model.reindex}`]),
            `apps call ${service.app.url} on the network ${service.network} with \`Authorization: Bearer <${service.app.key}>\`; an environment opts in with \`environments.<env>.services.${service.name}\` and gets its copy of the key with \`starci vps service grant ${name === "local" ? "--local" : name} --service ${service.name} --app <path> --env <env> --execute\``,
        ],
    }
}

/** `vps service down`: removes the stack; the model volume, the network and the key's secret stay, so `up` again serves at once. */
export const serviceDownPlan = (service: SharedService, target: ServiceTarget): VpsPlan => ({
    verb: `service down ${service.name}`,
    server: target.kind === "local" ? "local" : target.server.id,
    steps: [
        {
            id: "service-stack-remove",
            summary: `remove the ${service.stack} stack (its volumes, the network ${service.network} and its key secrets stay)`,
            root: true,
            secrets: [],
            script: `docker stack ls --format '{{.Name}}' | grep -qx ${shellQuote(service.stack)} || { echo unchanged; exit 0; }\ndocker stack rm ${shellQuote(service.stack)} >/dev/null\necho changed`,
        },
    ],
    notes: [`the volumes ${Object.values(service.components).flatMap((component) => Object.keys(component.volumes ?? {})).map((volume) => `${service.stack}-${volume}`).join(", ") || "(none)"} keep their data; remove them with docker volume rm on the server when the service is retired`],
})

/** The read-only status script: the stack's services and tasks, the model's own start lines, and the network. */
export const serviceStatusScript = (service: SharedService): string =>
    [
        `if ! docker stack ls --format '{{.Name}}' | grep -qx ${shellQuote(service.stack)}; then echo "stack=absent"; exit 0; fi`,
        "echo stack=present",
        `docker stack services ${shellQuote(service.stack)} --format 'service {{.Name}} {{.Replicas}} {{.Image}}'`,
        `docker stack ps ${shellQuote(service.stack)} --filter desired-state=running --format 'task {{.Name}} {{.CurrentState}}' 2>/dev/null | head -n 10`,
        ...(service.components.model === undefined ? [] : [`docker service logs --raw --tail 200 ${shellQuote(`${service.stack}_model`)} 2>&1 | grep '^starci: ' | tail -n 3 | sed 's/^/model /' || true`]),
        `docker network inspect ${shellQuote(service.network)} >/dev/null 2>&1 && echo network=present || echo network=absent`,
    ].join("\n")

/** What the capacity probe measured on the target. */
export interface Measured {
    readonly totalMb: number
    readonly availableMb: number
    readonly cpus: number
    readonly diskFreeMb: number
    readonly stacks: readonly string[]
    readonly volumes: readonly string[]
}

/**
 * The read-only capacity probe: the memory, CPUs and free disk the box has, the same sources `vps list` reads (/proc/meminfo, nproc, df), and the
 * stacks and volumes that exist. On a server it reads the host; on the local swarm (Docker Desktop) the host is the Docker VM, read through a
 * throwaway container of `probeImage` with no network.
 */
export const capacityScript = (target: ServiceTarget, probeImage: string): string => {
    const facts = `awk '/^MemTotal:/{t=$2} /^MemAvailable:/{a=$2} END{print "mem.totalKb=" t; print "mem.availableKb=" a}' /proc/meminfo; df -Pk "$ROOT" | awk 'NR==2{print "disk.availKb=" $4}'`
    const host = target.kind === "local"
        ? `docker run --rm --network none --entrypoint sh ${shellQuote(probeImage)} -c ${shellQuote(facts.replace('"$ROOT"', "/"))}`
        : `ROOT=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker); ${facts}`
    return [
        host,
        `echo "cpu.count=$(docker info --format '{{.NCPU}}' 2>/dev/null || nproc)"`,
        `echo "stacks=$(docker stack ls --format '{{.Name}}' 2>/dev/null | paste -sd, -)"`,
        `echo "volumes=$(docker volume ls --format '{{.Name}}' 2>/dev/null | paste -sd, -)"`,
    ].join("\n")
}

/** Reads the capacity probe's output. */
export const readCapacity = (stdout: string): Measured => {
    const values = new Map<string, string>()
    for (const line of stdout.split(/\r?\n/)) {
        const at = line.indexOf("=")
        if (at > 0) values.set(line.slice(0, at).trim(), line.slice(at + 1).trim())
    }
    const number = (key: string): number => {
        const value = Number(values.get(key) ?? "")
        if (!Number.isFinite(value) || (values.get(key) ?? "") === "") throw new Refusal("VPS_SERVICE_CAPACITY_UNREAD", `the capacity probe printed no ${key}; nothing was changed`)
        return value
    }
    const list = (key: string): string[] => (values.get(key) ?? "").split(",").filter((item) => item !== "")
    return { totalMb: Math.floor(number("mem.totalKb") / 1024), availableMb: Math.floor(number("mem.availableKb") / 1024), cpus: number("cpu.count"), diskFreeMb: Math.floor(number("disk.availKb") / 1024), stacks: list("stacks"), volumes: list("volumes") }
}

/** Another shared stack that runs on the box: its name and what its limits and reservations hold. */
export interface RunningShared {
    readonly stack: string
    readonly memoryMb: number
    readonly reserveCpus: number
}

/** What capacity `vps service up` always leaves to the apps (ops/vps.yaml services.capacity). */
export interface Keep {
    readonly memoryMb: number
    readonly cpus: number
    readonly diskMb: number
}

/**
 * Judges whether the service fits: its memory limits beside the limits of the other shared stacks that run, within the box's memory less what is kept
 * for the apps; its resident need within the memory available now (unless it runs already); its CPU reservations beside theirs within the CPUs less
 * the kept ones; its images and model within the free disk (unless its volumes exist already). Returns the lines it printed, and refuses
 * VPS_SERVICE_CAPACITY naming every number when one does not fit.
 */
export const judgeCapacity = (service: SharedService, budget: ServiceBudget, measured: Measured, others: readonly RunningShared[], keep: Keep): string[] => {
    const running = measured.stacks.includes(service.stack)
    const volumes = Object.values(service.components).flatMap((component) => Object.keys(component.volumes ?? {})).map((volume) => `${service.stack}-${volume}`)
    const onDisk = volumes.length > 0 && volumes.every((volume) => measured.volumes.includes(volume))
    const otherMb = round(others.reduce((total, other) => total + other.memoryMb, 0))
    const otherCpus = round(others.reduce((total, other) => total + other.reserveCpus, 0))
    const roomMb = measured.totalMb - keep.memoryMb
    const checks = [
        { ok: budget.memoryMb + otherMb <= roomMb, line: `memory limits: ${service.name} ${String(budget.memoryMb)} MB + other shared stacks ${String(otherMb)} MB (${others.map((other) => other.stack).join(", ") || "none"}) against ${String(measured.totalMb)} MB less ${String(keep.memoryMb)} MB kept for the apps = ${String(roomMb)} MB` },
        ...(running ? [] : [{ ok: budget.needs.memoryMb <= measured.availableMb - keep.memoryMb, line: `memory now: ${service.name} holds ${String(budget.needs.memoryMb)} MB once it serves against ${String(measured.availableMb)} MB available less ${String(keep.memoryMb)} MB kept = ${String(measured.availableMb - keep.memoryMb)} MB` }]),
        { ok: budget.reserveCpus + otherCpus <= measured.cpus - keep.cpus, line: `CPU reservations: ${service.name} ${String(budget.reserveCpus)} + other shared stacks ${String(otherCpus)} against ${String(measured.cpus)} CPUs less ${String(keep.cpus)} kept = ${String(round(measured.cpus - keep.cpus))}` },
        ...(onDisk ? [] : [{ ok: budget.needs.diskMb <= measured.diskFreeMb - keep.diskMb, line: `disk: ${service.name} takes ${String(budget.needs.diskMb)} MB (images and model) against ${String(measured.diskFreeMb)} MB free less ${String(keep.diskMb)} MB kept = ${String(measured.diskFreeMb - keep.diskMb)} MB` }]),
    ]
    const lines = checks.map((check) => `  capacity ${check.ok ? "fits" : "DOES NOT FIT"}: ${check.line}`)
    const short = checks.filter((check) => !check.ok)
    if (short.length > 0) throw new Refusal("VPS_SERVICE_CAPACITY", `${service.name} does not fit this box; nothing was changed:\n${lines.join("\n")}`)
    return lines
}
