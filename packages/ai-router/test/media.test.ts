import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { createMedia, MediaError } from "../src/media.ts"
import type { FetchLike } from "../src/types.ts"

interface Call { readonly url: string; readonly init: RequestInit }

function fake(handler: (call: Call) => Response | Promise<Response>): { fetch: FetchLike; calls: Call[] } {
    const calls: Call[] = []
    return { calls, fetch: async (url, init) => { const call = { url, init }; calls.push(call); return handler(call) } }
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const b64 = (text: string): string => Buffer.from(text).toString("base64")
const all = { OPENAI_API_KEY: "sk-o", GEMINI_API_KEY: "g-key", ELEVENLABS_API_KEY: "xi-key", ELEVENLABS_VOICE_ID: "voice1" }
const bodyOf = (call: Call): Record<string, unknown> => JSON.parse(call.init.body as string) as Record<string, unknown>
const headers = (call: Call | undefined): Record<string, string> => (call?.init.headers ?? {}) as Record<string, string>
function callAt(calls: readonly Call[], index: number): Call {
    const call = calls[index]
    if (call === undefined) throw new Error(`no call ${String(index)}`)
    return call
}
const settle = (): Promise<void> => new Promise((resolve) => { setImmediate(resolve) })

async function failure(promise: Promise<unknown>): Promise<MediaError> {
    try {
        await promise
    } catch (error) {
        assert.ok(error instanceof MediaError)
        return error
    }
    throw new Error("expected a MediaError")
}

describe("the media catalogue", () => {
    test("without a key no capability is offered and nothing throws", async () => {
        const media = createMedia({ env: {}, fetch: fake(() => json({})).fetch })
        assert.deepEqual(media.availableMediaModels(), [])
        assert.equal(media.auto("image"), undefined)
        assert.equal((await failure(media.generateImage({ prompt: "x" }))).failureClass, "unavailable")
        assert.equal((await failure(media.startVideo({ prompt: "x" }))).failureClass, "unavailable")
    })

    test("each key opens only its provider's models, and auto picks the first per kind", () => {
        const openai = createMedia({ env: { OPENAI_API_KEY: "k" } })
        assert.deepEqual([...new Set(openai.availableMediaModels().map((m) => `${m.kind}:${m.provider}`))], ["image:openai", "speech:openai"])
        assert.equal(openai.auto("video"), undefined)
        const every = createMedia({ env: all })
        assert.equal(every.auto("image")?.id, "gpt-image-2.5-flare")
        assert.equal(every.auto("speech")?.provider, "openai")
        assert.equal(every.auto("video")?.id, "gemini-omni-1.2-flash")
        assert.equal(createMedia({ env: { GEMINI_API_KEY: "k" } }).auto("image")?.provider, "google")
    })
})

describe("images", () => {
    test("OpenAI generations: request shape, base64 decoded, usage", async () => {
        const f = fake(() => json({ data: [{ b64_json: b64("a") }, { b64_json: b64("b") }], usage: { input_tokens: 5, output_tokens: 7 } }))
        const media = createMedia({ env: all, fetch: f.fetch })
        const result = await media.generateImage({ prompt: "cat", size: "1024x1024", n: 2 })
        assert.equal(f.calls[0]?.url, "https://api.openai.com/v1/images/generations")
        assert.deepEqual(bodyOf(f.calls[0]), { model: "gpt-image-2.5-flare", prompt: "cat", n: 2, size: "1024x1024" })
        assert.equal(headers(f.calls[0]).authorization, "Bearer sk-o")
        assert.equal(result.images.length, 2)
        assert.equal(Buffer.from(result.images[1]?.bytes ?? []).toString(), "b")
        assert.equal(result.images[0]?.mime, "image/png")
        assert.deepEqual(result.usage, { units: 2, inputTokens: 5, outputTokens: 7 })
        assert.equal(result.model, "gpt-image-2.5-flare")
    })

    test("reference images go to OpenAI edits as multipart image[]", async () => {
        const f = fake(() => json({ data: [{ b64_json: b64("e") }] }))
        const media = createMedia({ env: { OPENAI_API_KEY: "k" }, fetch: f.fetch })
        await media.generateImage({ prompt: "edit", referenceImages: [{ bytes: new Uint8Array([1, 2]), mime: "image/png" }, { bytes: new Uint8Array([3]), mime: "image/jpeg" }] })
        assert.equal(f.calls[0]?.url, "https://api.openai.com/v1/images/edits")
        const form = callAt(f.calls, 0).init.body as FormData
        assert.equal(form.getAll("image[]").length, 2)
        assert.equal(form.get("prompt"), "edit")
    })

    test("Google interactions: parts, aspect ratio, key header, model_output blocks", async () => {
        const f = fake(() => json({ steps: [{ type: "user_input" }, { type: "model_output", content: [{ type: "text", text: "here" }, { type: "image", data: b64("png"), mime_type: "image/jpeg" }] }] }))
        const media = createMedia({ env: { GEMINI_API_KEY: "g" }, fetch: f.fetch })
        const result = await media.generateImage({ prompt: "dog", size: "1536x1024", referenceImages: [{ bytes: new Uint8Array([9]), mime: "image/png" }] })
        assert.equal(f.calls[0]?.url, "https://generativelanguage.googleapis.com/v1beta/interactions")
        assert.equal(headers(f.calls[0])["x-goog-api-key"], "g")
        const body = bodyOf(f.calls[0])
        assert.equal(body.model, "gemini-nano-banana-2.1")
        assert.deepEqual(body.response_format, { type: "image", aspect_ratio: "3:2" })
        assert.deepEqual(body.input, [{ type: "text", text: "dog" }, { type: "image", data: Buffer.from([9]).toString("base64"), mime_type: "image/png" }])
        assert.equal(result.images[0]?.mime, "image/jpeg")
        assert.deepEqual(result.usage, { units: 1 })
    })

    test("Google answering text only is a refusal, not a transient failure", async () => {
        const media = createMedia({ env: { GEMINI_API_KEY: "g" }, fetch: fake(() => json({ steps: [{ type: "model_output", content: [{ type: "text", text: "I cannot draw that" }] }] })).fetch })
        const error = await failure(media.generateImage({ prompt: "x" }))
        assert.equal(error.failureClass, "refused")
        assert.match(error.message, /cannot draw/)
    })

    test("a 429 fails over to the next model and provider; a content-policy 400 stops at once", async () => {
        const f = fake((call) => call.url.includes("openai") ? json({ error: { message: "slow down", type: "rate_limit_error" } }, 429) : json({ steps: [{ type: "model_output", content: [{ type: "image", data: b64("g"), mime_type: "image/png" }] }] }))
        const result = await createMedia({ env: all, fetch: f.fetch }).generateImage({ prompt: "x" })
        assert.equal(result.provider, "google")
        assert.equal(f.calls.length, 3, "two OpenAI models were tried before Google")
        const refused = fake(() => json({ error: { code: "moderation_blocked", message: "Your request was rejected by the safety system." } }, 400))
        const error = await failure(createMedia({ env: all, fetch: refused.fetch }).generateImage({ prompt: "x" }))
        assert.equal(error.failureClass, "refused")
        assert.equal(error.retryable, false)
        assert.equal(refused.calls.length, 1)
    })

    test("a 503 is transient and retryable, a 401 is auth, a 400 is the caller's", async () => {
        const run = (status: number, body: unknown = {}): Promise<MediaError> => failure(createMedia({ env: { OPENAI_API_KEY: "k" }, fetch: fake(() => json(body, status)).fetch }).generateImage({ prompt: "x", model: "gpt-image-2.5-flare" }))
        const down = await run(503)
        assert.equal(down.failureClass, "transient")
        assert.equal(down.retryable, true)
        assert.equal(down.code, "AI_ROUTER_MEDIA_TRANSIENT")
        assert.equal((await run(401)).failureClass, "auth")
        assert.equal((await run(400, { error: { message: "bad size" } })).failureClass, "invalid_request")
    })

    test("a second key is tried after an auth failure and the secret never reaches the error", async () => {
        let seen = 0
        const f = fake(() => (seen++ === 0 ? json({ error: { message: "bad key sk-one" } }, 401) : json({ data: [{ b64_json: b64("z") }] })))
        const media = createMedia({ env: { OPENAI_API_KEY: "sk-one", OPENAI_API_KEY_2: "sk-two" }, fetch: f.fetch })
        await media.generateImage({ prompt: "x" })
        assert.equal(headers(f.calls[1]).authorization, "Bearer sk-two")
        const bad = await failure(createMedia({ env: { OPENAI_API_KEY: "sk-one" }, fetch: fake(() => json({ error: { message: "bad key sk-one" } }, 401)).fetch }).generateImage({ prompt: "x", model: "gpt-image-2.5-flare" }))
        assert.ok(!bad.message.includes("sk-one"))
    })

    test("a network failure is transient and invalid arguments fail before any call", async () => {
        const f = fake(() => { throw new Error("socket hang up") })
        const media = createMedia({ env: { OPENAI_API_KEY: "k" }, fetch: f.fetch })
        assert.equal((await failure(media.generateImage({ prompt: "x", model: "gpt-image-2.5-flare" }))).failureClass, "transient")
        const none = fake(() => json({}))
        const again = createMedia({ env: { OPENAI_API_KEY: "k" }, fetch: none.fetch })
        assert.equal((await failure(again.generateImage({ prompt: " " }))).failureClass, "invalid_request")
        assert.equal((await failure(again.generateImage({ prompt: "x", n: 11 }))).failureClass, "invalid_request")
        assert.equal((await failure(again.generateImage({ prompt: "x", model: "nope" }))).failureClass, "invalid_request")
        assert.equal(none.calls.length, 0)
    })
})

describe("speech", () => {
    test("OpenAI speech returns the audio bytes, mime and characters", async () => {
        const f = fake(() => new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
        const media = createMedia({ env: { OPENAI_API_KEY: "k" }, fetch: f.fetch })
        const result = await media.synthesizeSpeech({ text: "hello", voice: "cedar", format: "wav" })
        assert.deepEqual(bodyOf(callAt(f.calls, 0)), { model: "gpt-4o-mini-tts", input: "hello", voice: "cedar", response_format: "wav" })
        assert.equal(f.calls[0]?.url, "https://api.openai.com/v1/audio/speech")
        assert.deepEqual([...result.bytes], [1, 2, 3])
        assert.deepEqual(result.usage, { characters: 5 })
        assert.equal(result.provider, "openai")
    })

    test("ElevenLabs: voice in the path, xi-api-key, output_format; its 422 is the caller's", async () => {
        const f = fake(() => new Response(new Uint8Array([7]), { status: 200, headers: { "content-type": "audio/mpeg" } }))
        const media = createMedia({ env: { ELEVENLABS_API_KEY: "xi", ELEVENLABS_VOICE_ID: "v9" }, fetch: f.fetch })
        const result = await media.synthesizeSpeech({ text: "hi", format: "mp3_22050_32" })
        assert.equal(f.calls[0]?.url, "https://api.elevenlabs.io/v1/text-to-speech/v9?output_format=mp3_22050_32")
        assert.equal(headers(f.calls[0])["xi-api-key"], "xi")
        assert.deepEqual(bodyOf(f.calls[0]), { text: "hi", model_id: "eleven_multilingual_v2" })
        assert.equal(result.mime, "audio/mpeg")
        const bad = createMedia({ env: { ELEVENLABS_API_KEY: "xi", ELEVENLABS_VOICE_ID: "v9" }, fetch: fake(() => json({ detail: [{ loc: ["body"], msg: "field required", type: "missing" }] }, 422)).fetch })
        assert.equal((await failure(bad.synthesizeSpeech({ text: "hi" }))).failureClass, "invalid_request")
    })

    test("a provider that cannot serve the voice or format is skipped, and with none left the call is invalid", async () => {
        const f = fake(() => new Response(new Uint8Array([1]), { status: 200 }))
        const media = createMedia({ env: { OPENAI_API_KEY: "k", ELEVENLABS_API_KEY: "xi" }, fetch: f.fetch })
        assert.equal((await media.synthesizeSpeech({ text: "x" })).provider, "openai")
        assert.equal((await media.synthesizeSpeech({ text: "x", format: "mp3_44100_128", voice: "v" })).provider, "elevenlabs")
        const only = createMedia({ env: { ELEVENLABS_API_KEY: "xi" }, fetch: f.fetch })
        assert.equal((await failure(only.synthesizeSpeech({ text: "x" }))).failureClass, "invalid_request")
        assert.equal((await failure(media.synthesizeSpeech({ text: "" }))).failureClass, "invalid_request")
    })
})

describe("video jobs", () => {
    test("startVideo returns at once; getVideo is running, then done with the mp4", async () => {
        let release: (response: Response) => void = () => undefined
        const f = fake(() => new Promise<Response>((resolve) => { release = resolve }))
        const media = createMedia({ env: { GEMINI_API_KEY: "g" }, fetch: f.fetch })
        const job = await media.startVideo({ prompt: "waves", seconds: 5, size: "1080x1920" })
        assert.equal(job.provider, "google")
        assert.deepEqual(await media.getVideo(job.jobId), { status: "running" })
        assert.deepEqual(bodyOf(callAt(f.calls, 0)), { model: "gemini-omni-1.2-flash", input: "waves", response_format: { type: "video", aspect_ratio: "9:16", duration: "5s" } })
        release(json({ steps: [{ type: "model_output", content: [{ type: "video", data: b64("mp4"), mime_type: "video/mp4" }] }] }))
        await settle()
        const done = await media.getVideo(job.jobId)
        assert.equal(done.status, "done")
        assert.equal(Buffer.from(done.bytes).toString(), "mp4")
        assert.equal(done.mime, "video/mp4")
    })

    test("a refused or empty generation is status failed with its class; an unknown job is not_found", async () => {
        const media = createMedia({ env: { GEMINI_API_KEY: "g" }, fetch: fake(() => json({ error: { status: "INVALID_ARGUMENT", message: "Prompt blocked by safety policy" } }, 400)).fetch })
        const job = await media.startVideo({ prompt: "x" })
        await settle()
        const state = await media.getVideo(job.jobId)
        assert.equal(state.status, "failed")
        assert.equal(state.failureClass, "refused")
        const empty = createMedia({ env: { GEMINI_API_KEY: "g" }, fetch: fake(() => json({ steps: [] })).fetch })
        const second = await empty.startVideo({ prompt: "x" })
        await settle()
        assert.equal((await empty.getVideo(second.jobId)).status, "failed")
        assert.equal((await failure(media.getVideo("nope"))).failureClass, "not_found")
        assert.equal((await failure(media.startVideo({ prompt: "x", seconds: 30 }))).failureClass, "invalid_request")
    })

    test("a network failure marks the job failed as transient and an old finished job expires", async () => {
        let clock = 0
        const media = createMedia({ env: { GEMINI_API_KEY: "g" }, now: () => clock, fetch: fake(() => { throw new Error("reset") }).fetch })
        const job = await media.startVideo({ prompt: "x" })
        await settle()
        const state = await media.getVideo(job.jobId)
        assert.equal(state.status === "failed" ? state.failureClass : "", "transient")
        clock = 4_000_000
        await media.startVideo({ prompt: "y" })
        assert.equal((await failure(media.getVideo(job.jobId))).failureClass, "not_found")
    })
})
