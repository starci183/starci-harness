import type { StateStore } from "./store.ts"

/** A value or a promise of it: store adapters and key resolvers may answer either way. */
export type MaybePromise<T> = T | Promise<T>

/** What a model can do; a request needs every capability its shape implies. */
export type Capability = "chat" | "streaming" | "tools" | "json" | "embeddings" | "vision"

/** The price of a model per one million tokens, in whatever currency the pool uses. */
export interface ModelCost {
    readonly input: number
    readonly output: number
}

/** One model a provider serves. `id` is the name sent to the provider; `aliases` are names a caller may use instead. */
export interface ModelConfig {
    readonly id: string
    readonly aliases?: readonly string[]
    readonly contextWindow?: number
    readonly cost?: ModelCost
    /** Omitted means every chat capability (chat, streaming, tools, json) and no embeddings. */
    readonly capabilities?: readonly Capability[]
    readonly weight?: number
    /**
     * The model's identity across providers, when two providers name one model differently (`text-embedding-3-small` at
     * OpenAI, `openai/text-embedding-3-small` at OpenRouter). Default: the id. A pinned profile and every embeddings call
     * stay on one identity.
     */
    readonly identity?: string
    /** The length of the vectors an embeddings model answers; a response of another length fails the attempt. */
    readonly dimensions?: number
}

/** Returns the secret of a key at the moment of an attempt; an empty or missing answer disables the key. */
export type KeyResolver = () => MaybePromise<string | undefined>

interface KeyCommon {
    /** The name of the key in telemetry, health and errors; the secret itself is never exposed. */
    readonly alias: string
    readonly weight?: number
    /** The most requests this key carries at once in this process. */
    readonly maxConcurrency?: number
}

/** A key read from an environment variable at each attempt. */
export interface EnvKeyConfig extends KeyCommon {
    readonly env: string
}

/** A key returned by a resolver function at each attempt (a vault, a rotation, a test value). */
export interface ResolverKeyConfig extends KeyCommon {
    readonly resolve: KeyResolver
}

/** One API key of a provider, given by reference: an environment variable name or a resolver. */
export type KeyConfig = EnvKeyConfig | ResolverKeyConfig

/**
 * Which provider an endpoint is: it sets the wire protocol, the auth header, the default base URL, whether it serves
 * embeddings, and how its errors are classified (docs/design.md, the provider matrix). `openai-compatible` (the default)
 * is any endpoint that speaks the OpenAI chat-completions API with a bearer key: Ollama, vLLM, Together, LiteLLM...
 */
export type ProviderKind = "openai" | "anthropic" | "openrouter" | "qwen" | "deepseek" | "gemini" | "groq" | "openai-compatible"

/** A provider's own spending cap, in the unit of the models' `cost`; past it the provider is no candidate until the next UTC day or month. */
export interface ProviderBudget {
    readonly costPerDay?: number
    readonly costPerMonth?: number
}

/** One provider endpoint with its keys and models. */
export interface ProviderConfig {
    readonly id: string
    /** Default `openai-compatible`. */
    readonly kind?: ProviderKind
    /** The base URL the API paths hang from, such as `https://api.openai.com/v1`; required for `openai-compatible`, else the kind's default. */
    readonly baseUrl?: string
    readonly headers?: Readonly<Record<string, string>>
    readonly weight?: number
    /** The most requests this provider carries at once in this process, across its keys. */
    readonly maxConcurrency?: number
    /** The `max_tokens` sent to a provider that requires one (Anthropic) when the request sets none. Default 4096. */
    readonly defaultMaxTokens?: number
    readonly budget?: ProviderBudget
    readonly keys: readonly KeyConfig[]
    readonly models: readonly ModelConfig[]
}

/** One candidate of a profile: a model by id or alias, on one provider or on any that serves it, weighted within its tier. */
export interface CandidateRef {
    readonly model: string
    readonly provider?: string
    readonly weight?: number
}

