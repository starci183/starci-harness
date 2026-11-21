import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal, UsageError } from "../shared/errors.js"
import { locateOps } from "./ops.js"
import { resolveImages } from "./vps/policy.js"

/**
 * The host roles of ops/host-roles.yaml: what a machine can host (contexts/harness/host.md "Roles"). A machine lists one or more roles in
 * the local config.yaml (harness/machines.ts) and may toggle single services; `host up|status|doctor --host <name>` work on the union of the
 * services its roles turn on. This module only reads the generic catalog and computes that union; it reaches no machine.
 */

const NAME = /^[a-z][a-z0-9-]*$/
/** A service id: `<role>.<service>`. */
export const SERVICE_ID = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/

const imageSchema = z.union([z.strictObject({ image: z.string().regex(/^[a-z0-9./-]+$/), pin: z.string().min(1) }), z.strictObject({ ref: z.string().regex(/^[a-z0-9./:-]+@sha256:[0-9a-f]{64}$/, "a ref is pinned by digest") })])

const probeSchema = z.discriminatedUnion("kind", [
    z.strictObject({
        kind: z.literal("http"),
        url: z.url(),
        status: z.number().int().min(100).max(599).default(200),
        // On a server the GET runs in a throwaway container on this network; on `local` it runs from this process.
        network: z.string().regex(/^[a-z][a-z0-9_-]*$/).optional(),
        json: z.strictObject({ path: z.string().min(1), equals: z.union([z.string(), z.number(), z.boolean()]) }).optional(),
    }),
    z.strictObject({ kind: z.literal("embed") }),
    z.strictObject({ kind: z.literal("hook"), name: z.string().regex(NAME) }),
    z.strictObject({ kind: z.literal("host") }),
    z.strictObject({ kind: z.literal("replicas") }),
])

const common = {
    kind: z.enum(["swarm-stack", "host-compose"]),
    stack: z.string().regex(NAME),
    match: z.array(z.string().regex(/^[a-z0-9./-]+$/)).default([]),
    images: z.array(imageSchema),
    limits: z.strictObject({ memory: z.string().regex(/^\d+(?:\.\d+)?[MG]$/), cpus: z.string().regex(/^\d+\.\d+$/) }).nullable(),
    secrets: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/)),
    network: z.string().regex(/^[a-z][a-z0-9_-]*$/).nullable(),
    endpoint: z.url().optional(),
    probe: probeSchema,
    waitSeconds: z.number().int().positive().optional(),
}

const placementSchema = z.discriminatedUnion("via", [
    z.strictObject({ ...common, via: z.literal("host-stack"), ids: z.array(z.string().regex(NAME)).min(1) }),
    z.strictObject({ ...common, via: z.literal("vps-service"), name: z.string().regex(NAME) }),
    z.strictObject({ ...common, via: z.literal("vps-monitor"), components: z.array(z.string().regex(NAME)).min(1) }),
    z.strictObject({ ...common, via: z.literal("vps-ui") }),
    z.strictObject({ ...common, via: z.literal("vps-edge") }),
    z.strictObject({ ...common, via: z.literal("host-compose"), project: z.string().regex(NAME), dir: z.string().min(1) }),
])

const modelSchema = z.strictObject({
    name: z.string().regex(/^[a-z0-9][a-z0-9._-]*:[a-z0-9._-]+$/),
    digest: z.string().regex(/^[0-9a-f]{64}$/, "the model is pinned by its full manifest sha256"),
    quantization: z.string().min(1),
    dimensions: z.number().int().positive(),
    probeText: z.string().min(1),
    minCosine: z.number().min(0).max(1),
})

const serviceSchema = z.strictObject({
    summary: z.string().min(1),
    default: z.boolean(),
    model: modelSchema.optional(),
    on: z.strictObject({ local: placementSchema.optional(), remote: placementSchema.optional() }).refine((on) => on.local !== undefined || on.remote !== undefined, "a service runs somewhere: on.local, on.remote or both"),
})

const roleSchema = z.strictObject({
    summary: z.string().min(1),
    engine: z.enum(["swarm", "k3s"]).optional(),
    engines: z.record(z.enum(["swarm", "k3s"]), z.enum(["built", "declared"])).optional(),
    services: z.record(z.string().regex(NAME), serviceSchema),
})

