import type { OnApplicationShutdown } from "@nestjs/common"
import type {
    AiRouter,
    CallOptions,
    ChatCompletion,
    ChatCompletionRequest,
    ChatStream,
    EmbeddingsRequest,
    EmbeddingsResponse,
    HealthSnapshot,
    ResetTarget,
    RouterEvents,
    StatsSnapshot,
} from "../types.ts"
import type { AiRouterHandlers } from "./ai-router.options.ts"

/**
 * The injectable facade over one router. Every call it makes also follows the application's shutdown, and every
 * handler it subscribed is released then; calls made on the raw router (`AI_ROUTER`) are the caller's to cancel.
 */
export class AiRouterService<Profiles extends string = string> implements AiRouter<Profiles>, OnApplicationShutdown {
    /** The raw router this service delegates to. */
    readonly router: AiRouter<Profiles>
    readonly #shutdown = new AbortController()
    readonly #releases = new Set<() => void>()

    constructor(router: AiRouter<Profiles>, handlers: AiRouterHandlers = {}) {
        this.router = router
        if (handlers.attempt !== undefined) this.on("attempt", handlers.attempt)
        if (handlers.breaker !== undefined) this.on("breaker", handlers.breaker)
        if (handlers["key-disabled"] !== undefined) this.on("key-disabled", handlers["key-disabled"])
        if (handlers.request !== undefined) this.on("request", handlers.request)
    }

    #options(options: CallOptions<Profiles>): CallOptions<Profiles> {
        const signal = options.signal === undefined ? this.#shutdown.signal : AbortSignal.any([this.#shutdown.signal, options.signal])
        return { ...options, signal }
    }

    /** Sends a chat-completions request through the pool. */
    chat(request: ChatCompletionRequest, options: CallOptions<Profiles> = {}): Promise<ChatCompletion> {
        return this.router.chat(request, this.#options(options))
    }

    /** Streams a chat completion; the stream ends `cancelled` when the application shuts down. */
    stream(request: ChatCompletionRequest, options: CallOptions<Profiles> = {}): ChatStream {
        return this.router.stream(request, this.#options(options))
    }

    /** Sends an embeddings request through the pool. */
    embeddings(request: EmbeddingsRequest, options: CallOptions<Profiles> = {}): Promise<EmbeddingsResponse> {
        return this.router.embeddings(request, this.#options(options))
    }

    /** Reads every breaker, disabled key and headroom from the store. */
    health(): Promise<HealthSnapshot> {
        return this.router.health()
    }

    /** Returns this process's counters. */
    stats(): StatsSnapshot {
        return this.router.stats()
    }

    /** Subscribes to an event until the application shuts down; returns the unsubscribe function. */
    on<E extends keyof RouterEvents>(event: E, handler: (payload: RouterEvents[E]) => void): () => void {
        const unsubscribe = this.router.on(event, handler)
        const release = (): void => {
            unsubscribe()
            this.#releases.delete(release)
        }
        this.#releases.add(release)
        return release
    }

    /** Closes breakers, re-enables keys and clears headroom for the target (everything by default). */
    reset(target?: ResetTarget): Promise<void> {
        return this.router.reset(target)
    }

    /** Aborts every call still in flight through this service and releases its handlers. */
    onApplicationShutdown(): void {
        this.#shutdown.abort()
        for (const release of [...this.#releases]) release()
    }
}
