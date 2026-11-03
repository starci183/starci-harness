/** The viewer part of a key while nobody is signed in. */
export const SIGNED_OUT_VIEWER = "signed-out"

/** The identity of the SWR cache while the session answer has not landed. */
export const PENDING_VIEWER = "pending"

/** The id of the person the browser session belongs to: `undefined` until the first answer, `null` when signed out. */
export type ViewerId = string | null | undefined

/** The key of a read that may wait for an input: `null` makes SWR skip the read. */
export type KeyOrWait<Key extends readonly unknown[]> = Key | null

/** The viewer part of a viewer-scoped key: the user id, `"signed-out"` without a session, `undefined` until the session answer lands. */
export const viewerKeyId = (viewerId: ViewerId): string | undefined => (viewerId === undefined ? undefined : (viewerId ?? SIGNED_OUT_VIEWER))

/** The SWR key of a viewer-scoped read, `[name, viewer]`; `null` (the read waits) until the session answer lands. */
export const viewerKey = (name: string, viewerId: ViewerId): KeyOrWait<readonly [string, string]> => {
    const id = viewerKeyId(viewerId)
    return id === undefined ? null : [name, id]
}

/** The identity of the SWR cache a viewer owns, for the `key` of the `SWRConfig` that provides it: a change of person remounts it on a fresh cache. */
export const viewerCacheKey = (viewerId: ViewerId): string => (viewerId === undefined ? PENDING_VIEWER : (viewerId ?? SIGNED_OUT_VIEWER))

/**
 * The SWR key of a read scoped to the active tenant, `[name, tenantId, ...rest]`, so a switch of tenant reads afresh. It is
 * `null` (the read waits) until the store knows the tenant, or while `enabled` is false.
 */
export const tenantKey = <const Rest extends readonly (string | null)[]>(
    name: string,
    tenantId: string | undefined,
    rest: Rest,
    enabled = true,
): KeyOrWait<readonly [string, string, ...Rest]> => (tenantId === undefined || !enabled ? null : [name, tenantId, ...rest])

/** Keys a tenant read by its ordered parameters; absent parameters or an unknown or empty tenant pause the read. */
export const tenantParamsKey = <const Params extends readonly unknown[]>(
    name: string,
    tenantId: string | undefined,
    params: Params | null,
): KeyOrWait<readonly [string, string, ...Params]> => (tenantId !== undefined && tenantId !== "" && params !== null ? [name, tenantId, ...params] : null)

/** Keys a tenant read by its one request object; a `null` request or an unknown tenant pause the read. */
export const tenantRequestKey = <Request>(name: string, tenantId: string | undefined, request: Request | null): KeyOrWait<readonly [string, string, Request]> =>
    request === null || tenantId === undefined ? null : [name, tenantId, request]
