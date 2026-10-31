import { readFile } from "node:fs/promises"
import { matchesOf } from "./config.ts"
import { AiRouterError } from "./errors.ts"
import type { KeyQuota, MountedKeySpec } from "./gateway/keys.ts"
import { PROVIDER_PRESETS } from "./providers.ts"
import type { CandidateRef, KeyConfig, ModelConfig, ModelPolicy, PoolConfig, ProviderBudget, ProviderConfig, ProviderKind } from "./types.ts"

/**
 * The canonical env naming of upstream keys (docs/design.md, "Config from env"). For a provider whose prefix is `P`:
 *
 *   P_API_KEY, P_API_KEY_2, P_API_KEY_3, ...   one key each, aliases `<id>-1`, `<id>-2`, ... (gaps allowed, no upper bound)
 *   P_API_KEY_FILE, P_API_KEY_2_FILE, ...      the same key mounted as a file (a Docker or Kubernetes secret)
 *   P_API_KEYS                                 a list in one variable, split at commas and whitespace, aliases `<id>-list-1`, ...
 *   P_BASE_URL                                 moves the endpoint (a Qwen region or workspace host, an Ollama host)
 *
 * The prefixes are ANTHROPIC, OPENROUTER, DASHSCOPE (Qwen), DEEPSEEK, OPENAI, GEMINI and GROQ; an `openai-compatible`
 * provider names its own. Every key is read at each attempt, so a rotated secret needs no restart and lifts its blacklist.
 */

/** Env variables are read through this; the default is `process.env`. */
export type EnvSource = Readonly<Record<string, string | undefined>>

/** One provider as an app declares it from env: its kind, models, and optionally its id, prefix and limits. */
export interface EnvProviderSpec {
    readonly kind: ProviderKind
    /** Default: the kind (`openai-compatible` needs one). */
    readonly id?: string
    /** Default: the kind's prefix (`openai-compatible` needs one). */
    readonly envPrefix?: string
    /** Default: `<PREFIX>_BASE_URL`, then the kind's base URL. */
    readonly baseUrl?: string
    readonly models: readonly ModelConfig[]
    readonly headers?: Readonly<Record<string, string>>
    readonly weight?: number
    readonly maxConcurrency?: number
    /** The concurrency cap of each of its keys. */
    readonly keyMaxConcurrency?: number
    readonly defaultMaxTokens?: number
    readonly budget?: ProviderBudget
}

/** A pool declared from env: providers as `EnvProviderSpec`, everything else as `PoolConfig`. */
export interface EnvPoolSpec<Profiles extends string = string> extends Omit<PoolConfig<Profiles>, "providers"> {
    readonly providers: readonly EnvProviderSpec[]
}

function configError(message: string): AiRouterError {
    return new AiRouterError({ errorClass: "config", message })
}

function present(env: EnvSource, name: string): boolean {
    const value = env[name]
    return value !== undefined && value.trim() !== ""
}

async function firstLine(path: string): Promise<string | undefined> {
    try {
        return (await readFile(path, "utf8")).split(/\r?\n/)[0]
    } catch {
        return undefined
    }
}

/** The prefix a spec reads its keys under. */
export function envPrefixOf(spec: Pick<EnvProviderSpec, "kind" | "envPrefix">): string {
    const prefix = spec.envPrefix ?? PROVIDER_PRESETS[spec.kind].envPrefix
    if (prefix === null) throw configError(`a ${spec.kind} provider needs envPrefix: its kind has no canonical env names`)
    if (!/^[A-Z][A-Z0-9_]*$/.test(prefix)) throw configError(`envPrefix "${prefix}" must be upper-case letters, digits and _`)
    return prefix
}

/**
 * The keys of one provider found in env under its prefix, as references read at each attempt: never a copied value.
 * A key given both as a variable and as a `_FILE` twin is refused, since which one wins would be a guess.
 */
export function keysFromEnv(prefix: string, id: string, env: EnvSource = process.env, maxConcurrency?: number): KeyConfig[] {
    const pattern = new RegExp(`^${prefix}_API_KEY(?:_(\\d+))?(_FILE)?$`)
    const found = new Map<number, { name: string; file: boolean }>()
    for (const name of Object.keys(env)) {
        const match = pattern.exec(name)
        if (match === null || !present(env, name)) continue
        const index = match[1] === undefined ? 1 : Number(match[1])
        if (index < 1 || (match[1] !== undefined && index === 1)) throw configError(`${name}: number keys from 2 (${prefix}_API_KEY is the first)`)
        if (found.has(index)) throw configError(`${prefix} key ${String(index)} is set both as a variable and as a _FILE: keep one`)
        found.set(index, { name, file: match[2] !== undefined })
    }
    const cap = maxConcurrency === undefined ? {} : { maxConcurrency }
    const keys: KeyConfig[] = [...found.entries()]
        .sort(([a], [b]) => a - b)
        .map(([index, { name, file }]): KeyConfig => ({ alias: `${id}-${String(index)}`, ...cap, resolve: file ? () => firstLine(env[name] ?? "") : () => env[name] }))
    const list = `${prefix}_API_KEYS`
    if (present(env, list)) {
        const count = (env[list] ?? "").split(/[\s,]+/).filter((value) => value !== "").length
        for (let at = 0; at < count; at++) keys.push({ alias: `${id}-list-${String(at + 1)}`, ...cap, resolve: () => (env[list] ?? "").split(/[\s,]+/).filter((value) => value !== "")[at] })
    }
    return keys
}

