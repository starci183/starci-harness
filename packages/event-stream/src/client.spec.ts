import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it, mock } from "node:test"
import { createEventStream } from "./client.js"
import { EventStreamError } from "./errors.js"
import type { ErrorInfo, EventFrame, EventStreamHandle } from "./types.js"
import { advance, fakeFetch, open, settle, status, wire } from "./support.spec.js"
import type { Answer, Wire } from "./support.spec.js"

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout"] })
})
afterEach(() => {
  mock.timers.reset()
  mock.restoreAll()
})

/** Collects everything a followed stream reports. */
const recorder = () => {
  const frames: EventFrame<string>[] = []
  const named: [string, EventFrame<string>][] = []
  const errors: { error: EventStreamError; info: ErrorInfo }[] = []
  const closes: (EventStreamError | undefined)[] = []
  let opens = 0
  return {
    frames,
    named,
    errors,
    closes,
    get opens() {
      return opens
    },
    callbacks: {
      onOpen: () => {
        opens++
      },
      onFrame: (frame: EventFrame<string>) => frames.push(frame),
      onEvent: (name: string, frame: EventFrame<string>) => named.push([name, frame]),
      onError: (error: EventStreamError, info: ErrorInfo) => errors.push({ error, info }),
      onClose: (error?: EventStreamError) => closes.push(error),
    },
  }
}

const noJitter = { baseMs: 1000, maxMs: 15_000, jitter: false } as const

/** A stream that opens once and gives its wire to the test. */
const single = (text = "") => {
  const holder: { wire?: Wire } = {}
  const answer = open(text, (w) => {
    holder.wire = w
  })
  return { answer, holder }
}

const wireOf = (holder: { wire?: Wire }): Wire => {
  assert.ok(holder.wire, "the stream is not open")
  return holder.wire
}

