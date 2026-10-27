# @starci/event-stream

A first-class Server-Sent Events client for the browser and Node 18+, shaped like axios: one instance with defaults,
interceptors, a typed error, and the same call in a callback form and a `for await` form.

- Framework-agnostic ESM, zero runtime dependencies, fully typed, built on `fetch`.
- `Authorization: Bearer` from an async `getToken()`, with **one** renewal on a 401.
- `Last-Event-ID` is kept across reconnects, so the server replays what was missed.
- Doubling backoff with jitter that honours the server's `retry:` field.
- A heartbeat timeout: a silent stream is aborted and reopened.
- A spec-compliant parser (WHATWG event-stream rules), exported on its own.
- An adapter for `useSWRSubscription` at `@starci/event-stream/swr`.

The browser `EventSource` cannot send an `Authorization` header (and a token in the URL leaks into logs), which is why
this reads the response with `fetch`.

## Install

```sh
npm install @starci/event-stream
```

## Getting started

```ts
import { createEventStream } from "@starci/event-stream"

const events = createEventStream({
  baseURL: "https://api.example.com",
  getToken: () => session.accessToken(),
  refreshToken: () => session.refreshAccessToken(),
})

interface BookingStatus {
  bookingId: string
  status: string
}

const handle = events.follow<BookingStatus>("/booking-status/stream", {
  query: { bookingId: "b-1" },
  parse: (data) => JSON.parse(data) as BookingStatus,
  onOpen: () => revalidateSnapshot(), // fires on every (re)open
  onFrame: ({ id, data }) => apply(data),
  onError: (error, info) => console.warn(error.code, info.terminal ? "(stopped)" : `retry in ${info.delayMs}ms`),
})

handle.state // "connecting" | "open" | "reconnecting" | "closed"
handle.lastEventId // the resume point
handle.close()
```

`onOpen` fires every time the stream (re)opens. The stream carries changes and a query carries the snapshot, so this is the
moment to revalidate the snapshot and close the gap since the last frame.

### As an async iterator

```ts
for await (const frame of events.stream<BookingStatus>("/booking-status/stream", { parse: parseStatus })) {
  console.log(frame.id, frame.event, frame.data)
  if (frame.data.status === "done") break // breaking closes the stream
}
```

`stream()` yields every frame, named events included (check `frame.event`). It connects when the loop starts, throws the
`EventStreamError` that ended the stream, and ends quietly when the `signal` aborts. Frames queue without a limit until the
loop reads them.

## The instance

### `createEventStream(config)`

| Option               | Default      | Meaning                                                                                      |
| -------------------- | ------------ | -------------------------------------------------------------------------------------------- |
| `baseURL`            | none         | Joined in front of a relative path.                                                          |
| `headers`            | none         | Sent on every request (names are case-insensitive).                                          |
| `getToken`           | none         | Async token source; sent as `Authorization: Bearer`. Returning nothing sends no header.       |
| `refreshToken`       | `getToken`   | Called on a 401 for a fresh token. A second 401 ends the stream.                              |
| `retry.baseMs`       | `1000`       | First delay; a `retry:` field of the server replaces it.                                      |
| `retry.maxMs`        | `15000`      | Longest delay (a larger server `retry:` still wins).                                          |
| `retry.jitter`       | `true`       | Spread each delay over its upper half.                                                       |
| `retry.maxAttempts`  | unlimited    | Give up after this many consecutive failed attempts; an attempt that opens resets the count. |
| `heartbeatTimeoutMs` | `45000`      | Abort and reconnect when nothing, comments included, arrives for this long. `0` turns it off. |
| `fetch`              | global fetch | Inject a `fetch` for tests and server rendering.                                             |
| `credentials`        | none         | The `credentials` mode of the request (`include` sends cookies cross-origin).                |

`events.defaults` is the live configuration, as `axios.defaults`: changing it affects the next (re)connect.

```ts
events.defaults.headers["x-tenant"] = "acme"
```

### `events.follow(path, options)`

| Option        | Meaning                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------- |
| `query`       | Added to the URL; arrays repeat the key, `null` and `undefined` are left out.               |
| `headers`     | Added to the default headers for this stream.                                               |
| `lastEventId` | Where the stream resumes (sent as `Last-Event-ID` on the first request).                    |
| `signal`      | An `AbortSignal` that closes the stream and its reconnects.                                 |
| `parse`       | `(data, rawFrame) => T`: turns the data text into `T`. Throw to refuse the frame.           |
| `onOpen`      | `(response) => void` on every (re)open.                                                     |
| `onFrame`     | `({ id, event, data }) => void` for the default (`message`) event.                          |
| `onEvent`     | `(name, frame) => void` for named events (`event: tick`). Without it, named events are ignored. |
| `onError`     | `(error, { terminal, attempt, delayMs }) => void` for every failed attempt and refused frame. |
| `onClose`     | `(error?) => void` once: no argument when the caller closed it, the error when it ended on its own. |

