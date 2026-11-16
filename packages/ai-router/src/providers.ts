import type { ProviderConfig, ProviderKind } from "./types.ts"

/** The wire protocol a provider speaks: OpenAI chat-completions and embeddings, or Anthropic Messages. */
export type Protocol = "openai" | "anthropic"

/** When a provider's exhausted quota comes back when its answer does not say: never on its own, the next UTC month, or a calendar day in a time zone. */
export type QuotaWindow = { readonly kind: "month-utc" } | { readonly kind: "day"; readonly timeZone: string }

/** What a provider kind fixes: its protocol, default base URL, auth header, embeddings support and env prefix. */
export interface ProviderPreset {
    readonly kind: ProviderKind
    readonly protocol: Protocol
    /** Null: the base URL is required. */
    readonly baseUrl: string | null
    /** `bearer` sends `Authorization: Bearer <key>`; `x-api-key` sends `x-api-key: <key>` (Anthropic). */
    readonly auth: "bearer" | "x-api-key"
    /** False when the provider has no embeddings API: a model there declaring `embeddings` is refused. */
    readonly embeddings: boolean
    /** The prefix of its canonical env variables (`<PREFIX>_API_KEY`, `_2`, ..., `<PREFIX>_BASE_URL`); null: the app names one. */
    readonly envPrefix: string | null
    /** The official docs this preset was read from (docs/design.md lists the date). */
    readonly docs: string
    /** True for a self-hosted endpoint: keys are optional (none declared, or one that may be unset), its calls cost nothing and its model files load on first use. */
    readonly local: boolean
    /** How long an attempt may wait for the first answer or token, beyond the policy's `timeoutMs`; null: no extra wait. */
    readonly firstTokenTimeoutMs: number | null
}

/** A `local` provider's default wait for a model to load into GPU memory and answer first. */
export const LOCAL_FIRST_TOKEN_TIMEOUT_MS = 120_000

/** A `local` call's default whole-call deadline: a cold load plus a long answer outlasts the 120 s of a hosted call. */
export const LOCAL_DEADLINE_MS = 300_000

/**
 * The provider matrix (docs/design.md): read from each provider's official documentation on 2026-10-31. A base URL is
 * the default only; `baseUrl` (or `<PREFIX>_BASE_URL`) moves it, e.g. Qwen to another region or workspace host.
 */
export const PROVIDER_PRESETS: Readonly<Record<ProviderKind, ProviderPreset>> = Object.freeze({
    openai: { kind: "openai", protocol: "openai", baseUrl: "https://api.openai.com/v1", auth: "bearer", embeddings: true, envPrefix: "OPENAI", docs: "https://developers.openai.com/api/docs/guides/error-codes", local: false, firstTokenTimeoutMs: null },
    anthropic: { kind: "anthropic", protocol: "anthropic", baseUrl: "https://api.anthropic.com/v1", auth: "x-api-key", embeddings: false, envPrefix: "ANTHROPIC", docs: "https://platform.claude.com/docs/en/api/errors", local: false, firstTokenTimeoutMs: null },
    openrouter: { kind: "openrouter", protocol: "openai", baseUrl: "https://openrouter.ai/api/v1", auth: "bearer", embeddings: true, envPrefix: "OPENROUTER", docs: "https://openrouter.ai/docs/api/reference/errors-and-debugging", local: false, firstTokenTimeoutMs: null },
    qwen: { kind: "qwen", protocol: "openai", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", auth: "bearer", embeddings: true, envPrefix: "DASHSCOPE", docs: "https://www.alibabacloud.com/help/en/model-studio/error-code", local: false, firstTokenTimeoutMs: null },
    deepseek: { kind: "deepseek", protocol: "openai", baseUrl: "https://api.deepseek.com", auth: "bearer", embeddings: false, envPrefix: "DEEPSEEK", docs: "https://api-docs.deepseek.com/quick_start/error_codes", local: false, firstTokenTimeoutMs: null },
    gemini: { kind: "gemini", protocol: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", auth: "bearer", embeddings: true, envPrefix: "GEMINI", docs: "https://ai.google.dev/gemini-api/docs/api-errors", local: false, firstTokenTimeoutMs: null },
    groq: { kind: "groq", protocol: "openai", baseUrl: "https://api.groq.com/openai/v1", auth: "bearer", embeddings: false, envPrefix: "GROQ", docs: "https://console.groq.com/docs/errors", local: false, firstTokenTimeoutMs: null },
    // A self-hosted endpoint (Ollama, vLLM, llama.cpp server): the OpenAI protocol, the default base is Ollama's.
    local: { kind: "local", protocol: "openai", baseUrl: "http://localhost:11434/v1", auth: "bearer", embeddings: true, envPrefix: "LOCAL_AI", docs: "https://docs.ollama.com/api/openai-compatibility", local: true, firstTokenTimeoutMs: LOCAL_FIRST_TOKEN_TIMEOUT_MS },
    "openai-compatible": { kind: "openai-compatible", protocol: "openai", baseUrl: null, auth: "bearer", embeddings: true, envPrefix: null, docs: "https://docs.vllm.ai/en/latest/serving/online_serving/", local: false, firstTokenTimeoutMs: null },
})

/** The preset of a provider: its kind's, `openai-compatible` when it names none. */
export function presetOf(provider: ProviderConfig): ProviderPreset {
    return PROVIDER_PRESETS[provider.kind ?? "openai-compatible"]
}

/** The base URL a provider is called at, without a trailing slash; empty when neither the provider nor its kind has one. */
export function baseUrlOf(provider: ProviderConfig): string {
    return (provider.baseUrl ?? presetOf(provider).baseUrl ?? "").replace(/\/+$/, "")
}
