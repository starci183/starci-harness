import type { OutboxEvent, Subscription, SubscriptionHandlers } from "./contracts.ts"
import { checkSubscription } from "./hub.ts"

/**
 * What `sse` needs of the request: its headers (`Last-Event-ID`). A Node `IncomingMessage` (Express's `req`, Fastify's `req.raw`) has this
 * shape. The stream ends on the response's `close`, never the request's: a request emits `close` once its body is read, not when its
 * client goes.
 */
export interface SseRequest {
    readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>
}

/** What `sse` needs of the response. A Node `ServerResponse` (Express's `res`, Fastify's `reply.raw`) has this shape. */
export interface SseResponse {
    writeHead(status: number, headers: Record<string, string>): unknown
    write(chunk: string): boolean
    end(): unknown
    /** Drops a client that cannot keep up at once; `end` is used when absent. */
    destroy?(): unknown
    flushHeaders?(): void
    /** The bytes written and not yet sent. */
    readonly writableLength?: number
    on(event: "close" | "drain", listener: () => void): unknown
    on(event: "error", listener: (error: Error) => void): unknown
}

/** The limits a stream runs under, every one resolved. */
export interface SseLimits {
    readonly heartbeatMs: number
    readonly maxBufferedBytes: number
    readonly drainTimeoutMs: number
    readonly retryMs: number
}

/** The headers of an event stream: never cached, never transformed or buffered by a proxy. */
export const SSE_HEADERS: Readonly<Record<string, string>> = {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
}

/**
 * One event as an SSE frame: `id` is its seq, the `Last-Event-ID` the client sends back to resume; the frame is the default `message`
 * event, the one `@starci/event-stream`'s `onFrame` and its `useSWRSubscription` adapter receive, and its data is one JSON line.
 */
export const sseFrame = (event: OutboxEvent): string =>
    `id: ${event.seq}\ndata: ${JSON.stringify({ seq: event.seq, scope: event.scope, topic: event.topic, type: event.type, data: event.data, createdAt: event.createdAt })}\n\n`

const header = (request: SseRequest, name: string): string | undefined => {
    const value = request.headers[name]
    return typeof value === "string" ? value : value?.[0]
}

/** The subscribe door `serveSse` streams from. */
export type Subscribe = (subscription: Subscription, handlers: SubscriptionHandlers) => Promise<() => void>

/**
 * Serves one event stream: the headers, `retry:`, the replay after `Last-Event-ID` (the header, or `subscription.lastEventId` when the
 * app read it elsewhere), then live events and a heartbeat comment. Nothing waits on a client: a write that would leave more than
 * `maxBufferedBytes` unsent, or a stream full for `drainTimeoutMs`, drops that client at once (it reconnects and replays what it missed),
 * so one slow client never holds the others. The subscription ends with the response (its client went) or the outbox. Answers once the
 * stream is joined, or ended when the join failed (the client reconnects).
 */
export const serveSse = async (
    subscribe: Subscribe,
    request: SseRequest,
    response: SseResponse,
    subscription: Subscription,
    limits: SseLimits,
    report: (event: string, cause: unknown) => void,
): Promise<void> => {
    checkSubscription(subscription)
    const lastEventId = subscription.lastEventId ?? header(request, "last-event-id")
    response.writeHead(200, { ...SSE_HEADERS })
    response.flushHeaders?.()
    const stream = { open: true }
    let unsubscribe: (() => void) | undefined
    let drainTimer: ReturnType<typeof setTimeout> | undefined
    const stopDrainTimer = (): void => {
        if (drainTimer !== undefined) clearTimeout(drainTimer)
        drainTimer = undefined
    }
    const finish = (drop: boolean): void => {
        if (!stream.open) return
        stream.open = false
        clearInterval(heartbeat)
        stopDrainTimer()
        unsubscribe?.()
        if (drop && response.destroy !== undefined) response.destroy()
        else response.end()
    }
    const send = (text: string): void => {
        if (!stream.open) return
        const flushed = response.write(text)
        if ((response.writableLength ?? 0) > limits.maxBufferedBytes) {
            finish(true)
            return
        }
        if (!flushed && drainTimer === undefined) {
            drainTimer = setTimeout(() => {
                finish(true)
            }, limits.drainTimeoutMs)
            drainTimer.unref()
        }
    }
    const heartbeat = setInterval(() => {
        send(": heartbeat\n\n")
    }, limits.heartbeatMs)
    heartbeat.unref()
    response.on("drain", stopDrainTimer)
    response.on("close", () => {
        finish(false)
    })
    response.on("error", () => {
        finish(true)
    })
    send(`retry: ${String(limits.retryMs)}\n: open\n\n`)
    try {
        const leave = await subscribe(
            { scope: subscription.scope, topics: subscription.topics, lastEventId },
            {
                onEvent: (event) => {
                    send(sseFrame(event))
                },
                onClose: () => {
                    finish(false)
                },
            },
        )
        if (stream.open) unsubscribe = leave
        else leave()
    } catch (cause) {
        report("events-stream", cause)
        finish(false)
    }
}