/** How one call picks and falls back between models. */
export interface ModelPolicy {
    /** The preferred model (id or alias); the request's own `model` is used when this is absent. */
    readonly model?: string
    /** Models tried, in order, once the preferred model has no usable candidate. */
    readonly fallbacks?: readonly string[]
    /** False pins the call to the preferred model (or the first tier of `candidates`); the fallbacks are ignored. Default true. */
    readonly allowFallback?: boolean
    /** The most attempts across keys, providers and models. Default 4. */
    readonly maxAttempts?: number
    /** The limit of one attempt in milliseconds (for a stream: until the first token, then between chunks). Default 60000. */
    readonly timeoutMs?: number
    /** The limit of the whole call in milliseconds, waits and retries included. Default 120000. */
    readonly deadlineMs?: number
    /** A model whose estimated worst-case cost for this request exceeds `maxCost` is not a candidate. */
    readonly budget?: { readonly maxCost?: number }
    /** Restricts the call to these provider ids. */
    readonly providers?: readonly string[]
    /** Capabilities required beyond those the request shape implies. */
    readonly require?: readonly Capability[]
    /**
     * The ordered candidates of a profile, in place of `model` and `fallbacks`: each entry is a tier, tried in order; an
     * entry that is a list is one tier whose candidates share the load by weight.
     */
    readonly candidates?: readonly (CandidateRef | readonly CandidateRef[])[]
    /**
     * True pins the profile to one model identity (an embeddings space): every candidate must resolve to models of one
     * `identity` and `dimensions`, so keys and providers rotate but the model never changes, and a call cannot name another.
     */
    readonly pinned?: boolean
}

/** The thresholds of a circuit breaker. */
export interface BreakerConfig {
    /** Consecutive failures that open the breaker. */
    readonly failureThreshold?: number
    /** The first cooldown of an open breaker; it doubles on each failed probe. */
    readonly cooldownMs?: number
    /** The cooldown never grows past this. */
    readonly maxCooldownMs?: number
}

/** The retry, breaker and blacklist behaviour of the pool. */
export interface ResilienceConfig {
    /** The breaker of each key. Defaults: 3 failures, 15000 ms, 300000 ms. */
    readonly keyBreaker?: BreakerConfig
    /** The breaker of each provider, fed by every key's transient failures. Defaults: 8 failures, 30000 ms, 300000 ms. */
    readonly providerBreaker?: BreakerConfig
    /** Jittered exponential backoff between attempts after a transient failure. Defaults: 100 ms, factor 2, 5000 ms. */
    readonly backoff?: { readonly baseMs?: number; readonly factor?: number; readonly maxMs?: number }
    /** How long a key that answered 401/403 stays blacklisted; null keeps it out until its secret changes or `reset()`. Default null. */
    readonly authDisableMs?: number | null
    /** The cooldown of a key and model after a 429 without a retry-after header. Default 10000. */
    readonly rateLimitCooldownMs?: number
    /**
     * How long a key whose quota or credit is exhausted stays blacklisted when the provider's answer names no reset
     * window; a new secret for the key lifts it at once. Default 21600000 (6 hours).
     */
    readonly quotaBlacklistMs?: number
}

/** How candidates of equal health are ranked. */
export interface SelectionConfig {
    /**
     * A candidate whose latency EWMA exceeds `best * latencyTolerance + latencySlackMs` drops out of the tie.
     * Defaults 1.5 and 50 ms; the slack keeps millisecond jitter from deciding between equally fast keys. A lane is ranked
     * by latency once it has three samples, and one left out drifts toward the best EWMA until it is tried again.
     */
    readonly latencyTolerance?: number
    readonly latencySlackMs?: number
    /** The weight of the newest latency sample in the EWMA. Default 0.3. */
    readonly ewmaAlpha?: number
    /** A key and model with this many remaining requests or fewer is used only when nothing healthier is. Default 1. */
    readonly lowHeadroom?: number
}

/** The opt-in content of telemetry. */
export interface TelemetryConfig {
    /** True adds the request body and the response to attempt events. Default false. */
    readonly includeContent?: boolean
}

/** A `fetch`-compatible function; the global `fetch` is the default. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

/** The whole pool as data. `Profiles` names the policy profiles a call may select. */
export interface PoolConfig<Profiles extends string = string> {
    readonly providers: readonly ProviderConfig[]
    /** The policy every call starts from. */
    readonly defaults?: ModelPolicy
    /** Named policies a call selects with `{ profile }`; they override `defaults`. */
    readonly profiles?: Readonly<Record<Profiles, ModelPolicy>>
    readonly resilience?: ResilienceConfig
    readonly selection?: SelectionConfig
    readonly telemetry?: TelemetryConfig
    /**
     * Where breaker, blacklist, headroom and budget state lives; in memory by default. A durable store
     * (`openSqliteStateStore`, `redisStateStore`) keeps blacklisted keys out across a restart and shares them across processes.
     */
    readonly store?: StateStore
    /** The prefix of every store key, so several pools can share one store. Default `ai-router`. */
    readonly storeNamespace?: string
    readonly fetch?: FetchLike
    /** The random source of jitter, in [0, 1). Default `Math.random`. */
    readonly random?: () => number
}