const catalogSchema = z
    .strictObject({
        schema: z.literal("starci/host-roles@1"),
        waitSeconds: z.number().int().positive(),
        roles: z.record(z.string().regex(NAME), roleSchema),
        local: z.strictObject({ roles: z.array(z.string().regex(NAME)).min(1), services: z.record(z.string().regex(SERVICE_ID), z.boolean()).default({}) }),
    })
    .superRefine((catalog, issues) => {
        for (const [name, role] of Object.entries(catalog.roles)) {
            if (role.engine !== undefined && role.engines?.[role.engine] !== "built") issues.addIssue({ code: "custom", message: `role ${name} runs on engine ${role.engine}, which its engines do not mark built` })
        }
        for (const role of catalog.local.roles) if (catalog.roles[role] === undefined) issues.addIssue({ code: "custom", message: `local names the role ${role}, which is no role` })
        for (const id of Object.keys(catalog.local.services)) if (serviceOf(catalog.roles, id) === undefined) issues.addIssue({ code: "custom", message: `local toggles ${id}, which is no service` })
    })

/** ops/host-roles.yaml, validated. */
export type HostRoles = z.infer<typeof catalogSchema>
/** One role of the catalog. */
export type HostRole = z.infer<typeof roleSchema>
/** One service of a role. */
export type RoleService = z.infer<typeof serviceSchema>
/** How a service runs on one kind of machine. */
export type Placement = z.infer<typeof placementSchema>
/** The real call `host doctor` makes for a placement. */
export type PlacementProbe = z.infer<typeof probeSchema>
/** A pinned model a service serves. */
export type ServedModel = z.infer<typeof modelSchema>

function serviceOf(roles: Readonly<Record<string, HostRole>>, id: string): RoleService | undefined {
    const [role, service] = id.split(".")
    return role === undefined || service === undefined ? undefined : roles[role]?.services[service]
}

/** Loads and validates ops/host-roles.yaml (STARCI_OPS_DIR honoured). */
export const loadHostRoles = (dir: string = locateOps()): HostRoles => {
    const file = join(dir, "host-roles.yaml")
    let raw: unknown
    try {
        raw = parse(readFileSync(file, "utf8"))
    } catch (error: unknown) {
        throw new Refusal("OPS_INVALID", `${file} is not readable yaml: ${error instanceof Error ? error.message : String(error)}`)
    }
    const parsed = catalogSchema.safeParse(raw)
    if (!parsed.success) throw new Refusal("OPS_INVALID", `${file} is invalid: ${z.prettifyError(parsed.error)}`)
    return parsed.data
}

/** Every service id of the catalog, in file order. */
export const serviceIds = (catalog: HostRoles): string[] => Object.entries(catalog.roles).flatMap(([role, entry]) => Object.keys(entry.services).map((service) => `${role}.${service}`))

/** One service of the catalog by id; an unknown id is refused naming the catalog's. */
export const roleService = (catalog: HostRoles, id: string): RoleService => {
    const found = serviceOf(catalog.roles, id)
    if (found === undefined) throw new Refusal("HOST_SERVICE_UNKNOWN", `${id} is no service of ops/host-roles.yaml; the services are ${serviceIds(catalog).join(", ")}`)
    return found
}

/** A service id as an app or a flag may write it: `<role>.<service>`, or a bare service name the catalog holds once (`embed`). */
export const canonicalService = (catalog: HostRoles, name: string): string => {
    if (SERVICE_ID.test(name)) {
        roleService(catalog, name)
        return name
    }
    const matches = serviceIds(catalog).filter((id) => id.endsWith(`.${name}`))
    if (matches.length !== 1) throw new Refusal("HOST_SERVICE_UNKNOWN", matches.length === 0 ? `${name} is no service of ops/host-roles.yaml; the services are ${serviceIds(catalog).join(", ")}` : `${name} names several services (${matches.join(", ")}); write <role>.<service>`)
    return matches[0] ?? name
}

/** What a machine's entry says about roles: the roles it lists and the services it turns on or off against their role's default. */
export interface RoleChoice {
    readonly roles: readonly string[]
    readonly services: Readonly<Record<string, boolean>>
}

/** Refuses a choice that names an unknown role or service, or lists no role at all ("tối thiểu 1 cái"). */
export const validateChoice = (catalog: HostRoles, choice: RoleChoice): void => {
    if (choice.roles.length === 0) throw new Refusal("HOST_ROLES_EMPTY", "a machine hosts at least one role (app-host, starci, monitor, edge, ...)")
    const unknown = choice.roles.filter((role) => catalog.roles[role] === undefined)
    if (unknown.length > 0) throw new Refusal("HOST_ROLE_UNKNOWN", `${unknown.join(", ")} is no role of ops/host-roles.yaml; the roles are ${Object.keys(catalog.roles).join(", ")}`)
    for (const id of Object.keys(choice.services)) roleService(catalog, id)
}

