/** One server-sent event: its `event` name (`message` when absent) and its joined `data` lines. */
export interface SseEvent {
    readonly event: string
    readonly data: string
}

/**
 * Parses a server-sent-event byte stream. It reads the body only when the consumer asks for the next event, so a slow
 * consumer holds the socket back (backpressure) and a consumer that stops cancels the body.
 */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent, void, undefined> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let event = ""
    let data: string[] = []
    let done = false
    try {
        while (!done) {
            const chunk = await reader.read()
            done = chunk.done
            buffer += done ? decoder.decode() : decoder.decode(chunk.value, { stream: true })
            // A trailing carriage return may be the first half of a CRLF split across chunks; keep it until more arrives.
            const lines = buffer.split(/\r\n|\r(?!$)|\n/)
            buffer = done ? "" : (lines.pop() ?? "")
            for (const raw of lines) {
                const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw
                if (line === "") {
                    if (data.length > 0) yield { event: event === "" ? "message" : event, data: data.join("\n") }
                    event = ""
                    data = []
                    continue
                }
                if (line.startsWith(":")) continue
                const colon = line.indexOf(":")
                const field = colon === -1 ? line : line.slice(0, colon)
                const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "")
                if (field === "data") data.push(value)
                else if (field === "event") event = value
            }
        }
        if (data.length > 0) yield { event: event === "" ? "message" : event, data: data.join("\n") }
    } finally {
        if (!done) await reader.cancel().catch(() => undefined)
        reader.releaseLock()
    }
}
