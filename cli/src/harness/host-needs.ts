import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { parse } from "yaml"
import { Refusal } from "../shared/errors.js"
import { canonicalService, loadHostRoles, machineServices } from "./host-roles.js"
import type { HostRoles } from "./host-roles.js"
import { allMachines, LOCAL, readMachines } from "./machines.js"
import type { Machine, MachinesRead } from "./machines.js"
import { locateOps } from "./ops.js"

/**
 * The host services an app environment needs (contexts/harness/host.md "What an app needs"), declared in its
 * `.starcistacks/application-stacks.yaml` as `environments.<env>.hostServices`:
 *
 *   hostServices:
 *     machine: sv-hk-1                # optional; else the server its deploy.remote.serverRecipient belongs to (ops/vps/recipients.yaml), else local
 *     needs:
 *       starci.embed: [local, sv-hk-1]  # the machines that may serve it, in the order the app tries them; [] is the target machine alone
 *
 * `app check --env prod` and `app stack deploy` refuse HOST_SERVICE_MISSING when no machine of a need's list (resolved through this host's
 * config.yaml) hosts the service, HOST_ROLE_MISSING when a server target lacks the app-host role ("an app env must land on a machine with
 * app-host"), and HOST_MACHINE_UNKNOWN when config.yaml does not know the target. A host with no config.yaml at all (a CI runner) does not
 * judge: the machines are this host's, never the repository's, so the run says it was not judged and goes on.
 */

/** One environment's declaration, read. */
export interface HostNeeds {
    readonly env: string
    readonly machine: string | null
    readonly serverRecipient: string | null
    readonly needs: Readonly<Record<string, readonly string[]>>
}

// reason: the declaration is parsed YAML, judged here
type Parsed = Record<string, unknown>

const asRecord = (value: unknown): Parsed => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Parsed) : {})

/** The application-stacks.yaml of the app at or above `cwd`, or undefined when there is none. */
export const stacksFileOf = (cwd: string): string | undefined => {
    for (let dir = cwd; ; dir = dirname(dir)) {
        const file = join(dir, ".starcistacks", "application-stacks.yaml")
        if (existsSync(file)) return file
        if (dirname(dir) === dir) return undefined
    }
}

/** Every environment's `hostServices` declaration (the ones that declare none are left out); a malformed one is refused HOST_NEEDS_INVALID. */
export const readHostNeeds = (text: string, file: string): HostNeeds[] => {
    let raw: unknown
    try {
        raw = parse(text)
    } catch (error: unknown) {
        throw new Refusal("HOST_NEEDS_INVALID", `${file} is not readable yaml: ${error instanceof Error ? error.message : String(error)}`)
    }
    const environments = asRecord(asRecord(raw).environments)
    return Object.entries(environments).flatMap(([env, value]) => {
        const block = asRecord(value).hostServices
        if (block === undefined || block === null) return []
        const declared = asRecord(block)
        const problems: string[] = []
        for (const key of Object.keys(declared)) if (key !== "machine" && key !== "needs") problems.push(`${key} is not a field (machine, needs)`)
        const machine = typeof declared.machine === "string" ? declared.machine : null
        if (declared.machine !== undefined && machine === null) problems.push("machine is a machine name")
        const needs: Record<string, string[]> = {}
        for (const [service, list] of Object.entries(asRecord(declared.needs))) {
            if (list === null || list === undefined) needs[service] = []
            else if (Array.isArray(list) && list.every((entry) => typeof entry === "string")) needs[service] = list
            else problems.push(`needs.${service} is a list of machine names`)
        }
        if (Object.keys(needs).length === 0) problems.push("needs names no service")
        if (problems.length > 0) throw new Refusal("HOST_NEEDS_INVALID", `${file} environments.${env}.hostServices: ${problems.join("; ")}`)
        const recipient = asRecord(asRecord(asRecord(value).deploy).remote).serverRecipient
        return [{ env, machine, serverRecipient: typeof recipient === "string" ? recipient : null, needs }]
    })
}

/** The server id whose key a recipient is, by ops/vps/recipients.yaml `servers.<id>.server`; null when none is. */
export const serverOfRecipient = (recipient: string, opsDir: string = locateOps()): string | null => {
    const file = join(opsDir, "vps", "recipients.yaml")
    if (!existsSync(file)) return null
    const servers = asRecord(asRecord(parse(readFileSync(file, "utf8"))).servers)
    return Object.entries(servers).find(([, entry]) => asRecord(entry).server === recipient)?.[0] ?? null
}

/** The machine an environment lands on: its declared machine, the server of its recipient, else this host. */
export const targetOf = (needs: HostNeeds, opsDir: string = locateOps()): string => needs.machine ?? (needs.serverRecipient === null ? null : serverOfRecipient(needs.serverRecipient, opsDir)) ?? LOCAL

