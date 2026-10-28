import { buildCatalog, resolvePolicy, resolveSettings, validateConfig } from "./config.ts"
import type { ResolvedPolicy, Settings } from "./config.ts"
import { AiRouterError, classifyProviderError, classifyStatus, isRetryable, scrub } from "./errors.ts"
import type { AttemptFailure } from "./errors.ts"
import { Emitter } from "./events.ts"
import { readRateLimit } from "./headers.ts"
import type { RateLimitInfo } from "./headers.ts"
import { PoolState } from "./pool.ts"
import type { Lane, Need, Pick } from "./pool.ts"
import { parseSse } from "./sse.ts"
import { MemoryStateStore } from "./store.ts"
import type {
    AiRouter,
    CallOptions,
    Capability,
    ChatCompletion,
    ChatCompletionChunk,
    ChatCompletionRequest,
    EmbeddingsResponse,
    ErrorClass,
    FetchLike,
    KeyConfig,
    Operation,
    PoolConfig,
    RoutingInfo,
    Usage,
} from "./types.ts"

const BUSY_POLL_MS = 250
const ERROR_BODY_LIMIT = 4096

/** A failed attempt inside the router, before it becomes part of an `AiRouterError`. */
class AttemptError extends Error {
    readonly errorClass: ErrorClass
    readonly status: number | undefined
    readonly info: RateLimitInfo | null
    readonly missingKey: boolean

    constructor(errorClass: ErrorClass, message: string, options: { status?: number; info?: RateLimitInfo | null; missingKey?: boolean } = {}) {
        super(message)
        this.errorClass = errorClass
        this.status = options.status
        this.info = options.info ?? null
        this.missingKey = options.missingKey ?? false
    }
}

/** One call's lifetime: its deadline, its cancellation, the pairs it tried and the failures it met. */
class Call {
    readonly requestId: string
    readonly operation: Operation
    readonly policy: ResolvedPolicy
    readonly need: Need
    readonly lanes: readonly Lane[]
    readonly started = Date.now()
    readonly deadlineAt: number
    readonly controller = new AbortController()
    readonly tried = { lanes: new Set<string>(), pairs: new Set<string>(), providers: new Set<string>() }
    readonly failures: AttemptFailure[] = []
    attempts = 0
    transientFailures = 0
    cause: "cancelled" | "deadline" | null = null
    readonly #timer: ReturnType<typeof setTimeout>
    readonly #signal: AbortSignal | undefined
    readonly #onAbort = (): void => {
        this.#abort("cancelled")
    }

    constructor(operation: Operation, requestId: string, policy: ResolvedPolicy, need: Need, lanes: readonly Lane[], signal: AbortSignal | undefined) {
        this.operation = operation
        this.requestId = requestId
        this.policy = policy
        this.need = need
        this.lanes = lanes
        this.deadlineAt = this.started + policy.deadlineMs
        this.#timer = setTimeout(() => {
            this.#abort("deadline")
        }, policy.deadlineMs)
        this.#signal = signal
        if (signal?.aborted === true) this.#abort("cancelled")
        else signal?.addEventListener("abort", this.#onAbort, { once: true })
    }

    #abort(cause: "cancelled" | "deadline"): void {
        if (this.controller.signal.aborted) return
        this.cause = cause
        this.controller.abort(new AttemptError(cause, cause === "cancelled" ? "the call was cancelled" : "the call passed its deadline"))
    }

    /** The error a stopped call throws. */
    stopped(): AiRouterError {
        const cause = this.cause ?? "cancelled"
        return this.error(cause, cause === "cancelled" ? "the call was cancelled" : `the call passed its ${String(this.policy.deadlineMs)} ms deadline`)
    }

    /** Builds the call's error with every attempt it made. */
    error(errorClass: ErrorClass, message: string, extra: { retryAt?: number; status?: number; afterFirstToken?: boolean } = {}): AiRouterError {
        const last = this.failures.at(-1)
        return new AiRouterError({
            errorClass,
            message,
            requestId: this.requestId,
            attempts: [...this.failures],
            ...(last === undefined ? {} : { provider: last.provider, key: last.key, model: last.model }),
            ...extra,
        })
    }

    /** Stops the timers and listeners of the call. */
    dispose(): void {
        clearTimeout(this.#timer)
        this.#signal?.removeEventListener("abort", this.#onAbort)
    }
}