describe("follow: opening and frames", () => {
  it("sends the bearer token, headers, query and resume id, and delivers parsed frames", async () => {
    const { answer, holder } = single('id: 1\ndata: {"n":1}\n\n')
    const { fetch, calls } = fakeFetch(answer)
    const events = createEventStream({ baseURL: "https://api.test/", headers: { "X-App": "web" }, getToken: async () => "tok", fetch })
    const rec = recorder()
    const handle = events.follow<{ n: number }>("/s", {
      query: { a: 1 },
      headers: { "X-Extra": "1" },
      lastEventId: "0",
      parse: (data) => JSON.parse(data) as { n: number },
      onOpen: rec.callbacks.onOpen,
      onFrame: (frame) => rec.frames.push({ ...frame, data: JSON.stringify(frame.data) }),
    })
    assert.equal(handle.state, "connecting")
    assert.equal(handle.lastEventId, "0")
    await settle()
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.url, "https://api.test/s?a=1")
    assert.deepEqual(calls[0]?.headers, {
      accept: "text/event-stream",
      "cache-control": "no-cache",
      "x-app": "web",
      authorization: "Bearer tok",
      "x-extra": "1",
      "last-event-id": "0",
    })
    assert.equal(calls[0]?.init.method, "GET")
    assert.equal(calls[0]?.init.cache, "no-store")
    assert.equal("credentials" in (calls[0]?.init ?? {}), false)
    assert.equal(handle.state, "open")
    assert.equal(rec.opens, 1)
    assert.deepEqual(rec.frames, [{ id: "1", event: "message", data: '{"n":1}' }])
    assert.equal(handle.lastEventId, "1")
    handle.close()
    wireOf(holder)
  })

  it("delivers the data text when there is no parse, and no id before the stream sets one", async () => {
    const { answer } = single("data: hi\n\n")
    const { fetch, calls } = fakeFetch(answer)
    const events = createEventStream({ fetch })
    const rec = recorder()
    const handle = events.follow("/s", rec.callbacks)
    await settle()
    assert.equal(calls[0]?.url, "/s")
    assert.equal(calls[0]?.headers.authorization, undefined)
    assert.equal(calls[0]?.headers["last-event-id"], undefined)
    assert.deepEqual(rec.frames, [{ id: undefined, event: "message", data: "hi" }])
    assert.equal(handle.lastEventId, undefined)
    handle.close()
  })

  it("ignores an empty resume id and sends no token when the source gives none", async () => {
    const { answer } = single()
    const { fetch, calls } = fakeFetch(answer)
    const events = createEventStream({ fetch, getToken: () => null })
    const handle = events.follow("/s", { lastEventId: "" })
    await settle()
    assert.equal(calls[0]?.headers.authorization, undefined)
    assert.equal(calls[0]?.headers["last-event-id"], undefined)
    assert.equal(handle.lastEventId, undefined)
    handle.close()
  })

  it("routes named events to onEvent and ignores them when nobody listens", async () => {
    const { answer } = single("event: tick\nid: 4\ndata: t\n\ndata: m\n\n")
    const { fetch } = fakeFetch(answer)
    const events = createEventStream({ fetch })
    const rec = recorder()
    const handle = events.follow("/s", rec.callbacks)
    const quiet = events.follow("/s", {})
    await settle()
    assert.deepEqual(rec.named, [["tick", { id: "4", event: "tick", data: "t" }]])
    assert.deepEqual(rec.frames, [{ id: "4", event: "message", data: "m" }])
    handle.close()
    quiet.close()
  })

  it("moves the resume id on an id-only event", async () => {
    const { answer } = single("id: 12\n\n")
    const { fetch } = fakeFetch(answer)
    const handle = createEventStream({ fetch }).follow("/s")
    await settle()
    assert.equal(handle.lastEventId, "12")
    handle.close()
  })

  it("forgets the resume id when the stream resets it", async () => {
    const { answer, holder } = single("id: 3\ndata: a\n\n")
    const { fetch } = fakeFetch(answer)
    const rec = recorder()
    const handle = createEventStream({ fetch }).follow("/s", rec.callbacks)
    await settle()
    assert.equal(handle.lastEventId, "3")
    wireOf(holder).push("id\ndata: b\n\n")
    await settle()
    assert.deepEqual(
      rec.frames.map((f) => f.id),
      ["3", undefined],
    )
    assert.equal(handle.lastEventId, undefined)
    handle.close()
  })

  it("passes the credentials mode and reads the live defaults on every connect", async () => {
    const { answer, holder } = single()
    const { fetch, calls } = fakeFetch(answer)
    const events = createEventStream({ fetch, credentials: "include", retry: noJitter })
    const handle = events.follow("/s")
    await settle()
    assert.equal(calls[0]?.init.credentials, "include")
    events.defaults.headers["x-late"] = "1"
    events.defaults.getToken = () => "late"
    wireOf(holder).end()
    await advance(1000)
    assert.equal(calls[1]?.headers["x-late"], "1")
    assert.equal(calls[1]?.headers.authorization, "Bearer late")
    handle.close()
  })

  it("uses the global fetch when none is injected", async () => {
    const { answer } = single("data: g\n\n")
    const { fetch } = fakeFetch(answer)
    mock.method(globalThis, "fetch", fetch)
    const rec = recorder()
    const handle = createEventStream().follow("/s", rec.callbacks)
    await settle()
    assert.equal(rec.frames.length, 1)
    handle.close()
  })

  it("starts with the documented defaults", () => {
    const events = createEventStream()
    assert.equal(events.defaults.heartbeatTimeoutMs, 45_000)
    assert.deepEqual(events.defaults.retry, { baseMs: 1000, maxMs: 15_000, jitter: true })
    const limited = createEventStream({ retry: { maxAttempts: 3 }, heartbeatTimeoutMs: 5 })
    assert.equal(limited.defaults.retry.maxAttempts, 3)
    assert.equal(limited.defaults.heartbeatTimeoutMs, 5)
  })
})

