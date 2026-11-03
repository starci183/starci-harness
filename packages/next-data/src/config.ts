import type { Cache, Middleware, SWRConfiguration } from "swr"
import { pollingRestart } from "./polling.ts"

/** The `SWRConfig` value of a viewer-keyed cache: the defaults, the middleware list and the cache provider. */
export type ViewerSwrConfig = SWRConfiguration & { readonly use: readonly Middleware[]; readonly provider: () => Cache }

/**
 * The `SWRConfig` value of the provider keyed by the viewer (`viewerCacheKey`): the app's defaults, `pollingRestart` last in the
 * middleware list, and a fresh `Map` for every mount, so nothing cached for the previous person is drawn for the next.
 */
export const viewerSwrConfig = (defaults: SWRConfiguration = {}): ViewerSwrConfig => ({
    ...defaults,
    use: [...(defaults.use ?? []), pollingRestart],
    provider: () => new Map(),
})
