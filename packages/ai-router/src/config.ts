import { AiRouterError } from "./errors.ts"
import { baseUrlOf, presetOf, PROVIDER_PRESETS } from "./providers.ts"
import type { CallOptions, CandidateRef, Capability, CatalogModel, ModelConfig, ModelPolicy, PoolConfig, ProviderConfig, RouterCatalog } from "./types.ts"

/** The capabilities of a model that declares none. */
export const DEFAULT_CAPABILITIES: readonly Capability[] = ["chat", "streaming", "tools", "json"]

/** How long a spent quota keeps its key out when the provider names no window: 6 hours. */
export const DEFAULT_QUOTA_BLACKLIST_MS = 6 * 3_600_000

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
    readonly quotaBlacklistMs: number
    readonly latencyTolerance: number
    readonly latencySlackMs: number
    readonly ewmaAlpha: number
    readonly lowHeadroom: number
    readonly includeContent: boolean
    readonly namespace: string
}

/** One candidate of a resolved policy: a model name, the provider it is held to (null: any), and its weight in its tier. */
export interface ResolvedRef {
    readonly model: string
    readonly provider: string | null
    readonly weight: number
}

/** One call's policy with every default applied and its candidates expanded into tiers. */
export interface ResolvedPolicy {
    /** The tiers, tried in order; the candidates of one tier share the load by weight. */
    readonly tiers: readonly (readonly ResolvedRef[])[]
    /** Every model name of the tiers, in order and without repeats: what a message names. */
    readonly models: readonly string[]
    readonly pinned: boolean
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

/** The identity of a model: its declared `identity`, else its id. */
export function identityOf(model: ModelConfig): string {
    return model.identity ?? model.id
}

/** Every (provider, model) a candidate resolves to. */
export function matchesOf(config: PoolConfig, ref: { readonly model: string; readonly provider?: string | null }): { provider: ProviderConfig; model: ModelConfig }[] {
    const out: { provider: ProviderConfig; model: ModelConfig }[] = []
    for (const provider of config.providers) {
        if (ref.provider !== undefined && ref.provider !== null && provider.id !== ref.provider) continue
        for (const model of provider.models) if (modelMatches(model, ref.model)) out.push({ provider, model })
    }
    return out
}

function knownModel(config: PoolConfig, name: string): boolean {
    return matchesOf(config, { model: name }).length > 0
}

/** The candidates of a policy as tiers of refs, or null when it lists none. */
function candidateTiers(policy: ModelPolicy): CandidateRef[][] | null {
    if (policy.candidates === undefined) return null
    return policy.candidates.map((entry): CandidateRef[] => (isRefList(entry) ? [...entry] : [entry]))
}

function isRefList(entry: CandidateRef | readonly CandidateRef[]): entry is readonly CandidateRef[] {
    return Array.isArray(entry)
}

function validatePolicy(config: PoolConfig, policy: ModelPolicy, where: string): void {
    for (const name of [policy.model, ...(policy.fallbacks ?? [])]) {
        if (name !== undefined && !knownModel(config, name)) throw configError(`${where} names model "${name}", which no provider serves`)
    }
    const tiers = candidateTiers(policy)
    if (tiers !== null) {
        if (policy.model !== undefined || policy.fallbacks !== undefined) throw configError(`${where} sets candidates and model or fallbacks: give one or the other`)
        if (tiers.length === 0) throw configError(`${where}.candidates is empty`)
        tiers.forEach((tier, index) => {
            if (tier.length === 0) throw configError(`${where}.candidates[${String(index)}] is an empty tier`)
            for (const ref of tier) {
                if (ref.provider !== undefined && !config.providers.some((provider) => provider.id === ref.provider)) throw configError(`${where} names provider "${ref.provider}", which is not configured`)
                if (matchesOf(config, ref).length === 0) throw configError(`${where} names model "${ref.model}"${ref.provider === undefined ? "" : ` on provider "${ref.provider}"`}, which it does not serve`)
                positive(ref.weight, `${where} candidate "${ref.model}" weight`)
            }
        })
    }
    positive(policy.maxAttempts, `${where}.maxAttempts`)
    positive(policy.timeoutMs, `${where}.timeoutMs`)
    positive(policy.deadlineMs, `${where}.deadlineMs`)
    positive(policy.budget?.maxCost, `${where}.budget.maxCost`, true)
    for (const id of policy.providers ?? []) {
        if (!config.providers.some((provider) => provider.id === id)) throw configError(`${where} names provider "${id}", which is not configured`)
    }
}

/** Refuses a pinned profile whose candidates resolve to more than one model identity or vector length. */
function validatePinned(config: PoolConfig, policy: ModelPolicy, where: string): void {
    const refs = refsOf(policy)
    if (refs.length === 0) throw configError(`${where} is pinned but names no model`)
    const identities = new Set<string>()
    const dimensions = new Set<string>()
    for (const ref of refs) {
        for (const { model } of matchesOf(config, ref)) {
            identities.add(identityOf(model))
            dimensions.add(String(model.dimensions ?? "unset"))
        }
    }
    if (identities.size > 1) throw configError(`${where} is pinned but its candidates are different models (${[...identities].join(", ")}): give them one identity, or split the profile`)
    if (dimensions.size > 1) throw configError(`${where} is pinned but its candidates answer vectors of different lengths (${[...dimensions].join(", ")})`)
}

/** Every candidate a policy names, in order: its candidates, else its model and fallbacks. */
function refsOf(policy: ModelPolicy): CandidateRef[] {
    const tiers = candidateTiers(policy)
    if (tiers !== null) return tiers.flat()
    return [policy.model, ...(policy.fallbacks ?? [])].filter((name): name is string => name !== undefined).map((model) => ({ model }))
}

/** Refuses a pool that cannot route: no providers, duplicate ids, a key without a source, a bad URL, kind or number. */
export function validateConfig(config: PoolConfig): void {
    if (config.providers.length === 0) throw configError("the pool has no providers")
    const ids = new Set<string>()
    for (const provider of config.providers) {
        if (provider.id === "" || provider.id.includes("/")) throw configError(`provider id "${provider.id}" must be non-empty and without "/"`)
        if (ids.has(provider.id)) throw configError(`provider "${provider.id}" is declared twice`)
        ids.add(provider.id)
        if (provider.kind !== undefined && !Object.hasOwn(PROVIDER_PRESETS, provider.kind)) throw configError(`provider "${provider.id}" has an unknown kind "${provider.kind}"`)
        const preset = presetOf(provider)
        if (provider.baseUrl === undefined && preset.baseUrl === null) throw configError(`provider "${provider.id}" needs a baseUrl: kind ${preset.kind} has no default`)
        let url: URL
        try {
            url = new URL(baseUrlOf(provider))
        } catch {
            throw configError(`provider "${provider.id}" has an invalid baseUrl`)
        }
        if (url.protocol !== "https:" && url.protocol !== "http:") throw configError(`provider "${provider.id}" baseUrl must be http or https`)
        positive(provider.weight, `provider "${provider.id}" weight`)
        positive(provider.maxConcurrency, `provider "${provider.id}" maxConcurrency`)
        positive(provider.defaultMaxTokens, `provider "${provider.id}" defaultMaxTokens`)
        positive(provider.budget?.costPerDay, `provider "${provider.id}" budget.costPerDay`, true)
        positive(provider.budget?.costPerMonth, `provider "${provider.id}" budget.costPerMonth`, true)
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
            if (model.dimensions !== undefined && (!Number.isInteger(model.dimensions) || model.dimensions < 1)) throw configError(`model "${model.id}" dimensions must be a positive integer`)
            if (!preset.embeddings && (model.capabilities ?? []).includes("embeddings")) throw configError(`provider "${provider.id}" (${preset.kind}) has no embeddings API, so model "${model.id}" cannot declare embeddings`)
        }
    }
    positive(config.resilience?.quotaBlacklistMs, "resilience.quotaBlacklistMs")
    if (config.defaults !== undefined) {
        validatePolicy(config, config.defaults, "defaults")
        if (config.defaults.pinned === true) throw configError("defaults cannot be pinned: pin a profile")
    }
    for (const [name, policy] of Object.entries<ModelPolicy>(config.profiles ?? {})) {
        validatePolicy(config, policy, `profile "${name}"`)
        if (policy.pinned === true) validatePinned(config, policy, `profile "${name}"`)
    }
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
        quotaBlacklistMs: r.quotaBlacklistMs ?? DEFAULT_QUOTA_BLACKLIST_MS,
        latencyTolerance: s.latencyTolerance ?? 1.5,
        latencySlackMs: s.latencySlackMs ?? 50,
        ewmaAlpha: s.ewmaAlpha ?? 0.3,
        lowHeadroom: s.lowHeadroom ?? 1,
        includeContent: config.telemetry?.includeContent ?? false,
        namespace: config.storeNamespace ?? "ai-router",
    }
}