describe("follow: reconnecting", () => {
  it("reopens after a clean end with the last event id, and says so in onOpen", async () => {
    const holders: { wire?: Wire }[] = []
    const next = (text: string): Answer => {
      const { answer, holder } = single(text)
      holders.push(holder)
      return answer
    }
    const { fetch, calls } = fakeFetch(next("id: 5\ndata: a\n\n"), next("data: b\n\n"))
    const events = createEventStream({ fetch, retry: noJitter })
    const rec = recorder()
    const handle = events.follow("/s", rec.callbacks)
    await settle()
    wireOf(holders[0] ?? {}).end()
    await settle()
    assert.equal(handle.state, "reconnecting")
    await advance(999)
    assert.equal(calls.length, 1)
    await advance(1)
    assert.equal(calls.length, 2)
    assert.equal(calls[1]?.headers["last-event-id"], "5")
    assert.equal(rec.opens, 2)
    assert.deepEqual(
      rec.frames.map((f) => f.data),
      ["a", "b"],
    )
    assert.equal(rec.errors.length, 0)
    handle.close()
  })

  it("waits the retry the server named", async () => {
    const { answer, holder } = single("retry: 2500\n")
    const { fetch, calls } = fakeFetch(answer)
    const handle = createEventStream({ fetch, retry: noJitter }).follow("/s")
    await settle()
    wireOf(holder).end()
    await advance(2499)
    assert.equal(calls.length, 1)
    await advance(1)
    assert.equal(calls.length, 2)
    handle.close()
  })

  it("doubles the wait after each failure up to the cap, and starts over once a stream opens", async () => {
    const { answer, holder } = single()
    const { fetch, calls } = fakeFetch(status(503), status(503), status(500), status(503), answer)
    const events = createEventStream({ fetch, retry: { baseMs: 1000, maxMs: 3000, jitter: false } })
    const rec = recorder()
    const handle = events.follow("/s", rec.callbacks)
    await settle()
    const delays = () => rec.errors.map((e) => e.info.delayMs)
    assert.deepEqual(delays(), [1000])
    await advance(1000)
    assert.deepEqual(delays(), [1000, 2000])
    await advance(2000)
    await advance(3000)
    assert.deepEqual(delays(), [1000, 2000, 3000, 3000])
    assert.deepEqual(
      rec.errors.map((e) => e.info.attempt),
      [1, 2, 3, 4],
    )
    assert.equal(rec.errors[0]?.error.code, "ERR_BAD_RESPONSE")
    assert.equal(rec.errors[0]?.error.status, 503)
    assert.equal(rec.errors[0]?.error.retryable, true)
    assert.equal(rec.errors[0]?.info.terminal, false)
    await advance(3000)
    assert.equal(calls.length, 5)
    wireOf(holder).fail(new TypeError("terminated"))
    await settle()
    assert.equal(rec.errors.at(-1)?.error.code, "ERR_NETWORK")
    assert.equal(rec.errors.at(-1)?.info.attempt, 1)
    handle.close()
  })

  it("spreads the wait with jitter", async () => {
    mock.method(Math, "random", () => 0)
    const { answer } = single()
    const { fetch } = fakeFetch(status(503), answer)
    const rec = recorder()
    const handle = createEventStream({ fetch }).follow("/s", rec.callbacks)
    await settle()
    assert.equal(rec.errors[0]?.info.delayMs, 500)
    handle.close()
  })

  it("retries a 408 and a 429", async () => {
    const { answer } = single()
    const { fetch, calls } = fakeFetch(status(408), status(429), answer)
    const handle = createEventStream({ fetch, retry: noJitter }).follow("/s")
    await settle()
    await advance(1000)
    await advance(2000)
    assert.equal(calls.length, 3)
    assert.equal(handle.state, "open")
    handle.close()
  })

  it("gives up after maxAttempts consecutive failures and closes with the last error", async () => {
    const { fetch, calls } = fakeFetch(status(503))
    const events = createEventStream({ fetch, retry: { ...noJitter, maxAttempts: 2 } })
    const rec = recorder()
    const handle = events.follow("/s", rec.callbacks)
    await settle()
    await advance(1000)
    assert.equal(calls.length, 2)
    assert.equal(handle.state, "closed")
    assert.equal(rec.errors.length, 2)
    assert.equal(rec.errors[1]?.info.terminal, true)
    assert.equal(rec.errors[1]?.info.delayMs, undefined)
    assert.equal(rec.closes.length, 1)
    assert.equal(rec.closes[0]?.status, 503)
    await advance(60_000)
    assert.equal(calls.length, 2)
  })

  it("retries a response that has no body", async () => {
    const { answer } = single()
    const nobody: Answer = () => new Response(null, { status: 200, headers: { "content-type": "text/event-stream" } })
    const { fetch, calls } = fakeFetch(nobody, answer)
    const rec = recorder()
    const handle = createEventStream({ fetch, retry: noJitter }).follow("/s", rec.callbacks)
    await settle()
    assert.equal(rec.errors[0]?.error.code, "ERR_BAD_RESPONSE")
    await advance(1000)
    assert.equal(calls.length, 2)
    assert.equal(handle.state, "open")
    handle.close()
  })

  it("retries when the connection fails, with the request on the error and no credentials in it", async () => {
    const { answer } = single()
    const broken: Answer = () => {
      throw new TypeError("fetch failed")
    }
    const { fetch } = fakeFetch(broken, answer)
    const rec = recorder()
    const handle = createEventStream({ fetch, getToken: () => "secret", retry: noJitter }).follow("/s", rec.callbacks)
    await settle()
    const error = rec.errors[0]?.error
    assert.equal(error?.code, "ERR_NETWORK")
    assert.ok(error?.cause instanceof TypeError)
    assert.equal(error?.config?.headers.authorization, "[redacted]")
    assert.equal(error?.config?.path, "/s")
    handle.close()
  })

  it("retries when the token source or a request interceptor throws", async () => {
    const { answer } = single()
    const { fetch, calls } = fakeFetch(answer)
    let tokens = 0
    const events = createEventStream({
      fetch,
      retry: noJitter,
      getToken: () => {
        if (tokens++ === 0) throw new Error("offline")
        return "t"
      },
    })
    let intercepted = 0
    events.interceptors.request.use(() => {
      if (intercepted++ === 0) throw new Error("sign failed")
    })
    const rec = recorder()
    const handle = events.follow("/s", rec.callbacks)
    await settle()
    assert.equal(rec.errors[0]?.error.code, "ERR_REQUEST")
    assert.equal(rec.errors[0]?.error.config, undefined)
    await advance(1000)
    assert.equal(rec.errors[1]?.error.code, "ERR_REQUEST")
    await advance(2000)
    assert.equal(calls.length, 1)
    assert.equal(handle.state, "open")
    handle.close()
  })
})

