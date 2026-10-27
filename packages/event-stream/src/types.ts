import type { EventStreamError } from "./errors.js"
import type { InterceptorRegistry } from "./interceptors.js"

/** Header names and values; names are case-insensitive and stored lower-cased. */
export type HeadersRecord = Record<string, string>

/** One query value: `null` and `undefined` are left out, an array repeats the key. */
export type QueryValue = string | number | boolean | null | undefined

/** The query string of a request. */
export type Query = Record<string, QueryValue | readonly QueryValue[]>

/** A token source: a bearer token, or nothing to send no `Authorization` header. */
export type TokenSource = () => string | null | undefined | Promise<string | null | undefined>

/** The backoff between two attempts. */
export interface RetryConfig {
  /** The first delay in milliseconds; a `retry:` field of the server replaces it. Default 1000. */
  baseMs?: number
  /** The longest delay in milliseconds (a larger `retry:` of the server still wins). Default 15000. */
  maxMs?: number
  /** Spread each delay over its upper half, so clients that lost the same server do not return together. Default true. */
  jitter?: boolean
  /** Give up after this many consecutive failed attempts (an attempt that opens resets the count). Default: never. */
  maxAttempts?: number
}

/** What `createEventStream` takes. */
export interface EventStreamConfig {
  /** Joined in front of a relative path. */
  baseURL?: string
  /** Sent on every request. */
  headers?: HeadersRecord
  /** Gives the bearer token, once per (re)connect. */
  getToken?: TokenSource
  /** Gives a fresh token after a 401; when absent, `getToken` is called again. A second 401 ends the stream. */
  refreshToken?: TokenSource
  /** Backoff between attempts. */
  retry?: RetryConfig
  /** Abort and reconnect when nothing (not even a comment line) arrives for this long. Default 45000; 0 turns it off. */
  heartbeatTimeoutMs?: number
  /** The `fetch` to use, for tests and server rendering. Default: the global `fetch`. */
  fetch?: typeof fetch
  /** The `credentials` mode of the request (`include` sends cookies cross-origin). */
  credentials?: RequestCredentials
}

/** The configuration after the defaults: this is `instance.defaults`, and changing it affects the next (re)connect. */
export interface EventStreamDefaults {
  baseURL: string | undefined
  headers: HeadersRecord
  getToken: TokenSource | undefined
  refreshToken: TokenSource | undefined
  retry: Required<Omit<RetryConfig, "maxAttempts">> & Pick<RetryConfig, "maxAttempts">
  heartbeatTimeoutMs: number
  fetch: typeof fetch | undefined
  credentials: RequestCredentials | undefined
}

/** What a request interceptor sees before each (re)connect; change `url` and `headers` in place or return a new one. */
export interface RequestConfig {
  /** The absolute (or, in a browser, relative) URL with the query. */
  url: string
  /** Lower-cased header names, the token and `last-event-id` already set. */
  headers: HeadersRecord
  /** The path the caller asked for. */
  readonly path: string
  /** The number of failed attempts since the last open (0 on the first connect). */
  readonly attempt: number
  /** The last event id the stream saw, if any. */
  readonly lastEventId: string | undefined
}

/** One frame as a frame interceptor sees it: the data is still text. */
export interface RawFrame {
  /** The last event id of the stream at this frame, if any. */
  id: string | undefined
  /** The event name; `message` for the default one. */
  event: string
  /** The `data:` lines joined with a line feed. */
  data: string
}

/** One frame after the interceptors and `parse`. */
export interface EventFrame<T> {
  readonly id: string | undefined
  readonly event: string
  readonly data: T
}

/** Turns the data text of a frame into `T` (typically `JSON.parse` plus a check); throw to refuse the frame. */
export type ParseData<T> = (data: string, frame: RawFrame) => T

/** The state of a followed stream. */
export type EventStreamState = "connecting" | "open" | "reconnecting" | "closed"

/** What `onError` is told about the failure. */
export interface ErrorInfo {
  /** True when the stream ends with this error; false when it reconnects or (a frame error) simply goes on. */
  readonly terminal: boolean
  /** Consecutive failed attempts, this one included. */
  readonly attempt: number
  /** The wait before the next attempt, when one is scheduled. */
  readonly delayMs: number | undefined
}

/** The request side of the options of `follow` and `stream`. */
export interface RequestOptions {
  /** Added to the URL. */
  query?: Query
  /** Added to the default headers for this stream. */
  headers?: HeadersRecord
  /** Where the stream resumes: sent as `Last-Event-ID` on the first request. */
  lastEventId?: string
  /** Closes the stream (and its reconnects) when aborted. */
  signal?: AbortSignal
}

/** The callbacks of `follow`. */
export interface FollowCallbacks<T> {
  /** The stream (re)opened: the moment to revalidate a snapshot, which closes the gap since the last frame. */
  onOpen?(response: Response): void
  /** A default (`message`) event arrived. */
  onFrame?(frame: EventFrame<T>): void
  /** A named event arrived. */
  onEvent?(name: string, frame: EventFrame<T>): void
  /** An attempt failed, a frame was refused, or the stream ended with an error. */
  onError?(error: EventStreamError, info: ErrorInfo): void
  /** The stream closed: no argument when the caller closed it or aborted, the error when it ended on its own. */
  onClose?(error?: EventStreamError): void
}

/** The options of `follow`. */
export interface FollowOptions<T> extends RequestOptions, FollowCallbacks<T> {
  /** Turns the data text into `T`. */
  parse?: ParseData<T>
}

/** The options of `stream`: the frames are the iteration, so the frame callbacks are not taken. */
export interface StreamOptions<T> extends RequestOptions, Pick<FollowCallbacks<T>, "onOpen" | "onError"> {
  parse?: ParseData<T>
}

/** What `follow` returns. */
export interface EventStreamHandle {
  /** Ends the stream and its reconnects; `onClose` fires once. */
  close(): void
  /** The last event id seen. */
  readonly lastEventId: string | undefined
  readonly state: EventStreamState
}

/** The instance `createEventStream` returns. */
export interface EventStream {
  /** The live configuration. */
  readonly defaults: EventStreamDefaults
  readonly interceptors: {
    /** Runs before each (re)connect. */
    readonly request: InterceptorRegistry<RequestConfig>
    /** Runs on every frame, before `parse`; return `null` to drop a frame, throw to refuse it. */
    readonly frame: InterceptorRegistry<RawFrame, null>
  }
  /** Follows a stream with callbacks until closed. */
  follow(path: string, options?: FollowOptions<string>): EventStreamHandle
  follow<T>(path: string, options: FollowOptions<T> & { parse: ParseData<T> }): EventStreamHandle
  /** Follows a stream as an async iterator of every frame (named events carry their `event`); breaking the loop closes it. */
  stream(path: string, options?: StreamOptions<string>): AsyncGenerator<EventFrame<string>, void, undefined>
  stream<T>(path: string, options: StreamOptions<T> & { parse: ParseData<T> }): AsyncGenerator<EventFrame<T>, void, undefined>
}
