/** One measured fetch: the route it belongs to, how long it took in milliseconds, and whether it resolved. */
export interface FetchSample {
    readonly route: string
    readonly ms: number
    readonly ok: boolean
}

/** Where samples go, and how a key names its route; with no `sink` nothing is measured. */
export interface TimedFetcherOptions<Key> {
    readonly route?: (key: Key) => string
    readonly sink?: (sample: FetchSample) => void
    /** The clock, `performance.now` by default; injected in specs. */
    readonly now?: () => number
}

/** The route of a key when none is given: a string key itself, the first element of an array key that is a string, else `"unknown"`. */
export const defaultFetchRoute = (key: unknown): string => {
    if (typeof key === "string") return key
    if (Array.isArray(key) && typeof key[0] === "string") return key[0]
    return "unknown"
}

/**
 * Wraps a fetcher so each call reports `{ route, ms, ok }` to `sink`, the input of per-route p50/p75/p95 load times. Off by
 * default: without a sink the fetcher comes back unchanged. A sink that throws never breaks the fetch; a fetch that fails is
 * reported with `ok: false` and still rejects.
 */
export const timedFetcher = <Key, Data>(
    fetcher: (key: Key) => Data | Promise<Data>,
    options: TimedFetcherOptions<Key> = {},
): ((key: Key) => Data | Promise<Data>) => {
    const sink = options.sink
    if (sink === undefined) return fetcher
    const route = options.route ?? defaultFetchRoute
    const now = options.now ?? (() => performance.now())
    return (key) => {
        const started = now()
        const report = (ok: boolean): void => {
            try {
                sink({ route: route(key), ms: now() - started, ok })
            } catch {
                // A broken sink must not fail the read it measures.
            }
        }
        let result: Data | Promise<Data>
        try {
            result = fetcher(key)
        } catch (error) {
            report(false)
            throw error
        }
        if (!(result instanceof Promise)) {
            report(true)
            return result
        }
        return result.then(
            (data) => {
                report(true)
                return data
            },
            (error: unknown) => {
                report(false)
                throw error
            },
        )
    }
}