/** One part of a multi-part message content. */
export interface ContentPart {
    readonly type: string
    readonly text?: string
    readonly [key: string]: unknown
}

/** One tool call an assistant message carries. */
export interface ToolCall {
    readonly id: string
    readonly type: "function"
    readonly function: { readonly name: string; readonly arguments: string }
}

/** One message of a chat-completions request. */
export interface ChatMessage {
    readonly role: "system" | "developer" | "user" | "assistant" | "tool"
    readonly content: string | readonly ContentPart[] | null
    readonly name?: string
    readonly tool_calls?: readonly ToolCall[]
    readonly tool_call_id?: string
}

/** An OpenAI chat-completions request; unknown fields pass through to an OpenAI-compatible provider. */
export interface ChatCompletionRequest {
    /** The model (id or alias); a policy's `model` takes precedence. */
    readonly model?: string
    readonly messages: readonly ChatMessage[]
    readonly max_tokens?: number
    readonly max_completion_tokens?: number
    readonly temperature?: number
    readonly top_p?: number
    readonly stop?: string | readonly string[]
    readonly seed?: number
    readonly user?: string
    readonly tools?: readonly unknown[]
    readonly tool_choice?: unknown
    readonly parallel_tool_calls?: boolean
    readonly response_format?: { readonly type: string; readonly [key: string]: unknown }
    readonly stream_options?: { readonly include_usage?: boolean }
    readonly [key: string]: unknown
}

/** Token counts a provider reports. */
export interface Usage {
    readonly prompt_tokens: number
    readonly completion_tokens?: number
    readonly total_tokens: number
    readonly [key: string]: unknown
}

/** Where a successful call went and what it cost. */
export interface RoutingInfo {
    readonly requestId: string
    readonly provider: string
    readonly key: string
    /** The configured model id that answered. */
    readonly model: string
    readonly attempts: number
    readonly latencyMs: number
    /** Computed from usage and the model's cost; absent when either is unknown. */
    readonly cost?: number
}

/** The assistant message of one choice. */
export interface ChatChoiceMessage {
    readonly role: "assistant"
    readonly content: string | null
    readonly tool_calls?: readonly ToolCall[]
    readonly [key: string]: unknown
}

/** One choice of a chat completion. */
export interface ChatChoice {
    readonly index: number
    readonly message: ChatChoiceMessage
    readonly finish_reason: string | null
}

/** An OpenAI chat completion as a provider answers it. */
export interface ChatCompletionBody {
    readonly id: string
    readonly object: "chat.completion"
    readonly created: number
    readonly model: string
    readonly choices: readonly ChatChoice[]
    readonly usage?: Usage
    readonly [key: string]: unknown
}

/** An OpenAI chat completion, with the routing that produced it. */
export interface ChatCompletion extends ChatCompletionBody {
    readonly routing: RoutingInfo
}

/** One tool-call fragment of a streamed delta. */
export interface ToolCallDelta {
    readonly index: number
    readonly id?: string
    readonly type?: "function"
    readonly function?: { readonly name?: string; readonly arguments?: string }
}

/** One OpenAI chat-completion chunk of a stream. */
export interface ChatCompletionChunk {
    readonly id: string
    readonly object: "chat.completion.chunk"
    readonly created: number
    readonly model: string
    readonly choices: readonly {
        readonly index: number
        readonly delta: {
            readonly role?: "assistant"
            readonly content?: string | null
            readonly tool_calls?: readonly ToolCallDelta[]
            readonly [key: string]: unknown
        }
        readonly finish_reason: string | null
    }[]
    readonly usage?: Usage | null
    readonly [key: string]: unknown
}

/** A stream of chunks plus the id that names the call in telemetry. */
export interface ChatStream extends AsyncIterable<ChatCompletionChunk> {
    readonly requestId: string
}

/** An OpenAI embeddings request. */
export interface EmbeddingsRequest {
    readonly model?: string
    readonly input: string | readonly string[]
    readonly dimensions?: number
    readonly encoding_format?: "float" | "base64"
    readonly user?: string
    readonly [key: string]: unknown
}

