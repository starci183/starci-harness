import { DomainError, isPlainRecord } from "@starci/common"
import type { ChatAnthropic } from "@langchain/anthropic"
import type { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai"

/**
 * LangChain clients over the gateway (docs/design.md, "The LangChain entry"). An app holds one virtual key and names a
 * pool model or a profile; it gets back the LangChain chat model that speaks the protocol the gateway serves that name
 * through. The app never builds a provider client and never branches on a provider.
 *
 * The LangChain packages are optional peers, imported the first time a kind is asked for: an app that never asks for an
 * `anthropic` model never needs `@langchain/anthropic`, and the router's core imports none of them.
 */

/**
 * The chat model of each kind. A kind is a wire protocol, never a model family: every OpenAI-compatible provider
 * (DeepSeek, OpenRouter, Qwen, Groq, ...) is `openai`. A new kind is added by declaring its model here (module
 * augmentation) and registering its factory with `registerChatKind`; nothing else changes.
 */
export interface RoutedChatKinds {
    openai: ChatOpenAI
    anthropic: ChatAnthropic
}

/** A wire protocol the gateway serves a name through. */
export type RoutedKind = keyof RoutedChatKinds

/** One chat model the gateway routes, with the protocol it speaks. The common path uses `model` and never reads `kind`. */
export type RoutedChat<K extends RoutedKind = RoutedKind> = {
    [Kind in K]: {
        readonly kind: Kind
        /** The pool model or profile this client names on every call. */
        readonly name: string
        readonly model: RoutedChatKinds[Kind]
        /**
         * The same name through its other protocols, in the order the pool tries them: a profile whose candidates span two
         * protocols is one client here and the next ones there. The router fails over inside a protocol on its own; moving
         * to the next protocol is the caller's retry, which it already owns.
         */
        readonly fallbacks: readonly RoutedChat[]
    }
}[K]

/** The embeddings client of a pinned profile or an embeddings model, with the length of its vectors. */
export interface RoutedEmbeddings {
    readonly kind: "openai"
    readonly name: string
    readonly embeddings: OpenAIEmbeddings
    /** The vector length the pool declares for it; undefined when the pool declares none. */
    readonly dimensions: number | undefined
}

/** A `fetch`-compatible function. */
export type RoutedFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

/** How the routed clients reach the gateway. */
export interface RoutedModelsOptions {
    /** The gateway's origin, without `/v1` (`http://127.0.0.1:4100`). */
    readonly gatewayUrl: string
    /** The app's one virtual key (`STARCI_AI_KEY`). */
    readonly virtualKey: string
    /** The `fetch` every client and the catalog read use. Default: the global one. */
    readonly fetch?: RoutedFetch
    /** The limit of one call in milliseconds, for every client unless a call to `chat` sets its own. */
    readonly timeoutMs?: number
    /** Extra headers on every request to the gateway. */
    readonly headers?: Readonly<Record<string, string>>
}

/** What one `chat` call may set on the client it gets. */
export interface RoutedChatOptions {
    /** The limit of one call in milliseconds. */
    readonly timeoutMs?: number
    /** The most tokens an answer may hold. An `anthropic` client must send one: default 16000. */
    readonly maxTokens?: number
    /** Extra constructor fields of the kind's own client, for a provider's own features; they win over the defaults. */
    readonly fields?: Readonly<Partial<Record<RoutedKind, Readonly<Record<string, unknown>>>>>
}

/** What a kind's factory is given to build its client. */
export interface RoutedChatContext {
    readonly name: string
    /** The gateway's origin, without a trailing slash. */
    readonly gatewayUrl: string
    readonly virtualKey: string
    readonly fetch: RoutedFetch | undefined
    readonly timeoutMs: number | undefined
    readonly maxTokens: number | undefined
    /** The headers every request carries: the caller's, and the one that keeps the call on this kind's providers. */
    readonly headers: Readonly<Record<string, string>>
    /** The caller's own constructor fields for this kind. */
    readonly fields: Readonly<Record<string, unknown>>
}

/** Builds the chat model of one kind; it imports its LangChain package itself, so the package loads only when asked for. */
export type RoutedChatFactory<K extends RoutedKind = RoutedKind> = (context: RoutedChatContext) => Promise<RoutedChatKinds[K]>

/** Why the routed models refused. */
export type RoutedModelsErrorCode = "ROUTED_CATALOG_UNAVAILABLE" | "ROUTED_NAME_UNKNOWN" | "ROUTED_KIND_UNSUPPORTED" | "ROUTED_NOT_CHAT" | "ROUTED_NOT_EMBEDDINGS" | "ROUTED_PACKAGE_MISSING"

/** The one error of this entry: the gateway's catalog could not be read, or it does not serve the name as asked. */
export class RoutedModelsError extends DomainError<RoutedModelsErrorCode> {
    constructor(code: RoutedModelsErrorCode, message: string, cause?: unknown) {
        super({ code, ...(cause === undefined ? {} : { cause }) })
        this.message = message
        this.name = "RoutedModelsError"
    }
}

/** The `max_tokens` an `anthropic` client sends when the caller names none: thinking counts toward it on current models. */
export const ROUTED_ANTHROPIC_MAX_TOKENS = 16_000

/** The header that keeps a call on the providers of one protocol. */
const KIND_HEADER = "x-ai-router-kind"

async function load<T>(name: string, importer: () => Promise<T>): Promise<T> {
    try {
        return await importer()
    } catch (error) {
        throw new RoutedModelsError("ROUTED_PACKAGE_MISSING", `install ${name} to use this kind: it is an optional peer of @starci/ai-router/langchain`, error)
    }
}

const factories = new Map<string, RoutedChatFactory>()

/** Registers the factory of a kind; the built-in kinds are `openai` and `anthropic`. A later registration replaces an earlier one. */
export function registerChatKind<K extends RoutedKind>(kind: K, factory: RoutedChatFactory<K>): void {
    factories.set(kind, factory)
}

registerChatKind("openai", async (context) => {
    const { ChatOpenAI: Model } = await load("@langchain/openai", () => import("@langchain/openai"))
    return new Model({
        model: context.name,
        apiKey: context.virtualKey,
        // The app owns its retries: the router already fails over between keys and providers of the kind.
        maxRetries: 0,
        streamUsage: true,
        ...(context.timeoutMs === undefined ? {} : { timeout: context.timeoutMs }),
        ...(context.maxTokens === undefined ? {} : { maxTokens: context.maxTokens }),
        ...context.fields,
        configuration: { baseURL: `${context.gatewayUrl}/v1`, defaultHeaders: { ...context.headers }, ...(context.fetch === undefined ? {} : { fetch: context.fetch }) },
    })
})

registerChatKind("anthropic", async (context) => {
    const { ChatAnthropic: Model } = await load("@langchain/anthropic", () => import("@langchain/anthropic"))
    return new Model({
        model: context.name,
        apiKey: context.virtualKey,
        // The Anthropic client appends /v1/messages to its base URL itself.
        anthropicApiUrl: context.gatewayUrl,
        maxRetries: 0,
        streamUsage: true,
        maxTokens: context.maxTokens ?? ROUTED_ANTHROPIC_MAX_TOKENS,
        ...context.fields,
        clientOptions: { defaultHeaders: { ...context.headers }, ...(context.timeoutMs === undefined ? {} : { timeout: context.timeoutMs }), ...(context.fetch === undefined ? {} : { fetch: context.fetch }) },
    })
})

/** One name of the gateway's `GET /v1/models`. */
interface Listed {
    readonly id: string
    readonly kinds: readonly string[]
    readonly serves: readonly string[]
    readonly dimensions: number | undefined
}

function strings(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function listedOf(entry: unknown): Listed | undefined {
    if (!isPlainRecord(entry) || typeof entry.id !== "string") return undefined
    return { id: entry.id, kinds: strings(entry.kinds), serves: strings(entry.serves), dimensions: typeof entry.dimensions === "number" ? entry.dimensions : undefined }
}

/** The routed clients of one app. */
export interface RoutedModels {
    /**
     * The chat model of a pool model or profile, speaking the protocol of its first candidate. `createAgent({ model:
     * (await ai.chat(name)).model })` works for every kind; `kind` is read only for a provider's own features.
     */
    chat(name: string, options?: RoutedChatOptions): Promise<RoutedChat>
    /** The embeddings client of a pinned profile or an embeddings model. It never falls back to another model identity. */
    embeddings(name: string): Promise<RoutedEmbeddings>
    /** Reads the gateway's catalog again: after the pool's config changed. */
    refresh(): Promise<void>
}

/** Creates the routed clients of one app over its gateway and its one virtual key. Nothing is read until the first call. */
export function createRoutedModels(options: RoutedModelsOptions): RoutedModels {
    const gatewayUrl = options.gatewayUrl.replace(/\/+$/, "").replace(/\/v1$/, "")
    const fetcher: RoutedFetch = options.fetch ?? ((input, init) => fetch(input, init))
    let catalog: Promise<Map<string, Listed>> | undefined

    async function read(): Promise<Map<string, Listed>> {
        let body: unknown
        try {
            const response = await fetcher(`${gatewayUrl}/v1/models`, { headers: { authorization: `Bearer ${options.virtualKey}`, ...options.headers } })
            if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
            body = await response.json()
        } catch (error) {
            throw new RoutedModelsError("ROUTED_CATALOG_UNAVAILABLE", `the gateway at ${gatewayUrl} did not list its models: ${error instanceof Error ? error.message : "the request failed"}`, error)
        }
        const data: unknown[] = isPlainRecord(body) && Array.isArray(body.data) ? body.data : []
        return new Map(data.map(listedOf).filter((entry) => entry !== undefined).map((entry) => [entry.id, entry]))
    }

    function listed(): Promise<Map<string, Listed>> {
        catalog ??= read().catch((error: unknown) => {
            // A failed read is not remembered: the next call asks again.
            catalog = undefined
            throw error
        })
        return catalog
    }

    async function find(name: string): Promise<Listed> {
        let entry = (await listed()).get(name)
        if (entry === undefined) {
            // The pool may have gained the name since the catalog was read.
            catalog = undefined
            entry = (await listed()).get(name)
        }
        if (entry === undefined) throw new RoutedModelsError("ROUTED_NAME_UNKNOWN", `the gateway serves no model or profile "${name}" to this key`)
        return entry
    }

    async function build(kind: string, name: string, call: RoutedChatOptions): Promise<RoutedChat> {
        const factory = factories.get(kind)
        if (factory === undefined) throw new RoutedModelsError("ROUTED_KIND_UNSUPPORTED", `"${name}" is served through the ${kind} protocol, which has no registered chat kind`)
        const fields: Readonly<Record<string, unknown>> = (call.fields as Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>> | undefined)?.[kind] ?? {}
        const model = await factory({
            name,
            gatewayUrl,
            virtualKey: options.virtualKey,
            fetch: options.fetch,
            timeoutMs: call.timeoutMs ?? options.timeoutMs,
            maxTokens: call.maxTokens,
            headers: { ...options.headers, [KIND_HEADER]: kind },
            fields,
        })
        // The registry holds each kind's factory under its own key, so the model is the kind's.
        return { kind, name, model, fallbacks: [] } as unknown as RoutedChat
    }

    return {
        async chat(name, call = {}) {
            const entry = await find(name)
            if (!entry.serves.includes("chat")) throw new RoutedModelsError("ROUTED_NOT_CHAT", `"${name}" does not serve chat`)
            const [first, ...rest] = entry.kinds
            if (first === undefined) throw new RoutedModelsError("ROUTED_KIND_UNSUPPORTED", `the gateway names no protocol for "${name}"`)
            const primary = await build(first, name, call)
            const fallbacks = await Promise.all(rest.filter((kind) => factories.has(kind)).map((kind) => build(kind, name, call)))
            return { ...primary, fallbacks }
        },
        async embeddings(name) {
            const entry = await find(name)
            if (!entry.serves.includes("embeddings")) throw new RoutedModelsError("ROUTED_NOT_EMBEDDINGS", `"${name}" does not serve embeddings`)
            const { OpenAIEmbeddings: Embeddings } = await load("@langchain/openai", () => import("@langchain/openai"))
            const embeddings = new Embeddings({
                model: name,
                apiKey: options.virtualKey,
                maxRetries: 0,
                ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
                configuration: { baseURL: `${gatewayUrl}/v1`, defaultHeaders: { ...options.headers }, ...(options.fetch === undefined ? {} : { fetch: options.fetch }) },
            })
            return { kind: "openai", name, embeddings, dimensions: entry.dimensions }
        },
        async refresh() {
            catalog = undefined
            await listed()
        },
    }
}

/** What one answer cost in tokens and who served it, the same for every kind: what credit billing reads. */
export interface RoutedUsage {
    /** Prompt tokens billed at the full input price: the prompt without its cache reads and writes. */
    readonly inputTokens: number
    /** Prompt tokens read from the provider's prompt cache. */
    readonly cacheReadTokens: number
    /** Prompt tokens written to the provider's prompt cache. */
    readonly cacheWriteTokens: number
    /** Completion tokens, thinking included. */
    readonly outputTokens: number
    /** The part of `outputTokens` the model spent thinking; 0 when the provider does not count it. */
    readonly reasoningTokens: number
    /** The pool model that answered, as the pool's config names it; undefined when the answer carried no usage. */
    readonly model: string | undefined
    /** The pool provider that answered. */
    readonly provider: string | undefined
    /** The cost the router computed from the model's prices; undefined when the model declares none or the answer was streamed natively. */
    readonly cost: number | undefined
}

function count(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0
}

function record(value: unknown): Record<string, unknown> {
    return isPlainRecord(value) ? value : {}
}

/**
 * The usage of a LangChain answer that came through the gateway (an `AIMessage`, or the chunks of a stream added up),
 * in one shape for every kind. The token counts are LangChain's `usage_metadata`; the lane that answered is what the
 * gateway wrote into the provider's raw usage, which LangChain keeps in `response_metadata.usage`.
 */
export function usageOf(reply: { readonly usage_metadata?: unknown; readonly response_metadata?: unknown }): RoutedUsage {
    const usage = record(reply.usage_metadata)
    const metadata = record(reply.response_metadata)
    const raw = record(metadata.usage)
    const routing = record(raw.served)
    const inputDetails = record(usage.input_token_details)
    const cacheReadTokens = count(inputDetails.cache_read)
    const cacheWriteTokens = count(inputDetails.cache_creation)
    // OpenAI's raw usage names thinking tokens `reasoning_tokens`, Anthropic's `thinking_tokens`.
    const reasoningTokens = count(record(usage.output_token_details).reasoning) || count(record(raw.completion_tokens_details).reasoning_tokens) || count(record(raw.output_tokens_details).thinking_tokens)
    return {
        inputTokens: Math.max(0, count(usage.input_tokens) - cacheReadTokens - cacheWriteTokens),
        cacheReadTokens,
        cacheWriteTokens,
        outputTokens: count(usage.output_tokens),
        reasoningTokens,
        model: typeof routing.model === "string" ? routing.model : undefined,
        provider: typeof routing.provider === "string" ? routing.provider : undefined,
        cost: typeof routing.cost === "number" ? routing.cost : undefined,
    }
}
