import { createFakeProvider } from "../src/fake.ts"
import type { FakeProvider } from "../src/fake.ts"
import { createRouter } from "../src/router.ts"
import type { AiRouter, PoolConfig, ProviderConfig, RouterEvents } from "../src/types.ts"

/** A provider with resolver keys whose test secrets are `sk-<provider>-<alias>`. */
export function provider(id: string, aliases: readonly string[], models: ProviderConfig["models"], extra: Partial<ProviderConfig> = {}): ProviderConfig {
    return {
        id,
        baseUrl: `https://${id}.test/v1`,
        keys: aliases.map((alias) => ({ alias, resolve: () => `sk-${id}-${alias}` })),
        models,
        ...extra,
    }
}

/** The pool most specs use: provider a (keys k1, k2; models m1 alias fast, m2), provider b (key k1; m1). */
export function standardProviders(): ProviderConfig[] {
    return [provider("a", ["k1", "k2"], [{ id: "m1", aliases: ["fast"] }, { id: "m2" }]), provider("b", ["k1"], [{ id: "m1" }])]
}

/** A router over a fake provider with test-speed backoff. */
export function setup(providers: readonly ProviderConfig[] = standardProviders(), extra: Partial<PoolConfig> = {}): { fake: FakeProvider; router: AiRouter } {
    const fake = createFakeProvider()
    const router = createRouter({
        providers,
        fetch: fake.fetch,
        random: () => 0.5,
        ...extra,
        resilience: { backoff: { baseMs: 1, maxMs: 2 }, ...extra.resilience },
    })
    return { fake, router }
}

/** Collects every event of one name. */
export function record<E extends keyof RouterEvents>(router: AiRouter, event: E): RouterEvents[E][] {
    const out: RouterEvents[E][] = []
    router.on(event, (payload) => out.push(payload))
    return out
}

/** A one-message chat request. */
export function ask(text = "hi", model = "m1"): { model: string; messages: { role: "user"; content: string }[] } {
    return { model, messages: [{ role: "user", content: text }] }
}

/** Waits real milliseconds. */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Reads a stream to its end and returns every item. */
export async function drain<T>(stream: AsyncIterable<T>): Promise<T[]> {
    const out: T[] = []
    for await (const item of stream) out.push(item)
    return out
}

/** Counts how often each value occurs. */
export function tally(values: readonly string[]): Record<string, number> {
    const out: Record<string, number> = {}
    for (const value of values) out[value] = (out[value] ?? 0) + 1
    return out
}
