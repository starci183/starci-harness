import { createHash, randomUUID, timingSafeEqual } from "node:crypto"
import { createServer } from "node:http"
import type { IncomingMessage, Server, ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { AiRouterError } from "../errors.ts"
import type { AiRouter, CallOptions, CatalogModel, ChatCompletionChunk, ChatCompletionRequest, EmbeddingsRequest, MaybePromise, ModelPolicy, RouterCatalog, Usage } from "../types.ts"
import { dayOf, KeyAdmin, KeyAdminError } from "./keys.ts"
import type { KeySpec, KeyStore, MountedKeySpec, StoredKey } from "./keys.ts"

/** How a gateway is built over a router. */
export interface GatewayOptions {
    /** Where virtual keys and their usage live. */
    readonly keys: KeyStore
    /**
     * Keys mounted from secrets the app already holds, so a deploy needs no `keys create`. Each secret is read once
     * here, checked to start with `sk-starci-<label>-`, and kept only as its SHA-256; the key is never written to
     * the store, has the stable id `key_<16 hex>` of its label (its quota and usage survive a new secret), lists with
     * `mounted: true`, and refuses revoke, rotate and update. An invalid key or a label given twice throws a
     * `MountedKeyError` here; a secret or id a stored key holds rejects `ready()`.
     */
    readonly mountedKeys?: readonly MountedKeySpec[]
    /** Returns the admin token at each admin request; absent, or an empty answer, turns the admin API off. */
    readonly adminToken?: () => MaybePromise<string | undefined>
    /** The largest request body read, in bytes. Default 4 MiB. */
    readonly maxBodyBytes?: number
    /** The clock of quotas and usage days. Default `Date.now`. */
    readonly clock?: () => number
    /** Receives a failure no response can carry any more (a usage write after the reply was sent). */
    readonly onError?: (error: unknown) => void
}

/** An OpenAI-compatible HTTP front over one router, with virtual keys, quotas, usage and an admin API. */
export interface AiRouterGateway {
    /** The key administration the admin API and the CLI share. */
    readonly admin: KeyAdmin
    /**
     * Resolves once the mounted keys are checked against the store, and rejects with a `MountedKeyError` when a stored
     * key holds a mounted key's secret or id. `listen`, `handle` and the Nest module wait for it.
     */
    ready(): Promise<void>
    /** Answers one HTTP request; mount it on any Node HTTP server or framework (a body a framework parsed is used as is). */
    handle(request: IncomingMessage, response: ServerResponse): Promise<void>
    /** Listens on a port (0: any free port) and resolves to the bound address. */
    listen(port: number, host?: string): Promise<{ readonly port: number; readonly host: string; readonly url: string }>
    /** Stops listening, ends open connections and releases the router subscription; the key store stays open. */
    close(): Promise<void>
}

/** A refusal the gateway answers as an OpenAI error object. */
class GatewayError extends Error {
    readonly status: number
    readonly type: string
    readonly code: string
    readonly retryAfter: number | undefined

    constructor(status: number, code: string, message: string, options: { type?: string; retryAfter?: number } = {}) {
        super(message)
        this.status = status
        this.code = code
        this.type = options.type ?? (status === 401 ? "authentication_error" : status === 403 ? "permission_error" : status === 429 ? "rate_limit_error" : status >= 500 ? "api_error" : "invalid_request_error")
        this.retryAfter = options.retryAfter
    }

    /** The outcome a usage row records for this refusal. */
    get outcome(): string {
        return `rejected:${this.code}`
    }
}

const DEFAULT_MAX_BODY = 4 * 1024 * 1024
const MINUTE = 60_000

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function errorBody(error: GatewayError): { error: { message: string; type: string; param: null; code: string } } {
    return { error: { message: error.message, type: error.type, param: null, code: error.code } }
}

function send(response: ServerResponse, status: number, body: unknown, headers: Readonly<Record<string, string>> = {}): void {
    const text = JSON.stringify(body)
    response.writeHead(status, { "content-type": "application/json", "content-length": String(Buffer.byteLength(text)), ...headers })
    response.end(text)
}

function sendError(response: ServerResponse, error: GatewayError, headers: Readonly<Record<string, string>> = {}): void {
    send(response, error.status, errorBody(error), error.retryAfter === undefined ? headers : { ...headers, "retry-after": String(error.retryAfter) })
}

function secondsUntil(at: number, now: number): number {
    return Math.max(1, Math.ceil((at - now) / 1000))
}

/** The Retry-After of a pool whose keys are all blacklisted: until the earliest returns, else this many seconds. */
export const BLACKLISTED_RETRY_AFTER_S = 300

function retryAfterOf(error: AiRouterError, now: number): number {
    return error.retryAt === undefined ? BLACKLISTED_RETRY_AFTER_S : secondsUntil(error.retryAt, now)
}

/** Maps a router failure to the status a client can act on; the message is the router's, which never holds a key value. */
function fromRouterError(error: unknown, now: number): GatewayError {
    if (!(error instanceof AiRouterError)) return new GatewayError(502, "upstream_error", "the pool failed to answer")
    const retry = error.retryAt === undefined ? {} : { retryAfter: secondsUntil(error.retryAt, now) }
    switch (error.errorClass) {
        case "invalid_request": {
            const status = error.status !== undefined && error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 403 && error.status !== 429 ? error.status : 400
            return new GatewayError(status, "upstream_invalid_request", error.message)
        }
        case "config":
            return new GatewayError(400, "invalid_request", error.message)
        case "no_candidate":
            return new GatewayError(503, "pool_unavailable", `no model of the pool can serve this request: ${error.message}`, retry)
        case "rate_limit":
            return new GatewayError(503, "pool_rate_limited", `every key of the pool is rate limited: ${error.message}`, retry)
        case "quota":
            // Every key that could serve is blacklisted for a spent quota or budget: come back when the first one returns.
            return new GatewayError(503, "pool_quota_exhausted", `every upstream key for this request has exhausted its quota or credit: ${error.message}`, { retryAfter: retryAfterOf(error, now) })
        case "deadline":
            return new GatewayError(504, "pool_timeout", error.message)
        case "cancelled":
            return new GatewayError(499, "cancelled", error.message)
        case "auth":
            // Every key is refused or unset, until an operator seals a new secret: the client can only come back later.
            return new GatewayError(503, "pool_auth_failed", "no upstream key of the pool is accepted: each is blacklisted until its secret changes", { retryAfter: retryAfterOf(error, now) })
        case "transient":
        case "timeout":
        case "network":
        case "stream":
            return new GatewayError(502, "upstream_error", `the pool failed to answer: ${error.message}`, retry)
    }
}

function bearer(request: IncomingMessage): string | undefined {
    const header = request.headers.authorization
    if (header === undefined) return undefined
    const match = /^Bearer\s+(\S+)\s*$/i.exec(header)
    return match?.[1]
}

function sameSecret(given: string, expected: string): boolean {
    const a = createHash("sha256").update(given).digest()
    const b = createHash("sha256").update(expected).digest()
    return timingSafeEqual(a, b)
}

async function readBody(request: IncomingMessage, limit: number): Promise<unknown> {
    // A framework that parsed the body already (express.json, a Nest controller) leaves it on the request.
    const parsed = (request as IncomingMessage & { body?: unknown }).body
    if (parsed !== undefined) return typeof parsed === "string" || Buffer.isBuffer(parsed) ? parseJson(parsed.toString()) : parsed
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request as AsyncIterable<Buffer>) {
        size += chunk.length
        if (size > limit) throw new GatewayError(413, "request_too_large", `the request body is larger than ${String(limit)} bytes`)
        chunks.push(chunk)
    }
    return parseJson(Buffer.concat(chunks).toString("utf8"))
}

