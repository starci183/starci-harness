import { mock } from "node:test"

/** Lets every pending promise reaction (and the I/O of the fake streams) run; `setImmediate` is not faked. */
export const settle = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await new Promise<void>((resolve) => setImmediate(resolve))
}

/** Moves the faked clock and lets the reactions run. */
export const advance = async (ms: number): Promise<void> => {
  await settle()
  mock.timers.tick(ms)
  await settle()
}

const encoder = new TextEncoder()

/** One open response whose body the test writes by hand. */
export interface Wire {
  readonly response: Response
  push(text: string): void
  end(): void
  fail(cause: unknown): void
}

/** A `200 text/event-stream` response; its body errors when the request's signal aborts, as a real one does. */
export const wire = (signal: AbortSignal | null | undefined, headers: Record<string, string> = { "content-type": "text/event-stream" }): Wire => {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start: (c) => {
      controller = c
    },
  })
  signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")), { once: true })
  return {
    response: new Response(body, { status: 200, headers }),
    push: (text) => controller.enqueue(encoder.encode(text)),
    end: () => controller.close(),
    fail: (cause) => controller.error(cause),
  }
}

/** One recorded request of the fake fetch. */
export interface Call {
  readonly url: string
  readonly headers: Record<string, string>
  readonly signal: AbortSignal
  readonly init: RequestInit
}

/** What answers one request: a response, or a rejection. */
export type Answer = (call: Call, index: number) => Response | Promise<Response>

/** A `fetch` that records its requests and answers them with `answers`; the last answer repeats. */
export const fakeFetch = (...answers: Answer[]): { fetch: typeof fetch; calls: Call[] } => {
  const calls: Call[] = []
  const fetchImpl = (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const call: Call = {
      url: String(input),
      headers: init.headers as Record<string, string>,
      signal: init.signal as AbortSignal,
      init,
    }
    calls.push(call)
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)]
    if (answer === undefined) throw new Error("no answer prepared")
    return Promise.resolve().then(() => answer(call, calls.length - 1))
  }
  return { fetch: fetchImpl as typeof fetch, calls }
}

/** An answer that opens a stream, hands its wire to the test and writes `text` to it. */
export const open =
  (text = "", sink: (wire: Wire) => void = () => undefined): Answer =>
  (call) => {
    const w = wire(call.signal)
    if (text !== "") w.push(text)
    sink(w)
    return w.response
  }

/** An answer with a status and no stream. */
export const status =
  (code: number, init: ResponseInit = {}): Answer =>
  () =>
    new Response(code === 204 ? null : "no", { ...init, status: code })
