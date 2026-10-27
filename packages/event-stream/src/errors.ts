import type { RequestConfig } from "./types.js"

/** The machine-readable reason of an {@link EventStreamError}, shaped after axios's error codes. */
export const EventStreamErrorCode = {
  /** The server answered 4xx (other than 408 and 429): asking again cannot help, the stream ends. */
  BadRequest: "ERR_BAD_REQUEST",
  /** The server answered 5xx, 408 or 429 (retried), or answered 200 with something that is not an event stream. */
  BadResponse: "ERR_BAD_RESPONSE",
  /** The connection failed or broke (retried). */
  Network: "ERR_NETWORK",
  /** The stream was silent for longer than `heartbeatTimeoutMs` (retried). */
  Timeout: "ECONNABORTED",
  /** `getToken`, `refreshToken` or a request interceptor threw (retried). */
  Request: "ERR_REQUEST",
  /** A frame interceptor or the `parse` function threw: the frame is dropped and the stream goes on. */
  Frame: "ERR_FRAME",
  /** `onOpen`, `onFrame` or `onEvent` threw: the stream ends. */
  Callback: "ERR_CALLBACK",
} as const

/** One of the values of {@link EventStreamErrorCode}. */
export type EventStreamErrorCodeValue = (typeof EventStreamErrorCode)[keyof typeof EventStreamErrorCode]

/** What an {@link EventStreamError} can carry besides its message and code. */
export interface EventStreamErrorInit {
  /** The HTTP status of the answer, when there was one. */
  readonly status?: number
  /** The request that failed (the authorization header is redacted). */
  readonly config?: RequestConfig
  /** The answer, when there was one (its body is not read). */
  readonly response?: Response
  /** The error that caused this one. */
  readonly cause?: unknown
  /** True when the client reconnects after this error (unless the attempts ran out). */
  readonly retryable?: boolean
}

/** The one error type of the library: `status`, `code`, `config` and `response` as on an axios error. */
export class EventStreamError extends Error {
  /** Marks the error for {@link isEventStreamError} across realms and package copies. */
  readonly isEventStreamError = true
  readonly code: EventStreamErrorCodeValue
  readonly status: number | undefined
  readonly config: RequestConfig | undefined
  readonly response: Response | undefined
  readonly retryable: boolean

  constructor(message: string, code: EventStreamErrorCodeValue, init: EventStreamErrorInit = {}) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause })
    this.name = "EventStreamError"
    this.code = code
    this.status = init.status
    this.config = init.config
    this.response = init.response
    this.retryable = init.retryable ?? false
  }

  /** A plain object for logs: the same fields without the response. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      status: this.status,
      retryable: this.retryable,
      config: this.config,
    }
  }
}

/** True when `value` is an {@link EventStreamError}. */
export const isEventStreamError = (value: unknown): value is EventStreamError =>
  typeof value === "object" && value !== null && "isEventStreamError" in value && value.isEventStreamError === true
