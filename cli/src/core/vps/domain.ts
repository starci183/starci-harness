import { existsSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { locateOps } from "../../harness/ops.js"
import { applyDns, cloudflareCall, deleteRecord, dnsAction, ensureTunnel, ingressWith, ingressWithout, putIngress, recordsOf, tunnelIngress, tunnelToken, verifyToken, wantedRecord, zoneId } from "../../harness/vps/cloudflare.js"
import type { CloudflareCall } from "../../harness/vps/cloudflare.js"
import { runPlan, sessionFor } from "../../harness/vps/fleet.js"
import type { StepOutcome } from "../../harness/vps/fleet.js"
import { promptHidden } from "../../harness/vps/local.js"
import { cloudflareFile, forServer, loadVpsPolicy } from "../../harness/vps/policy.js"
import type { VpsPolicy } from "../../harness/vps/policy.js"
import { connectorStep, edgeListScript, edgeRouteStep, edgeUnrouteStep, edgeUpPlan, fqdnOf, routeOf } from "../../harness/vps/plan.js"
import type { DomainRoute, PlanStep, VpsPlan } from "../../harness/vps/plan.js"
import { CLOUDFLARE_KEYS, ownerStore, requireKey, SERVER_KEYS } from "../../harness/vps/sealed.js"
import type { SealedStore } from "../../harness/vps/sealed.js"
import { Refusal, UsageError } from "../../shared/errors.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import type { VerbResult } from "../../shared/verb.js"
import { EXECUTE, OWNER, pinsOf, planResult, requireAction, scopeOf, SERVER_ID } from "./shared.js"
import type { VpsData, VpsScope } from "./shared.js"

/** The owner's Cloudflare API of a policy: the sealed token and account. */
interface Cloudflare {
    readonly call: CloudflareCall
    readonly account: string
    readonly token: string
}

const cloudflareOf = (policy: VpsPolicy, opsDir: string, store: SealedStore): Cloudflare => {
    const file = cloudflareFile(policy, opsDir)
    if (!existsSync(file)) throw new Refusal("VPS_CLOUDFLARE_TOKEN_MISSING", `no Cloudflare token is sealed (${file}): run \`starci vps cloudflare set-token --account <account id> --execute\``)
    const map = store.open(file)
    const token = requireKey(map, CLOUDFLARE_KEYS.token, file)
    return { call: cloudflareCall(policy.ingress.api, token), account: requireKey(map, CLOUDFLARE_KEYS.account, file), token }
}

/** The full name of a `<sub>` operand: a label of the domain, or a name already under it. */
const fqdnOfSub = (policy: VpsPolicy, sub: string): string => {
    const name = sub.toLowerCase()
    if (name.endsWith(`.${policy.ingress.domain}`)) return name
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name)) throw new UsageError(`${sub} is no subdomain label of ${policy.ingress.domain}`)
    return fqdnOf(policy, name)
}

const note = (id: string, summary: string): PlanStep => ({ id, summary, root: false, script: "", secrets: [] })

/** The steps of a domain added through the tunnel: tunnel, connector, ingress rule, proxied CNAME. */
const tunnelAddSteps = (scope: VpsScope, fqdn: string, origin: string): PlanStep[] => [
    note("tunnel", `Cloudflare: the remotely managed tunnel ${forServer(scope.policy.ingress.tunnel.name, scope.server.id)} exists (made, its run token sealed in ${scope.server.id}.enc.yaml, when it does not)`),
    connectorStep(scope.policy, pinsOf(scope), "<tunnel>"),
    note("ingress", `Cloudflare: the tunnel routes ${fqdn} to ${origin}`),
    note("dns", `Cloudflare: ${fqdn} is a proxied CNAME to <tunnel id>.cfargotunnel.com`),
]

