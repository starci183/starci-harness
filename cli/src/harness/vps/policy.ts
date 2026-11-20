import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal } from "../../shared/errors.js"
import { locateOps } from "../ops.js"

/** A server id: the file name of its inventory entry and the label of its DNS names. */
const ID = /^[a-z][a-z0-9-]{0,30}[a-z0-9]$/
/** A subdomain label, or a template of one that names `{id}`. */
const LABEL = /^(?:[a-z0-9-]|\{id\})+$/
const PORT_RULE = /^(?:\d{1,5}\/(?:tcp|udp)|ssh)$/

const imageRef = z.strictObject({ image: z.string().regex(/^[a-z0-9./-]+$/), pin: z.string().min(1) })
const family = z.enum(["debian", "rhel"])
const firewallKind = z.enum(["ufw", "firewalld", "csf"])
const ingressMode = z.enum(["tunnel", "edge"])

const policySchema = z.strictObject({
    schema: z.literal("starci/vps@1"),
    inventory: z.strictObject({ dir: z.string().min(1), example: z.string().regex(/\.yaml$/), cloudflare: z.string().regex(/\.enc\.yaml$/) }),
    ssh: z.strictObject({
        connectTimeoutSeconds: z.number().int().positive(),
        commandTimeoutSeconds: z.number().int().positive(),
        keyTypes: z.array(z.enum(["ed25519", "ecdsa", "rsa"])).min(1),
    }),
    osFamilies: z.record(z.string().regex(/^[a-z]+$/), family),
    bootstrap: z.strictObject({
        notClean: z.strictObject({ panels: z.record(z.string().regex(/^[a-z]+$/), z.string().regex(/^\/[A-Za-z0-9/_.-]+$/)), ports: z.array(z.number().int().min(1).max(65535)).min(1) }),
        opsUser: z.string().regex(/^[a-z_][a-z0-9_-]{0,31}$/),
        sshd: z.record(z.string().regex(/^[A-Za-z0-9]+$/), z.string().regex(/^[A-Za-z0-9-]+$/)),
        firewall: z.strictObject({ byFamily: z.record(family, firewallKind), openPorts: z.array(z.string().regex(PORT_RULE)).min(1) }),
        intrusion: z.strictObject({ maxRetry: z.number().int().positive(), findTimeMinutes: z.number().int().positive(), banTimeMinutes: z.number().int().positive() }),
        autoUpdates: z.boolean(),
    }),
    docker: z.strictObject({ pin: z.string().min(1), repository: z.record(family, z.url()) }),
    swarm: z.strictObject({ advertise: z.literal("host"), autolock: z.boolean(), network: z.string().regex(/^[a-z][a-z0-9-]*$/) }),
    edge: z.strictObject({ stack: z.string().regex(/^[a-z][a-z0-9-]*$/), proxy: imageRef, resolver: z.string().regex(/^[a-z][a-z0-9]*$/) }),
    monitor: z.strictObject({ stack: z.string().regex(/^[a-z][a-z0-9-]*$/), network: z.string().regex(/^[a-z][a-z0-9_-]*$/), components: z.string().regex(/\.yaml$/) }),
    // The catalog of opt-in shared services (ops/vps/services/<name>/components.yaml) and the room `vps service up` always leaves to the apps.
    services: z.strictObject({
        dir: z.string().min(1),
        capacity: z.strictObject({ keepMemory: z.string().regex(/^\d+(?:\.\d+)?[MG]$/), keepCpus: z.number().min(0), keepDisk: z.string().regex(/^\d+(?:\.\d+)?[MG]$/) }),
    }),
    ui: z.strictObject({ stack: z.string().regex(/^[a-z][a-z0-9-]*$/), server: imageRef, agent: imageRef, subdomain: z.string().regex(LABEL), port: z.number().int().min(1).max(65535) }),
    ingress: z.strictObject({
        domain: z.string().regex(/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/),
        defaultMode: ingressMode,
        tunnel: z.strictObject({ name: z.string().regex(/^(?:[a-z0-9-]|\{id\})+$/), connector: imageRef, sshSubdomain: z.string().regex(LABEL) }),
        tokenScopes: z.strictObject({ tunnel: z.array(z.string().min(1)).min(1), edge: z.array(z.string().min(1)).min(1) }),
        api: z.url(),
    }),
    grant: z.strictObject({
        userPrefix: z.string().regex(/^[a-z][a-z0-9-]*-$/),
        keyType: z.literal("ed25519"),
        groups: z.array(z.string().regex(/^[a-z_][a-z0-9_-]*$/)),
        member: z.string().regex(/^[a-z][a-z0-9-]*$/),
    }),
    health: z.strictObject({
        failedLoginsHours: z.number().int().positive(),
        failedLoginsAlert: z.number().int().positive(),
        diskAlertPercent: z.number().int().min(1).max(100),
        memoryAlertPercent: z.number().int().min(1).max(100),
    }),
})

