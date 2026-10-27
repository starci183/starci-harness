import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it, mock } from "node:test"
import { createEventStream } from "./client.js"
import { subscribeEventStream } from "./swr.js"
import { fakeFetch, open, settle, status } from "./support.spec.js"
import type { EventFrame } from "./types.js"

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout"] })
})
afterEach(() => {
  mock.timers.reset()
})

const nextRecorder = () => {
  const calls: [Error | null | undefined, unknown][] = []
  return { calls, next: (error?: Error | null, data?: unknown) => calls.push([error, data]) }
}

describe("subscribeEventStream", () => {
  it("hands the data of each frame to next, and unsubscribing closes the stream", async () => {
    const { fetch, calls } = fakeFetch(open("data: 2\n\nevent: other\ndata: 3\n\n"))
    const events = createEventStream({ fetch })
    const rec = nextRecorder()
    let opened = 0
    const seen: EventFrame<number>[] = []
    const unsubscribe = subscribeEventStream<number>(events, "/s", {
      parse: (data) => Number(data),
      onOpen: () => {
        opened++
      },
      onFrame: (frame) => {
        seen.push(frame)
      },
    })("key", { next: rec.next })
    await settle()
    assert.deepEqual(rec.calls, [[null, 2]])
    assert.deepEqual(
      seen.map((f) => f.data),
      [2],
    )
    assert.equal(opened, 1)
    unsubscribe()
    assert.equal(calls[0]?.signal.aborted, true)
  })

  it("delivers the text without parse, selects what SWR gets, and reports a failed attempt as its error", async () => {
    const { fetch } = fakeFetch(status(503), open("data: x\n\n"))
    const events = createEventStream({ fetch, retry: { jitter: false } })
    const rec = nextRecorder()
    const unsubscribe = subscribeEventStream(events, "/s", { select: (frame) => `${frame.event}=${frame.data}` })("key", { next: rec.next })
    await settle()
    assert.equal(rec.calls.length, 1)
    assert.equal((rec.calls[0]?.[0] as Error).message, "the event stream was refused with status 503")
    mock.timers.tick(1000)
    await settle()
    assert.deepEqual(rec.calls[1], [null, "message=x"])
    unsubscribe()
  })

  it("works without options", async () => {
    const { fetch } = fakeFetch(open("data: y\n\n"))
    const rec = nextRecorder()
    const unsubscribe = subscribeEventStream(createEventStream({ fetch }), "/s")("key", { next: rec.next })
    await settle()
    assert.deepEqual(rec.calls, [[null, "y"]])
    unsubscribe()
  })
})
