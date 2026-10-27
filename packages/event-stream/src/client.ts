import { EventStreamError, EventStreamErrorCode } from "./errors.js"
import type { EventStreamErrorCodeValue } from "./errors.js"
import { InterceptorChain } from "./interceptors.js"
import { parseEventStream } from "./parser.js"
import type { ServerSentEvent } from "./parser.js"
import type {
  EventFrame,
  EventStream,
  EventStreamConfig,
  EventStreamDefaults,
  EventStreamHandle,
  EventStreamState,
  FollowOptions,
  RawFrame,
  RequestConfig,
  StreamOptions,
} from "./types.js"
import { backoffDelay, buildUrl, mergeHeaders } from "./url.js"

const DEFAULT_HEARTBEAT_TIMEOUT_MS = 45_000
const REDACTED = "[redacted]"

/** A refusal that repeats: a 4xx other than 408 (timeout) and 429 (too many requests), as the browser `EventSource` treats it. */
const isFinalRefusal = (status: number): boolean => status >= 400 && status < 500 && status !== 408 && status !== 429

/** The request without its credentials, for an error to carry. */
const redacted = (config: RequestConfig): RequestConfig => ({
  ...config,
  headers: mergeHeaders(config.headers, config.headers.authorization === undefined ? undefined : { authorization: REDACTED }),
})

/** What one connection attempt came to. */
interface Outcome {
  /** True when the stream opened during the attempt. */
  readonly opened: boolean
  /** The reason it ended; absent when the server closed the stream cleanly. */
  readonly error: EventStreamError | undefined
}

/** The pieces of an instance that a followed stream reads. */
interface Core {
  readonly defaults: EventStreamDefaults
  readonly requestInterceptors: InterceptorChain<RequestConfig>
  readonly frameInterceptors: InterceptorChain<RawFrame, null>
}

const resolveDefaults = (config: EventStreamConfig): EventStreamDefaults => ({
  baseURL: config.baseURL,
  headers: mergeHeaders(config.headers),
  getToken: config.getToken,
  refreshToken: config.refreshToken,
  retry: {
    baseMs: config.retry?.baseMs ?? 1000,
    maxMs: config.retry?.maxMs ?? 15_000,
    jitter: config.retry?.jitter ?? true,
    ...(config.retry?.maxAttempts === undefined ? {} : { maxAttempts: config.retry.maxAttempts }),
  },
  heartbeatTimeoutMs: config.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS,
  fetch: config.fetch,
  credentials: config.credentials,
})

/** Runs a callback of the caller; what it throws ends the stream with a typed error. */
const callback = (run: () => void): void => {
  try {
    run()
  } catch (cause) {
    throw new EventStreamError("an event stream callback threw", EventStreamErrorCode.Callback, { cause })
  }
}