/** ops/vps.yaml, validated: the managed-VPS policy (no host, no secret). */
export type VpsPolicy = z.infer<typeof policySchema>
/** An OS family a server belongs to. */
export type OsFamily = z.infer<typeof family>
/** A firewall a server runs. */
export type FirewallKind = z.infer<typeof firewallKind>
/** How a server is reached under the owner's domain. */
export type IngressMode = z.infer<typeof ingressMode>

/** A host: an IPv4 or IPv6 address, or a DNS name. */
const HOST = /^(?:(?:\d{1,3}\.){3}\d{1,3}|[0-9a-fA-F:]+|[a-z0-9-]+(?:\.[a-z0-9-]+)+)$/

const serverSchema = z.strictObject({
    schema: z.literal("starci/vps-server@1"),
    id: z.string().regex(ID, "an id is lower-case letters, digits and dashes, 2 to 32 long"),
    host: z.string().regex(HOST, "a host is an IP address or a DNS name"),
    sshPort: z.number().int().min(1).max(65535),
    os: z.string().regex(/^[a-z]+$/),
    provider: z.string().min(1),
    panel: z.strictObject({ kind: z.enum(["none", "cpanel", "directadmin", "cyberpanel", "aapanel", "plesk", "other"]), url: z.url().nullable() }),
    swarm: z.strictObject({ role: z.enum(["manager", "worker", "none"]) }),
    projects: z.array(z.string().regex(/^[a-z0-9][a-z0-9._-]*$/)),
    ingress: z.strictObject({ mode: ingressMode }).optional(),
    firewall: firewallKind.optional(),
    // The monitoring components this server turns on or off against their defaults (ops/vps/monitor/components.yaml).
    monitor: z.strictObject({ components: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), z.boolean()) }).optional(),
    // Choices for the shared services this server runs (ops/vps/services/<name>/components.yaml): component toggles and, by explicit choice only, a model variant.
    services: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), z.strictObject({ components: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), z.boolean()).optional(), model: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/).optional() })).optional(),
})

/** One server of the inventory (its `<id>.yaml`), validated. */
export type VpsServer = z.infer<typeof serverSchema>

/** A loaded server with the facts the policy derives for it. */
export interface ManagedServer extends VpsServer {
    readonly family: OsFamily
    readonly firewallKind: FirewallKind
    readonly ingressMode: IngressMode
    /** The sealed file of its keys, present or not. */
    readonly sealedFile: string
}

const readYaml = (file: string): unknown => {
    try {
        return parse(readFileSync(file, "utf8"))
    } catch (error: unknown) {
        throw new Refusal("OPS_INVALID", `${file} is not readable yaml: ${error instanceof Error ? error.message : String(error)}`)
    }
}

/** Loads and validates ops/vps.yaml from the ops folder (STARCI_OPS_DIR honoured). */
export const loadVpsPolicy = (dir: string = locateOps()): VpsPolicy => {
    const file = join(dir, "vps.yaml")
    const parsed = policySchema.safeParse(readYaml(file))
    if (!parsed.success) throw new Refusal("OPS_INVALID", `${file} is invalid: ${z.prettifyError(parsed.error)}`)
    // byFamily and repository are records over the family enum, so the schema already holds one entry per family.
    return parsed.data
}

/** The inventory folder of the policy, absolute. */
export const inventoryDir = (policy: VpsPolicy, opsDir: string = locateOps()): string => join(opsDir, policy.inventory.dir)

/** The sealed Cloudflare token file of the policy, absolute. */
export const cloudflareFile = (policy: VpsPolicy, opsDir: string = locateOps()): string => join(opsDir, policy.inventory.cloudflare)

/** Fills `{id}` of a policy template with a server id. */
export const forServer = (template: string, id: string): string => template.replaceAll("{id}", id)

/** Validates one server document against the policy; `file` names it in a refusal. */
export const parseServer = (policy: VpsPolicy, raw: unknown, file: string, dir: string): ManagedServer => {
    const parsed = serverSchema.safeParse(raw)
    if (!parsed.success) throw new Refusal("VPS_SERVER_INVALID", `${file} is invalid: ${z.prettifyError(parsed.error)}`)
    const server = parsed.data
    const expected = file.replace(/^.*[\\/]/, "").replace(/\.yaml$/, "")
    if (expected !== server.id) throw new Refusal("VPS_SERVER_INVALID", `${file} declares id ${server.id}; a server file is named after its id`)
    const osFamily = policy.osFamilies[server.os]
    if (osFamily === undefined) throw new Refusal("VPS_SERVER_INVALID", `${file}: os ${server.os} is no OS ops/vps.yaml osFamilies knows (${Object.keys(policy.osFamilies).join(", ")})`)
    return { ...server, family: osFamily, firewallKind: server.firewall ?? policy.bootstrap.firewall.byFamily[osFamily], ingressMode: server.ingress?.mode ?? policy.ingress.defaultMode, sealedFile: join(dir, `${server.id}.enc.yaml`) }
}

