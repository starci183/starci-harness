import { format } from "winston"
import LokiTransport from "winston-loki"
import type { LokiOptions } from "./logging.options"

/** Defaults of the push: a batch every 5 s, a push abandoned after 5 s, at most 10000 lines waiting. */
const BATCH_SECONDS = 5
const TIMEOUT_MS = 5000
const MAX_BUFFERED = 10_000

/** winston-loki's own `log`, which the bounded transport calls once a line fits (its typing declares the method optional). */
const lokiLog = LokiTransport.prototype.log

/** The URL without the slashes it ends with: winston-loki appends `/loki/api/v1/push` to it. */
const withoutTrailingSlash = (url: string): string => {
    let end = url.length
    while (end > 0 && url[end - 1] === "/") end -= 1
    return url.slice(0, end)
}

/** What the transport tells its owner when Loki cannot be reached: the cause, never a line. */
export type LokiFailure = (cause: unknown) => void

/** The number of lines winston-loki holds in its batch, read without trusting the shape of its internals. */
const bufferedLines = (transport: object): number => {
    const batcher: unknown = Reflect.get(transport, "batcher")
    if (typeof batcher !== "object" || batcher === null) return 0
    const batch: unknown = Reflect.get(batcher, "batch")
    if (typeof batch !== "object" || batch === null) return 0
    const streams: unknown = Reflect.get(batch, "streams")
    if (!Array.isArray(streams)) return 0
    return streams.reduce<number>((sum, stream: unknown) => {
        const entries: unknown =
            typeof stream === "object" && stream !== null ? Reflect.get(stream, "entries") : undefined
        return sum + (Array.isArray(entries) ? entries.length : 0)
    }, 0)
}

/**
 * The winston-loki transport made safe to run in a server: it batches, abandons a push after the timeout, drops a failed batch
 * instead of re-queueing it (`clearOnError`; winston-loki then waits 60 s before the next push), holds at most `maxBuffered`
 * lines and drops the newest past that, never hooks the process exit (the logging module flushes it on shutdown), and reports a
 * failed push to `onFailure` instead of throwing. The console transports keep every line whatever happens here.
 */
export class BoundedLokiTransport extends LokiTransport {
    private readonly maxBuffered: number
    private droppedLines = 0

    constructor(options: LokiOptions, onFailure: LokiFailure) {
        super({
            host: withoutTrailingSlash(options.url),
            // `stack` is the app under the name the collector's lines carry, so one Grafana or bot query reads pushed and collected lines alike
            labels: { stack: options.labels.app, ...options.labels },
            // a format of its own makes winston-loki push the finished line (MESSAGE) the console wrote, unchanged
            format: format((info) => info)(),
            json: true,
            batching: true,
            interval: options.batchSeconds ?? BATCH_SECONDS,
            timeout: options.timeoutMs ?? TIMEOUT_MS,
            clearOnError: true,
            replaceTimestamp: false,
            gracefulShutdown: false,
            onConnectionError: onFailure,
            ...(options.basicAuth === undefined ? {} : { basicAuth: options.basicAuth.reveal() }),
            ...(options.tenant === undefined ? {} : { headers: { "X-Scope-OrgID": options.tenant } }),
        })
        this.maxBuffered = options.maxBuffered ?? MAX_BUFFERED
    }

    /** Lines dropped because the buffer was full since the transport started. */
    get dropped(): number {
        return this.droppedLines
    }

    /** Hands the line to winston-loki's batch, or drops it when the batch already holds `maxBuffered` lines. */
    override log(info: unknown, next: () => void): void {
        if (bufferedLines(this) >= this.maxBuffered) {
            this.droppedLines += 1
            next()
            return
        }
        if (lokiLog === undefined) next()
        else lokiLog.call(this, info, next)
    }
}