describe("follow: heartbeat", () => {
  it("counts a comment line as liveness and reconnects once the stream is silent", async () => {
    const holders: { wire?: Wire }[] = []
    const next = (text: string): Answer => {
      const { answer, holder } = single(text)
      holders.push(holder)
      return answer
    }
    const { fetch, calls } = fakeFetch(next("id: 3\ndata: a\n\n"), next(""))
    const events = createEventStream({ fetch, heartbeatTimeoutMs: 1000, retry: noJitter })
    const rec = recorder()
    const handle = events.follow("/s", rec.callbacks)
    await advance(800)
    wireOf(holders[0] ?? {}).push(": heartbeat\n")
    await advance(800)
    assert.equal(handle.state, "open")
    await advance(300)
    assert.equal(handle.state, "reconnecting")
    assert.equal(rec.errors[0]?.error.code, "ECONNABORTED")
    assert.equal(rec.errors[0]?.info.terminal, false)
    assert.equal(calls[0]?.signal.aborted, true)
    await advance(1000)
    assert.equal(calls.length, 2)
    assert.equal(calls[1]?.headers["last-event-id"], "3")
    handle.close()
  })

  it("can be turned off", async () => {
    const { answer } = single()
    const { fetch } = fakeFetch(answer)
    const handle = createEventStream({ fetch, heartbeatTimeoutMs: 0 }).follow("/s")
    await advance(10 * 60_000)
    assert.equal(handle.state, "open")
    handle.close()
  })

  it("also covers a connection that never answers", async () => {
    const hang: Answer = (call) =>
      new Promise<Response>((_resolve, reject) => call.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))
    const { answer } = single()
    const { fetch } = fakeFetch(hang, answer)
    const rec = recorder()
    const handle = createEventStream({ fetch, heartbeatTimeoutMs: 1000, retry: noJitter }).follow("/s", rec.callbacks)
    await advance(1000)
    assert.equal(rec.errors[0]?.error.code, "ECONNABORTED")
    assert.equal(rec.errors[0]?.error.cause instanceof DOMException, true)
    handle.close()
  })
})