/** One attempt's abort controller: it follows the call and adds the attempt's own timeout. */
class AttemptScope {
    readonly controller = new AbortController()
    cause: ErrorClass | null = null
    /** The key value this attempt sends, held only to scrub it from error messages. */
    secret: string | undefined
    #timer: ReturnType<typeof setTimeout> | undefined
    readonly #call: Call
    readonly #follow = (): void => {
        this.cause = this.#call.cause
        this.controller.abort(this.#call.controller.signal.reason)
    }

    constructor(call: Call, timeoutMs: number) {
        this.#call = call
        if (call.controller.signal.aborted) this.#follow()
        else call.controller.signal.addEventListener("abort", this.#follow, { once: true })
        this.arm(timeoutMs)
    }

    /** Restarts the attempt's timeout. */
    arm(timeoutMs: number): void {
        clearTimeout(this.#timer)
        this.#timer = setTimeout(() => {
            if (this.controller.signal.aborted) return
            this.cause = "timeout"
            this.controller.abort(new AttemptError("timeout", `the attempt passed its ${String(timeoutMs)} ms timeout`))
        }, timeoutMs)
    }

    /** Turns whatever an attempt threw into an `AttemptError`, naming an abort by its cause. */
    classify(error: unknown): AttemptError {
        const failure =
            error instanceof AttemptError
                ? error
                : this.cause !== null
                  ? new AttemptError(this.cause, this.cause === "timeout" ? "the attempt timed out" : `the call was ${this.cause === "deadline" ? "past its deadline" : "cancelled"}`)
                  : new AttemptError("network", error instanceof Error ? error.message : "the request failed")
        // Whatever a provider echoed, the key value never leaves the attempt.
        if (this.secret === undefined || !failure.message.includes(this.secret)) return failure
        return new AttemptError(failure.errorClass, scrub(failure.message, [this.secret]), { ...statusOf(failure), info: failure.info, missingKey: failure.missingKey })
    }

    /** Stops the timer and the call listener. */
    dispose(): void {
        clearTimeout(this.#timer)
        this.#call.controller.signal.removeEventListener("abort", this.#follow)
    }
}

function textOf(content: ChatCompletionRequest["messages"][number]["content"]): string {
    if (content === null) return ""
    if (typeof content === "string") return content
    return content.map((part) => part.text ?? "").join("")
}

function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
}

function chatNeed(request: ChatCompletionRequest, streaming: boolean, require: readonly Capability[]): Need {
    const capabilities = new Set<Capability>(["chat", ...require])
    if (streaming) capabilities.add("streaming")
    if (request.tools !== undefined && request.tools.length > 0) capabilities.add("tools")
    if (request.response_format !== undefined && request.response_format.type !== "text") capabilities.add("json")
    return {
        capabilities: [...capabilities],
        promptTokens: estimateTokens(request.messages.map((message) => textOf(message.content)).join("\n")),
        outputTokens: request.max_completion_tokens ?? request.max_tokens ?? 0,
    }
}

function hasToken(chunk: ChatCompletionChunk): boolean {
    return chunk.choices.some((choice) =>
        Object.entries(choice.delta).some(([field, value]) => field !== "role" && value !== null && value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0)),
    )
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null
}

function usageOf(json: Record<string, unknown>): Usage | undefined {
    return isRecord(json.usage) && typeof json.usage.prompt_tokens === "number" ? (json.usage as unknown as Usage) : undefined
}

function statusOf(error: AttemptError): { status?: number } {
    return error.status === undefined ? {} : { status: error.status }
}