/** One vector of an embeddings response. */
export interface EmbeddingData {
    readonly object: "embedding"
    readonly index: number
    readonly embedding: readonly number[] | string
}

/** An OpenAI embeddings response as a provider answers it. */
export interface EmbeddingsBody {
    readonly object: "list"
    readonly data: readonly EmbeddingData[]
    readonly model: string
    readonly usage?: Usage
}

/** An OpenAI embeddings response, with the routing that produced it. */
export interface EmbeddingsResponse extends EmbeddingsBody {
    readonly routing: RoutingInfo
}

/** The per-call options of `chat`, `stream` and `embeddings`. */
export interface CallOptions<Profiles extends string = string> {
    readonly profile?: Profiles
    /** Overrides the profile and the defaults, field by field. */
    readonly policy?: ModelPolicy
    readonly signal?: AbortSignal
    /** The id sent as `x-request-id` and `idempotency-key` on every attempt; generated when absent. */
    readonly requestId?: string
    /** Extra headers for this call; they cannot replace the provider's auth header. */
    readonly headers?: Readonly<Record<string, string>>
}

/** Why an attempt or a call failed. */
export type ErrorClass =
    | "rate_limit"
    | "quota"
    | "auth"
    | "transient"
    | "timeout"
    | "network"
    | "stream"
    | "invalid_request"
    | "cancelled"
    | "deadline"
    | "no_candidate"
    | "config"

/** The operation a call performs. */
export type Operation = "chat" | "stream" | "embeddings"

/** The state of a breaker as health reports it; `half-open` is an open breaker past its cooldown. */
export type BreakerState = "closed" | "open" | "half-open"

/** Emitted once per attempt. Carries no prompt or response unless `telemetry.includeContent` is true. */
export interface AttemptEvent {
    readonly type: "attempt"
    readonly requestId: string
    readonly operation: Operation
    readonly attempt: number
    readonly provider: string
    readonly key: string
    readonly model: string
    readonly latencyMs: number
    readonly outcome: "success" | "failure"
    readonly errorClass?: ErrorClass
    readonly status?: number
    readonly usage?: Usage
    readonly cost?: number
    readonly content?: { readonly request: unknown; readonly response?: unknown }
}

/** Emitted when a key's or a provider's breaker changes state. */
export interface BreakerEvent {
    readonly type: "breaker"
    readonly scope: "key" | "provider"
    readonly provider: string
    readonly key?: string
    readonly from: BreakerState
    readonly to: BreakerState
}

/** Why a key is blacklisted: its secret was refused (`auth`), it has none (`missing`), or its quota or credit is spent (`quota`). */
export type DisabledReason = "auth" | "missing" | "quota"

/** Emitted when a key is blacklisted. It names the key by alias and the provider's error code, never the secret. */
export interface KeyDisabledEvent {
    readonly type: "key-disabled"
    readonly provider: string
    readonly key: string
    readonly reason: DisabledReason
    /** Epoch milliseconds the key returns, or null until its secret changes or `reset()`. */
    readonly until: number | null
    /** The provider's error code or type (`insufficient_quota`, `billing_error`, ...), when it sent one. */
    readonly code?: string
}

/** Emitted when a blacklisted key comes back because its secret changed. */
export interface KeyRestoredEvent {
    readonly type: "key-restored"
    readonly provider: string
    readonly key: string
    /** Why it was out. */
    readonly was: DisabledReason
    readonly reason: "secret_changed"
}

/** Emitted once per call when it settles. */
export interface RequestEvent {
    readonly type: "request"
    readonly requestId: string
    readonly operation: Operation
    readonly outcome: "success" | "failure"
    readonly attempts: number
    readonly latencyMs: number
    readonly provider?: string
    readonly key?: string
    readonly model?: string
    readonly errorClass?: ErrorClass
}

/** Every event the router emits, by name. */
export interface RouterEvents {
    readonly attempt: AttemptEvent
    readonly breaker: BreakerEvent
    readonly "key-disabled": KeyDisabledEvent
    readonly "key-restored": KeyRestoredEvent
    readonly request: RequestEvent
}

/** The health of one key and model. */
export interface LaneHealth {
    readonly model: string
    readonly remainingRequests: number | null
    readonly remainingTokens: number | null
    /** Epoch milliseconds until which a 429 keeps this lane out; 0 when none. */
    readonly cooldownUntil: number
    readonly latencyEwmaMs: number | null
}