describe("follow: token renewal and refusals", () => {
  it("renews the token once on a 401 with refreshToken", async () => {
    const { answer } = single()
    const { fetch, calls } = fakeFetch(status(401), answer)
    const getToken = mock.fn(() => "old")
    const refreshToken = mock.fn(async () => "new")
    const handle = createEventStream({ fetch, getToken, refreshToken }).follow("/s")
    await settle()
    assert.deepEqual(
      calls.map((c) => c.headers.authorization),
      ["Bearer old", "Bearer new"],
    )
    assert.equal(getToken.mock.callCount(), 1)
    assert.equal(refreshToken.mock.callCount(), 1)
    assert.equal(handle.state, "open")
    handle.close()
  })

  it("calls getToken again when there is no refreshToken, also for a response without a body", async () => {
    const { answer } = single()
    const nobody: Answer = () => new Response(null, { status: 401 })
    const { fetch, calls } = fakeFetch(nobody, answer)
    let n = 0
    const handle = createEventStream({ fetch, getToken: () => `t${++n}` }).follow("/s")
    await settle()
    assert.deepEqual(
      calls.map((c) => c.headers.authorization),
      ["Bearer t1", "Bearer t2"],
    )
    handle.close()
  })

  it("ends the stream when the renewed request is refused again", async () => {
    const { fetch, calls } = fakeFetch(status(401))
    const rec = recorder()
    const handle = createEventStream({ fetch, getToken: () => "t", refreshToken: () => "r" }).follow("/s", rec.callbacks)
    await settle()
    assert.equal(calls.length, 2)
    assert.equal(handle.state, "closed")
    assert.equal(rec.errors[0]?.error.status, 401)
    assert.equal(rec.errors[0]?.error.code, "ERR_BAD_REQUEST")
    assert.equal(rec.errors[0]?.info.terminal, true)
    assert.equal(rec.closes[0], rec.errors[0]?.error)
  })

  it("does not renew when there is no token source", async () => {
    const { fetch, calls } = fakeFetch(status(401))
    const rec = recorder()
    createEventStream({ fetch }).follow("/s", rec.callbacks)
    await settle()
    assert.equal(calls.length, 1)
    assert.equal(rec.errors[0]?.error.config?.headers.authorization, undefined)
    assert.ok(rec.errors[0]?.error.response instanceof Response)
  })

  it("treats a 4xx other than 408 and 429 as final and never reconnects", async () => {
    const { fetch, calls } = fakeFetch(status(404))
    const rec = recorder()
    const handle = createEventStream({ fetch, retry: noJitter }).follow("/s", rec.callbacks)
    await settle()
    await advance(120_000)
    assert.equal(calls.length, 1)
    assert.equal(handle.state, "closed")
    assert.equal(rec.errors.length, 1)
    assert.equal(rec.errors[0]?.error.retryable, false)
    assert.equal(rec.closes.length, 1)
  })

  it("ends the stream on a response that is not an event stream, and accepts the type in any case", async () => {
    const html: Answer = () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } })
    const { fetch } = fakeFetch(html)
    const rec = recorder()
    createEventStream({ fetch }).follow("/s", rec.callbacks)
    await settle()
    assert.equal(rec.errors[0]?.error.code, "ERR_BAD_RESPONSE")
    assert.equal(rec.errors[0]?.info.terminal, true)

    const accepted: Answer = (call) => wire(call.signal, { "Content-Type": "Text/Event-Stream; charset=utf-8" }).response
    const loose: Answer = (call) => wire(call.signal, {}).response
    for (const answer of [accepted, loose]) {
      const ok = recorder()
      const handle = createEventStream({ fetch: fakeFetch(answer).fetch }).follow("/s", ok.callbacks)
      await settle()
      assert.equal(handle.state, "open")
      handle.close()
    }
  })
})