/** The services a machine hosts: each default-on service of its roles, plus the ones it turns on, minus the ones it turns off; in catalog order. */
export const machineServices = (catalog: HostRoles, choice: RoleChoice): string[] =>
    serviceIds(catalog).filter((id) => {
        const toggled = choice.services[id]
        if (toggled !== undefined) return toggled
        const role = id.split(".")[0] ?? ""
        return choice.roles.includes(role) && roleService(catalog, id).default
    })

/**
 * Applies a `--roles` expression to a choice. Plain names replace the role list (`app-host,starci`); `+role` and `-role` add and remove a role;
 * `+role.service` and `-role.service` turn one service on or off against its role's default, beside either. Mixing a plain role list with +/- roles is refused.
 */
export const applyRoles = (catalog: HostRoles, current: RoleChoice | undefined, expression: string): RoleChoice => {
    const parts = expression.split(",").map((part) => part.trim()).filter((part) => part !== "")
    if (parts.length === 0) throw new UsageError("--roles takes a comma list: app-host,starci,monitor,edge or +starci.sonar,-starci.embed")
    const plain = parts.filter((part) => !part.includes(".") && !part.startsWith("+") && !part.startsWith("-"))
    const signedRoles = parts.filter((part) => !part.includes(".") && (part.startsWith("+") || part.startsWith("-")))
    if (plain.length > 0 && signedRoles.length > 0) throw new UsageError(`--roles ${expression} mixes a plain list of roles with +/- roles; write one or the other`)
    // A plain list replaces the roles; +/- roles change them. Service toggles (+role.service, -role.service) go with either.
    let roles = plain.length > 0 ? [] : [...(current?.roles ?? [])]
    let services: Record<string, boolean> = { ...(current?.services ?? {}) }
    // Roles first, so a service toggle is judged against the roles the expression leaves.
    for (const part of parts.filter((one) => !one.includes("."))) {
        const name = part.replace(/^[+-]/, "")
        if (part.startsWith("-")) roles = roles.filter((role) => role !== name)
        else {
            if (catalog.roles[name] === undefined) throw new Refusal("HOST_ROLE_UNKNOWN", `${name} is no role of ops/host-roles.yaml; the roles are ${Object.keys(catalog.roles).join(", ")}`)
            if (!roles.includes(name)) roles = [...roles, name]
        }
    }
    for (const part of parts.filter((one) => one.includes("."))) {
        const id = canonicalService(catalog, part.replace(/^[+-]/, ""))
        const on = !part.startsWith("-")
        const fallback = roles.includes(id.split(".")[0] ?? "") && roleService(catalog, id).default
        // A toggle equal to what the roles give anyway is not stored, so the entry says only what differs.
        services = on === fallback ? Object.fromEntries(Object.entries(services).filter(([key]) => key !== id)) : { ...services, [id]: on }
    }
    const choice = { roles, services }
    validateChoice(catalog, choice)
    return choice
}

/** Where a machine runs: this harness host, or a managed server. */
export type Site = "local" | "remote"

/** The placement of a service on a site, or undefined when it does not run there. */
export const placementOf = (catalog: HostRoles, id: string, site: Site): Placement | undefined => roleService(catalog, id).on[site]

/** The images of a placement as `repo:tag@digest`, pins resolved by contexts/stack/pins.yaml. */
export const placementImages = (placement: Placement, opsDir: string = locateOps()): string[] => {
    const pinned = Object.fromEntries(placement.images.flatMap((image, index) => ("pin" in image ? [[String(index), image]] : [])))
    const resolved = resolveImages(pinned, opsDir)
    return placement.images.map((image, index) => ("ref" in image ? image.ref : (resolved[String(index)] ?? "")))
}

/** The repository of an image ref (`grafana/grafana:13.3.0@sha256:...` is `grafana/grafana`; a docker.io/library prefix is dropped). */
export const imageRepository = (ref: string): string => {
    const bare = ref.split("@")[0] ?? ref
    const slash = bare.lastIndexOf("/")
    const colon = bare.lastIndexOf(":")
    const repo = colon > slash ? bare.slice(0, colon) : bare
    return repo.replace(/^docker\.io\//, "").replace(/^library\//, "")
}

/** The digest of an image ref, or null when it carries none. */
export const imageDigest = (ref: string): string | null => /@(sha256:[0-9a-f]{64})/.exec(ref)?.[1] ?? null