/** Parses one SSE data payload: a chunk, null for an event to skip, or a thrown error the provider streamed. */
function parseChunk(data: string): ChatCompletionChunk | null {
    let json: unknown
    try {
        json = JSON.parse(data)
    } catch {
        throw new AttemptError("stream", "the provider streamed an event that is not JSON")
    }
    if (!isRecord(json)) return null
    if (json.error !== undefined && json.error !== null) {
        const message = isRecord(json.error) && typeof json.error.message === "string" ? json.error.message : "the provider streamed an error"
        throw new AttemptError(classifyProviderError(json.error), message)
    }
    return Array.isArray(json.choices) ? (json as unknown as ChatCompletionChunk) : null
}

async function resolveSecret(key: KeyConfig): Promise<string | undefined> {
    const value = "env" in key ? process.env[key.env] : await key.resolve()
    return value === undefined || value.trim() === "" ? undefined : value.trim()
}

async function errorBody(response: Response): Promise<string> {
    let text: string
    try {
        text = (await response.text()).slice(0, ERROR_BODY_LIMIT)
    } catch {
        return `HTTP ${String(response.status)}`
    }
    let message = text
    try {
        const json: unknown = JSON.parse(text)
        if (isRecord(json) && isRecord(json.error) && typeof json.error.message === "string") message = json.error.message
        else if (isRecord(json) && typeof json.message === "string") message = json.message
    } catch {
        // Not JSON: the raw text is the message.
    }
    return `HTTP ${String(response.status)}: ${message || response.statusText}`
}

