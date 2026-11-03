# Changelog

## 0.1.0 - 2026-11-03

The data helpers of a StarCi front end over SWR, lifted from the product that ran them in production and generalised: no product names, typed, one entry, no component.

- Added: `pollingRestart`, an SWR middleware. SWR schedules the next poll only while a function `refreshInterval` answers above `0`; once it answered `0` nothing wakes it, so a read that starts idle never polls for the same key. The middleware starts the chain again when newer data makes the function answer above `0`. A numeric or absent interval passes through untouched. `shouldRestartPolling` is the pure decision.
- Added: the key helpers of FE-DATA-KEY. `viewerKey` and `viewerKeyId` (`"signed-out"` without a session, a wait until the session answers), `viewerCacheKey` (the `key` of the `SWRConfig` that provides a viewer's cache), `tenantKey`, `tenantParamsKey` and `tenantRequestKey` (the tenant id between the name and the arguments, `null` while an input is missing). They take values, so each app keeps its own hook that reads the store.
- Added: `viewerSwrConfig(defaults)`, the `SWRConfig` value of a viewer-keyed cache: the app's defaults, `pollingRestart` last in `use`, and a fresh `Map` for every mount.
- Added: `createViewerCache()`, the writes to the cache of the viewer now on screen (`bind`, `unbind`, `mutate`): each viewer has a cache of their own, so SWR's exported `mutate` reaches none of them.
- The specs run the middleware on real SWR in jsdom and hold the pure logic at 100% lines.
