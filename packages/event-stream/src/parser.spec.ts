import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { EventStreamParser, parseEventStream } from "./parser.js"
import type { ServerSentEvent } from "./parser.js"

const collect = (chunks: readonly string[], lastEventId?: string) => {
  const events: ServerSentEvent[] = []
  const retries: number[] = []
  const parser = new EventStreamParser(
    { onEvent: (event) => events.push(event), onRetry: (ms) => retries.push(ms) },
    lastEventId === undefined ? {} : { lastEventId },
  )
  for (const chunk of chunks) parser.feed(chunk)
  return { events, retries, parser }
}

describe("EventStreamParser", () => {
  it("dispatches a default message event on the blank line", () => {
    const { events } = collect(["data: hello\n\n"])
    assert.deepEqual(events, [{ event: "message", data: "hello", id: "" }])
  })

  it("joins data lines with a line feed and strips only one leading space", () => {
    const { events } = collect(["data:  a\ndata\ndata: c\n\n"])
    assert.deepEqual(events, [{ event: "message", data: " a\n\nc", id: "" }])
  })

  it("names an event and resets the name after the dispatch", () => {
    const { events } = collect(["event: tick\ndata: 1\n\ndata: 2\n\n"])
    assert.deepEqual(
      events.map((e) => e.event),
      ["tick", "message"],
    )
  })

  it("persists the id across events, and an empty id resets it", () => {
    const { events, parser } = collect(["id: 7\ndata: a\n\ndata: b\n\nid\ndata: c\n\n"])
    assert.deepEqual(
      events.map((e) => e.id),
      ["7", "7", ""],
    )
    assert.equal(parser.lastEventId, "")
  })

  it("ignores an id that holds a NUL character", () => {
    const { events } = collect(["id: 1\n\u0000ignored\nid: 2\u00003\ndata: a\n\n"])
    assert.equal(events[0]?.id, "1")
  })

  it("moves the last event id on an event without data, and dispatches nothing", () => {
    const { events, parser } = collect(["id: 9\nevent: x\n\n"])
    assert.deepEqual(events, [])
    assert.equal(parser.lastEventId, "9")
    parser.feed("data: after\n\n")
    assert.deepEqual(events, [{ event: "message", data: "after", id: "9" }])
  })

  it("does not move the last event id for an event the connection dropped", () => {
    const { parser } = collect(["id: 5\ndata: half"])
    assert.equal(parser.lastEventId, "")
  })

  it("starts from the id the request resumed with", () => {
    const { events } = collect(["data: a\n\n"], "41")
    assert.equal(events[0]?.id, "41")
  })

  it("reads retry only when it is all digits", () => {
    const { retries } = collect(["retry: 2500\nretry: 12x\nretry:\nretry: -3\n\n"])
    assert.deepEqual(retries, [2500])
  })

  it("tolerates a missing retry handler", () => {
    const events: ServerSentEvent[] = []
    new EventStreamParser({ onEvent: (e) => events.push(e) }).feed("retry: 1\n\n")
    assert.deepEqual(events, [])
  })

  it("ignores comments and unknown fields", () => {
    const { events } = collect([": heartbeat\nfoo: bar\ndata: a\n:\n\n"])
    assert.deepEqual(events, [{ event: "message", data: "a", id: "" }])
  })

  it("accepts LF, CRLF and CR line endings", () => {
    for (const eol of ["\n", "\r\n", "\r"]) {
      const { events } = collect([`data: a${eol}data: b${eol}${eol}`])
      assert.deepEqual(events, [{ event: "message", data: "a\nb", id: "" }], JSON.stringify(eol))
    }
  })

  it("reads a CRLF split between two chunks as one line ending", () => {
    const { events } = collect(["data: a\r", "\ndata: b\r\n", "\r", "\ndata: c\n\n"])
    assert.deepEqual(
      events.map((e) => e.data),
      ["a\nb", "c"],
    )
  })

  it("reads a CR followed by another line as a line ending of its own", () => {
    const { events } = collect(["data: a\r", "data: b\n\n"])
    assert.deepEqual(events, [{ event: "message", data: "a\nb", id: "" }])
  })

  it("keeps waiting for the line feed through an empty chunk", () => {
    const { events } = collect(["data: a\r", "", "\n\n"])
    assert.deepEqual(events, [{ event: "message", data: "a", id: "" }])
  })

  it("drops a leading byte order mark, once", () => {
    const { events } = collect(["\uFEFFdata: a\n\n", "\uFEFFdata: b\n\n"])
    assert.deepEqual(
      events.map((e) => e.data),
      ["a"],
    )
  })

  it("drops the byte order mark that follows an empty first chunk", () => {
    const { events } = collect(["", "\uFEFFdata: a\n\n"])
    assert.equal(events[0]?.data, "a")
  })

  it("reads a line that arrives in pieces", () => {
    const { events } = collect(["da", "ta: he", "llo\n", "\n"])
    assert.equal(events[0]?.data, "hello")
  })

  it("drops an event the stream ended in the middle of", () => {
    const { events } = collect(["data: a\n\ndata: b\n"])
    assert.equal(events.length, 1)
  })
})

