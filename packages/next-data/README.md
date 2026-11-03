# @starci/next-data

The data helpers of a StarCi Next.js front end over SWR: pure logic and one middleware, no component, no class string, no lifecycle of its own (FE-PACKAGES-2). Each operation's SWR hook stays in the app (FE-DATA-SWR): it reads the store, builds its key with the helpers below and calls the transport.

| export | what it is for |
|---|---|
| `pollingRestart` | SWR middleware. A function `refreshInterval` that answered `0` is never scheduled again by SWR; this starts it again when newer data makes it answer above `0`. A numeric or absent interval is untouched. |
| `viewerSwrConfig(defaults)` | the `SWRConfig` value of the provider keyed by the viewer: the defaults, `pollingRestart` in `use`, a fresh cache `Map` per mount |
| `viewerCacheKey(viewerId)` | the `key` of that `SWRConfig`: `"pending"` before the session answers, `"signed-out"`, or the user id, so a change of person remounts the cache |
| `viewerKey(name, viewerId)`, `viewerKeyId` | the key of a viewer-scoped read, `[name, viewer]`, `null` until the session answers |
| `tenantKey(name, tenantId, rest, enabled?)`, `tenantParamsKey`, `tenantRequestKey` | the key of a tenant-scoped read: `[name, tenantId, ...]`, `null` while an input is missing |
| `createViewerCache()` | the writes to the cache of the viewer on screen (`bind`, `unbind`, `mutate`); SWR's exported `mutate` is bound to the default cache and reaches none of the viewers' |

## In an app

```tsx
// modules/viewer-cache/index.ts: the one instance
export const viewerCache = createViewerCache()

// components/providers/AppProviders: one SWR cache per viewer
const ViewerCacheBinding = () => {
    viewerCache.bind(useSWRConfig().mutate)
    return null
}
<SWRConfig key={viewerCacheKey(viewerId)} value={viewerSwrConfig({ focusThrottleInterval: 30_000 })}>
    <ViewerCacheBinding />
    {children}
</SWRConfig>

// hooks/workspaceKey/useWorkspaceKey.ts: the app's hook reads the store, the package builds the key
export const useWorkspaceKey = <Rest extends readonly (string | null)[]>(name: string, rest: Rest, enabled = true) =>
    tenantKey(name, useAppSelector((state) => state.workspace.activeWorkspaceId), rest, enabled)
```

The package pins no SWR or React: `swr` (>= 2) and `react` (>= 18) are peers, the versions of the app's stack.

## Tests

`npm test` typechecks, lints and runs the `node:test` specs under 90% line coverage; the middleware spec drives real SWR in jsdom.
