# Changelog

## 0.1.0 - 2026-10-26

- Added: the package (owner ruling `event-stream-package`, 2026-10-26): a framework-agnostic Server-Sent Events client for browsers and Node 18+, with no runtime dependency.
  - `createEventStream(config)` with `baseURL`, default `headers`, an async `getToken()` sent as a Bearer token with one renewal on a 401 (`refreshToken()`, else `getToken()` again), a doubling `retry` backoff with jitter that honours the server's `retry:` field, a `heartbeatTimeoutMs` (default 45000) and an injectable `fetch`.
  - `follow()` (callbacks and a `{ close(), lastEventId, state }` handle, `Last-Event-ID` kept across reconnects, `onOpen` on every (re)open, named events through `onEvent`) and `stream()` (an async iterator).
  - Request and frame interceptors, `instance.interceptors.request.use(fn)` and `instance.interceptors.frame.use(fn)`, with `eject` and `clear`.
  - A terminal 4xx (other than 408 and 429) and a typed `EventStreamError` with `status`, `code`, `config`, `response` and `cause`, mirroring the axios error.
  - `parseEventStream` and `EventStreamParser`: a WHATWG-compliant parser (CRLF, LF and CR, multi-line data, byte order mark, `id`, `retry`, `event`).
  - The `@starci/event-stream/swr` subpath: `subscribeEventStream(instance, path, options)` for `useSWRSubscription`; React and SWR are optional peer dependencies of that subpath only.
  - The specs hold 100% line, branch and function coverage.
