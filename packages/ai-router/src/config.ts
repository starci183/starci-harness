import { AiRouterError } from "./errors.ts"
import type { Capability, CallOptions, CatalogModel, ModelConfig, ModelPolicy, PoolConfig, RouterCatalog } from "./types.ts"

/** The capabilities of a model that declares none. */
export const DEFAULT_CAPABILITIES: readonly Capability[] = ["chat", "streaming", "tools", "json"]

/** A breaker's thresholds with every default applied. */
export interface BreakerSettings {
    readonly failureThreshold: number
    readonly cooldownMs: number
    readonly maxCooldownMs: number
}

/** The pool-wide settings with every default applied. */
export interface Settings {
    readonly keyBreaker: BreakerSettings
    readonly providerBreaker: BreakerSettings
    readonly backoff: { readonly baseMs: number; readonly factor: number; readonly maxMs: number }
    readonly authDisableMs: number | null
    readonly rateLimitCooldownMs: number
    readonly latencyTolerance: number
    readonly latencySlackMs: number
    readonly ewmaAlpha: number
    readonly lowHeadroom: number
    readonly includeContent: boolean
    readonly namespace: string
}

/** One call's policy with every default applied and its model list expanded. */
export interface ResolvedPolicy {
    /** The preferred model first, then the fallbacks when fallback is allowed, without repeats. */
    readonly models: readonly string[]
    readonly maxAttempts: number
    readonly timeoutMs: number
    readonly deadlineMs: number
    readonly maxCost: number | null
    readonly providers: ReadonlySet<string> | null
    readonly require: readonly Capability[]
}

function configError(message: string): AiRouterError {
    return new AiRouterError({ errorClass: "config", message })
}

function positive(value: number | undefined, name: string, allowZero = false): void {
    if (value === undefined) return
    if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) throw configError(`${name} must be a positive number`)
}

/** True when the name is the model's id or one of its aliases. */
export function modelMatches(model: ModelConfig, name: string): boolean {
    return model.id === name || (model.aliases?.includes(name) ?? false)
}

function knownModel(config: PoolConfig, name: string): boolean {
    return config.providers.some((provider) => provider.models.some((model) => modelMatches(model, name)))
}

function validatePolicy(config: PoolConfig, policy: ModelPolicy, where: string): void {
    for (const name of [policy.model, ...(policy.fallbacks ?? [])]) {
        if (name !== undefined && !knownModel(config, name)) throw configError(`${where} names model "${name}", which no provider serves`)
    }
    positive(policy.maxAttempts, `${where}.maxAttempts`)
    positive(policy.timeoutMs, `${where}.timeoutMs`)
    positive(policy.deadlineMs, `${where}.deadlineMs`)
    positive(policy.budget?.maxCost, `${where}.budget.maxCost`, true)
    for (const id of policy.providers ?? []) {
        if (!config.providers.some((provider) => provider.id === id)) throw configError(`${where} names provider "${id}", which is not configured`)
    }
}

/** Refuses a pool that cannot route: no providers, duplicate ids, a key without a source, a bad URL or number. */
export function validateConfig(config: PoolConfig): void {
    if (config.providers.length === 0) throw configError("the pool has no providers")
    const ids = new Set<string>()
    for (const provider of config.providers) {
        if (provider.id === "" || provider.id.includes("/")) throw configError(`provider id "${provider.id}" must be non-empty and without "/"`)
        if (ids.has(provider.id)) throw configError(`provider "${provider.id}" is declared twice`)
        ids.add(provider.id)
        let url: URL
        try {
            url = new URL(provider.baseUrl)
        } catch {
            throw configError(`provider "${provider.id}" has an invalid baseUrl`)
        }
        if (url.protocol !== "https:" && url.protocol !== "http:") throw configError(`provider "${provider.id}" baseUrl must be http or https`)
        positive(provider.weight, `provider "${provider.id}" weight`)
        positive(provider.maxConcurrency, `provider "${provider.id}" maxConcurrency`)
        if (provider.keys.length === 0) throw configError(`provider "${provider.id}" has no keys`)
        if (provider.models.length === 0) throw configError(`provider "${provider.id}" has no models`)
        const aliases = new Set<string>()
        for (const key of provider.keys) {
            if (key.alias === "" || key.alias.includes("/")) throw configError(`key alias "${key.alias}" of provider "${provider.id}" must be non-empty and without "/"`)
            if (aliases.has(key.alias)) throw configError(`provider "${provider.id}" declares key "${key.alias}" twice`)
            aliases.add(key.alias)
            const sources = ("env" in key ? 1 : 0) + ("resolve" in key ? 1 : 0)
            if (sources !== 1) throw configError(`key "${key.alias}" of provider "${provider.id}" needs exactly one of env or resolve`)
            positive(key.weight, `key "${key.alias}" weight`)
            positive(key.maxConcurrency, `key "${key.alias}" maxConcurrency`)
        }
        const models = new Set<string>()
        for (const model of provider.models) {
            if (model.id === "") throw configError(`provider "${provider.id}" has a model with an empty id`)
            if (models.has(model.id)) throw configError(`provider "${provider.id}" declares model "${model.id}" twice`)
            models.add(model.id)
            positive(model.weight, `model "${model.id}" weight`)
            positive(model.contextWindow, `model "${model.id}" contextWindow`)
        }
    }
    if (config.defaults !== undefined) validatePolicy(config, config.defaults, "defaults")
    for (const [name, policy] of Object.entries<ModelPolicy>(config.profiles ?? {})) validatePolicy(config, policy, `profile "${name}"`)
}