/** The printed plan of a domain change. */
const domainPlan = (scope: VpsScope, action: "add" | "remove", fqdn: string, route: DomainRoute | undefined): VpsPlan => {
    const { policy, server } = scope
    let steps: PlanStep[]
    if (route?.via === "tunnel") steps = tunnelAddSteps(scope, fqdn, route.origin)
    else if (route?.via === "edge") steps = [note("dns", `Cloudflare: ${fqdn} is a DNS-only A record to ${server.host}`), edgeRouteStep(policy, fqdn, route.service, route.port)]
    else steps = [note("ingress", `Cloudflare: the tunnel no longer routes ${fqdn} (when it does)`), ...(server.ingressMode === "edge" ? [edgeUnrouteStep(fqdn)] : []), note("dns", `Cloudflare: the records of ${fqdn} that point at this server or its tunnel are deleted`)]
    const sshName = forServer(policy.ingress.tunnel.sshSubdomain, server.id)
    const notes = action === "add" && route?.via === "tunnel" && route.origin.startsWith("ssh://") ? [`reach it with \`ssh -o ProxyCommand="cloudflared access ssh --hostname ${fqdn}" <user>@${fqdn}\`; the policy's name for it is ${sshName}`] : []
    return { verb: `domain ${action}`, server: server.id, steps, notes }
}

const done = (id: string, changed: boolean, detail = ""): StepOutcome => ({ id, outcome: changed ? "changed" : "unchanged", detail })

/** Adds a name through the tunnel: tunnel (made once, token sealed), connector, ingress rule, proxied CNAME. */
const addOnTunnel = async (scope: VpsScope, store: SealedStore, cloudflare: Cloudflare, fqdn: string, origin: string, progress: (line: string) => void): Promise<StepOutcome[]> => {
    const { policy, server } = scope
    const outcomes: StepOutcome[] = []
    const sealed = store.open(server.sealedFile)
    let tunnelId = sealed[SERVER_KEYS.tunnelId] ?? ""
    let token = sealed[SERVER_KEYS.tunnelToken] ?? ""
    if (tunnelId === "" || token === "") {
        const ensured = await ensureTunnel(cloudflare.call, cloudflare.account, forServer(policy.ingress.tunnel.name, server.id), true)
        tunnelId = ensured.id ?? ""
        token = await tunnelToken(cloudflare.call, cloudflare.account, tunnelId)
        store.write(server.sealedFile, { [SERVER_KEYS.tunnelId]: tunnelId, [SERVER_KEYS.tunnelToken]: token })
        outcomes.push(done("tunnel", true, `tunnel ${tunnelId}${ensured.created ? " made" : ""}, its token sealed`))
    } else outcomes.push(done("tunnel", false))
    progress(`tunnel: ${outcomes[0]?.outcome ?? ""}`)
    const connector = await runPlan(policy, server, store, { verb: "domain add", server: server.id, steps: [connectorStep(policy, pinsOf(scope), tunnelId)], notes: [] }, { TUNNEL_TOKEN: token }, progress)
    outcomes.push(...connector)
    if (connector.some((outcome) => outcome.outcome === "failed")) return outcomes
    const ingress = ingressWith(await tunnelIngress(cloudflare.call, cloudflare.account, tunnelId), fqdn, origin)
    if (ingress.changed) await putIngress(cloudflare.call, cloudflare.account, tunnelId, ingress.rules)
    outcomes.push(done("ingress", ingress.changed, `${fqdn} -> ${origin}`))
    const zone = await zoneId(cloudflare.call, policy.ingress.domain)
    const want = wantedRecord(fqdn, "tunnel", { tunnelId, host: server.host })
    const action = dnsAction(await recordsOf(cloudflare.call, zone, fqdn), want)
    await applyDns(cloudflare.call, zone, action, want)
    outcomes.push(done("dns", action.kind !== "none", `${want.type} ${fqdn} -> ${want.content}`))
    return outcomes
}

/** Adds a name through the edge proxy: the DNS-only record to the server, then the service's Traefik labels. */
const addOnEdge = async (scope: VpsScope, store: SealedStore, cloudflare: Cloudflare, fqdn: string, route: Extract<DomainRoute, { via: "edge" }>, progress: (line: string) => void): Promise<StepOutcome[]> => {
    const { policy, server } = scope
    const zone = await zoneId(cloudflare.call, policy.ingress.domain)
    const want = wantedRecord(fqdn, "edge", { host: server.host })
    const action = dnsAction(await recordsOf(cloudflare.call, zone, fqdn), want)
    await applyDns(cloudflare.call, zone, action, want)
    const outcomes = [done("dns", action.kind !== "none", `${want.type} ${fqdn} -> ${want.content}`)]
    return [...outcomes, ...(await runPlan(policy, server, store, { verb: "domain add", server: server.id, steps: [edgeRouteStep(policy, fqdn, route.service, route.port)], notes: [] }, {}, progress))]
}

