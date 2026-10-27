import { validateConfig } from "./config.ts"
import type { KeyConfig, KeyResolver, ModelConfig, ModelPolicy, PoolConfig, ProviderConfig } from "./types.ts"

/** The fields of a provider the builder takes up front; keys and models follow by method. */
export type ProviderOptions = Omit<ProviderConfig, "id" | "keys" | "models">

/** The fields of a key besides its alias, with exactly one source: `env` or `resolve`. */
export type KeyOptions =
    | { readonly env: string; readonly weight?: number; readonly maxConcurrency?: number }
    | { readonly resolve: KeyResolver; readonly weight?: number; readonly maxConcurrency?: number }

/** The fields of a model besides its id. */
export type ModelOptions = Omit<ModelConfig, "id">

interface Draft {
    id: string
    options: ProviderOptions
    keys: KeyConfig[]
    models: ModelConfig[]
}

/** A fluent, typed way to write a `PoolConfig`; profile names accumulate in the type so calls can only name real ones. */
export class PoolBuilder<Profiles extends string = never> {
    readonly #providers: Draft[] = []
    #profiles: Record<string, ModelPolicy> = {}
    #rest: Omit<PoolConfig, "providers" | "profiles"> = {}

    /** Starts a provider; the `key` and `model` calls after it belong to it. */
    provider(id: string, options: ProviderOptions): this {
        this.#providers.push({ id, options, keys: [], models: [] })
        return this
    }

    #current(what: string): Draft {
        const draft = this.#providers.at(-1)
        if (draft === undefined) throw new TypeError(`${what} needs a provider() before it`)
        return draft
    }

    /** Adds a key to the current provider, by environment variable name or resolver. */
    key(alias: string, options: KeyOptions): this {
        this.#current("key()").keys.push({ alias, ...options })
        return this
    }

    /** Adds a model to the current provider. */
    model(id: string, options: ModelOptions = {}): this {
        this.#current("model()").models.push({ id, ...options })
        return this
    }

    /** Names a policy profile. */
    profile<Name extends string>(name: Name, policy: ModelPolicy): PoolBuilder<Profiles | Name> {
        this.#profiles = { ...this.#profiles, [name]: policy }
        return this as unknown as PoolBuilder<Profiles | Name>
    }

    /** Sets the pool-wide options: defaults, resilience, selection, telemetry, store, fetch. */
    options(options: Omit<PoolConfig, "providers" | "profiles">): this {
        this.#rest = { ...this.#rest, ...options }
        return this
    }

    /** Returns the validated `PoolConfig`. */
    build(): PoolConfig<Profiles> {
        const providers: ProviderConfig[] = this.#providers.map((draft) => ({ ...draft.options, id: draft.id, keys: [...draft.keys], models: [...draft.models] }))
        const config: PoolConfig<Profiles> = { ...this.#rest, providers, profiles: { ...this.#profiles } as Record<Profiles, ModelPolicy> }
        validateConfig(config)
        return config
    }
}

/** Starts a typed pool builder. */
export function definePool(): PoolBuilder {
    return new PoolBuilder()
}