function parseJson(text: string): unknown {
    try {
        return JSON.parse(text)
    } catch {
        throw new GatewayError(400, "invalid_json", "the request body is not JSON")
    }
}

function allows(list: readonly string[], name: string): boolean {
    return list.includes("*") || list.includes(name)
}

function modelNamed(catalog: RouterCatalog, name: string): CatalogModel | undefined {
    return catalog.models.find((model) => model.id === name || model.aliases.includes(name))
}

function modelAllowed(key: StoredKey, model: CatalogModel): boolean {
    return [model.id, ...model.aliases].some((name) => allows(key.models, name))
}

/** Writes and waits for the socket to take it, so a slow client holds the upstream stream back. */
function write(response: ServerResponse, text: string): Promise<void> {
    if (response.write(text)) return Promise.resolve()
    return new Promise((resolve) => {
        const done = (): void => {
            response.off("drain", done)
            response.off("close", done)
            resolve()
        }
        response.on("drain", done)
        response.on("close", done)
    })
}

/** What one routed call sends to the router, once the key's bindings are applied. */
interface Target {
    readonly options: CallOptions
    /** The request's `model` is dropped when it named a profile, so the profile decides. */
    readonly dropModel: boolean
}

/** An authenticated, admitted request on its way to the router. */
interface Prepared {
    readonly key: StoredKey
    readonly body: Record<string, unknown>
    readonly target: Target
    readonly started: number
}