/** Creates a router over a pool of providers, keys and models. The pool is validated now; keys are read per attempt. */
export function createRouter<P extends string = string>(config: PoolConfig<P>): AiRouter<P> {
    validateConfig(config)
    const settings: Settings = resolveSettings(config)
    const emitter = new Emitter()
    const state = new PoolState(config.providers, settings, config.store ?? new MemoryStateStore(), emitter)
    const fetchImpl: FetchLike = config.fetch ?? ((input, init) => fetch(input, init))
    const random = config.random ?? Math.random
    const catalog = buildCatalog(config)

    // The policy is resolved at once, so a bad profile or model throws from the call itself; the clock starts at start().
    function prepare(operation: Operation, model: string | undefined, options: CallOptions<P>, need: (policy: ResolvedPolicy) => Need): { requestId: string; start: () => Call } {
        const policy = resolvePolicy(config, options, model)
        const callNeed = need(policy)
        const lanes = state.lanes(policy, callNeed)
        const requestId = options.requestId ?? globalThis.crypto.randomUUID()
        return {
            requestId,
            start: () => {
                state.totals.requests++
                return new Call(operation, requestId, policy, callNeed, lanes, options.signal)
            },
        }
    }

    async function next(call: Call): Promise<Pick> {
        for (;;) {
            if (call.controller.signal.aborted) throw call.stopped()
            if (call.lanes.length === 0) {
                throw call.error("no_candidate", `no provider serves ${call.policy.models.join(", ")} with ${call.need.capabilities.join(", ")} within its context window and budget`)
            }
            if (call.attempts >= call.policy.maxAttempts) {
                const last = call.failures.at(-1)
                throw call.error(last?.errorClass ?? "no_candidate", `all ${String(call.attempts)} attempts failed; last: ${last?.message ?? "none"}`, last?.status === undefined ? {} : { status: last.status })
            }
            const picked = await state.pick(call.lanes, call.need, call.tried, call.policy.timeoutMs + 1000)
            if ("lane" in picked) return picked
            const now = Date.now()
            if (picked.waitUntil > call.deadlineAt) {
                const last = call.failures.at(-1)
                const message = `no candidate is usable before the deadline${last === undefined ? "" : `; last: ${last.message}`}`
                const retryAt = Number.isFinite(picked.waitUntil) ? { retryAt: picked.waitUntil } : {}
                throw call.error(last?.errorClass ?? "no_candidate", message, retryAt)
            }
            try {
                await state.waitForCapacity(picked.busy ? BUSY_POLL_MS : picked.waitUntil - now, call.controller.signal)
            } catch {
                throw call.stopped()
            }
        }
    }

    async function backoff(call: Call, errorClass: ErrorClass): Promise<void> {
        // Rate and auth failures belong to one key; the next key owes them no wait. Transient ones back off.
        if (errorClass === "rate_limit" || errorClass === "auth") return
        call.transientFailures++
        const { baseMs, factor, maxMs } = settings.backoff
        const delay = Math.min(maxMs, baseMs * factor ** (call.transientFailures - 1)) * (0.5 + random() * 0.5)
        try {
            await new Promise<void>((resolve, reject) => {
                const signal = call.controller.signal
                const timer = setTimeout(() => {
                    signal.removeEventListener("abort", stop)
                    resolve()
                }, delay)
                const stop = (): void => {
                    clearTimeout(timer)
                    reject(new Error("stopped"))
                }
                if (signal.aborted) stop()
                else signal.addEventListener("abort", stop, { once: true })
            })
        } catch {
            throw call.stopped()
        }
    }

    function headers(lane: Lane, secret: string, call: Call, options: CallOptions<P>, accept: string): Record<string, string> {
        const out: Record<string, string> = {}
        for (const [name, value] of Object.entries({ ...lane.provider.headers, ...options.headers })) {
            if (name.toLowerCase() !== "authorization") out[name] = value
        }
        return {
            ...out,
            "content-type": "application/json",
            accept,
            authorization: `Bearer ${secret}`,
            "x-request-id": call.requestId,
            "idempotency-key": call.requestId,
        }
    }

    async function open(call: Call, pick: Pick, scope: AttemptScope, path: string, body: Record<string, unknown>, options: CallOptions<P>, accept: string): Promise<Response> {
        let secret: string | undefined
        try {
            secret = await resolveSecret(pick.lane.key)
        } catch {
            secret = undefined
        }
        if (secret === undefined) throw new AttemptError("auth", `key ${pick.lane.key.alias} resolved to no value`, { missingKey: true })
        scope.secret = secret
        let response: Response
        try {
            response = await fetchImpl(`${pick.lane.provider.baseUrl.replace(/\/+$/, "")}${path}`, {
                method: "POST",
                headers: headers(pick.lane, secret, call, options, accept),
                body: JSON.stringify({ ...body, model: pick.lane.model.id }),
                signal: scope.controller.signal,
            })
        } catch (error) {
            throw scope.classify(error)
        }
        if (!response.ok) {
            const info = readRateLimit(response.headers, Date.now())
            throw new AttemptError(classifyStatus(response.status), await errorBody(response), { status: response.status, info })
        }
        return response
    }

    function begin(call: Call, pick: Pick): void {
        call.attempts++
        call.tried.lanes.add(pick.lane.id)
        call.tried.pairs.add(pick.lane.pair)
        call.tried.providers.add(pick.lane.provider.id)
        state.count(pick.lane)
    }

    async function fail(call: Call, pick: Pick, error: AttemptError, latencyMs: number, content: unknown): Promise<void> {
        await state.failed(pick.lane, error.errorClass, error.info, error.missingKey)
        call.failures.push({
            provider: pick.lane.provider.id,
            key: pick.lane.key.alias,
            model: pick.lane.model.id,
            errorClass: error.errorClass,
            message: error.message,
            ...(error.status === undefined ? {} : { status: error.status }),
        })
        emitter.emit("attempt", {
            type: "attempt",
            requestId: call.requestId,
            operation: call.operation,
            attempt: call.attempts,
            provider: pick.lane.provider.id,
            key: pick.lane.key.alias,
            model: pick.lane.model.id,
            latencyMs,
            outcome: "failure",
            errorClass: error.errorClass,
            ...(error.status === undefined ? {} : { status: error.status }),
            ...(settings.includeContent ? { content: { request: content } } : {}),
        })
    }

    async function succeed(call: Call, pick: Pick, info: RateLimitInfo | null, latencyMs: number, usage: Usage | undefined, content: { request: unknown; response?: unknown }): Promise<RoutingInfo> {
        const cost = await state.succeeded(pick.lane, info, latencyMs, usage)
        emitter.emit("attempt", {
            type: "attempt",
            requestId: call.requestId,
            operation: call.operation,
            attempt: call.attempts,
            provider: pick.lane.provider.id,
            key: pick.lane.key.alias,
            model: pick.lane.model.id,
            latencyMs,
            outcome: "success",
            ...(usage === undefined ? {} : { usage }),
            ...(cost === undefined ? {} : { cost }),
            ...(settings.includeContent ? { content } : {}),
        })
        return {
            requestId: call.requestId,
            provider: pick.lane.provider.id,
            key: pick.lane.key.alias,
            model: pick.lane.model.id,
            attempts: call.attempts,
            latencyMs: Date.now() - call.started,
            ...(cost === undefined ? {} : { cost }),
        }
    }

    function settle(call: Call, routing: RoutingInfo | null, error: AiRouterError | null): void {
        if (routing !== null) state.totals.succeeded++
        else state.totals.failed++
        emitter.emit("request", {
            type: "request",
            requestId: call.requestId,
            operation: call.operation,
            outcome: routing === null ? "failure" : "success",
            attempts: call.attempts,
            latencyMs: Date.now() - call.started,
            ...(routing === null ? {} : { provider: routing.provider, key: routing.key, model: routing.model }),
            ...(error === null ? {} : { errorClass: error.errorClass }),
        })
        call.dispose()
    }

    function toRouterError(call: Call, error: unknown): AiRouterError {
        if (error instanceof AiRouterError) return error
        return call.error("network", error instanceof Error ? error.message : "the call failed")
    }

    async function unary<T>(call: Call, path: string, body: Record<string, unknown>, options: CallOptions<P>, parse: (json: Record<string, unknown>) => { value: T; usage: Usage | undefined }): Promise<{ value: T; routing: RoutingInfo }> {
        try {
            for (;;) {
                const pick = await next(call)
                begin(call, pick)
                const scope = new AttemptScope(call, call.policy.timeoutMs)
                const started = Date.now()
                try {
                    const response = await open(call, pick, scope, path, body, options, "application/json")
                    let json: unknown
                    try {
                        json = await response.json()
                    } catch (error) {
                        throw scope.cause === null ? new AttemptError("transient", "the provider answered a body that is not JSON") : scope.classify(error)
                    }
                    if (!isRecord(json)) throw new AttemptError("transient", "the provider answered a body that is not an object")
                    if (json.error !== undefined && json.error !== null) {
                        const message = isRecord(json.error) && typeof json.error.message === "string" ? json.error.message : "the provider answered an error"
                        throw new AttemptError(classifyProviderError(json.error), message)
                    }
                    const parsed = parse(json)
                    const latencyMs = Date.now() - started
                    const routing = await succeed(call, pick, readRateLimit(response.headers, Date.now()), latencyMs, parsed.usage, { request: body, response: json })
                    settle(call, routing, null)
                    return { value: parsed.value, routing }
                } catch (error) {
                    const failure = scope.classify(error)
                    await fail(call, pick, failure, Date.now() - started, body)
                    if (failure.errorClass === "cancelled" || failure.errorClass === "deadline") throw call.stopped()
                    if (!isRetryable(failure.errorClass)) {
                        throw call.error(failure.errorClass, failure.message, statusOf(failure))
                    }
                    await backoff(call, failure.errorClass)
                } finally {
                    scope.dispose()
                    await state.release(pick.lane, pick.leases)
                }
            }
        } catch (error) {
            const routerError = toRouterError(call, error)
            settle(call, null, routerError)
            throw routerError
        }
    }

    async function* streamCall(call: Call, body: Record<string, unknown>, options: CallOptions<P>): AsyncGenerator<ChatCompletionChunk, void, undefined> {
        let settled = false
        try {
            for (;;) {
                const pick = await next(call)
                begin(call, pick)
                const scope = new AttemptScope(call, call.policy.timeoutMs)
                const started = Date.now()
                let firstToken = false
                let usage: Usage | undefined
                let info: RateLimitInfo | null = null
                // "pending" in the finally block means the consumer stopped reading: no catch ran and no success did.
                let outcome: "pending" | "failed" | "done" = "pending"
                try {
                    const response = await open(call, pick, scope, "/chat/completions", { ...body, stream: true }, options, "text/event-stream")
                    info = readRateLimit(response.headers, Date.now())
                    if (response.body === null) throw new AttemptError("transient", "the provider answered no stream body")
                    const held: ChatCompletionChunk[] = []
                    for await (const event of parseSse(response.body)) {
                        if (event.data === "[DONE]") break
                        const chunk = parseChunk(event.data)
                        if (chunk === null) continue
                        if (isRecord(chunk.usage)) usage = chunk.usage
                        scope.arm(call.policy.timeoutMs)
                        if (firstToken) {
                            yield chunk
                            continue
                        }
                        held.push(chunk)
                        if (hasToken(chunk)) {
                            firstToken = true
                            for (const early of held.splice(0)) yield early
                        }
                    }
                    for (const early of held.splice(0)) yield early
                    outcome = "done"
                    const routing = await succeed(call, pick, info, Date.now() - started, usage, { request: body })
                    settled = true
                    settle(call, routing, null)
                    return
                } catch (error) {
                    outcome = "failed"
                    const failure = scope.classify(error)
                    await fail(call, pick, failure, Date.now() - started, body)
                    if (failure.errorClass === "cancelled" || failure.errorClass === "deadline") throw call.stopped()
                    if (firstToken) {
                        throw call.error(failure.errorClass, `the stream failed after its first token: ${failure.message}`, { afterFirstToken: true, ...statusOf(failure) })
                    }
                    if (!isRetryable(failure.errorClass)) throw call.error(failure.errorClass, failure.message, statusOf(failure))
                    await backoff(call, failure.errorClass)
                } finally {
                    scope.controller.abort()
                    scope.dispose()
                    if (outcome === "pending") {
                        const routing = await succeed(call, pick, info, Date.now() - started, usage, { request: body })
                        settled = true
                        settle(call, routing, null)
                    }
                    await state.release(pick.lane, pick.leases)
                }
            }
        } catch (error) {
            const routerError = toRouterError(call, error)
            settled = true
            settle(call, null, routerError)
            throw routerError
        } finally {
            if (!settled) settle(call, null, call.error("cancelled", "the consumer stopped reading"))
        }
    }

    return {
        async chat(request, options = {}) {
            const body: Record<string, unknown> = { ...request }
            delete body.stream
            const { start } = prepare("chat", request.model, options, (policy) => chatNeed(request, false, policy.require))
            const { value, routing } = await unary(start(), "/chat/completions", body, options, (json) => ({
                value: json,
                usage: usageOf(json),
            }))
            return { ...value, routing } as ChatCompletion
        },
        stream(request, options = {}) {
            const body: Record<string, unknown> = { ...request }
            delete body.stream
            const { requestId, start } = prepare("stream", request.model, options, (policy) => chatNeed(request, true, policy.require))
            return {
                requestId,
                [Symbol.asyncIterator]: () => streamCall(start(), body, options),
            }
        },
        async embeddings(request, options = {}) {
            const { start } = prepare("embeddings", request.model, options, (policy) => ({
                capabilities: ["embeddings", ...policy.require],
                promptTokens: estimateTokens(typeof request.input === "string" ? request.input : request.input.join("\n")),
                outputTokens: 0,
            }))
            const { value, routing } = await unary(start(), "/embeddings", { ...request }, options, (json) => ({
                value: json as unknown as Omit<EmbeddingsResponse, "routing">,
                usage: usageOf(json),
            }))
            return { ...value, routing }
        },
        catalog: () => catalog,
        health: () => state.health(),
        stats: () => state.stats(),
        on: (event, handler) => emitter.on(event, handler),
        reset: (target = {}) => state.reset(target),
    }
}