/** The providers of the specs that have at least one key in env; a provider with none is left out, not refused. */
export function providersFromEnv(specs: readonly EnvProviderSpec[], env: EnvSource = process.env): ProviderConfig[] {
    const out: ProviderConfig[] = []
    for (const spec of specs) {
        const prefix = envPrefixOf(spec)
        const id = spec.id ?? (spec.kind === "openai-compatible" ? undefined : spec.kind)
        if (id === undefined) throw configError(`an openai-compatible provider (prefix ${prefix}) needs an id`)
        const keys = keysFromEnv(prefix, id, env, spec.keyMaxConcurrency)
        if (keys.length === 0) continue
        const baseUrl = spec.baseUrl ?? (present(env, `${prefix}_BASE_URL`) ? env[`${prefix}_BASE_URL`]?.trim() : undefined)
        out.push({
            id,
            kind: spec.kind,
            ...(baseUrl === undefined ? {} : { baseUrl }),
            ...(spec.headers === undefined ? {} : { headers: spec.headers }),
            ...(spec.weight === undefined ? {} : { weight: spec.weight }),
            ...(spec.maxConcurrency === undefined ? {} : { maxConcurrency: spec.maxConcurrency }),
            ...(spec.defaultMaxTokens === undefined ? {} : { defaultMaxTokens: spec.defaultMaxTokens }),
            ...(spec.budget === undefined ? {} : { budget: spec.budget }),
            keys,
            models: spec.models,
        })
    }
    return out
}

function isTier(entry: CandidateRef | readonly CandidateRef[]): entry is readonly CandidateRef[] {
    return Array.isArray(entry)
}

/** A policy cut down to the candidates the present providers serve; null when nothing it names is left. */
function prune(config: PoolConfig, policy: ModelPolicy): ModelPolicy | null {
    const served = (ref: CandidateRef): boolean => matchesOf(config, ref).length > 0
    if (policy.candidates !== undefined) {
        const tiers = policy.candidates
            .map((entry) => (isTier(entry) ? entry.filter(served) : served(entry) ? entry : null))
            .filter((entry): entry is CandidateRef | CandidateRef[] => entry !== null && (!isTier(entry) || entry.length > 0))
        return tiers.length === 0 ? null : { ...policy, candidates: tiers }
    }
    const fallbacks = policy.fallbacks?.filter((model) => served({ model }))
    const kept = { ...policy, ...(fallbacks === undefined ? {} : { fallbacks }) }
    if (policy.model === undefined || served({ model: policy.model })) return kept
    // The preferred model's provider has no key: its first served fallback leads, unless the profile is pinned.
    const [first, ...rest] = fallbacks ?? []
    if (first === undefined || policy.pinned === true) return null
    return { ...kept, model: first, fallbacks: rest }
}

/**
 * A pool from env: the providers that have keys, and every profile cut down to the candidates they serve, so an app
 * declares every provider it may use and deploys with the keys it has. A profile left with nothing is refused, naming
 * the variables that would give it a candidate.
 */
export function poolFromEnv<P extends string = string>(spec: EnvPoolSpec<P>, env: EnvSource = process.env): PoolConfig<P> {
    const providers = providersFromEnv(spec.providers, env)
    const expected = spec.providers.map((entry) => `${envPrefixOf(entry)}_API_KEY`).join(", ")
    if (providers.length === 0) throw configError(`no provider has a key in env: set one of ${expected}`)
    const { defaults: declaredDefaults, profiles: declaredProfiles, ...settings } = { ...spec, providers }
    const served: PoolConfig = settings
    // A default that names nothing served is dropped, not kept to fail validation.
    const defaults = declaredDefaults === undefined ? null : prune(served, declaredDefaults)
    const pool: PoolConfig<P> = { ...settings, ...(defaults === null ? {} : { defaults }) }
    if (declaredProfiles === undefined) return pool
    const profiles: Record<P, ModelPolicy> = { ...declaredProfiles }
    for (const [name, policy] of Object.entries<ModelPolicy>(declaredProfiles)) {
        const kept = prune(served, policy)
        if (kept === null) throw configError(`profile "${name}" has no candidate whose provider has a key: set one of ${expected}`)
        Object.assign(profiles, { [name]: kept })
    }
    return { ...pool, profiles }
}

/** What `virtualKeyFromEnv` binds the app's own gateway key to. */
export interface VirtualKeyEnvSpec {
    /** The label in the secret, `sk-starci-<label>-...`. */
    readonly label: string
    /** Default `["work", "embed"]`. */
    readonly profiles?: readonly string[]
    /** Exact catalog model ids the key may name besides its profiles. Default none. */
    readonly models?: readonly string[]
    readonly quota?: KeyQuota
    readonly owner?: string
    /** Default `STARCI_AI_KEY`; `<name>_FILE` is read when the variable itself is unset. */
    readonly variable?: string
}

/**
 * The app's virtual key as a mounted key, from `STARCI_AI_KEY` (or its `_FILE` twin, a sealed secret mounted as a
 * file): the one key every client of the app (its LangChain integration, its agent runtime) sends to the gateway.
 */
export async function virtualKeyFromEnv(spec: VirtualKeyEnvSpec, env: EnvSource = process.env): Promise<MountedKeySpec> {
    const variable = spec.variable ?? "STARCI_AI_KEY"
    const file = env[`${variable}_FILE`]
    const secret = present(env, variable) ? (env[variable] ?? "").trim() : file !== undefined && file.trim() !== "" ? ((await firstLine(file.trim())) ?? "").trim() : ""
    if (secret === "") throw configError(`${variable} (or ${variable}_FILE) is not set: seal the app's virtual key`)
    return {
        label: spec.label,
        secret,
        profiles: spec.profiles ?? ["work", "embed"],
        models: spec.models ?? [],
        ...(spec.quota === undefined ? {} : { quota: spec.quota }),
        ...(spec.owner === undefined ? {} : { owner: spec.owner }),
    }
}
