import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"
import type { DevSyncSettings } from "../../harness/local-settings.js"

/**
 * The native processes a dev environment of an app declares (`environments.<env>.local.processes` of its .starcistacks/application-stacks.yaml), with
 * the side each runs (its `cwd` under be/ or fe/) and the port it listens on (a name of `local.ports`, or a number). A sync restarts the processes the
 * app declares, never names the harness assumed: one app's are `api` and `web`, another's `core`, `app`, `landing`.
 */
export interface DeclaredProcess {
    readonly name: string
    readonly side: "be" | "fe" | "both"
    readonly port?: number
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** The processes the checkout's `env` declares, or undefined when the declaration cannot be read or declares none. */
export const declaredProcesses = (root: string, env: string): DeclaredProcess[] | undefined => {
    let doc: unknown
    try {
        doc = parse(readFileSync(join(root, ".starcistacks", "application-stacks.yaml"), "utf8"))
    } catch {
        return undefined
    }
    return declaredOf(doc, env)
}

/** `declaredProcesses` over a parsed declaration. Pure. */
export const declaredOf = (doc: unknown, env: string): DeclaredProcess[] | undefined => {
    const environments = isRecord(doc) ? doc.environments : undefined
    const local = isRecord(environments) && isRecord(environments[env]) ? environments[env].local : undefined
    if (!isRecord(local) || !Array.isArray(local.processes)) return undefined
    const ports = isRecord(local.ports) ? local.ports : {}
    const found: DeclaredProcess[] = []
    for (const entry of local.processes) {
        if (!isRecord(entry) || typeof entry.name !== "string") continue
        const cwd = typeof entry.cwd === "string" ? entry.cwd.replaceAll("\\", "/") : ""
        const side = cwd === "be" || cwd.startsWith("be/") ? "be" : cwd === "fe" || cwd.startsWith("fe/") ? "fe" : "both"
        const named = typeof entry.port === "string" ? ports[entry.port] : entry.port
        found.push({ name: entry.name, side, ...(typeof named === "number" ? { port: named } : {}) })
    }
    return found.length === 0 ? undefined : found
}

/**
 * The stack processes of each side for a sync: the settings' own when every name they give is one the app declares (a deliberate choice), else the
 * app's declared processes by the side they run (one under neither be/ nor fe/ restarts with either). Pure.
 */
export const processesOfApp = (configured: DevSyncSettings["processes"], declared: readonly DeclaredProcess[] | undefined): DevSyncSettings["processes"] => {
    if (declared === undefined) return configured
    const names = new Set(declared.map((one) => one.name))
    if ([...configured.be, ...configured.fe].every((name) => names.has(name))) return configured
    return { be: declared.filter((one) => one.side !== "fe").map((one) => one.name), fe: declared.filter((one) => one.side !== "be").map((one) => one.name) }
}
