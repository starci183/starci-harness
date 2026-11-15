import type { FakeProvider } from "../../src/fake.ts"
import type { PoolConfig } from "../../src/types.ts"

/**
 * A pool of two protocols, as an app with a strong and a cheap model declares it: Claude Sonnet on Anthropic directly
 * (two keys), DeepSeek and an embeddings model through OpenRouter, and two profiles that try one protocol first and the
 * other after it. Every secret is a test value.
 */
export function mixedPool(fake: FakeProvider): PoolConfig {
    return {
        providers: [
            {
                id: "anthropic",
                kind: "anthropic",
                keys: [
                    { alias: "a1", resolve: () => "sk-ant-test-1" },
                    { alias: "a2", resolve: () => "sk-ant-test-2" },
                ],
                models: [{ id: "claude-sonnet-5-5", aliases: ["sonnet"], cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5, cacheWrite1h: 4 }, omit: ["temperature"], forcedToolUse: false }],
            },
            {
                id: "openrouter",
                kind: "openrouter",
                keys: [{ alias: "o1", resolve: () => "sk-or-test-1" }],
                models: [
                    { id: "deepseek/deepseek-v4.1-flash", aliases: ["deepseek"], cost: { input: 0.2, output: 0.8, cacheRead: 0.02 } },
                    { id: "openai/text-embedding-3-small", identity: "text-embedding-3-small", dimensions: 3, capabilities: ["embeddings"] },
                ],
            },
        ],
        profiles: {
            "auto-light": { candidates: [{ provider: "openrouter", model: "deepseek/deepseek-v4.1-flash" }, { provider: "anthropic", model: "claude-sonnet-5-5" }] },
            "auto-heavy": { candidates: [{ provider: "anthropic", model: "claude-sonnet-5-5" }, { provider: "openrouter", model: "deepseek/deepseek-v4.1-flash" }] },
            embed: { pinned: true, candidates: [{ provider: "openrouter", model: "openai/text-embedding-3-small" }] },
        },
        resilience: { backoff: { baseMs: 1, maxMs: 1 }, keyBreaker: { failureThreshold: 100 }, providerBreaker: { failureThreshold: 100 } },
        fetch: fake.fetch,
        random: () => 0.5,
    }
}
