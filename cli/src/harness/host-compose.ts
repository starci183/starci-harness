import type { ManagedServer, VpsPolicy } from "./vps/policy.js"
import type { VpsPlan } from "./vps/plan.js"

/**
 * The integration point of a `host-compose` service of ops/host-roles.yaml (a host-level docker compose project under
 * /opt/starci/services/<project>, never a Swarm stack): the deployer `host up --execute` hands a missing one to, its rollback, and the real
 * call `host doctor` makes. BuildKit (`starci.buildkit`, rootless, never privileged, no docker socket) is the first: lane t190-buildkit builds
 * its definition (ops/vps/services/buildkit/) and registers its adapter in HOST_COMPOSE_ADAPTERS under its project name `buildkit`. Until an
 * adapter is registered, `host status` and `host up` report the service HOST_SERVICE_UNBUILT and deploy nothing for it.
 */
export interface HostComposeAdapter {
    /** The compose project (`project` of the placement). */
    readonly project: string
    /** The idempotent plan that renders the project's files, seals what it needs from the key model and runs `docker compose up -d`. */
    readonly up: (policy: VpsPolicy, server: ManagedServer, opsDir: string) => VpsPlan
    /** The rollback: `docker compose -p <project> down` (its volumes stay). */
    readonly down: (policy: VpsPolicy, server: ManagedServer) => VpsPlan
    /** The doctor's real call, run on the server: its last line is `ok <evidence>` or `fail <why>` (BuildKit: `buildctl debug workers` over the gate). */
    readonly ping: (server: ManagedServer) => string
}

/** The registered host-compose adapters, by project. Empty in this lane: BuildKit's is added by lane t190-buildkit. */
export const HOST_COMPOSE_ADAPTERS: ReadonlyMap<string, HostComposeAdapter> = new Map<string, HostComposeAdapter>()

/** The projects that have an adapter. */
export const hostComposeProjects = (): ReadonlySet<string> => new Set(HOST_COMPOSE_ADAPTERS.keys())

/** Reads a ping script's verdict from its last line. */
export const readPing = (stdout: string): { readonly ok: boolean; readonly evidence: string } => {
    const last = stdout.trim().split(/\r?\n/).at(-1) ?? ""
    if (last.startsWith("ok")) return { ok: true, evidence: last.slice(2).trim() || "answered" }
    return { ok: false, evidence: last.startsWith("fail") ? last.slice(4).trim() : last || "no answer" }
}