/**
 * Where a call's models come from, the first that names any: the call's model, the call's candidates, the profile's
 * candidates, the profile's model, the request's model, the defaults' candidates, the defaults' model.
 */
function sourceOf(defaults: ModelPolicy, profile: ModelPolicy, call: ModelPolicy, requestModel: string | undefined): { candidates: CandidateRef[][] } | { model: string | undefined } {
    if (call.model !== undefined) return { model: call.model }
    for (const policy of [call, profile]) {
        const tiers = candidateTiers(policy)
        if (tiers !== null) return { candidates: tiers }
        if (policy === profile && profile.model !== undefined) return { model: profile.model }
    }
    if (requestModel !== undefined) return { model: requestModel }
    const tiers = candidateTiers(defaults)
    return tiers === null ? { model: defaults.model } : { candidates: tiers }
}

function single(model: string): ResolvedRef[] {
    return [{ model, provider: null, weight: 1 }]
}

/**
 * Merges defaults, the named profile and the call's policy (later wins, field by field) and expands the candidates
 * into tiers. A call's own `model` wins over the profile's candidates; a pinned profile refuses another model.
 */
export function resolvePolicy<P extends string>(config: PoolConfig<P>, options: CallOptions<P>, requestModel: string | undefined): ResolvedPolicy {
    let profile: ModelPolicy = {}
    if (options.profile !== undefined) {
        const found = config.profiles?.[options.profile]
        if (found === undefined) throw configError(`profile "${options.profile}" is not configured`)
        profile = found
    }
    const call = options.policy
    if (call !== undefined) validatePolicy(config, call, "policy")
    const pinned = profile.pinned === true
    if (pinned && call !== undefined && (call.model !== undefined || call.fallbacks !== undefined || call.candidates !== undefined)) {
        throw configError(`profile "${options.profile ?? ""}" is pinned to one model: a call cannot name another`)
    }
    const merged: ModelPolicy = { ...config.defaults, ...profile, ...call }
    let tiers: ResolvedRef[][]
    const source = sourceOf(config.defaults ?? {}, profile, call ?? {}, requestModel)
    if ("candidates" in source) {
        tiers = source.candidates.map((tier) => tier.map((ref) => ({ model: ref.model, provider: ref.provider ?? null, weight: ref.weight ?? 1 })))
    } else {
        const preferred = source.model
        if (preferred === undefined) throw configError("no model: set request.model, a policy model or a profile model")
        if (!knownModel(config, preferred)) throw configError(`model "${preferred}" is not served by any provider`)
        const names = [preferred]
        for (const name of merged.fallbacks ?? []) if (!names.includes(name)) names.push(name)
        tiers = names.map(single)
    }
    if (merged.allowFallback === false) tiers = tiers.slice(0, 1)
    const models: string[] = []
    for (const ref of tiers.flat()) if (!models.includes(ref.model)) models.push(ref.model)
    return {
        tiers,
        models,
        pinned,
        maxAttempts: merged.maxAttempts ?? 4,
        timeoutMs: merged.timeoutMs ?? 60_000,
        deadlineMs: merged.deadlineMs ?? 120_000,
        maxCost: merged.budget?.maxCost ?? null,
        providers: merged.providers === undefined ? null : new Set(merged.providers),
        require: merged.require ?? [],
    }
}