const encoder = new TextEncoder()

const bodyOf = (chunks: readonly Uint8Array[], onCancel?: () => void, closeAtEnd = true): ReadableStream<Uint8Array> => {
  let index = 0
  return new ReadableStream<Uint8Array>({
    pull: (controller) => {
      const chunk = chunks[index++]
      if (chunk === undefined) {
        if (closeAtEnd) controller.close()
      }
      else controller.enqueue(chunk)
    },
    cancel: () => onCancel?.(),
  })
}

async function* texts(...chunks: string[]): AsyncGenerator<string> {
  yield* chunks
}

const drain = async (source: Parameters<typeof parseEventStream>[0], options?: Parameters<typeof parseEventStream>[1]) => {
  const out: ServerSentEvent[] = []
  for await (const event of parseEventStream(source, options)) out.push(event)
  return out
}

describe("parseEventStream", () => {
  it("decodes a multi-byte character split across two chunks", async () => {
    const bytes = encoder.encode("data: caf\u00e9\n\n")
    const split = bytes.indexOf(0xc3) + 1
    const events = await drain(bodyOf([bytes.slice(0, split), bytes.slice(split)]))
    assert.equal(events[0]?.data, "caf\u00e9")
  })

  it("reads an async iterable of text and bytes", async () => {
    async function* source() {
      yield "data: a\n\n"
      yield encoder.encode("data: b\n\n")
    }
    const events = await drain(source())
    assert.deepEqual(
      events.map((e) => e.data),
      ["a", "b"],
    )
  })

  it("reports retry, every chunk and each change of the last event id", async () => {
    const retries: number[] = []
    const ids: string[] = []
    let chunks = 0
    const events = await drain(texts("retry: 3000\nid: 1\ndata: a\n\n", ": hb\n", "id: 1\ndata: b\n\nid: 2\n\n"), {
      onRetry: (ms) => retries.push(ms),
      onChunk: () => chunks++,
      onLastEventId: (id) => ids.push(id),
      lastEventId: "0",
    })
    assert.equal(events.length, 2)
    assert.deepEqual(retries, [3000])
    assert.equal(chunks, 3)
    assert.deepEqual(ids, ["1", "2"])
  })

  it("cancels a web stream when the consumer stops early", async () => {
    let cancelled = false
    const body = bodyOf(
      [encoder.encode("data: a\n\ndata: b\n\n")],
      () => {
        cancelled = true
      },
      false,
    )
    for await (const event of parseEventStream(body)) {
      assert.equal(event.data, "a")
      break
    }
    assert.equal(cancelled, true)
  })

  it("lets the original error through when the stream failed and cannot be cancelled", async () => {
    const failing = new ReadableStream<Uint8Array>({
      start: (controller) => controller.error(new Error("boom")),
    })
    await assert.rejects(drain(failing), /boom/)
  })
})
