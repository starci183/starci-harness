"use client"

import { useStaticsResolver } from "../../staticsScope.js"

/**
 * Where a piece of media comes from: a URL that is already resolved (`src`) or a statics key resolved through the nearest
 * `StaticsProvider` (`staticsKey`). Exactly one; both or neither does not compile.
 */
export type MediaSourceRef =
    | { readonly src: string; readonly staticsKey?: never }
    | { readonly staticsKey: string; readonly src?: never }

/** The URL a source names, or `null` when its statics key cannot be resolved (no provider, or a malformed key). */
export const useMediaUrl = (): ((source: MediaSourceRef) => string | null) => {
    const resolve = useStaticsResolver()
    return (source) => (source.staticsKey === undefined ? source.src : resolve(source.staticsKey))
}

/** A development failure for a statics key nothing can resolve; production draws the error state instead. */
export const reportUnresolvedStatics = (component: string, source: MediaSourceRef) => {
    if (process.env.NODE_ENV !== "production" && source.staticsKey !== undefined) console.error(`STATICS_KEY_UNRESOLVED: ${component} staticsKey "${source.staticsKey}" has no StaticsProvider above it, or is not a relative key of plain segments`)
}