/** Starts following one stream; the loop runs until the handle is closed, the signal aborts or an error ends it. */
function startFollow<T>(core: Core, path: string, options: FollowOptions<T>): EventStreamHandle {
  const life = new AbortController()
  let state: EventStreamState = "connecting"
  let lastEventId = options.lastEventId === "" ? undefined : options.lastEventId
  let serverRetryMs: number | undefined

  const closed = (): boolean => state === "closed"
  const detach = (): void => options.signal?.removeEventListener("abort", close)
  const finish = (error?: EventStreamError): void => {
    if (closed()) return
    state = "closed"
    detach()
    life.abort()
    options.onClose?.(error)
  }
  function close(): void {
    finish()
  }

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer)
        life.signal.removeEventListener("abort", done)
        resolve()
      }
      const timer = setTimeout(done, ms)
      life.signal.addEventListener("abort", done, { once: true })
    })

  const report = (error: EventStreamError, terminal: boolean, attempt: number, delayMs: number | undefined): void =>
    options.onError?.(error, { terminal, attempt, delayMs })

  /** Reads the token (or the renewed one) and builds the request through the interceptors. */
  const prepare = async (attempt: number, renew: boolean): Promise<RequestConfig> => {
    const { defaults } = core
    const source = renew ? (defaults.refreshToken ?? defaults.getToken) : defaults.getToken
    let config: RequestConfig = {
      url: buildUrl(defaults.baseURL, path, options.query),
      headers: {},
      path,
      attempt,
      lastEventId,
    }
    try {
      const token = await source?.()
      config.headers = mergeHeaders(
        { accept: "text/event-stream", "cache-control": "no-cache" },
        defaults.headers,
        token ? { authorization: `Bearer ${token}` } : undefined,
        options.headers,
        lastEventId === undefined ? undefined : { "last-event-id": lastEventId },
      )
      config = await core.requestInterceptors.run(config)
    } catch (cause) {
      throw new EventStreamError("the request could not be prepared", EventStreamErrorCode.Request, { cause, retryable: true })
    }
    return config
  }

  /** Hands one event to the frame interceptors, `parse` and the caller's callbacks. */
  const deliver = async (event: ServerSentEvent, attempt: number): Promise<void> => {
    let frame: EventFrame<T>
    try {
      const raw = await core.frameInterceptors.run({ id: event.id === "" ? undefined : event.id, event: event.event, data: event.data })
      if (raw === null) return
      frame = { id: raw.id, event: raw.event, data: options.parse ? options.parse(raw.data, raw) : (raw.data as T) }
    } catch (cause) {
      report(new EventStreamError("a frame was refused", EventStreamErrorCode.Frame, { cause }), false, attempt, undefined)
      return
    }
    if (frame.event === "message") callback(() => options.onFrame?.(frame))
    else callback(() => options.onEvent?.(frame.event, frame))
  }

  /** One connection: request, read until it ends, and say how it ended. */
  const attemptOnce = async (attempt: number): Promise<Outcome> => {
    const connection = new AbortController()
    const abort = (): void => connection.abort()
    life.signal.addEventListener("abort", abort, { once: true })
    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const touch = (): void => {
      clearTimeout(timer)
      const ms = core.defaults.heartbeatTimeoutMs
      if (ms > 0)
        timer = setTimeout(() => {
          timedOut = true
          connection.abort()
        }, ms)
    }
    let opened = false
    let sent: RequestConfig | undefined
    const connect = async (): Promise<Outcome> => {
      try {
        touch()
        const send = async (renew: boolean): Promise<Response> => {
          const prepared = await prepare(attempt, renew)
          sent = redacted(prepared)
          // Called as a plain function: a browser fetch throws "Illegal invocation" when it is called as a method of another object.
          const doFetch = core.defaults.fetch ?? globalThis.fetch
          const { credentials } = core.defaults
          return doFetch(prepared.url, {
            method: "GET",
            headers: prepared.headers,
            signal: connection.signal,
            cache: "no-store",
            ...(credentials === undefined ? {} : { credentials }),
          })
        }
        let response = await send(false)
        if (response.status === 401 && (core.defaults.refreshToken ?? core.defaults.getToken) !== undefined) {
          await response.body?.cancel()
          touch()
          response = await send(true)
        }
        if (closed()) return { opened, error: undefined }
        const context = { status: response.status, config: sent, response }
        if (!response.ok) {
          const retryable = !isFinalRefusal(response.status)
          const code = retryable ? EventStreamErrorCode.BadResponse : EventStreamErrorCode.BadRequest
          throw new EventStreamError(`the event stream was refused with status ${response.status}`, code, { ...context, retryable })
        }
        const contentType = response.headers.get("content-type")
        if (contentType !== null && !contentType.toLowerCase().includes("text/event-stream"))
          throw new EventStreamError(`the event stream answered ${contentType}`, EventStreamErrorCode.BadResponse, context)
        if (response.body === null)
          throw new EventStreamError("the event stream answered no body", EventStreamErrorCode.BadResponse, { ...context, retryable: true })
        opened = true
        touch()
        state = "open"
        callback(() => options.onOpen?.(response))
        const events = parseEventStream(response.body, {
          lastEventId: lastEventId ?? "",
          onRetry: (ms) => {
            serverRetryMs = ms
          },
          onChunk: touch,
          onLastEventId: (id) => {
            lastEventId = id === "" ? undefined : id
          },
        })
        for await (const event of events) {
          await deliver(event, attempt)
          if (closed()) break
        }
        return { opened, error: undefined }
      } catch (cause) {
        if (closed()) return { opened, error: undefined }
        if (cause instanceof EventStreamError) return { opened, error: cause }
        const context = { config: sent }
        return {
          opened,
          error: timedOut
            ? new EventStreamError("the event stream was silent for too long", EventStreamErrorCode.Timeout, { ...context, cause, retryable: true })
            : new EventStreamError("the event stream failed", EventStreamErrorCode.Network, { ...context, cause, retryable: true }),
        }
      }
    }
    const outcome = await connect()
    clearTimeout(timer)
    life.signal.removeEventListener("abort", abort)
    return outcome
  }

  const run = async (): Promise<void> => {
    let failures = 0
    while (!closed()) {
      const { opened, error } = await attemptOnce(failures)
      if (closed()) return
      if (opened) failures = 0
      if (error !== undefined) failures++
      const { retry } = core.defaults
      const exhausted = retry.maxAttempts !== undefined && failures >= retry.maxAttempts
      if (error !== undefined && (!error.retryable || exhausted)) {
        report(error, true, failures, undefined)
        finish(error)
        return
      }
      const delayMs = backoffDelay(failures, retry, serverRetryMs, Math.random)
      if (error !== undefined) report(error, false, failures, delayMs)
      state = "reconnecting"
      await sleep(delayMs)
    }
  }
  if (options.signal?.aborted) queueMicrotask(close)
  else {
    options.signal?.addEventListener("abort", close, { once: true })
    void run()
  }

  return {
    close,
    get lastEventId() {
      return lastEventId
    },
    get state() {
      return state
    },
  }
}

