import type { Arguments, MutatorCallback, MutatorOptions, ScopedMutator } from "swr"

/** A key, a key list, or a test over every cached key. */
export type CacheTarget = Arguments | ((key?: Arguments) => boolean)

/** What a write gives an entry: a value, a promise of one, or a function of the current one. */
export type CacheValue<Data> = Data | Promise<Data> | MutatorCallback<Data>

/**
 * The writes to the cache of the viewer now on screen. Each viewer has a cache of their own, so the `mutate` SWR exports,
 * bound to its default cache, reaches none of them; this one reaches the cache bound last.
 */
export interface ViewerCache {
    /** Binds the writes to the cache of the viewer now on screen; the component that provides that cache calls it with `useSWRConfig().mutate`. */
    readonly bind: (mutator: ScopedMutator) => void
    /** Drops the binding, so a write answers `undefined` until a cache is bound again. */
    readonly unbind: () => void
    /** Refreshes or writes entries of the bound cache the way SWR's own `mutate` does; answers `undefined` while no cache is bound. */
    readonly mutate: <Data = unknown>(
        target: CacheTarget,
        data?: CacheValue<Data>,
        options?: boolean | MutatorOptions<Data>,
    ) => Promise<Data | undefined>
}

/** Creates the viewer-cache writes of an app: one instance per app, imported wherever a write must reach the viewer's cache. */
export const createViewerCache = (): ViewerCache => {
    let bound: ScopedMutator | undefined
    return {
        bind: (mutator) => {
            bound = mutator
        },
        unbind: () => {
            bound = undefined
        },
        mutate: async <Data = unknown>(target: CacheTarget, data?: CacheValue<Data>, options?: boolean | MutatorOptions<Data>) => {
            if (bound === undefined) return undefined
            // ScopedMutator overloads a key and a key test separately, so a union of both resolves to neither.
            if (typeof target === "function") return bound<Data>(target, data, options)
            return bound<Data>(target, data, options)
        },
    }
}
