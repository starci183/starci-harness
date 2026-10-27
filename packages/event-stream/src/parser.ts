/** One dispatched event, by the WHATWG server-sent-events rules. */
export interface ServerSentEvent {
  /** The `event:` field, or `message` when the event named none. */
  readonly event: string
  /** The `data:` lines joined with a line feed. */
  readonly data: string
  /** The last event id the stream set up to this event (`id:` fields persist), or an empty string when it set none. */
  readonly id: string
}

/** What a parser tells its owner. */
export interface EventStreamParserHandlers {
  /** An event was dispatched. */
  onEvent(event: ServerSentEvent): void
  /** A `retry:` field set the reconnection time, in milliseconds. */
  onRetry?(ms: number): void
}

/** Where a parser starts. */
export interface EventStreamParserOptions {
  /** The last event id of the stream before this response (the `Last-Event-ID` of the request). */
  readonly lastEventId?: string
}

const LINE_FEED = 10
const CARRIAGE_RETURN = 13
const COLON = 58
const BYTE_ORDER_MARK = 0xfeff
const DIGITS = /^\d+$/

/**
 * An incremental parser of the `text/event-stream` format: feed it decoded text in chunks of any size and it calls back for each
 * complete event. Lines end with CRLF, LF or CR (also across chunks), a leading byte order mark is ignored, an unfinished event
 * is dropped with its response, and the `event`, `data`, `id` and `retry` fields follow the WHATWG rules.
 */
export class EventStreamParser {
  readonly #handlers: EventStreamParserHandlers
  #buffer = ""
  #started = false
  #skipLineFeed = false
  #dataLines: string[] = []
  #eventType = ""
  #idBuffer: string
  #lastEventId: string

  constructor(handlers: EventStreamParserHandlers, options: EventStreamParserOptions = {}) {
    this.#handlers = handlers
    this.#lastEventId = options.lastEventId ?? ""
    this.#idBuffer = this.#lastEventId
  }

  /** The last event id dispatched so far. */
  get lastEventId(): string {
    return this.#lastEventId
  }

  /** Reads the next piece of decoded text. */
  feed(chunk: string): void {
    let text = chunk
    if (!this.#started && text.length > 0) {
      this.#started = true
      if (text.charCodeAt(0) === BYTE_ORDER_MARK) text = text.slice(1)
    }
    if (this.#skipLineFeed && text.length > 0) {
      this.#skipLineFeed = false
      if (text.charCodeAt(0) === LINE_FEED) text = text.slice(1)
    }
    const buffer = this.#buffer + text
    let start = 0
    for (let i = 0; i < buffer.length; i++) {
      const code = buffer.charCodeAt(i)
      if (code !== LINE_FEED && code !== CARRIAGE_RETURN) continue
      this.#readLine(buffer.slice(start, i))
      if (code === CARRIAGE_RETURN) {
        if (i + 1 === buffer.length) this.#skipLineFeed = true
        else if (buffer.charCodeAt(i + 1) === LINE_FEED) i++
      }
      start = i + 1
    }
    this.#buffer = buffer.slice(start)
  }

  #readLine(line: string): void {
    if (line === "") {
      this.#dispatch()
      return
    }
    if (line.charCodeAt(0) === COLON) return
    const colon = line.indexOf(":")
    const field = colon === -1 ? line : line.slice(0, colon)
    const raw = colon === -1 ? "" : line.slice(colon + 1)
    const value = raw.startsWith(" ") ? raw.slice(1) : raw
    if (field === "event") this.#eventType = value
    else if (field === "data") this.#dataLines.push(value)
    else if (field === "id") {
      if (!value.includes("\0")) this.#idBuffer = value
    } else if (field === "retry" && DIGITS.test(value)) this.#handlers.onRetry?.(Number(value))
  }

  #dispatch(): void {
    this.#lastEventId = this.#idBuffer
    const lines = this.#dataLines
    const event = this.#eventType
    this.#dataLines = []
    this.#eventType = ""
    if (lines.length === 0) return
    this.#handlers.onEvent({ event: event === "" ? "message" : event, data: lines.join("\n"), id: this.#lastEventId })
  }
}

/** A response body or any other source of event-stream bytes or text. */
export type EventStreamSource = ReadableStream<Uint8Array> | AsyncIterable<Uint8Array | string>

/** What {@link parseEventStream} takes besides the source. */
export interface ParseEventStreamOptions extends EventStreamParserOptions {
  /** A `retry:` field set the reconnection time, in milliseconds. */
  readonly onRetry?: (ms: number) => void
  /** Called for every chunk read from the source, whatever it holds (comments included): the liveness of the stream. */
  readonly onChunk?: () => void
  /** Called with the last event id after every dispatch, even when the event had no data. */
  readonly onLastEventId?: (id: string) => void
}

const isReadableStream = (source: EventStreamSource): source is ReadableStream<Uint8Array> => "getReader" in source

/** The chunks of a source; a web stream is cancelled when the consumer stops early. */
async function* chunksOf(source: EventStreamSource): AsyncGenerator<Uint8Array | string, void, undefined> {
  if (!isReadableStream(source)) {
    yield* source
    return
  }
  const reader = source.getReader()
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) return
      yield chunk.value
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

/**
 * Reads a `text/event-stream` body and yields its events. The source is a `fetch` response body, any async iterable of bytes
 * or text, and stopping the iteration early cancels a web stream.
 *
 * ```ts
 * const response = await fetch(url, { headers: { accept: "text/event-stream" } })
 * for await (const event of parseEventStream(response.body!)) console.log(event.event, event.data)
 * ```
 */
export async function* parseEventStream(
  source: EventStreamSource,
  options: ParseEventStreamOptions = {},
): AsyncGenerator<ServerSentEvent, void, undefined> {
  const decoder = new TextDecoder()
  let ready: ServerSentEvent[] = []
  let known = options.lastEventId ?? ""
  const parser = new EventStreamParser(
    {
      onEvent: (event) => ready.push(event),
      ...(options.onRetry === undefined ? {} : { onRetry: options.onRetry }),
    },
    options,
  )
  for await (const chunk of chunksOf(source)) {
    options.onChunk?.()
    parser.feed(typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true }))
    if (parser.lastEventId !== known) {
      known = parser.lastEventId
      options.onLastEventId?.(known)
    }
    const events = ready
    ready = []
    yield* events
  }
}