/** A promise and the function that resolves it. */
const signal = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/** Follows a stream as an async iterator: frames queue up until the loop reads them. */
async function* iterate<T>(core: Core, path: string, options: StreamOptions<T>): AsyncGenerator<EventFrame<T>, void, undefined> {
  const queue: EventFrame<T>[] = []
  let ended = false
  let failure: EventStreamError | undefined
  let changed = signal()
  const push = (frame: EventFrame<T>): void => {
    queue.push(frame)
    changed.resolve()
  }
  const handle = startFollow<T>(core, path, {
    ...options,
    onFrame: push,
    onEvent: (_name, frame) => push(frame),
    onClose: (error) => {
      ended = true
      failure = error
      changed.resolve()
    },
  })
  try {
    for (;;) {
      const frame = queue.shift()
      if (frame !== undefined) yield frame
      else if (!ended) {
        await changed.promise
        changed = signal()
      }
      else if (failure !== undefined) throw failure
      else return
    }
  } finally {
    handle.close()
  }
}

/**
 * Creates an event stream client.
 *
 * ```ts
 * const events = createEventStream({ baseURL: "https://api.example.com", getToken: () => session.accessToken() })
 * const handle = events.follow<Booking>("/bookings/stream", {
 *   parse: (data) => JSON.parse(data) as Booking,
 *   onOpen: () => revalidate(),
 *   onFrame: ({ data }) => apply(data),
 * })
 * handle.close()
 * ```
 */
export function createEventStream(config: EventStreamConfig = {}): EventStream {
  const core: Core = {
    defaults: resolveDefaults(config),
    requestInterceptors: new InterceptorChain<RequestConfig>(),
    frameInterceptors: new InterceptorChain<RawFrame, null>(),
  }
  return {
    defaults: core.defaults,
    interceptors: { request: core.requestInterceptors, frame: core.frameInterceptors },
    follow: (path: string, options: FollowOptions<unknown> = {}): EventStreamHandle => startFollow(core, path, options),
    stream: (path: string, options: StreamOptions<unknown> = {}) => iterate(core, path, options),
  } as EventStream
}

export type { EventStreamErrorCodeValue }