/** Removes a name: its tunnel rule, its edge labels, and the records of the name that point at this server or its tunnel. */
const removeName = async (scope: VpsScope, store: SealedStore, cloudflare: Cloudflare, fqdn: string, progress: (line: string) => void): Promise<StepOutcome[]> => {
    const { policy, server } = scope
    const zone = await zoneId(cloudflare.call, policy.ingress.domain)
    const outcomes: StepOutcome[] = []
    const tunnelId = store.open(server.sealedFile)[SERVER_KEYS.tunnelId] ?? ""
    if (tunnelId !== "") {
        const ingress = ingressWithout(await tunnelIngress(cloudflare.call, cloudflare.account, tunnelId), fqdn)
        if (ingress.changed) await putIngress(cloudflare.call, cloudflare.account, tunnelId, ingress.rules)
        outcomes.push(done("ingress", ingress.changed))
    }
    if (server.ingressMode === "edge") outcomes.push(...(await runPlan(policy, server, store, { verb: "domain remove", server: server.id, steps: [edgeUnrouteStep(fqdn)], notes: [] }, {}, progress)))
    // Only a record that points at this server or its tunnel is deleted; anything else at that name is left and named.
    const points = new Set([server.host, ...(tunnelId === "" ? [] : [`${tunnelId}.cfargotunnel.com`])])
    const records = (await recordsOf(cloudflare.call, zone, fqdn)).filter((record) => record.name === fqdn)
    const ours = records.filter((record) => points.has(record.content))
    for (const record of ours) await deleteRecord(cloudflare.call, zone, record.id)
    outcomes.push(done("dns", ours.length > 0, records.length > ours.length ? `left ${String(records.length - ours.length)} record(s) of ${fqdn} that point elsewhere` : ""))
    return outcomes
}

/** One name a server answers, and where it goes. */
interface NameRow {
    readonly hostname: string
    readonly service: string
    readonly via: "tunnel" | "edge"
}