/** One environment's verdict. */
export interface NeedsVerdict {
    readonly env: string
    readonly target: string
    readonly state: "ok" | "unjudged" | "refused"
    readonly code: "HOST_SERVICE_MISSING" | "HOST_ROLE_MISSING" | "HOST_MACHINE_UNKNOWN" | null
    /** Each need, with the machine that serves it (the first of its list that hosts it), or null. */
    readonly served: Readonly<Record<string, string | null>>
    readonly detail: string
}

/** Judges one environment against the machines of config.yaml. */
export const judgeNeeds = (catalog: HostRoles, read: MachinesRead, needs: HostNeeds, target: string): NeedsVerdict => {
    if (!read.exists) return { env: needs.env, target, state: "unjudged", code: null, served: {}, detail: `not judged: this host has no config.yaml (${read.file}); the machines live on the owner's host, never in the repository` }
    const machines: Readonly<Record<string, Machine>> = allMachines(read, catalog.local)
    const landing = machines[target]
    if (landing === undefined) return { env: needs.env, target, state: "refused", code: "HOST_MACHINE_UNKNOWN", served: {}, detail: `environments.${needs.env} lands on ${target}, which config.yaml does not hold: starci vps add ${target} --host <addr> --user <user> --roles app-host,...` }
    if (target !== LOCAL && !landing.roles.includes("app-host")) return { env: needs.env, target, state: "refused", code: "HOST_ROLE_MISSING", served: {}, detail: `environments.${needs.env} lands on ${target}, whose roles (${landing.roles.join(", ")}) do not include app-host: starci vps set ${target} --roles +app-host` }
    const served: Record<string, string | null> = {}
    const missing: string[] = []
    for (const [name, list] of Object.entries(needs.needs)) {
        const id = canonicalService(catalog, name)
        const candidates = list.length === 0 ? [target] : list
        const by = candidates.find((candidate) => {
            const machine = machines[candidate]
            return machine !== undefined && machineServices(catalog, machine).includes(id)
        })
        served[id] = by ?? null
        if (by === undefined) missing.push(`${id} (none of ${candidates.join(", ")} hosts it: starci vps set ${candidates[0] ?? target} --roles +${id}, then starci host up --host ${candidates[0] ?? target} --execute)`)
    }
    if (missing.length > 0) return { env: needs.env, target, state: "refused", code: "HOST_SERVICE_MISSING", served, detail: `environments.${needs.env} on ${target} needs ${missing.join("; ")}` }
    return { env: needs.env, target, state: "ok", code: null, served, detail: Object.entries(served).map(([id, by]) => `${id} by ${String(by)}`).join(", ") }
}

/**
 * This host's config.yaml as read, or, on a host with no harness home at all (a CI runner running the app's published CLI: HOST_STATE_NOT_FOUND),
 * an absent one, so the verdict is `unjudged` instead of a refusal of the verb that asked.
 */
const hostMachines = (): MachinesRead => {
    try {
        return readMachines()
    } catch (error: unknown) {
        if (error instanceof Refusal && error.code === "HOST_STATE_NOT_FOUND") return { file: "no config.yaml: this host has no harness home", exists: false, doc: { schema: "starci/machines@1", machines: {} } }
        throw error
    }
}

/**
 * Judges the app at `cwd`: every environment that declares hostServices (or only `env`), and refuses with the first refused verdict's code naming
 * every refused environment. Returns the verdicts when nothing is refused (an app that declares nothing judges nothing). config.yaml and the ops
 * catalog are read only once an environment declares something, and a host without either (a CI runner) judges nothing: `stack deploy` on a
 * runner refused HOST_STATE_NOT_FOUND before it started, for an app that declares no hostServices.
 */
export const requireHostServices = (cwd: string, env?: string, read?: MachinesRead, opsDir?: string): NeedsVerdict[] => {
    const file = stacksFileOf(cwd)
    if (file === undefined) return []
    const declared = readHostNeeds(readFileSync(file, "utf8"), file).filter((needs) => env === undefined || needs.env === env)
    if (declared.length === 0) return []
    const machines = read ?? hostMachines()
    if (!machines.exists) return declared.map((needs) => ({ env: needs.env, target: needs.machine ?? LOCAL, state: "unjudged", code: null, served: {}, detail: `not judged: this host has no config.yaml (${machines.file}); the machines live on the owner's host, never in the repository` }))
    const ops = opsDir ?? locateOps()
    const catalog = loadHostRoles(ops)
    const verdicts = declared.map((needs) => judgeNeeds(catalog, machines, needs, targetOf(needs, ops)))
    const refused = verdicts.filter((verdict) => verdict.state === "refused")
    const first = refused[0]
    if (first?.code != null) throw new Refusal(first.code, refused.map((verdict) => verdict.detail).join("; "))
    return verdicts
}
