import { matchesOf } from "./config.ts"
import type { EnvProviderSpec } from "./env.ts"
import { AiRouterError } from "./errors.ts"
import type { CandidateRef, Capability, FetchLike, ModelConfig, ModelCost, ModelPolicy, PoolConfig, ProviderKind } from "./types.ts"

/**
 * The models the router knows by id, with the facts their vendors state. A fact a vendor's page does not state is left
 * out, never guessed. Sources, read 2026-11-16:
 *
 * - Anthropic, https://platform.claude.com/docs/en/models/overview: ids, 1M-token context window, text and image input,
 *   tool use, price per million tokens (Fable 5.2 8 and 40, Opus 5.5 4 and 20, Sonnet 5.5 2 and 10) and the cache-read share
 *   of the input price (2.5% on Fable 5.2, 5% on Opus 5.5 and Sonnet 5.5). Haiku 5.5 is priced "From $0.10 / $0.50", so it
 *   carries no cost, and the page states no cache write price, so none is declared.
 * - OpenAI, https://developers.openai.com/api/docs/models: ids, 1.05M-token context window, image input and function
 *   calling for the latest models. Their price is not declared here: the router prices what a deployment sets.
 *
 * `tier` is this package's own ranking by the vendors' descriptions and prices ("most demanding work" is `max`,
 * "high-volume tasks" is `low`); it orders the `auto-*` profiles and states nothing a vendor claims.
 */
export type EffortTier = "low" | "medium" | "high" | "max"

export const EFFORT_TIERS: readonly EffortTier[] = ["low", "medium", "high", "max"]

export interface KnownModel {
    readonly id: string
    readonly kind: "anthropic" | "openai"
    readonly label: string
    readonly tier: EffortTier
    readonly vision: boolean
    readonly tools: boolean
    readonly contextWindow: number
    readonly cost?: ModelCost
}

const CLAUDE_CONTEXT = 1_000_000
const OPENAI_CONTEXT = 1_050_000

export const KNOWN_MODELS: readonly KnownModel[] = Object.freeze([
    { id: "claude-fable-5-2", kind: "anthropic", label: "Claude Fable 5.2", tier: "max", vision: true, tools: true, contextWindow: CLAUDE_CONTEXT, cost: { input: 8, output: 40, cacheRead: 0.2 } },
    { id: "claude-opus-5-5", kind: "anthropic", label: "Claude Opus 5.5", tier: "high", vision: true, tools: true, contextWindow: CLAUDE_CONTEXT, cost: { input: 4, output: 20, cacheRead: 0.2 } },
    { id: "claude-sonnet-5-5", kind: "anthropic", label: "Claude Sonnet 5.5", tier: "medium", vision: true, tools: true, contextWindow: CLAUDE_CONTEXT, cost: { input: 2, output: 10, cacheRead: 0.1 } },
    { id: "claude-haiku-5-5", kind: "anthropic", label: "Claude Haiku 5.5", tier: "low", vision: true, tools: true, contextWindow: CLAUDE_CONTEXT },
    { id: "gpt-6-astra", kind: "openai", label: "GPT-6 Astra", tier: "max", vision: true, tools: true, contextWindow: OPENAI_CONTEXT },
    { id: "gpt-6.1-sol", kind: "openai", label: "GPT-6.1 Sol", tier: "high", vision: true, tools: true, contextWindow: OPENAI_CONTEXT },
    { id: "gpt-6.1-terra", kind: "openai", label: "GPT-6.1 Terra", tier: "medium", vision: true, tools: true, contextWindow: OPENAI_CONTEXT },
    { id: "gpt-6-luna", kind: "openai", label: "GPT-6 Luna", tier: "low", vision: true, tools: true, contextWindow: OPENAI_CONTEXT },
] satisfies KnownModel[])

function capabilitiesOf(model: { readonly vision: boolean; readonly tools: boolean }): Capability[] {
    return ["chat", "streaming", "json", ...(model.tools ? (["tools"] as const) : []), ...(model.vision ? (["vision"] as const) : [])]
}