/** The model names a profile (or the defaults) tries, first then the rest; the rest is empty when fallback is off. */
function namesOf(defaults: ModelPolicy, profile: ModelPolicy): { model?: string; fallbacks: readonly string[] } {
    const source = sourceOf(defaults, profile, {}, undefined)
    const merged: ModelPolicy = { ...defaults, ...profile }
    const names: string[] = []
    const add = (name: string): void => {
        if (!names.includes(name)) names.push(name)
    }
    if ("candidates" in source) {
        for (const ref of source.candidates.flat()) add(ref.model)
        const [first, ...rest] = names
        return { ...(first === undefined ? {} : { model: first }), fallbacks: merged.allowFallback === false ? [] : rest }
    }
    if (source.model !== undefined) add(source.model)
    for (const name of merged.fallbacks ?? []) add(name)
    const rest = source.model === undefined ? names : names.slice(1)
    return { ...(source.model === undefined ? {} : { model: source.model }), fallbacks: merged.allowFallback === false ? [] : rest }
}

const OPERATIONS: readonly ("chat" | "embeddings")[] = ["chat", "embeddings"]

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
    const serves = (name: string | undefined): ("chat" | "embeddings")[] => {
        if (name === undefined) return []
        const capabilities = new Set(matchesOf(config, { model: name }).flatMap(({ model }) => model.capabilities ?? DEFAULT_CAPABILITIES))
        return OPERATIONS.filter((operation) => capabilities.has(operation))
    }
    return {
        defaults: namesOf({}, defaults),
        profiles: Object.entries<ModelPolicy>(config.profiles ?? {}).map(([name, policy]) => {
            const named = namesOf(defaults, policy)
            return { name, ...named, pinned: policy.pinned === true, serves: serves(named.model) }
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