/** Applies the defaults of every pool-wide setting. */
export function resolveSettings(config: PoolConfig): Settings {
    const r = config.resilience ?? {}
    const s = config.selection ?? {}
    return {
        keyBreaker: {
            failureThreshold: r.keyBreaker?.failureThreshold ?? 3,
            cooldownMs: r.keyBreaker?.cooldownMs ?? 15_000,
            maxCooldownMs: r.keyBreaker?.maxCooldownMs ?? 300_000,
        },
        providerBreaker: {
            failureThreshold: r.providerBreaker?.failureThreshold ?? 8,
            cooldownMs: r.providerBreaker?.cooldownMs ?? 30_000,
            maxCooldownMs: r.providerBreaker?.maxCooldownMs ?? 300_000,
        },
        backoff: { baseMs: r.backoff?.baseMs ?? 100, factor: r.backoff?.factor ?? 2, maxMs: r.backoff?.maxMs ?? 5_000 },
        authDisableMs: r.authDisableMs === undefined ? null : r.authDisableMs,
        rateLimitCooldownMs: r.rateLimitCooldownMs ?? 10_000,
        latencyTolerance: s.latencyTolerance ?? 1.5,
        latencySlackMs: s.latencySlackMs ?? 50,
        ewmaAlpha: s.ewmaAlpha ?? 0.3,
        lowHeadroom: s.lowHeadroom ?? 1,
        includeContent: config.telemetry?.includeContent ?? false,
        namespace: config.storeNamespace ?? "ai-router",
    }
}

/** Merges defaults, the named profile and the call's policy (later wins, field by field) and expands the model list. */
export function resolvePolicy<P extends string>(config: PoolConfig<P>, options: CallOptions<P>, requestModel: string | undefined): ResolvedPolicy {
    let profile: ModelPolicy = {}
    if (options.profile !== undefined) {
        const found = config.profiles?.[options.profile]
        if (found === undefined) throw configError(`profile "${options.profile}" is not configured`)
        profile = found
    }
    const merged: ModelPolicy = { ...config.defaults, ...profile, ...options.policy }
    if (options.policy !== undefined) validatePolicy(config, options.policy, "policy")
    // A call's policy, then its chosen profile, then the request's own model, then the defaults.
    const preferred = options.policy?.model ?? profile.model ?? requestModel ?? config.defaults?.model
    if (preferred === undefined) throw configError("no model: set request.model, a policy model or a profile model")
    if (!knownModel(config, preferred)) throw configError(`model "${preferred}" is not served by any provider`)
    const models = [preferred]
    if (merged.allowFallback !== false) {
        for (const name of merged.fallbacks ?? []) if (!models.includes(name)) models.push(name)
    }
    return {
        models,
        maxAttempts: merged.maxAttempts ?? 4,
        timeoutMs: merged.timeoutMs ?? 60_000,
        deadlineMs: merged.deadlineMs ?? 120_000,
        maxCost: merged.budget?.maxCost ?? null,
        providers: merged.providers === undefined ? null : new Set(merged.providers),
        require: merged.require ?? [],
    }
}

function fallbacksOf(policy: ModelPolicy): readonly string[] {
    return policy.allowFallback === false ? [] : (policy.fallbacks ?? [])
}

/** Lists the profiles and models of a validated pool; a model id served by several providers is one entry. */
export function buildCatalog(config: PoolConfig): RouterCatalog {
    const models = new Map<string, { aliases: Set<string>; providers: string[]; capabilities: Set<Capability>; contextWindow?: number; cost?: ModelConfig["cost"] }>()
    for (const provider of config.providers) {
        for (const model of provider.models) {
            let entry = models.get(model.id)
            if (entry === undefined) {
                entry = { aliases: new Set(), providers: [], capabilities: new Set() }
                models.set(model.id, entry)
            }
            for (const alias of model.aliases ?? []) entry.aliases.add(alias)
            entry.providers.push(provider.id)
            for (const capability of model.capabilities ?? DEFAULT_CAPABILITIES) entry.capabilities.add(capability)
            if (entry.contextWindow === undefined && model.contextWindow !== undefined) entry.contextWindow = model.contextWindow
            if (entry.cost === undefined && model.cost !== undefined) entry.cost = model.cost
        }
    }
    const defaults = config.defaults ?? {}
    return {
        defaults: { ...(defaults.model === undefined ? {} : { model: defaults.model }), fallbacks: fallbacksOf(defaults) },
        profiles: Object.entries<ModelPolicy>(config.profiles ?? {}).map(([name, policy]) => {
            const merged: ModelPolicy = { ...defaults, ...policy }
            return { name, ...(merged.model === undefined ? {} : { model: merged.model }), fallbacks: fallbacksOf(merged) }
        }),
        models: [...models].map(([id, entry]): CatalogModel => ({
            id,
            aliases: [...entry.aliases],
            providers: entry.providers,
            capabilities: [...entry.capabilities],
            ...(entry.contextWindow === undefined ? {} : { contextWindow: entry.contextWindow }),
            ...(entry.cost === undefined ? {} : { cost: entry.cost }),
        })),
    }
}