Comment lines (`: heartbeat`) never reach a callback, but they count as liveness for the heartbeat timeout. `follow`
returns a handle `{ close(), lastEventId, state }`.

## Reconnecting

A stream that ends, breaks or goes silent is reopened with `Last-Event-ID` after a doubling wait
(`baseMs`, `2 * baseMs`, ... up to `maxMs`). The server steers it with the `retry:` field.

| Answer                                          | Behaviour                                                         |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| network failure, 5xx, 408, 429, no body         | retried with backoff                                              |
| silent for `heartbeatTimeoutMs`                 | aborted and retried (`ECONNABORTED`)                              |
| 401                                             | token renewed once (`refreshToken`, else `getToken` again), then retried at once |
| any other 4xx, or a `Content-Type` that is not `text/event-stream` | **terminal**: reported once, the stream closes, as `EventSource` does |

## Errors

Every failure is an `EventStreamError`, shaped like an axios error:

```ts
import { isEventStreamError } from "@starci/event-stream"

onError: (error, info) => {
  error.code // "ERR_BAD_REQUEST" | "ERR_BAD_RESPONSE" | "ERR_NETWORK" | "ECONNABORTED" | "ERR_REQUEST" | "ERR_FRAME" | "ERR_CALLBACK"
  error.status // the HTTP status, when there was one
  error.config // the request (the authorization header is redacted)
  error.response // the Response, when there was one
  error.cause // the underlying error
  error.retryable // whether the client reconnects after it
}
```

`ERR_FRAME` (a frame interceptor or `parse` threw) drops that frame and the stream goes on. `ERR_CALLBACK` (`onOpen`,
`onFrame` or `onEvent` threw) closes the stream, so a handler bug is not retried forever.

## Interceptors

Interceptors run in the order they were added and may be async. Each returns the value, a new one, or nothing to keep the
mutated one. `use()` returns an id for `eject(id)`; `clear()` removes all.

```ts
// Before every (re)connect: change the url and headers.
events.interceptors.request.use((config) => {
  config.headers["x-request-id"] = crypto.randomUUID()
  config.url += "&client=web"
})

// On every frame, before `parse`: transform, drop (null) or refuse (throw).
events.interceptors.frame.use((frame) => {
  if (frame.data === "") return null
  return { ...frame, data: frame.data.trim() }
})
```

The request config is `{ url, headers, path, attempt, lastEventId }`; `attempt` counts the failed attempts since the last
open, so an interceptor can sign a fresh URL on every reconnect.

## The parser

```ts
import { parseEventStream, EventStreamParser } from "@starci/event-stream"

const response = await fetch(url, { headers: { accept: "text/event-stream" } })
for await (const event of parseEventStream(response.body!)) console.log(event.event, event.data, event.id)

// Or feed decoded text yourself:
const parser = new EventStreamParser({ onEvent: console.log, onRetry: (ms) => console.log("retry", ms) })
parser.feed("data: hel")
parser.feed("lo\r\n\r\n")
```

It follows the WHATWG rules: CRLF, LF and CR line endings (also split across chunks), multi-line `data:`, a leading byte
order mark, comment lines, `id:` that persists (and resets when empty, and is ignored with a NUL), digits-only `retry:`, and
an unfinished event dropped with its connection.

## SWR

`@starci/event-stream/swr` adapts a stream to `useSWRSubscription`. React and SWR are optional peer dependencies of this
subpath only; the adapter itself imports neither.

```tsx
import useSWRSubscription from "swr/subscription"
import { subscribeEventStream } from "@starci/event-stream/swr"

const { data, error } = useSWRSubscription(
  ["booking-status", id],
  subscribeEventStream(events, `/bookings/${id}/stream`, {
    parse: parseStatus,
    onOpen: () => mutate(["booking", id]), // revalidate the snapshot on every (re)open
  }),
)
```

The data of every default frame goes to SWR's `next`, a failed attempt goes as its error (the next frame clears it), and
unsubscribing closes the stream. `select(frame)` picks what SWR receives instead of `frame.data`.

## Types

Everything is exported as a type: `EventStream`, `EventStreamConfig`, `FollowOptions<T>`, `StreamOptions<T>`,
`EventFrame<T>`, `RawFrame`, `RequestConfig`, `ErrorInfo`, `EventStreamHandle`, `ServerSentEvent`, and more.

## Develop

```sh
npm ci
npm test   # builds, then runs the specs with a 100% line, branch and function gate
```

MIT
