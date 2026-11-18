import { Refusal } from "../../shared/errors.js"

/**
 * The Cloudflare side of `starci vps domain` and `vps cloudflare`: the owner's API token (sealed, ops/vps.yaml `inventory.cloudflare`)
 * talks to the v4 API for the zone of `ingress.domain` and the owner's account. Planning is pure (`ingressWith`, `dnsAction`); the
 * http seam is injectable so the specs never reach the network. The token is a bearer header of the request alone: never in a
 * URL, a line or an error (a refusal carries the API's own error codes and messages).
 */

/** One call of the v4 API: method, path below the API root, optional JSON body; resolves to the envelope's `result`. */
export type CloudflareCall = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown) => Promise<unknown>

/** One error of the API's envelope as `<code> <message>`. */
const apiError = (error: unknown): string => {
    if (typeof error !== "object" || error === null) return typeof error === "string" ? error : "unknown error"
    const { code, message } = error as { code?: unknown; message?: unknown }
    return `${typeof code === "number" || typeof code === "string" ? String(code) : ""} ${typeof message === "string" ? message : ""}`.trim()
}

/** The http seam over fetch: bearer token, JSON in and out, `success: false` refused with the API's own errors. */
export const cloudflareCall = (api: string, token: string, fetcher: typeof fetch = fetch): CloudflareCall => async (method, path, body) => {
    const response = await fetcher(`${api}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30_000),
    })
    let envelope: unknown
    try {
        envelope = await response.json()
    } catch {
        throw new Refusal("VPS_CLOUDFLARE_FAILED", `${method} ${path.split("?")[0] ?? path} answered ${String(response.status)} with no JSON`)
    }
    const record = typeof envelope === "object" && envelope !== null ? (envelope as { success?: unknown; errors?: unknown; result?: unknown }) : {}
    if (record.success !== true) {
        const errors = Array.isArray(record.errors) ? record.errors.map(apiError) : []
        throw new Refusal("VPS_CLOUDFLARE_FAILED", `${method} ${path.split("?")[0] ?? path} answered ${String(response.status)}: ${errors.join("; ") || "no error given"}`)
    }
    return record.result
}

/** One ingress rule of a remotely managed tunnel. */
export interface IngressRule {
    readonly hostname?: string
    readonly service: string
    readonly [key: string]: unknown
}

/** The catch-all every tunnel ends with: a name the tunnel does not route answers 404. */
export const CATCH_ALL: IngressRule = { service: "http_status:404" }

/** The rules with `hostname` routed to `service` (replacing a rule of that name), the catch-all kept last; `changed` when they differ. */
export const ingressWith = (rules: readonly IngressRule[], hostname: string, service: string): { readonly rules: IngressRule[]; readonly changed: boolean } => {
    const named = rules.filter((rule) => rule.hostname !== undefined)
    const current = named.find((rule) => rule.hostname === hostname)
    if (current?.service === service && rules.at(-1)?.hostname === undefined) return { rules: [...rules], changed: false }
    const next = [...named.filter((rule) => rule.hostname !== hostname), { hostname, service }, rules.find((rule) => rule.hostname === undefined) ?? CATCH_ALL]
    return { rules: next, changed: true }
}

/** The rules without `hostname`; `changed` when one was there. */
export const ingressWithout = (rules: readonly IngressRule[], hostname: string): { readonly rules: IngressRule[]; readonly changed: boolean } => {
    const next = rules.filter((rule) => rule.hostname !== hostname)
    return { rules: next.length === 0 ? [CATCH_ALL] : next, changed: next.length !== rules.length }
}

/** A DNS record as the API lists it. */
export interface DnsRecord {
    readonly id: string
    readonly type: string
    readonly name: string
    readonly content: string
    readonly proxied?: boolean
}

/** The record a domain needs. */
export interface DnsWanted {
    readonly type: "CNAME" | "A" | "AAAA"
    readonly name: string
    readonly content: string
    readonly proxied: boolean
}

/** What to do about one name: create it, update the record of the same type, nothing, or refuse a record of another kind there. */
export type DnsAction = { readonly kind: "create" } | { readonly kind: "update"; readonly id: string } | { readonly kind: "none"; readonly id: string } | { readonly kind: "conflict"; readonly detail: string }

/** Plans the record of `want` against the records the zone holds for its name. */
export const dnsAction = (existing: readonly DnsRecord[], want: DnsWanted): DnsAction => {
    const same = existing.filter((record) => record.name === want.name)
    if (same.length === 0) return { kind: "create" }
    const match = same.find((record) => record.type === want.type)
    if (match === undefined || same.length > 1) return { kind: "conflict", detail: `${want.name} already holds ${same.map((record) => `${record.type} ${record.content}`).join(", ")}; remove it in Cloudflare or pick another name` }
    if (match.content === want.content && (match.proxied ?? false) === want.proxied) return { kind: "none", id: match.id }
    return { kind: "update", id: match.id }
}

/** The DNS record a domain of a server needs: a proxied CNAME to the tunnel, or a DNS-only A/AAAA to the server. */
export const wantedRecord = (fqdn: string, mode: "tunnel" | "edge", target: { readonly tunnelId?: string; readonly host: string }): DnsWanted => {
    if (mode === "tunnel") {
        if (target.tunnelId === undefined) throw new Refusal("VPS_TUNNEL_MISSING", "the server has no tunnel yet")
        return { type: "CNAME", name: fqdn, content: `${target.tunnelId}.cfargotunnel.com`, proxied: true }
    }
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(target.host)) return { type: "A", name: fqdn, content: target.host, proxied: false }
    if (target.host.includes(":")) return { type: "AAAA", name: fqdn, content: target.host, proxied: false }
    throw new Refusal("VPS_DOMAIN_HOST", `an edge server's record points at its address; its file's host ${target.host} is a name, not an IP`)
}

const asArray = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null) : [])

const text = (value: unknown, what: string): string => {
    if (typeof value !== "string" || value === "") throw new Refusal("VPS_CLOUDFLARE_FAILED", `the API answered no ${what}`)
    return value
}

/** The zone id of the domain; refused when the token cannot see it. */
export const zoneId = async (call: CloudflareCall, domain: string): Promise<string> => {
    const zones = asArray(await call("GET", `/zones?name=${encodeURIComponent(domain)}`))
    if (zones.length === 0) throw new Refusal("VPS_CLOUDFLARE_ZONE", `the token sees no zone ${domain}; give it Zone / DNS / Edit on ${domain}`)
    return text(zones[0]?.id, "zone id")
}

/** The id of the named remotely managed tunnel, created when absent. */
export const ensureTunnel = async (call: CloudflareCall, account: string, name: string, execute: boolean): Promise<{ readonly id: string | undefined; readonly created: boolean }> => {
    const found = asArray(await call("GET", `/accounts/${encodeURIComponent(account)}/cfd_tunnel?is_deleted=false&name=${encodeURIComponent(name)}`))
    const id = found.find((tunnel) => tunnel.name === name)?.id
    if (typeof id === "string") return { id, created: false }
    if (!execute) return { id: undefined, created: true }
    const made = await call("POST", `/accounts/${encodeURIComponent(account)}/cfd_tunnel`, { name, config_src: "cloudflare" })
    return { id: text((made as { id?: unknown } | null)?.id, "tunnel id"), created: true }
}

/** The run token of a tunnel (sealed at once by the caller, never printed). */
export const tunnelToken = async (call: CloudflareCall, account: string, tunnel: string): Promise<string> => text(await call("GET", `/accounts/${encodeURIComponent(account)}/cfd_tunnel/${encodeURIComponent(tunnel)}/token`), "tunnel token")

/** The ingress rules of a tunnel's remote configuration (the catch-all alone when none is set yet). */
export const tunnelIngress = async (call: CloudflareCall, account: string, tunnel: string): Promise<IngressRule[]> => {
    const configuration = (await call("GET", `/accounts/${encodeURIComponent(account)}/cfd_tunnel/${encodeURIComponent(tunnel)}/configurations`)) as { config?: { ingress?: unknown } } | null
    const rules = asArray(configuration?.config?.ingress).map((rule): IngressRule => ({ ...rule, service: typeof rule.service === "string" ? rule.service : "" }))
    return rules.length === 0 ? [CATCH_ALL] : rules
}

/** Writes a tunnel's ingress rules. */
export const putIngress = async (call: CloudflareCall, account: string, tunnel: string, rules: readonly IngressRule[]): Promise<void> => {
    await call("PUT", `/accounts/${encodeURIComponent(account)}/cfd_tunnel/${encodeURIComponent(tunnel)}/configurations`, { config: { ingress: rules } })
}

/** The records of one name in a zone. */
export const recordsOf = async (call: CloudflareCall, zone: string, name: string): Promise<DnsRecord[]> =>
    asArray(await call("GET", `/zones/${encodeURIComponent(zone)}/dns_records?name=${encodeURIComponent(name)}`)).map((record) => ({
        id: String(record.id),
        type: String(record.type),
        name: String(record.name),
        content: String(record.content),
        proxied: record.proxied === true,
    }))

/** Applies a planned DNS action. */
export const applyDns = async (call: CloudflareCall, zone: string, action: DnsAction, want: DnsWanted): Promise<void> => {
    const body = { type: want.type, name: want.name, content: want.content, proxied: want.proxied, ttl: 1, comment: "starci vps domain" }
    if (action.kind === "create") await call("POST", `/zones/${encodeURIComponent(zone)}/dns_records`, body)
    else if (action.kind === "update") await call("PUT", `/zones/${encodeURIComponent(zone)}/dns_records/${encodeURIComponent(action.id)}`, body)
    else if (action.kind === "conflict") throw new Refusal("VPS_DNS_CONFLICT", action.detail)
}

/** Deletes a record by id. */
export const deleteRecord = async (call: CloudflareCall, zone: string, id: string): Promise<void> => {
    await call("DELETE", `/zones/${encodeURIComponent(zone)}/dns_records/${encodeURIComponent(id)}`)
}

/** Verifies a token is active (a user token, else an account token of `account`). */
export const verifyToken = async (call: CloudflareCall, account: string): Promise<void> => {
    try {
        await call("GET", "/user/tokens/verify")
    } catch {
        await call("GET", `/accounts/${encodeURIComponent(account)}/tokens/verify`)
    }
}