describe("follow: interceptors", () => {
  it("lets request interceptors change the url and headers before every connect", async () => {
    const { answer, holder } = single()
    const { fetch, calls } = fakeFetch(status(503), answer)
    const events = createEventStream({ fetch, retry: noJitter })
    const seen: [number, string | undefined][] = []
    events.interceptors.request.use((config) => {
      seen.push([config.attempt, config.lastEventId])
      config.headers["x-trace"] = "1"
      config.url += "&sig=1"
    })
    events.interceptors.request.use((config) => ({ ...config, headers: { ...config.headers, "x-second": "2" } }))
    const handle = events.follow("/s", { query: { a: 1 } })
    await settle()
    await advance(1000)
    assert.deepEqual(seen, [
      [0, undefined],
      [1, undefined],
    ])
    assert.equal(calls[1]?.url, "/s?a=1&sig=1")
    assert.equal(calls[1]?.headers["x-trace"], "1")
    assert.equal(calls[1]?.headers["x-second"], "2")
    wireOf(holder)
    handle.close()
  })

  it("transforms, drops and refuses frames with frame interceptors", async () => {
    const { answer } = single("data: keep\n\ndata: drop\n\ndata: bad\n\ndata: next\n\n")
    const { fetch } = fakeFetch(answer)
    const events = createEventStream({ fetch })
    events.interceptors.frame.use((frame) => (frame.data === "drop" ? null : frame))
    events.interceptors.frame.use((frame) => {
      if (frame.data === "bad") throw new Error("invalid")
      return { ...frame, data: frame.data.toUpperCase() }
    })
    const rec = recorder()
    const handle = events.follow("/s", rec.callbacks)
    await settle()
    assert.deepEqual(
      rec.frames.map((f) => f.data),
      ["KEEP", "NEXT"],
    )
    assert.equal(rec.errors.length, 1)
    assert.equal(rec.errors[0]?.error.code, "ERR_FRAME")
    assert.equal(rec.errors[0]?.info.terminal, false)
    assert.equal(rec.errors[0]?.info.delayMs, undefined)
    assert.equal(handle.state, "open")
    handle.close()
  })

  it("refuses a frame whose parse throws and hands parse the raw frame", async () => {
    const { answer } = single("id: 8\nevent: e\ndata: x\n\n")
    const { fetch } = fakeFetch(answer)
    const rec = recorder()
    let raw: unknown
    const handle = createEventStream({ fetch }).follow<number>("/s", {
      parse: (_data, frame) => {
        raw = frame
        throw new Error("not a number")
      },
      onError: rec.callbacks.onError,
    })
    await settle()
    assert.deepEqual(raw, { id: "8", event: "e", data: "x" })
    assert.equal(rec.errors[0]?.error.code, "ERR_FRAME")
    handle.close()
  })
})

describe("follow: callbacks that throw", () => {
  it("ends the stream with ERR_CALLBACK", async () => {
    const boom = (): void => {
      throw new Error("handler bug")
    }
    const cases = [
      { text: "", options: { onOpen: boom } },
      { text: "data: a\n\n", options: { onFrame: boom } },
      { text: "event: n\ndata: a\n\n", options: { onEvent: boom } },
    ]
    for (const { text, options } of cases) {
      const { answer } = single(text)
      const { fetch, calls } = fakeFetch(answer)
      const rec = recorder()
      const handle = createEventStream({ fetch }).follow("/s", { ...options, onError: rec.callbacks.onError, onClose: rec.callbacks.onClose })
      await settle()
      assert.equal(handle.state, "closed")
      assert.equal(rec.errors[0]?.error.code, "ERR_CALLBACK")
      assert.equal(rec.errors[0]?.info.terminal, true)
      assert.equal(rec.closes.length, 1)
      assert.equal(calls.length, 1)
    }
  })
})

