import { AttemptError } from "./attempt.ts"
import { classifyFailure } from "./classify.ts"
import { buildCatalog, resolvePolicy, resolveSettings, validateConfig } from "./config.ts"
import type { ResolvedPolicy, Settings } from "./config.ts"
import { AiRouterError, isRetryable, scrub } from "./errors.ts"
import type { AttemptFailure } from "./errors.ts"
import { Emitter } from "./events.ts"
import { readRateLimit } from "./headers.ts"
import type { RateLimitInfo } from "./headers.ts"
import { PoolState } from "./pool.ts"
import type { Blacklisted, Lane, Need, Pick } from "./pool.ts"
import { baseUrlOf, presetOf } from "./providers.ts"
import { resolveSecret } from "./secrets.ts"
import { readChunk, readCompletion, readEmbeddings, readUsage, vectorLength } from "./shapes.ts"
import { parseSse } from "./sse.ts"
import { MemoryStateStore } from "./store.ts"
import type {
    AiRouter,
    CallOptions,
    Capability,
    ChatCompletionChunk,
    ChatCompletionRequest,
    ErrorClass,
    FetchLike,
    Operation,
    PoolConfig,
    RoutingInfo,
    Usage,
} from "./types.ts"
import { wireOf } from "./wire/index.ts"

const BUSY_POLL_MS = 250
const ERROR_BODY_LIMIT = 4096

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
    /** The key value this attempt sends, held only to scrub it from error messages and fingerprint a blacklist. */
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
        return failure.withMessage(scrub(failure.message, [this.secret]))
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

function chatNeed(request: ChatCompletionRequest, streaming: boolean, policy: ResolvedPolicy): Need {
    const capabilities = new Set<Capability>(["chat", ...policy.require])
    if (streaming) capabilities.add("streaming")
    if (request.tools !== undefined && request.tools.length > 0) capabilities.add("tools")
    if (request.response_format !== undefined && request.response_format.type !== "text") capabilities.add("json")
    return {
        capabilities: [...capabilities],
        promptTokens: estimateTokens(request.messages.map((message) => textOf(message.content)).join("\n")),
        outputTokens: request.max_completion_tokens ?? request.max_tokens ?? 0,
        oneIdentity: policy.pinned,
        dimensions: null,
    }
}

function hasToken(chunk: ChatCompletionChunk): boolean {
    return chunk.choices.some((choice) =>
        Object.entries(choice.delta).some(([field, value]) => field !== "role" && value !== null && value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0)),
    )
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function statusOf(error: AttemptError): { status?: number } {
    return error.status === undefined ? {} : { status: error.status }
}

/** The failure an error body describes: its class by the provider's kind, its message, its code and quota window. */
function failureOf(lane: Lane, status: number | undefined, body: unknown, info: RateLimitInfo | null, fallback: string): AttemptError {
    const classified = classifyFailure(presetOf(lane.provider).kind, status, body)
    const root: unknown = Array.isArray(body) ? body[0] : body
    const error = isRecord(root) && isRecord(root.error) ? root.error : root
    const detail = isRecord(error) && typeof error.message === "string" ? error.message : typeof body === "string" && body !== "" ? body : fallback
    const message = status === undefined ? detail : `HTTP ${String(status)}: ${detail}`
    return new AttemptError(classified.errorClass, message, {
        ...(status === undefined ? {} : { status }),
        info,
        ...(classified.code === undefined ? {} : { code: classified.code }),
        ...(classified.window === undefined ? {} : { window: classified.window }),
    })
}

async function errorOf(lane: Lane, response: Response): Promise<AttemptError> {
    const info = readRateLimit(response.headers, Date.now())
    let text = ""
    try {
        text = (await response.text()).slice(0, ERROR_BODY_LIMIT)
    } catch {
        // An unreadable body: the status alone decides.
    }
    let body: unknown = text
    try {
        body = JSON.parse(text)
    } catch {
        // Not JSON: the raw text is the message.
    }
    return failureOf(lane, response.status, body, info, response.statusText || "the provider refused the request")
}