/** Reads the edge list script's lines into names: each router's Host rule with its service and port. */
export const edgeNames = (stdout: string): NameRow[] => {
    const rules = new Map<string, { service: string; host?: string; port?: string }>()
    for (const line of stdout.split(/\r?\n/)) {
        const match = /^(\S+) traefik\.http\.(routers|services)\.([^.]+)\.(?:rule|loadbalancer\.server\.port)=(.*)$/.exec(line.trim())
        if (match === null) continue
        const [, service = "", kind, router = "", value = ""] = match
        const entry = rules.get(router) ?? { service }
        if (kind === "routers") {
            const host = /Host\(`([^`]+)`\)/.exec(value)?.[1]
            if (host !== undefined) entry.host = host
        } else entry.port = value
        rules.set(router, entry)
    }
    return [...rules.values()].flatMap((entry) => (entry.host === undefined ? [] : [{ hostname: entry.host, service: `${entry.service}:${entry.port ?? "?"}`, via: "edge" as const }]))
}

/** Lists the names a server answers: the tunnel's ingress rules, and the edge proxy's routed services. */
const listNames = async (scope: VpsScope, store: SealedStore): Promise<NameRow[]> => {
    const { policy, server } = scope
    const names: NameRow[] = []
    const tunnelId = store.open(server.sealedFile)[SERVER_KEYS.tunnelId] ?? ""
    if (tunnelId !== "") {
        const cloudflare = cloudflareOf(policy, scope.opsDir, store)
        for (const rule of await tunnelIngress(cloudflare.call, cloudflare.account, tunnelId)) if (rule.hostname !== undefined) names.push({ hostname: rule.hostname, service: rule.service, via: "tunnel" })
    }
    if (server.ingressMode !== "edge") return names
    const session = await sessionFor(policy, server, store)
    try {
        const run = await session.run({ script: edgeListScript(), root: true, timeoutMs: policy.ssh.commandTimeoutSeconds * 1000 })
        return [...names, ...edgeNames(run.stdout)]
    } finally {
        session.close()
    }
}

/**
 * `starci vps domain add|list|remove <id> [<sub>] [--to <target>] [--execute]`: a name under the owner's domain for a server. The UI
 * and SSH always go through the server's Cloudflare tunnel (made once, its token sealed; a cloudflared connector; the ingress rule;
 * a proxied CNAME). An app service goes through the tunnel on a tunnel server, and through Traefik on an edge server (a DNS-only A
 * record and the service's labels; the certificate by DNS-01). `add` and `remove` are dry runs until --execute.
 */
export const vpsDomainVerb = defineVerb({
    path: ["vps", "domain"],
    summary: "`domain add <id> <sub> --to <service:port|port|ui|ssh>`, `domain list <id>`, `domain remove <id> <sub>`: a name <sub>.<domain of ops/vps.yaml> for a managed server: the UI and SSH through its Cloudflare tunnel, an app service through the tunnel or through Traefik (DNS-only A record, labels, DNS-01 certificate) by the server's ingress mode; add and remove are dry runs until --execute",
    editions: BOTH_EDITIONS,
    effect: "remote",
    roles: OWNER,
    schema: "starci/vps-domain@1",
    flags: {
        action: { kind: "string", summary: "add, list or remove", required: true, positional: true },
        id: { kind: "string", summary: "the server id", required: true, positional: true },
        sub: { kind: "string", summary: "the subdomain label (or the full name under the domain)", positional: true },
        to: { kind: "string", summary: "add: what the name reaches: <service>:<port> (a swarm service on the shared network), <port> (on the host, tunnel servers), ui (the Portainer stack) or ssh" },
        execute: EXECUTE,
    },
    run: async (context, flags): Promise<VerbResult<VpsData>> => {
        const action = requireAction(flags.action, ["add", "list", "remove"], "domain")
        const scope = scopeOf(flags.id)
        if (action === "list") {
            const names = await listNames(scope, await ownerStore())
            return { data: { server: scope.server.id, mode: scope.server.ingressMode, names }, message: names.length === 0 ? `${scope.server.id}: no name yet` : names.map((entry) => `${entry.hostname} -> ${entry.service} (${entry.via})`).join("\n") }
        }
        if (flags.sub === undefined) throw new UsageError(`starci vps domain ${action} <id> <sub>: name the subdomain`)
        const fqdn = fqdnOfSub(scope.policy, flags.sub)
        if (action === "add" && flags.to === undefined) throw new UsageError("starci vps domain add <id> <sub> --to <target>: name what the name reaches")
        const route = action === "add" ? routeOf(scope.policy, scope.server, flags.to ?? "") : undefined
        const plan = domainPlan(scope, action, fqdn, route)
        if (!flags.execute) return planResult(plan, undefined)
        const store = await ownerStore()
        const cloudflare = cloudflareOf(scope.policy, scope.opsDir, store)
        if (route === undefined) return planResult(plan, await removeName(scope, store, cloudflare, fqdn, context.progress))
        const outcomes = route.via === "tunnel" ? await addOnTunnel(scope, store, cloudflare, fqdn, route.origin, context.progress) : await addOnEdge(scope, store, cloudflare, fqdn, route, context.progress)
        return planResult(plan, outcomes, [`  https://${fqdn}`])
    },
})

/** `starci vps edge up <id> [--execute]`: the Traefik stack on 80/443 of a clean box, its Cloudflare token a swarm secret. */
export const vpsEdgeVerb = defineVerb({
    path: ["vps", "edge"],
    summary: "`edge up <id>`: deploy Traefik as the swarm stack of ops/vps.yaml `edge` on a managed server: 80 and 443 in host mode, routing to labelled swarm services of the shared network, certificates by ACME DNS-01 through Cloudflare with the sealed token as a swarm secret; a dry run until --execute",
    editions: BOTH_EDITIONS,
    effect: "remote",
    roles: OWNER,
    schema: "starci/vps-edge@1",
    flags: { action: { kind: "string", summary: "up", required: true, positional: true }, id: SERVER_ID, execute: EXECUTE },
    run: async (context, flags): Promise<VerbResult<VpsData>> => {
        requireAction(flags.action, ["up"], "edge")
        const scope = scopeOf(flags.id)
        const plan = edgeUpPlan(scope.policy, scope.server, pinsOf(scope))
        if (!flags.execute) return planResult(plan, undefined)
        const store = await ownerStore()
        const cloudflare = cloudflareOf(scope.policy, scope.opsDir, store)
        return planResult(plan, await runPlan(scope.policy, scope.server, store, plan, { CLOUDFLARE_API_TOKEN: cloudflare.token }, context.progress))
    },
})