interface Captured {
    usage?: Usage
    cost?: number
}

/** Creates the gateway over a router; nothing listens until `listen`. */
export function createGateway(router: AiRouter, options: GatewayOptions): AiRouterGateway {
    const clock = options.clock ?? Date.now
    const catalog = router.catalog()
    const admin = new KeyAdmin(options.keys, { catalog, clock, ...(options.mountedKeys === undefined ? {} : { mounted: options.mountedKeys }) })
    const checked = admin.checkMounted()
    // A refusal surfaces through ready(), listen() and handle(); it must not also be an unhandled rejection.
    checked.catch(() => undefined)
    const maxBody = options.maxBodyBytes ?? DEFAULT_MAX_BODY
    const servers = new Set<Server>()
    // A stream's usage reaches the gateway through the attempt event of its request id.
    const captured = new Map<string, Captured>()
    const unsubscribe = router.on("attempt", (event) => {
        const slot = captured.get(event.requestId)
        if (slot === undefined || event.outcome !== "success") return
        if (event.usage !== undefined) slot.usage = event.usage
        if (event.cost !== undefined) slot.cost = event.cost
    })

    function report(error: unknown): void {
        try {
            options.onError?.(error)
        } catch {
            // The observer's failure is the observer's.
        }
    }

    async function record(key: StoredKey, started: number, outcome: string, usage: Usage | undefined, cost: number | undefined): Promise<void> {
        try {
            await options.keys.record(key.id, dayOf(started), {
                outcome,
                promptTokens: usage?.prompt_tokens ?? 0,
                completionTokens: usage?.completion_tokens ?? 0,
                cost: cost ?? 0,
                latencyMs: clock() - started,
            })
        } catch (error) {
            report(error)
        }
    }

    async function authenticate(request: IncomingMessage): Promise<StoredKey> {
        const secret = bearer(request)
        if (secret === undefined) throw new GatewayError(401, "missing_api_key", "send the key as Authorization: Bearer sk-starci-...")
        const key = await admin.authenticate(secret)
        if (key === undefined) throw new GatewayError(401, "invalid_api_key", "the API key is not valid")
        if (key.revokedAt !== null) throw new GatewayError(401, "invalid_api_key", "the API key was revoked")
        if (!key.enabled) throw new GatewayError(401, "invalid_api_key", "the API key is disabled")
        return key
    }

    function target(key: StoredKey, name: unknown, operation: "chat" | "embeddings"): Target {
        if (typeof name !== "string" || name === "") throw new GatewayError(400, "missing_model", "model is required: a profile name or a model id")
        const pinned: ModelPolicy = key.allowFallback ? {} : { allowFallback: false }
        const needs = operation === "embeddings" ? "embeddings" : "chat"
        const profile = catalog.profiles.find((entry) => entry.name === name)
        if (profile !== undefined) {
            if (!allows(key.profiles, name)) throw new GatewayError(403, "model_not_allowed", `this key may not call profile "${name}"`)
            if (profile.serves.length > 0 && !profile.serves.includes(needs)) throw new GatewayError(400, "model_not_supported", `the profile "${name}" does not serve ${operation}`)
            return { options: { profile: name, ...(key.allowFallback ? {} : { policy: pinned }) }, dropModel: true }
        }
        const model = modelNamed(catalog, name)
        if (model === undefined) throw new GatewayError(404, "model_not_found", `the model "${name}" does not exist`)
        // A model the key's allowlist does not name is refused, never remapped to a profile.
        if (!modelAllowed(key, model)) throw new GatewayError(403, "model_not_allowed", `this key may not call model "${name}"`)
        if (!model.capabilities.includes(needs)) throw new GatewayError(400, "model_not_supported", `the model "${name}" does not serve ${operation}`)
        // An embeddings call never falls back: another model is another vector space.
        if (operation === "embeddings") return { options: { policy: { model: name, allowFallback: false } }, dropModel: false }
        // A direct call falls back only to the pool's default fallbacks this key may call itself.
        const fallbacks = catalog.defaults.fallbacks.filter((fallback) => {
            const entry = modelNamed(catalog, fallback)
            return entry !== undefined && entry.id !== model.id && modelAllowed(key, entry)
        })
        return { options: { policy: { model: name, fallbacks, ...pinned } }, dropModel: false }
    }

    async function admit(key: StoredKey, now: number): Promise<void> {
        const quota = key.quota
        if (quota.tokensPerDay !== undefined || quota.costPerDay !== undefined || quota.costPerMonth !== undefined) {
            const today = dayOf(now)
            const rows = await options.keys.usage(key.id, `${today.slice(0, 8)}01`, today)
            const day = rows.find((row) => row.day === today)
            const date = new Date(now)
            const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)
            if (quota.tokensPerDay !== undefined && (day?.promptTokens ?? 0) + (day?.completionTokens ?? 0) >= quota.tokensPerDay) {
                throw new GatewayError(429, "tokens_per_day_exceeded", `this key used its ${String(quota.tokensPerDay)} tokens for today (UTC)`, { retryAfter: secondsUntil(midnight, now) })
            }
            if (quota.costPerDay !== undefined && (day?.cost ?? 0) >= quota.costPerDay) {
                throw new GatewayError(429, "cost_per_day_exceeded", `this key spent its ${String(quota.costPerDay)} for today (UTC)`, { retryAfter: secondsUntil(midnight, now) })
            }
            const month = rows.reduce((sum, row) => sum + row.cost, 0)
            if (quota.costPerMonth !== undefined && month >= quota.costPerMonth) {
                const next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
                throw new GatewayError(429, "cost_per_month_exceeded", `this key spent its ${String(quota.costPerMonth)} for this month (UTC)`, { retryAfter: secondsUntil(next, now) })
            }
        }
        if (quota.requestsPerMinute !== undefined) {
            const minute = Math.floor(now / MINUTE)
            const count = await options.keys.hit(key.id, minute)
            if (count > quota.requestsPerMinute) {
                throw new GatewayError(429, "requests_per_minute_exceeded", `this key is limited to ${String(quota.requestsPerMinute)} requests a minute`, { retryAfter: secondsUntil((minute + 1) * MINUTE, now) })
            }
        }
    }

    /** Reads the body and applies the key's bindings and quotas; a refusal is recorded against the key. */
    async function prepare(key: StoredKey, request: IncomingMessage, operation: "chat" | "embeddings"): Promise<Prepared> {
        const started = clock()
        try {
            const body = await readBody(request, maxBody)
            if (!isRecord(body)) throw new GatewayError(400, "invalid_request", "the request body must be a JSON object")
            if (operation === "chat" && !Array.isArray(body.messages)) throw new GatewayError(400, "invalid_request", "messages is required")
            if (operation === "embeddings" && typeof body.input !== "string" && !Array.isArray(body.input)) throw new GatewayError(400, "invalid_request", "input is required")
            const resolved = target(key, body.model, operation)
            await admit(key, started)
            return { key, body, target: resolved, started }
        } catch (error) {
            if (error instanceof GatewayError) await record(key, started, error.outcome, undefined, undefined)
            throw error
        }
    }

    function callBody(body: Record<string, unknown>, routed: Target): Record<string, unknown> {
        const out: Record<string, unknown> = { ...body }
        delete out.stream
        if (routed.dropModel) delete out.model
        return out
    }

    function controllerFor(response: ServerResponse): AbortController {
        const controller = new AbortController()
        response.on("close", () => {
            if (!response.writableFinished) controller.abort()
        })
        return controller
    }

    async function unary(response: ServerResponse, operation: "chat" | "embeddings", { key, body, target: routed, started }: Prepared): Promise<void> {
        const requestId = randomUUID()
        const headers = { "x-request-id": requestId }
        const options: CallOptions = { ...routed.options, requestId, signal: controllerFor(response).signal }
        try {
            const result =
                operation === "chat" ? await router.chat(callBody(body, routed) as unknown as ChatCompletionRequest, options) : await router.embeddings(callBody(body, routed) as unknown as EmbeddingsRequest, options)
            const { routing, ...answer } = result
            send(response, 200, answer, { ...headers, "x-ai-router-model": routing.model, "x-ai-router-attempts": String(routing.attempts) })
            await record(key, started, "success", result.usage, routing.cost)
        } catch (error) {
            const refusal = fromRouterError(error, clock())
            await record(key, started, `error:${error instanceof AiRouterError ? error.errorClass : "unknown"}`, undefined, undefined)
            sendError(response, refusal, headers)
        }
    }

    async function stream(response: ServerResponse, { key, body, target: routed, started }: Prepared): Promise<void> {
        const requestId = randomUUID()
        const headers = { "x-request-id": requestId }
        const controller = controllerFor(response)
        // Usage is always asked of the provider, for the key's accounting; the client gets the usage chunk only if it asked.
        const asked = isRecord(body.stream_options) ? body.stream_options : {}
        const wantsUsage = asked.include_usage === true
        const call = { ...callBody(body, routed), stream_options: { ...asked, include_usage: true } } as unknown as ChatCompletionRequest
        const slot: Captured = {}
        captured.set(requestId, slot)
        let outcome = "success"
        let iterator: AsyncIterator<ChatCompletionChunk> | undefined
        try {
            iterator = router.stream(call, { ...routed.options, requestId, signal: controller.signal })[Symbol.asyncIterator]()
            // Nothing is sent before the first chunk, so a pool failure before the first token is an ordinary error response.
            let next = await iterator.next()
            response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive", "x-accel-buffering": "no", ...headers })
            try {
                while (next.done !== true) {
                    const chunk = next.value
                    if (wantsUsage || chunk.usage === undefined || chunk.usage === null) await write(response, `data: ${JSON.stringify(chunk)}\n\n`)
                    else if (chunk.choices.length > 0) {
                        const rest: Record<string, unknown> = { ...chunk }
                        delete rest.usage
                        await write(response, `data: ${JSON.stringify(rest)}\n\n`)
                    }
                    if (response.destroyed) {
                        outcome = "cancelled"
                        break
                    }
                    next = await iterator.next()
                }
                if (outcome === "success") response.end("data: [DONE]\n\n")
            } catch (error) {
                // After the first token the status is sent; the failure goes down the stream as an OpenAI error object.
                outcome = `error:${error instanceof AiRouterError ? error.errorClass : "unknown"}`
                if (!response.destroyed) response.end(`data: ${JSON.stringify(errorBody(fromRouterError(error, clock())))}\n\n`)
            }
        } catch (error) {
            outcome = `error:${error instanceof AiRouterError ? error.errorClass : "unknown"}`
            sendError(response, fromRouterError(error, clock()), headers)
        } finally {
            await iterator?.return?.()
            captured.delete(requestId)
            await record(key, started, outcome, slot.usage, slot.cost)
        }
    }

    function listed(key: StoredKey): { id: string; object: "model"; created: number; owned_by: string }[] {
        const out = new Map<string, { id: string; object: "model"; created: number; owned_by: string }>()
        for (const profile of catalog.profiles) {
            if (allows(key.profiles, profile.name)) out.set(profile.name, { id: profile.name, object: "model", created: 0, owned_by: "profile" })
        }
        for (const model of catalog.models) {
            if (!modelAllowed(key, model)) continue
            for (const name of [model.id, ...model.aliases]) {
                if (!out.has(name)) out.set(name, { id: name, object: "model", created: 0, owned_by: model.providers.join(",") })
            }
        }
        return [...out.values()]
    }

    async function models(request: IncomingMessage, response: ServerResponse, id: string | null): Promise<void> {
        const key = await authenticate(request)
        const data = listed(key)
        if (id === null) {
            send(response, 200, { object: "list", data })
            return
        }
        const found = data.find((entry) => entry.id === id)
        if (found === undefined) throw new GatewayError(404, "model_not_found", `the model "${id}" does not exist`)
        send(response, 200, found)
    }

    async function isAdmin(request: IncomingMessage): Promise<boolean | null> {
        const token = await options.adminToken?.()
        if (token === undefined || token.trim() === "") return null
        const given = bearer(request)
        return given !== undefined && sameSecret(given, token.trim())
    }

    async function health(request: IncomingMessage, response: ServerResponse): Promise<void> {
        const snapshot = await router.health()
        const up = snapshot.providers.some((provider) => provider.breaker !== "open" && provider.keys.some((key) => key.breaker !== "open" && !key.disabled))
        const body = { status: up ? "ok" : "degraded" }
        // The pool's detail (provider ids, key aliases, breakers) is the operator's: it needs the admin token.
        send(response, 200, (await isAdmin(request)) === true ? { ...body, pool: snapshot } : body)
    }

    function adminFailure(error: unknown): GatewayError {
        if (!(error instanceof KeyAdminError)) throw error
        if (error.code === "not_found") return new GatewayError(404, "key_not_found", error.message)
        if (error.code === "revoked") return new GatewayError(409, "key_revoked", error.message)
        if (error.code === "mounted") return new GatewayError(409, "key_mounted", error.message)
        return new GatewayError(400, "invalid_key_spec", error.message)
    }

    async function adminApi(request: IncomingMessage, response: ServerResponse, path: string, url: URL): Promise<void> {
        const allowed = await isAdmin(request)
        if (allowed === null) throw new GatewayError(403, "admin_disabled", "the admin API is off: no admin token is configured")
        if (!allowed) throw new GatewayError(401, "invalid_admin_token", "send the admin token as Authorization: Bearer <token>")
        const method = request.method ?? "GET"
        const parts = path.split("/").slice(3)
        try {
            if (parts.length === 0) {
                if (method === "GET") {
                    send(response, 200, { object: "list", data: await admin.list() })
                    return
                }
                if (method === "POST") {
                    send(response, 201, await admin.create((await readBody(request, maxBody)) as KeySpec))
                    return
                }
            }
            const [id, action] = parts
            if (id !== undefined && parts.length === 1) {
                if (method === "GET") {
                    send(response, 200, await admin.get(id))
                    return
                }
                if (method === "PATCH") {
                    const patch = await readBody(request, maxBody)
                    if (!isRecord(patch)) throw new GatewayError(400, "invalid_key_spec", "the update must be a JSON object")
                    send(response, 200, await admin.update(id, patch))
                    return
                }
            }
            if (id !== undefined && parts.length === 2) {
                if (action === "revoke" && method === "POST") {
                    send(response, 200, await admin.revoke(id))
                    return
                }
                if (action === "rotate" && method === "POST") {
                    send(response, 200, await admin.rotate(id))
                    return
                }
                if (action === "usage" && method === "GET") {
                    const from = url.searchParams.get("from")
                    const to = url.searchParams.get("to")
                    send(response, 200, await admin.usage(id, { ...(from === null ? {} : { from }), ...(to === null ? {} : { to }) }))
                    return
                }
            }
        } catch (error) {
            throw error instanceof GatewayError ? error : adminFailure(error)
        }
        throw new GatewayError(404, "not_found", `no admin route ${method} ${path}`)
    }

    async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
        const url = new URL(request.url ?? "/", "http://gateway.local")
        const path = url.pathname.replace(/\/+$/, "") || "/"
        const method = request.method ?? "GET"
        const only = (wanted: string): void => {
            if (method !== wanted) throw new GatewayError(405, "method_not_allowed", `${path} answers ${wanted} only`)
        }
        if (path === "/health") {
            only("GET")
            await health(request, response)
            return
        }
        if (path === "/admin/keys" || path.startsWith("/admin/keys/")) {
            await adminApi(request, response, path, url)
            return
        }
        if (path === "/v1/models" || path.startsWith("/v1/models/")) {
            only("GET")
            await models(request, response, path === "/v1/models" ? null : decodeURIComponent(path.slice("/v1/models/".length)))
            return
        }
        if (path === "/v1/chat/completions" || path === "/v1/embeddings") {
            only("POST")
            const operation = path === "/v1/embeddings" ? "embeddings" : "chat"
            const prepared = await prepare(await authenticate(request), request, operation)
            if (operation === "chat" && prepared.body.stream === true) await stream(response, prepared)
            else await unary(response, operation, prepared)
            return
        }
        throw new GatewayError(404, "not_found", `no route ${method} ${path}`)
    }

    async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
        try {
            await checked
            await route(request, response)
        } catch (error) {
            if (response.headersSent) {
                response.destroy()
                report(error)
                return
            }
            if (error instanceof GatewayError) sendError(response, error)
            else {
                report(error)
                sendError(response, new GatewayError(500, "internal_error", "the gateway failed"))
            }
        }
    }

    return {
        admin,
        ready: () => checked,
        handle,
        async listen(port, host = "127.0.0.1") {
            await checked
            const server = createServer((request, response) => {
                void handle(request, response)
            })
            servers.add(server)
            await new Promise<void>((resolve, reject) => {
                server.once("error", reject)
                server.listen(port, host, () => {
                    server.off("error", reject)
                    resolve()
                })
            })
            const address = server.address() as AddressInfo
            const shown = address.family === "IPv6" ? `[${address.address}]` : address.address
            return { port: address.port, host: address.address, url: `http://${shown}:${String(address.port)}` }
        },
        async close() {
            unsubscribe()
            await Promise.all(
                [...servers].map(
                    (server) =>
                        new Promise<void>((resolve) => {
                            server.close(() => {
                                resolve()
                            })
                            server.closeAllConnections()
                        }),
                ),
            )
            servers.clear()
        },
    }
}