function blacklistMessage(blacklisted: Blacklisted, models: readonly string[]): string {
    const keys = blacklisted.keys.length === 0 ? "" : ` keys ${blacklisted.keys.join(", ")}`
    const budgets = blacklisted.budgets.length === 0 ? "" : ` budget of ${blacklisted.budgets.join(", ")}`
    const what = blacklisted.reason === "quota" ? "quota or budget is spent" : "secret was refused or is missing"
    return `every key serving ${models.join(", ")} is blacklisted (${what}):${keys}${budgets}`
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
                const dimensions = call.need.dimensions === null ? "" : ` at ${String(call.need.dimensions)} dimensions`
                throw call.error("no_candidate", `no provider serves ${call.policy.models.join(", ")} with ${call.need.capabilities.join(", ")}${dimensions} within its context window and budget`)
            }
            if (call.attempts >= call.policy.maxAttempts) {
                const last = call.failures.at(-1)
                throw call.error(last?.errorClass ?? "no_candidate", `all ${String(call.attempts)} attempts failed; last: ${last?.message ?? "none"}`, last?.status === undefined ? {} : { status: last.status })
            }
            const picked = await state.pick(call.lanes, call.need, call.tried, call.policy.timeoutMs + 1000)
            if ("lane" in picked) return picked
            const now = Date.now()
            if (picked.waitUntil > call.deadlineAt) {
                const retryAt = Number.isFinite(picked.waitUntil) ? { retryAt: picked.waitUntil } : {}
                // Every key is out for its own reason, past the deadline: the call fails at once and says why.
                if (picked.blacklisted !== null) throw call.error(picked.blacklisted.reason, blacklistMessage(picked.blacklisted, call.policy.models), retryAt)
                const last = call.failures.at(-1)
                const message = `no candidate is usable before the deadline${last === undefined ? "" : `; last: ${last.message}`}`
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
        // Rate, quota and auth failures belong to one key; the next key owes them no wait. Transient ones back off.
        if (errorClass === "rate_limit" || errorClass === "quota" || errorClass === "auth") return
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
        const wire = wireOf(lane.provider)
        const out: Record<string, string> = {}
        // Neither the provider's headers nor the caller's may carry or replace the secret's header.
        for (const [name, value] of Object.entries({ ...lane.provider.headers, ...options.headers })) {
            // Names are lower-cased, so `Anthropic-Version` and the wire's `anthropic-version` are one header, not two.
            const lower = name.toLowerCase()
            if (lower !== "authorization" && !wire.secretHeaders.includes(lower)) out[lower] = value
        }
        return {
            ...out,
            "content-type": "application/json",
            accept,
            ...wire.headers(secret, lane.provider),
            "x-request-id": call.requestId,
            "idempotency-key": call.requestId,
        }
    }

    async function open(call: Call, pick: Pick, scope: AttemptScope, operation: "chat" | "stream" | "embeddings", body: Record<string, unknown>, options: CallOptions<P>): Promise<Response> {
        const secret = await resolveSecret(pick.lane.key)
        if (secret === undefined) throw new AttemptError("auth", `key ${pick.lane.key.alias} resolved to no value`, { missingKey: true })
        scope.secret = secret
        const wire = wireOf(pick.lane.provider)
        const request = operation === "embeddings" ? wire.embeddings(body, pick.lane.model.id) : wire.chat(body, pick.lane.model.id, operation === "stream", pick.lane.provider)
        let response: Response
        try {
            response = await fetchImpl(`${baseUrlOf(pick.lane.provider)}${request.path}`, {
                method: "POST",
                headers: headers(pick.lane, secret, call, options, operation === "stream" ? "text/event-stream" : "application/json"),
                body: JSON.stringify(request.body),
                signal: scope.controller.signal,
            })
        } catch (error) {
            throw scope.classify(error)
        }
        if (!response.ok) throw await errorOf(pick.lane, response)
        return response
    }

    function begin(call: Call, pick: Pick): void {
        call.attempts++
        call.tried.lanes.add(pick.lane.id)
        call.tried.pairs.add(pick.lane.pair)
        call.tried.providers.add(pick.lane.provider.id)
        state.count(pick.lane)
    }

    async function fail(call: Call, pick: Pick, error: AttemptError, secret: string | undefined, latencyMs: number, content: unknown): Promise<void> {
        await state.failed(pick.lane, error, secret)
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

    async function unary<T>(call: Call, operation: "chat" | "embeddings", body: Record<string, unknown>, options: CallOptions<P>, parse: (json: Record<string, unknown>, lane: Lane) => { value: T; usage: Usage | undefined }): Promise<{ value: T; routing: RoutingInfo }> {
        try {
            for (;;) {
                const pick = await next(call)
                begin(call, pick)
                const scope = new AttemptScope(call, call.policy.timeoutMs)
                const started = Date.now()
                try {
                    const response = await open(call, pick, scope, operation, body, options)
                    let json: unknown
                    try {
                        json = await response.json()
                    } catch (error) {
                        throw scope.cause === null ? new AttemptError("transient", "the provider answered a body that is not JSON") : scope.classify(error)
                    }
                    if (!isRecord(json) && !Array.isArray(json)) throw new AttemptError("transient", "the provider answered a body that is not an object")
                    // An error inside a 200 body (OpenRouter does this) is classified like an error status.
                    if (!isRecord(json) || (json.error !== undefined && json.error !== null)) throw failureOf(pick.lane, undefined, json, null, "the provider answered an error")
                    const parsed = parse(json, pick.lane)
                    const latencyMs = Date.now() - started
                    const routing = await succeed(call, pick, readRateLimit(response.headers, Date.now()), latencyMs, parsed.usage, { request: body, response: json })
                    settle(call, routing, null)
                    return { value: parsed.value, routing }
                } catch (error) {
                    const failure = scope.classify(error)
                    await fail(call, pick, failure, scope.secret, Date.now() - started, body)
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
                    const response = await open(call, pick, scope, "stream", body, options)
                    info = readRateLimit(response.headers, Date.now())
                    if (response.body === null) throw new AttemptError("transient", "the provider answered no stream body")
                    const held: ChatCompletionChunk[] = []
                    for await (const event of wireOf(pick.lane.provider).chunks(parseSse(response.body))) {
                        if (event.kind === "malformed") throw new AttemptError("stream", "the provider streamed an event that is not JSON")
                        if (event.kind === "error") throw failureOf(pick.lane, undefined, event.body, null, "the provider streamed an error")
                        const chunk = readChunk(event.chunk)
                        if (chunk === undefined) continue
                        const chunkUsage = readUsage(chunk.usage)
                        if (chunkUsage !== undefined) usage = chunkUsage
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
                    await fail(call, pick, failure, scope.secret, Date.now() - started, body)
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
            const { start } = prepare("chat", request.model, options, (policy) => chatNeed(request, false, policy))
            const { value, routing } = await unary(start(), "chat", body, options, (json, lane) => {
                const completion = readCompletion(wireOf(lane.provider).chatResponse(json))
                if (completion === undefined) throw new AttemptError("transient", "the provider answered a completion without choices")
                return { value: completion, usage: completion.usage }
            })
            return { ...value, routing }
        },
        stream(request, options = {}) {
            const body: Record<string, unknown> = { ...request }
            delete body.stream
            const { requestId, start } = prepare("stream", request.model, options, (policy) => chatNeed(request, true, policy))
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
                // An embeddings call never changes model space: every lane serves the first lane's model identity.
                oneIdentity: true,
                dimensions: request.dimensions ?? null,
            }))
            const { value, routing } = await unary(start(), "embeddings", { ...request }, options, (json, lane) => {
                const embeddings = readEmbeddings(json)
                if (embeddings === undefined) throw new AttemptError("transient", "the provider answered embeddings without a list of vectors")
                const expected = lane.model.dimensions
                const wrong = expected === undefined ? undefined : embeddings.data.find((entry) => vectorLength(entry.embedding) !== expected)
                // A vector of another length is another space: never handed to a caller whose index holds the pinned one.
                if (wrong !== undefined) throw new AttemptError("transient", `the provider answered ${String(vectorLength(wrong.embedding))}-dimensional vectors, the model is declared at ${String(expected)}`)
                return { value: embeddings, usage: embeddings.usage }
            })
            return { ...value, routing }
        },
        catalog: () => catalog,
        health: () => state.health(),
        stats: () => state.stats(),
        on: (event, handler) => emitter.on(event, handler),
        reset: (target = {}) => state.reset(target),
    }
}