/** The ids of the inventory: every `<id>.yaml` of its folder but the example and the sealed files. */
export const serverIds = (policy: VpsPolicy, dir: string): string[] => {
    if (!existsSync(dir)) return []
    return readdirSync(dir)
        .filter((name) => name.endsWith(".yaml") && !name.endsWith(".enc.yaml") && name !== policy.inventory.example)
        .map((name) => name.slice(0, -".yaml".length))
        .sort((left, right) => left.localeCompare(right))
}

/** Loads one server of the inventory; an unknown id is refused naming the known ones. */
export const loadServer = (policy: VpsPolicy, id: string, dir: string = inventoryDir(policy)): ManagedServer => {
    if (!ID.test(id)) throw new Refusal("VPS_SERVER_UNKNOWN", `${id} is no server id (lower-case letters, digits and dashes)`)
    const file = join(dir, `${id}.yaml`)
    if (`${id}.yaml` === policy.inventory.example) throw new Refusal("VPS_SERVER_UNKNOWN", `${id} is the placeholder example of ${dir}, no server`)
    if (!existsSync(file)) {
        const known = serverIds(policy, dir)
        throw new Refusal("VPS_SERVER_UNKNOWN", `no server ${id} in ${dir}${known.length === 0 ? " (the inventory is empty: `starci vps add <id>` adds one)" : `; the servers are ${known.join(", ")}`}`)
    }
    return parseServer(policy, readYaml(file), file, dir)
}

/** Loads every server of the inventory. */
export const loadInventory = (policy: VpsPolicy, dir: string = inventoryDir(policy)): ManagedServer[] => serverIds(policy, dir).map((id) => loadServer(policy, id, dir))

const pinsSchema = z.looseObject({
    images: z.record(z.string(), z.looseObject({ version: z.string().min(1) })),
    hosts: z.record(z.string(), z.looseObject({ version: z.string().min(1) })).optional(),
})

/** The versions the policy takes from contexts/stack/pins.yaml: every image by `repo:tag@digest`, the docker engine by version. */
export interface VpsPins {
    readonly docker: string
    readonly uiServer: string
    readonly uiAgent: string
    readonly connector: string
    readonly edge: string
}

/** contexts/stack/pins.yaml beside the ops folder. */
const pinsFile = (opsDir: string): string => join(dirname(opsDir), "contexts", "stack", "pins.yaml")

/** Resolves image refs of a policy file by contexts/stack/pins.yaml: each as `repo:tag@digest`; a pin without a digest, or one the file lacks, is refused by name. */
export const resolveImages = <K extends string>(refs: Readonly<Record<K, { readonly image: string; readonly pin: string }>>, opsDir: string = locateOps()): Record<K, string> => {
    const file = pinsFile(opsDir)
    const parsed = pinsSchema.safeParse(readYaml(file))
    if (!parsed.success) throw new Refusal("OPS_INVALID", `${file} is not in the shape ops/vps.yaml reads: ${z.prettifyError(parsed.error)}`)
    const out = {} as Record<K, string>
    for (const [key, ref] of Object.entries(refs) as [K, { readonly image: string; readonly pin: string }][]) {
        const version = parsed.data.images[ref.pin]?.version
        if (version === undefined) throw new Refusal("OPS_INVALID", `the image pin ${ref.pin} of ${key} is not in ${file} images`)
        if (!/@sha256:[0-9a-f]{64}$/.test(version)) throw new Refusal("OPS_INVALID", `${file} images.${ref.pin} is pinned without a digest; a managed server runs digests only`)
        out[key] = `${ref.image}:${version}`
    }
    return out
}

/** Resolves the policy's pins; an image pinned without a digest, or a pin the file lacks, is refused by name. */
export const resolvePins = (policy: VpsPolicy, opsDir: string = locateOps()): VpsPins => {
    const file = pinsFile(opsDir)
    const parsed = pinsSchema.safeParse(readYaml(file))
    if (!parsed.success) throw new Refusal("OPS_INVALID", `${file} is not in the shape ops/vps.yaml reads: ${z.prettifyError(parsed.error)}`)
    const image = (ref: { readonly image: string; readonly pin: string }): string => {
        const version = parsed.data.images[ref.pin]?.version
        if (version === undefined) throw new Refusal("OPS_INVALID", `ops/vps.yaml names image pin ${ref.pin}, which ${file} images lacks`)
        if (!/@sha256:[0-9a-f]{64}$/.test(version)) throw new Refusal("OPS_INVALID", `${file} images.${ref.pin} is pinned without a digest; a managed server runs digests only`)
        return `${ref.image}:${version}`
    }
    const docker = parsed.data.hosts?.[policy.docker.pin]?.version
    if (docker === undefined || !/^\d+\.\d+\.\d+$/.test(docker)) throw new Refusal("OPS_INVALID", `ops/vps.yaml names docker pin ${policy.docker.pin}, which ${file} hosts lacks as an exact x.y.z version`)
    return { docker, uiServer: image(policy.ui.server), uiAgent: image(policy.ui.agent), connector: image(policy.ingress.tunnel.connector), edge: image(policy.edge.proxy) }
}