/** The known models of one provider kind as the `ModelConfig`s of a provider. */
export function knownModelConfigs(kind: "anthropic" | "openai"): ModelConfig[] {
    return KNOWN_MODELS.filter((model) => model.kind === kind).map(
        (model): ModelConfig => ({
            id: model.id,
            contextWindow: model.contextWindow,
            capabilities: capabilitiesOf(model),
            ...(model.cost === undefined ? {} : { cost: model.cost }),
            // Claude Opus 5.5 and Sonnet 5.5 refuse a forced tool choice (docs/design.md, "A model's own request shape").
            ...(model.id === "claude-opus-5-5" || model.id === "claude-sonnet-5-5" ? { forcedToolUse: false } : {}),
        }),
    )
}

/** What `fetchOpenRouterModels` reads of one entry of OpenRouter's `GET /api/v1/models`; every field but `id` is optional. */
interface OpenRouterEntry {
    readonly id?: unknown
    readonly context_length?: unknown
    readonly architecture?: { readonly input_modalities?: unknown; readonly output_modalities?: unknown }
    readonly supported_parameters?: unknown
}

function strings(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

export interface OpenRouterCatalogOptions {
    /** Default `https://openrouter.ai/api/v1`. */
    readonly baseUrl?: string
    /** Sent as a bearer token when given; the endpoint's auth is optional (https://openrouter.ai/docs/api-reference/list-available-models). */
    readonly apiKey?: string
    readonly fetch?: FetchLike
    /** How long a fetched catalog is reused. Default one hour; 0 never caches. */
    readonly ttlMs?: number
    readonly now?: () => number
}

const cache = new Map<string, { at: number; models: ModelConfig[] }>()

/**
 * OpenRouter's catalog as `ModelConfig`s: the id sent to OpenRouter is `<vendor>/<model>` and the name a caller uses is
 * `openrouter/<vendor>/<model>` (an alias). The endpoint answers text-output models by default. Vision comes from
 * `architecture.input_modalities` holding `image`, tools from `supported_parameters` holding `tools`, the window from
 * `context_length`; an entry that omits a field leaves that fact out. Prices are not read: the page does not state their
 * unit. The answer is cached per base URL for `ttlMs`.
 */
export async function fetchOpenRouterModels(options: OpenRouterCatalogOptions = {}): Promise<ModelConfig[]> {
    const baseUrl = (options.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/+$/, "")
    const now = options.now ?? Date.now
    const ttl = options.ttlMs ?? 3_600_000
    const hit = cache.get(baseUrl)
    if (hit !== undefined && ttl > 0 && now() - hit.at < ttl) return hit.models
    const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init))
    const response = await doFetch(`${baseUrl}/models`, { method: "GET", headers: options.apiKey === undefined ? {} : { authorization: `Bearer ${options.apiKey}` } })
    if (!response.ok) throw new AiRouterError({ errorClass: "config", message: `OpenRouter catalog answered ${String(response.status)}` })
    const body = (await response.json()) as { data?: unknown }
    const models: ModelConfig[] = []
    for (const entry of Array.isArray(body.data) ? (body.data as OpenRouterEntry[]) : []) {
        if (typeof entry.id !== "string" || entry.id === "") continue
        const outputs = strings(entry.architecture?.output_modalities)
        if (outputs.length > 0 && !outputs.includes("text")) continue
        models.push({
            id: entry.id,
            aliases: [`openrouter/${entry.id}`],
            capabilities: capabilitiesOf({ tools: strings(entry.supported_parameters).includes("tools"), vision: strings(entry.architecture?.input_modalities).includes("image") }),
            ...(typeof entry.context_length === "number" && entry.context_length > 0 ? { contextWindow: entry.context_length } : {}),
        })
    }
    cache.set(baseUrl, { at: now(), models })
    return models
}