describe("follow: closing", () => {
  it("closes once, aborts the request and stops reading", async () => {
    const { answer } = single("data: a\n\n")
    const { fetch, calls } = fakeFetch(answer)
    const rec = recorder()
    const handle = createEventStream({ fetch }).follow("/s", rec.callbacks)
    await settle()
    handle.close()
    handle.close()
    await settle()
    assert.equal(handle.state, "closed")
    assert.equal(calls[0]?.signal.aborted, true)
    assert.deepEqual(rec.closes, [undefined])
    assert.equal(rec.errors.length, 0)
  })

  it("stops delivering the frames of a chunk once a callback closed the stream", async () => {
    const { answer } = single("data: a\n\ndata: b\n\n")
    const { fetch } = fakeFetch(answer)
    const seen: string[] = []
    const holder: { handle?: EventStreamHandle } = {}
    holder.handle = createEventStream({ fetch }).follow("/s", {
      onFrame: (frame) => {
        seen.push(frame.data)
        holder.handle?.close()
      },
    })
    await settle()
    assert.deepEqual(seen, ["a"])
  })

  it("closes when the signal aborts, also while waiting to reconnect", async () => {
    const { answer, holder } = single()
    const { fetch, calls } = fakeFetch(answer)
    const controller = new AbortController()
    const rec = recorder()
    const handle = createEventStream({ fetch, retry: noJitter }).follow("/s", { ...rec.callbacks, signal: controller.signal })
    await settle()
    wireOf(holder).end()
    await settle()
    assert.equal(handle.state, "reconnecting")
    controller.abort()
    await settle()
    assert.equal(handle.state, "closed")
    assert.deepEqual(rec.closes, [undefined])
    await advance(60_000)
    assert.equal(calls.length, 1)
  })

  it("closes when the signal aborts mid-stream", async () => {
    const { answer } = single("data: a\n\n")
    const { fetch } = fakeFetch(answer)
    const controller = new AbortController()
    const rec = recorder()
    const handle = createEventStream({ fetch }).follow("/s", { ...rec.callbacks, signal: controller.signal })
    await settle()
    controller.abort()
    await settle()
    assert.equal(handle.state, "closed")
    assert.deepEqual(rec.closes, [undefined])
    assert.equal(rec.errors.length, 0)
  })

  it("never connects when the signal is already aborted", async () => {
    const { fetch, calls } = fakeFetch(status(200))
    const rec = recorder()
    const handle = createEventStream({ fetch }).follow("/s", { ...rec.callbacks, signal: AbortSignal.abort() })
    await settle()
    assert.equal(calls.length, 0)
    assert.equal(handle.state, "closed")
    assert.deepEqual(rec.closes, [undefined])
  })

  it("does not open a stream whose answer arrives after the close", async () => {
    const late: { resolve?: (response: Response) => void } = {}
    const slow: Answer = () => new Promise<Response>((resolve) => (late.resolve = resolve))
    const { fetch } = fakeFetch(slow)
    const rec = recorder()
    const handle = createEventStream({ fetch }).follow("/s", rec.callbacks)
    await settle()
    handle.close()
    late.resolve?.(wire(undefined).response)
    await settle()
    assert.equal(handle.state, "closed")
    assert.equal(rec.opens, 0)
    assert.equal(rec.errors.length, 0)
  })
})

describe("stream: the async iterator", () => {
  it("yields every frame, named events included, and breaking the loop closes the stream", async () => {
    const { answer } = single("data: 1\n\nevent: n\ndata: 2\n\ndata: 3\n\n")
    const { fetch, calls } = fakeFetch(answer)
    const events = createEventStream({ fetch })
    const seen: string[] = []
    for await (const frame of events.stream("/s", { parse: (data) => Number(data) * 2 })) {
      seen.push(`${frame.event}:${frame.data}`)
      if (seen.length === 3) break
    }
    assert.deepEqual(seen, ["message:2", "n:4", "message:6"])
    assert.equal(calls[0]?.signal.aborted, true)
  })

  it("connects only when the loop starts, and passes onOpen and onError through", async () => {
    const { answer } = single("data: a\n\n")
    const { fetch, calls } = fakeFetch(status(503), answer)
    const events = createEventStream({ fetch, retry: noJitter })
    const rec = recorder()
    const iterator = events.stream("/s", { onOpen: rec.callbacks.onOpen, onError: rec.callbacks.onError })
    await settle()
    assert.equal(calls.length, 0)
    const first = iterator.next()
    await settle()
    await advance(1000)
    assert.equal((await first).value?.data, "a")
    assert.equal(rec.opens, 1)
    assert.equal(rec.errors.length, 1)
    await iterator.return()
  })

  it("keeps the frames that arrived in one chunk until the loop reads them, then ends when aborted", async () => {
    const { answer, holder } = single()
    const { fetch } = fakeFetch(answer)
    const controller = new AbortController()
    const iterator = createEventStream({ fetch }).stream("/s", { signal: controller.signal })
    const first = iterator.next()
    await settle()
    wireOf(holder).push("data: a\n\ndata: b\n\n")
    assert.equal((await first).value?.data, "a")
    controller.abort()
    await settle()
    assert.equal((await iterator.next()).value?.data, "b")
    assert.equal((await iterator.next()).done, true)
  })

  it("throws the error that ended the stream", async () => {
    const { fetch } = fakeFetch(status(404))
    const iterator = createEventStream({ fetch }).stream("/missing")
    await assert.rejects(iterator.next(), (error: unknown) => error instanceof EventStreamError && error.status === 404)
  })
})
