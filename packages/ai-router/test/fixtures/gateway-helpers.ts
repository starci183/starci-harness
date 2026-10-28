import { createFakeProvider } from "../../src/fake.ts"
import type { FakeProvider } from "../../src/fake.ts"
import { createGateway } from "../../src/gateway/gateway.ts"
import type { AiRouterGateway, GatewayOptions } from "../../src/gateway/gateway.ts"
import { MemoryKeyStore } from "../../src/gateway/keys.ts"
import type { KeyAdmin, KeySpec, KeyStore } from "../../src/gateway/keys.ts"
import { createRouter } from "../../src/router.ts"
import type { AiRouter, PoolConfig } from "../../src/types.ts"

/** The upstream key value of the test pool; a response that contains it leaked it. */
export const UPSTREAM_SECRET = "sk-upstream-a-k1-secret"
/** The admin token of the test gateway. */
export const ADMIN_TOKEN = "admin-test-token"

/**
 * The pool of the gateway specs: provider a serves m1 (alias fast, priced so one default call costs 1.2), m2 and the
 * embeddings model e1; profile lesson prefers m1 and falls back to m2, profile quiz pins m2; the defaults fall back to m2.
 */
export function gatewayPool(fake: FakeProvider): PoolConfig {
    return {
        providers: [
            {
                id: "a",
                baseUrl: "https://a.test/v1",
                keys: [{ alias: "k1", resolve: () => UPSTREAM_SECRET }],
                models: [{ id: "m1", aliases: ["fast"], cost: { input: 100_000, output: 100_000 } }, { id: "m2" }, { id: "e1", capabilities: ["embeddings"] }],
            },
        ],
        defaults: { fallbacks: ["m2"], maxAttempts: 2 },
        profiles: { lesson: { model: "m1", fallbacks: ["m2"] }, quiz: { model: "m2", allowFallback: false } },
        // One key serves every model, so its breaker stays closed through the failures a spec scripts.
        resilience: { backoff: { baseMs: 1, maxMs: 1 }, keyBreaker: { failureThreshold: 100 }, providerBreaker: { failureThreshold: 100 } },
        fetch: fake.fetch,
        random: () => 0.5,
    }
}

/** A running gateway over the test pool, with a clock the spec moves. */
export interface Harness {
    readonly fake: FakeProvider
    readonly router: AiRouter
    readonly gateway: AiRouterGateway
    readonly admin: KeyAdmin
    readonly store: KeyStore
    readonly url: string
    readonly clock: { now: number }
    /** Issues a key and returns its secret. */
    key(spec?: Partial<KeySpec>): Promise<string>
    close(): Promise<void>
}

/** Starts a gateway on a free port. */
export async function harness(options: Partial<GatewayOptions> = {}, pool?: (fake: FakeProvider) => PoolConfig): Promise<Harness> {
    const fake = createFakeProvider()
    const router = createRouter((pool ?? gatewayPool)(fake))
    const store = options.keys ?? new MemoryKeyStore()
    const clock = { now: Date.UTC(2026, 9, 28, 12, 0, 30) }
    const gateway = createGateway(router, { adminToken: () => ADMIN_TOKEN, clock: () => clock.now, ...options, keys: store })
    const { url } = await gateway.listen(0)
    return {
        fake,
        router,
        gateway,
        admin: gateway.admin,
        store,
        url,
        clock,
        async key(spec = {}) {
            const issued = await gateway.admin.create({ label: "test", profiles: ["*"], models: ["*"], ...spec })
            return issued.secret
        },
        close: () => gateway.close(),
    }
}

/** One HTTP exchange with the gateway. */
export interface Reply {
    readonly status: number
    readonly headers: Headers
    readonly text: string
    readonly json: Record<string, unknown>
}

/** Sends a request: a JSON body when `body` is an object, raw text when it is a string. */
export async function http(url: string, path: string, init: { method?: string; key?: string; body?: unknown } = {}): Promise<Reply> {
    const headers: Record<string, string> = {}
    if (init.key !== undefined) headers.authorization = `Bearer ${init.key}`
    if (init.body !== undefined) headers["content-type"] = "application/json"
    const response = await fetch(`${url}${path}`, {
        method: init.method ?? (init.body === undefined ? "GET" : "POST"),
        headers,
        ...(init.body === undefined ? {} : { body: typeof init.body === "string" ? init.body : JSON.stringify(init.body) }),
    })
    const text = await response.text()
    let json: Record<string, unknown>
    try {
        json = JSON.parse(text) as Record<string, unknown>
    } catch {
        json = {}
    }
    return { status: response.status, headers: response.headers, text, json }
}

/** The OpenAI error object of a reply. */
export function errorOf(reply: Reply): { message: string; type: string; code: string } {
    return reply.json.error as { message: string; type: string; code: string }
}

/** A one-message chat body. */
export function chatBody(model: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { model, messages: [{ role: "user", content: "the secret prompt text" }], ...extra }
}

/** The data payloads of an SSE body, in order. */
export function events(text: string): string[] {
    return text
        .split("\n\n")
        .map((block) => block.trim())
        .filter((block) => block.startsWith("data: "))
        .map((block) => block.slice("data: ".length))
}