/** The health of one key. */
export interface KeyHealth {
    readonly alias: string
    readonly breaker: BreakerState
    readonly failures: number
    readonly disabled: boolean
    readonly disabledReason: DisabledReason | null
    /** Epoch milliseconds the blacklist ends; null while it lasts until the secret changes, and when the key is not disabled. */
    readonly disabledUntil: number | null
    readonly inflight: number
    readonly models: readonly LaneHealth[]
}

/** The health of one provider. */
export interface ProviderHealth {
    readonly id: string
    readonly kind: ProviderKind
    readonly breaker: BreakerState
    readonly failures: number
    readonly inflight: number
    /** This UTC day's and month's spend against `budget`, when the provider has one. */
    readonly spend?: { readonly day: number; readonly month: number }
    readonly keys: readonly KeyHealth[]
}

/** A snapshot of the pool's health. */
export interface HealthSnapshot {
    readonly at: number
    readonly providers: readonly ProviderHealth[]
}

/** Counters of one provider, key and model in this process. */
export interface LaneStats {
    readonly provider: string
    readonly key: string
    readonly model: string
    readonly attempts: number
    readonly successes: number
    readonly failures: Readonly<Partial<Record<ErrorClass, number>>>
    readonly promptTokens: number
    readonly completionTokens: number
    readonly cost: number
}

/** Counters of this process since the router was created. */
export interface StatsSnapshot {
    readonly requests: number
    readonly succeeded: number
    readonly failed: number
    readonly attempts: number
    readonly lanes: readonly LaneStats[]
}

/** What `reset()` clears: everything, one provider, or one key of a provider. */
export interface ResetTarget {
    readonly provider?: string
    readonly key?: string
}

/** The raw router behind `AiRouterService`, injected with `@InjectAiRouter()` (token `AI_ROUTER`). */
export interface AiRouter<Profiles extends string = string> {
    /** Sends a chat-completions request through the pool. */
    chat(request: ChatCompletionRequest, options?: CallOptions<Profiles>): Promise<ChatCompletion>
    /** Streams a chat completion as OpenAI chunks; fails over only before the first token. */
    stream(request: ChatCompletionRequest, options?: CallOptions<Profiles>): ChatStream
    /** Sends an embeddings request through the pool. */
    embeddings(request: EmbeddingsRequest, options?: CallOptions<Profiles>): Promise<EmbeddingsResponse>
    /** Reads every breaker, blacklisted key, headroom and budget from the store. */
    health(): Promise<HealthSnapshot>
    /** Returns this process's counters. */
    stats(): StatsSnapshot
    /** Subscribes to an event; returns the unsubscribe function. */
    on<E extends keyof RouterEvents>(event: E, handler: (payload: RouterEvents[E]) => void): () => void
    /** Closes breakers, lifts blacklists and clears headroom for the target (everything by default). */
    reset(target?: ResetTarget): Promise<void>
    /** Lists the pool's profiles and models by name, with no key: what a caller may ask for. */
    catalog(): RouterCatalog
}

/** One model of the pool as the catalog lists it: one entry per configured id, merged across the providers serving it. */
export interface CatalogModel {
    readonly id: string
    readonly aliases: readonly string[]
    readonly providers: readonly string[]
    readonly capabilities: readonly Capability[]
    readonly contextWindow?: number
    readonly cost?: ModelCost
}

/** One named profile as the catalog lists it. */
export interface CatalogProfile {
    readonly name: string
    /** The profile's preferred model (its first candidate), else the defaults'; absent when neither names one. */
    readonly model?: string
    /** The fallbacks the profile tries (its later candidates, or its own fallbacks, else the defaults'); empty when fallback is off. */
    readonly fallbacks: readonly string[]
    /** True when the profile is pinned to one model identity. */
    readonly pinned: boolean
    /** The operations its first model serves: `chat`, `embeddings` or both. */
    readonly serves: readonly ("chat" | "embeddings")[]
}

/** The names a caller may route by: the defaults' fallbacks, every profile and every model. */
export interface RouterCatalog {
    readonly defaults: { readonly model?: string; readonly fallbacks: readonly string[] }
    readonly profiles: readonly CatalogProfile[]
    readonly models: readonly CatalogModel[]
}