/** Forgets every cached OpenRouter catalog (tests, or a deployment that wants a refresh now). */
export function clearOpenRouterCatalogCache(): void {
    cache.clear()
}

export interface DefaultProvidersOptions {
    /** Models for the `openrouter` provider, from `fetchOpenRouterModels`; without them it is left out (nothing to route). */
    readonly openRouterModels?: readonly ModelConfig[]
}

/**
 * Provider specs for `poolFromEnv`: Anthropic and OpenAI with the known models, and OpenRouter with the models given.
 * Each is present only when its key is in env (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`): without a
 * key the provider and its models are absent from the catalog, and nothing fails at boot.
 */
export function defaultProviderSpecs(options: DefaultProvidersOptions = {}): EnvProviderSpec[] {
    const specs: EnvProviderSpec[] = [
        { kind: "anthropic", models: knownModelConfigs("anthropic") },
        { kind: "openai", models: knownModelConfigs("openai") },
    ]
    if (options.openRouterModels !== undefined) specs.push({ kind: "openrouter", models: options.openRouterModels })
    return specs
}

/** One model a caller may choose, from the providers whose keys are configured. */
export interface AvailableModel {
    /** The name to ask for: the model id, or `openrouter/<vendor>/<model>` on OpenRouter. */
    readonly id: string
    /** The id of the provider serving it. */
    readonly provider: string
    readonly label: string
    readonly vision: boolean
    readonly tools: boolean
    readonly contextTokens?: number
}

/** The chat models of a pool, one per provider serving them; a pool built from env holds only providers with keys. */
export function availableModels(config: PoolConfig): AvailableModel[] {
    const out: AvailableModel[] = []
    for (const provider of config.providers) {
        const kind: ProviderKind = provider.kind ?? "openai-compatible"
        for (const model of provider.models) {
            const capabilities = model.capabilities ?? ["chat", "streaming", "tools", "json"]
            if (!capabilities.includes("chat")) continue
            out.push({
                id: kind === "openrouter" ? `openrouter/${model.id.replace(/^openrouter\//, "")}` : model.id,
                provider: provider.id,
                label: KNOWN_MODELS.find((known) => known.id === model.id)?.label ?? model.id,
                vision: capabilities.includes("vision"),
                tools: capabilities.includes("tools"),
                ...(model.contextWindow === undefined ? {} : { contextTokens: model.contextWindow }),
            })
        }
    }
    return out
}

/**
 * The pool with `auto-low`, `auto-medium`, `auto-high`, `auto-max` and `auto` (the medium one) profiles added: each tries
 * the known models the pool serves, starting at its own effort tier, then the tiers below it from the nearest down, then
 * those above from the nearest up. A profile with no known model to try is not added, and a profile the app declares is
 * kept as it is. The pool holds only providers with keys, so `auto` never leaves them.
 */
export function withAutoProfiles<P extends string>(config: PoolConfig<P>): PoolConfig {
    const served = KNOWN_MODELS.filter((model) => matchesOf(config, { model: model.id }).length > 0)
    const profiles: Record<string, ModelPolicy> = { ...(config.profiles ?? {}) }
    const add = (name: string, tier: EffortTier): void => {
        if (name in profiles) return
        const at = EFFORT_TIERS.indexOf(tier)
        const distance = (model: KnownModel): number => {
            const gap = EFFORT_TIERS.indexOf(model.tier) - at
            return gap <= 0 ? -gap : 10 + gap
        }
        const tiers: CandidateRef[][] = []
        let current: EffortTier | undefined
        for (const model of [...served].sort((a, b) => distance(a) - distance(b))) {
            if (model.tier === current) tiers[tiers.length - 1]?.push({ model: model.id })
            else tiers.push([{ model: model.id }])
            current = model.tier
        }
        if (tiers.length > 0) profiles[name] = { candidates: tiers }
    }
    for (const tier of EFFORT_TIERS) add(`auto-${tier}`, tier)
    add("auto", "medium")
    return { ...config, profiles }
}