/**
 * `starci vps cloudflare set-token --account <id> [--execute]` and `vps cloudflare status`: the owner's Cloudflare API token, read
 * at a masked prompt, verified against the API and sealed to the owner key in ops/vps.yaml `inventory.cloudflare` (gitignored),
 * never secret.env and never printed. The scopes it needs are ops/vps.yaml `ingress.tokenScopes`.
 */
export const vpsCloudflareVerb = defineVerb({
    path: ["vps", "cloudflare"],
    summary: "`cloudflare set-token --account <id>`: read the owner's Cloudflare API token at a masked prompt, verify it and seal it to the owner key (gitignored, never secret.env, never printed); `cloudflare status`: whether one is sealed and active, and the scopes it needs",
    editions: BOTH_EDITIONS,
    effect: "remote",
    roles: OWNER,
    schema: "starci/vps-cloudflare@1",
    flags: {
        action: { kind: "string", summary: "set-token or status", required: true, positional: true },
        account: { kind: "string", summary: "set-token: the Cloudflare account id the tunnels live in (the dashboard's Account ID)" },
        execute: EXECUTE,
    },
    run: async (_context, flags): Promise<VerbResult<VpsData>> => {
        const action = requireAction(flags.action, ["set-token", "status"], "cloudflare")
        const opsDir = locateOps()
        const policy = loadVpsPolicy(opsDir)
        const file = cloudflareFile(policy, opsDir)
        const scopes = [`the token needs, on ${policy.ingress.domain} only:`, ...[...new Set([...policy.ingress.tokenScopes.tunnel, ...policy.ingress.tokenScopes.edge])].map((scope) => `  ${scope}`)]
        if (action === "status") {
            if (!existsSync(file)) return { data: { sealed: false, active: false }, message: [`no token is sealed (${file})`, ...scopes].join("\n"), exitCode: 1 }
            const cloudflare = cloudflareOf(policy, opsDir, await ownerStore())
            await verifyToken(cloudflare.call, cloudflare.account)
            await zoneId(cloudflare.call, policy.ingress.domain)
            return { data: { sealed: true, active: true }, message: [`the sealed token is active and sees ${policy.ingress.domain}`, ...scopes].join("\n") }
        }
        if (flags.account === undefined || !/^[0-9a-f]{32}$/.test(flags.account)) throw new UsageError("starci vps cloudflare set-token --account <id>: the 32-hex account id of the dashboard")
        if (!flags.execute) return { data: { sealed: existsSync(file), execute: false }, message: [`set-token: dry run (add --execute): read the token at a masked prompt, verify it, seal it with account ${flags.account} to ${file}`, ...scopes].join("\n") }
        const store = await ownerStore()
        const token = (await promptHidden("Cloudflare API token", false)).trim()
        if (!/^[A-Za-z0-9_-]{30,}$/.test(token)) throw new Refusal("VPS_CLOUDFLARE_TOKEN_SHAPE", "that is not the shape of a Cloudflare API token; nothing was sealed")
        const call = cloudflareCall(policy.ingress.api, token)
        await verifyToken(call, flags.account)
        await zoneId(call, policy.ingress.domain)
        mkdirSync(dirname(file), { recursive: true })
        store.write(file, { [CLOUDFLARE_KEYS.token]: token, [CLOUDFLARE_KEYS.account]: flags.account })
        return { data: { sealed: true, execute: true }, message: `the token is active, sees ${policy.ingress.domain}, and is sealed in ${file}` }
    },
})
