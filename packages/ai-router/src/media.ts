import { DomainError, isPlainRecord } from "@starci/common"
import { keysFromEnv } from "./env.ts"
import type { EnvSource } from "./env.ts"
import { scrub } from "./errors.ts"
import type { FetchLike, ResolverKeyConfig } from "./types.ts"

/**
 * Media generation beside chat: images, speech and video, key-gated like the chat providers. A provider whose key is not in
 * env is absent from `availableMediaModels()` and nothing fails at boot. Sources, read 2026-11-17 (a fact a page does not
 * state is left out, never guessed):
 *
 * - OpenAI images, https://developers.openai.com/api/reference/resources/images/methods/generate (`POST /v1/images/generations`:
 *   `model`, `prompt`, `n` 1 to 10, `size`; GPT image models always answer `data[].b64_json` and `usage`) and
 *   https://developers.openai.com/api/docs/guides/image-generation (`gpt-image-2.5-flare`, `gpt-image-2.5-sunburst`; reference
 *   images go to `POST /v1/images/edits` as multipart `image[]`).
 * - OpenAI speech, https://developers.openai.com/api/docs/guides/text-to-speech (`POST /v1/audio/speech`: `gpt-4o-mini-tts`,
 *   `input`, `voice`, `response_format` mp3|opus|aac|flac|wav|pcm, binary answer; the page says the model shuts down on
 *   2027-01-06). The page gives no usage, so usage is the characters sent.
 * - Google images, https://aistudio.google.com/docs/image-generation (`POST /v1beta/interactions`, header `x-goog-api-key`:
 *   `model`, `input` as text and `{type:"image", data, mime_type}` parts, `response_format {type:"image", aspect_ratio}`;
 *   the answer's `steps[]` of type `model_output` hold `content[]` blocks of type `image` with base64 `data`). The page shows
 *   no usage fields and no blocked-result shape: usage is the images returned, and an answer with no image is a refusal.
 * - Google video, https://aistudio.google.com/docs/omni (`gemini-omni-1.2-flash`, same endpoint, `response_format {type:"video",
 *   aspect_ratio, duration:"<n>s"}` 3s to 15s; the answer's `model_output` step holds a `video/mp4` block with base64 `data`).
 *   The page documents this call as synchronous, with no background mode or polling, so the job lives in this process.
 * - ElevenLabs, https://elevenlabs.io/docs/api-reference/text-to-speech/convert (`POST /v1/text-to-speech/{voice_id}`, header
 *   `xi-api-key`, body `text` and `model_id`, query `output_format` default `mp3_44100_128`, binary answer, 422 validation).
 *
 * Left out: OpenAI video (the Sora models and the Videos API are shut down, per https://developers.openai.com/api/docs/guides/video-generation),
 * Google Veo (its preview models are shut down, per https://aistudio.google.com/docs/video) and fal (https://fal.ai/docs/documentation/model-apis/inference/queue
 * documents the queue only; no video model id, input or output is stated there).
 */
export type MediaKind = "image" | "speech" | "video"

/** Why a media call failed: `refused` the content policy, `transient` a 429, 5xx, timeout or network failure, `auth` a refused key, `invalid_request` the caller's request, `not_found` an unknown job, `unavailable` no provider with a key serves the kind. */
export type MediaFailureClass = "refused" | "transient" | "auth" | "invalid_request" | "not_found" | "unavailable"

const MEDIA_CODES = {
    refused: "AI_ROUTER_MEDIA_REFUSED",
    transient: "AI_ROUTER_MEDIA_TRANSIENT",
    auth: "AI_ROUTER_MEDIA_AUTH",
    invalid_request: "AI_ROUTER_MEDIA_INVALID_REQUEST",
    not_found: "AI_ROUTER_MEDIA_NOT_FOUND",
    unavailable: "AI_ROUTER_MEDIA_UNAVAILABLE",
} as const satisfies Record<MediaFailureClass, string>

/** The stable code of a media error class. */
export const AI_ROUTER_MEDIA_ERROR_CODES: Readonly<Record<MediaFailureClass, (typeof MEDIA_CODES)[MediaFailureClass]>> = MEDIA_CODES

/** A code of `MediaError`. */
export type MediaErrorCode = (typeof MEDIA_CODES)[MediaFailureClass]

/** The one error a media call throws; `failureClass` says why, `retryable` whether the same call may succeed later. */
export class MediaError extends DomainError<MediaErrorCode> {
    readonly failureClass: MediaFailureClass
    readonly retryable: boolean
    readonly status: number | undefined
    readonly provider: string | undefined
    readonly model: string | undefined

    constructor(init: { readonly failureClass: MediaFailureClass; readonly message: string; readonly status?: number; readonly provider?: string; readonly model?: string }) {
        super({ code: MEDIA_CODES[init.failureClass] })
        this.message = init.message
        this.name = "MediaError"
        this.failureClass = init.failureClass
        this.retryable = init.failureClass === "transient"
        this.status = init.status
        this.provider = init.provider
        this.model = init.model
    }
}

/** Raw media: bytes and their MIME type. */
export interface MediaBlob {
    readonly bytes: Uint8Array
    readonly mime: string
}

export interface ImageRequest {
    readonly prompt: string
    /** `<width>x<height>` (`1024x1024`), or for Google an aspect ratio (`16:9`); Google reads only the shape of a `<width>x<height>`. */
    readonly size?: string
    /** How many images, 1 to 10 (default 1). */
    readonly n?: number
    /** Images the result is built from (OpenAI edits, Google input parts). */
    readonly referenceImages?: readonly MediaBlob[]
    /** A model of `availableMediaModels()`; absent or `auto`: the first available, with failover. */
    readonly model?: string
    /** Keeps the call on one provider id. */
    readonly provider?: string
}

export interface ImageResult {
    readonly images: readonly MediaBlob[]
    readonly model: string
    readonly provider: string
    /** `units` is the number of images returned; OpenAI also reports its token counts. */
    readonly usage: { readonly units: number; readonly inputTokens?: number; readonly outputTokens?: number }
}

export interface SpeechRequest {
    readonly text: string
    /** OpenAI: a voice name (default `marin`). ElevenLabs: a voice id (default `ELEVENLABS_VOICE_ID`). */
    readonly voice?: string
    /** `mp3` (default), or OpenAI `opus|aac|flac|wav|pcm`, or an ElevenLabs `output_format` such as `mp3_44100_128`. */
    readonly format?: string
    readonly model?: string
    readonly provider?: string
}

export interface SpeechResult extends MediaBlob {
    readonly model: string
    readonly provider: string
    /** The characters sent: neither provider's page documents a duration. */
    readonly usage: { readonly characters: number }
}

export interface VideoRequest {
    readonly prompt: string
    /** 3 to 15. */
    readonly seconds?: number
    /** `16:9`, `9:16` or `<width>x<height>`: only the orientation is sent. */
    readonly size?: string
    readonly model?: string
    readonly provider?: string
}

export interface VideoJob {
    readonly jobId: string
    readonly provider: string
}

export type VideoStatus =
    | { readonly status: "running" }
    | ({ readonly status: "done" } & MediaBlob & { readonly model: string })
    | { readonly status: "failed"; readonly error: string; readonly failureClass: MediaFailureClass }

/** One media model a caller may choose, from the providers whose keys are configured. */
export interface AvailableMediaModel {
    readonly kind: MediaKind
    /** The name to ask for. */
    readonly id: string
    readonly provider: string
    readonly label: string
}

export interface MediaRouter {
    generateImage(request: ImageRequest, signal?: AbortSignal): Promise<ImageResult>
    synthesizeSpeech(request: SpeechRequest, signal?: AbortSignal): Promise<SpeechResult>
    /** Starts a video and returns at once; poll `getVideo`. Jobs live in this process. */
    startVideo(request: VideoRequest): Promise<VideoJob>
    getVideo(jobId: string): Promise<VideoStatus>
    /** The models whose provider has a key; empty for a kind nobody serves. */
    availableMediaModels(): AvailableMediaModel[]
    /** The model `auto` picks for a kind among the available ones, or undefined when none. */
    auto(kind: MediaKind): AvailableMediaModel | undefined
}

export interface MediaOptions {
    readonly env?: EnvSource
    readonly fetch?: FetchLike
    /** Per HTTP call (default 120000; a video call 600000). */
    readonly timeoutMs?: number
    /** Moves a provider's base URL: OpenAI otherwise reads `OPENAI_BASE_URL`. */
    readonly baseUrls?: { readonly openai?: string; readonly google?: string; readonly elevenlabs?: string }
    /** Models offered, replacing the built-in catalogue, in `auto` order. */
    readonly catalogue?: readonly CatalogueEntry[]
    /** Clock for job expiry. */
    readonly now?: () => number
}

type ProviderId = "openai" | "google" | "elevenlabs"

/** A model the catalogue offers; `provider` is `openai`, `google` or `elevenlabs`. */
export interface CatalogueEntry {
    readonly kind: MediaKind
    readonly provider: ProviderId
    readonly id: string
    readonly label: string
}

/** The built-in catalogue in `auto` order (see the sources above). */
export const MEDIA_CATALOGUE: readonly CatalogueEntry[] = Object.freeze([
    { kind: "image", provider: "openai", id: "gpt-image-2.5-flare", label: "GPT Image 2.5 Flare" },
    { kind: "image", provider: "openai", id: "gpt-image-2.5-sunburst", label: "GPT Image 2.5 Sunburst" },
    { kind: "image", provider: "google", id: "gemini-nano-banana-2.1", label: "Nano Banana 2.1" },
    { kind: "image", provider: "google", id: "gemini-3-pro-image", label: "Nano Banana Pro" },
    { kind: "image", provider: "google", id: "gemini-3.1-flash-lite-image", label: "Nano Banana 2 Lite" },
    { kind: "speech", provider: "openai", id: "gpt-4o-mini-tts", label: "GPT-4o mini TTS" },
    { kind: "speech", provider: "elevenlabs", id: "eleven_multilingual_v2", label: "ElevenLabs Multilingual v2" },
    { kind: "video", provider: "google", id: "gemini-omni-1.2-flash", label: "Gemini Omni 1.2 Flash" },
])

const ENV_PREFIX: Readonly<Record<ProviderId, string>> = { openai: "OPENAI", google: "GEMINI", elevenlabs: "ELEVENLABS" }
const DEFAULT_URL: Readonly<Record<ProviderId, string>> = {
    openai: "https://api.openai.com/v1",
    google: "https://generativelanguage.googleapis.com/v1beta",
    elevenlabs: "https://api.elevenlabs.io/v1",
}
const OPENAI_FORMATS: Readonly<Record<string, string>> = { mp3: "audio/mpeg", opus: "audio/opus", aac: "audio/aac", flac: "audio/flac", wav: "audio/wav", pcm: "audio/pcm" }
const REFUSAL = /moderation|content[ _-]?policy|safety|blocked|prohibited|violat|not allowed/i
const JOB_TTL_MS = 3_600_000

type Failure = MediaError

function transient(message: string, provider: string, model: string, status?: number): MediaError {
    return new MediaError({ failureClass: "transient", message, provider, model, ...(status === undefined ? {} : { status }) })
}

function bytesOf(base64: string): Uint8Array {
    return new Uint8Array(Buffer.from(base64, "base64"))
}

function field(value: unknown, name: string): unknown {
    return isPlainRecord(value) ? value[name] : undefined
}

function textOf(value: unknown): string {
    return typeof value === "string" ? value : ""
}

/** Reads the message and code of an error body in the OpenAI, Gemini or ElevenLabs shape. */
function errorText(body: unknown): string {
    const root: unknown = Array.isArray(body) ? body[0] : body
    const error = field(root, "error")
    const detail = field(root, "detail")
    const parts = [textOf(field(error, "code")), textOf(field(error, "type")), textOf(field(error, "status")), textOf(field(error, "message")), textOf(error), textOf(detail), textOf(field(detail, "status")), textOf(field(detail, "message")), textOf(field(root, "message"))]
    if (Array.isArray(detail)) for (const item of detail) parts.push(textOf(field(item, "msg")))
    return parts.filter((part) => part !== "").join(" ")
}

/** Classifies an HTTP failure: 401/403 auth, 408/409/425/429/5xx transient, a 400 or 422 naming a policy refused, any other 4xx an invalid request. */
export function classifyMediaStatus(status: number, body: unknown): MediaFailureClass {
    if (status === 401 || status === 403) return "auth"
    if (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500) return "transient"
    if ((status === 400 || status === 422) && REFUSAL.test(errorText(body))) return "refused"
    return "invalid_request"
}

interface Resolved {
    readonly id: ProviderId
    readonly keys: readonly ResolverKeyConfig[]
    readonly baseUrl: string
}

interface Job {
    readonly provider: string
    readonly model: string
    readonly at: number
    state: VideoStatus
}

/**
 * Media over the providers whose keys are in env (`OPENAI_API_KEY`, `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, each with `_2`.. or
 * `_API_KEYS` twins). With no key, a provider is absent and nothing fails at boot. A call without `model` tries the available
 * models of its kind in catalogue order and its keys in order, moving on after an `auth` or `transient` failure; a `refused` or
 * `invalid_request` stops at once, since another provider would not make it the caller's right.
 */
export function createMedia(options: MediaOptions = {}): MediaRouter {
    const env = options.env ?? process.env
    const fetchFn: FetchLike = options.fetch ?? ((input, init) => fetch(input, init))
    const timeoutMs = options.timeoutMs ?? 120_000
    const now = options.now ?? Date.now
    const catalogue = options.catalogue ?? MEDIA_CATALOGUE
    const providers = new Map<ProviderId, Resolved>()
    for (const id of ["openai", "google", "elevenlabs"] as const) {
        const keys = keysFromEnv(ENV_PREFIX[id], id, env).filter((key): key is ResolverKeyConfig => "resolve" in key)
        if (keys.length === 0) continue
        const own = options.baseUrls?.[id] ?? (id === "openai" ? env.OPENAI_BASE_URL : undefined)
        providers.set(id, { id, keys, baseUrl: (own !== undefined && own.trim() !== "" ? own : DEFAULT_URL[id]).replace(/\/+$/, "") })
    }
    const jobs = new Map<string, Job>()
    let counter = 0

    const available = (): AvailableMediaModel[] => catalogue.filter((entry) => providers.has(entry.provider)).map(({ kind, id, provider, label }) => ({ kind, id, provider, label }))

    function candidates(kind: MediaKind, model: string | undefined, provider: string | undefined): CatalogueEntry[] {
        const all = catalogue.filter((entry) => entry.kind === kind && providers.has(entry.provider))
        if (all.length === 0) throw new MediaError({ failureClass: "unavailable", message: `no provider with a key serves ${kind}` })
        const named = model === undefined || model === "auto" ? undefined : model
        const out = all.filter((entry) => (named === undefined || entry.id === named) && (provider === undefined || entry.provider === provider))
        if (out.length === 0) throw new MediaError({ failureClass: "invalid_request", message: `no available ${kind} model matches ${named ?? "auto"}${provider === undefined ? "" : ` on ${provider}`}` })
        return out
    }

    async function http(entry: CatalogueEntry, key: string, url: string, init: RequestInit, signal: AbortSignal | undefined, limitMs: number): Promise<Response> {
        const timeout = AbortSignal.timeout(limitMs)
        try {
            return await fetchFn(url, { ...init, signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]) })
        } catch (error) {
            if (signal?.aborted === true) throw error
            const message = error instanceof Error ? error.message : String(error)
            throw transient(scrub(`${entry.provider} did not answer: ${message}`, [key]), entry.provider, entry.id)
        }
    }

    async function ok(entry: CatalogueEntry, key: string, response: Response): Promise<Response> {
        if (response.ok) return response
        const raw = await response.text().catch(() => "")
        let body: unknown = raw
        try {
            body = JSON.parse(raw)
        } catch {
            /* a non-JSON error body stays text */
        }
        const failureClass = classifyMediaStatus(response.status, body)
        const detail = scrub(errorText(body) || raw.slice(0, 300), [key])
        throw new MediaError({ failureClass, message: `${entry.provider} answered ${String(response.status)}${detail === "" ? "" : `: ${detail}`}`, status: response.status, provider: entry.provider, model: entry.id })
    }

    /** Tries each candidate with each of its keys: `skip` marks a candidate that cannot serve the request. */
    async function attempt<T>(kind: MediaKind, request: { readonly model?: string; readonly provider?: string }, serve: (entry: CatalogueEntry, base: string, key: string) => Promise<T> | "skip"): Promise<T> {
        let last: Failure | undefined
        let skipped = 0
        const list = candidates(kind, request.model, request.provider)
        for (const entry of list) {
            const resolved = providers.get(entry.provider)
            if (resolved === undefined) continue
            for (const keyConfig of resolved.keys) {
                const key = await keyConfig.resolve()
                if (key === undefined || key.trim() === "") continue
                let pending: Promise<T> | "skip"
                try {
                    pending = serve(entry, resolved.baseUrl, key)
                    if (pending === "skip") {
                        skipped += 1
                        break
                    }
                    return await pending
                } catch (error) {
                    if (!(error instanceof MediaError)) throw error
                    last = error
                    if (error.failureClass === "refused" || error.failureClass === "invalid_request") throw error
                    if (error.failureClass === "transient" && error.status === undefined) break
                }
            }
        }
        if (last !== undefined) throw last
        if (skipped > 0) throw new MediaError({ failureClass: "invalid_request", message: `no available ${kind} model supports this request (voice, format or size)` })
        throw new MediaError({ failureClass: "unavailable", message: `no key resolved for ${kind}` })
    }

    function ratioOf(size: string | undefined): string | undefined {
        if (size === undefined) return undefined
        if (/^\d+:\d+$/.test(size)) return size
        const match = /^(\d+)x(\d+)$/.exec(size)
        if (match === null) return undefined
        const [width, height] = [Number(match[1]), Number(match[2])]
        const divisor = ((a: number, b: number): number => { while (b !== 0) [a, b] = [b, a % b]; return a })(width, height)
        return divisor === 0 ? undefined : `${String(width / divisor)}:${String(height / divisor)}`
    }

    async function openaiImage(entry: CatalogueEntry, base: string, key: string, request: ImageRequest, signal: AbortSignal | undefined): Promise<ImageResult> {
        const refs = request.referenceImages ?? []
        let response: Response
        if (refs.length === 0) {
            const body = { model: entry.id, prompt: request.prompt, ...(request.n === undefined ? {} : { n: request.n }), ...(request.size === undefined ? {} : { size: request.size }) }
            response = await http(entry, key, `${base}/images/generations`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) }, signal, timeoutMs)
        } else {
            const form = new FormData()
            form.set("model", entry.id)
            form.set("prompt", request.prompt)
            if (request.n !== undefined) form.set("n", String(request.n))
            if (request.size !== undefined) form.set("size", request.size)
            for (const [index, ref] of refs.entries()) form.append("image[]", new Blob([ref.bytes], { type: ref.mime }), `reference-${String(index + 1)}`)
            response = await http(entry, key, `${base}/images/edits`, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form }, signal, timeoutMs)
        }
        const json: unknown = await (await ok(entry, key, response)).json().catch(() => undefined)
        const data = field(json, "data")
        const images: MediaBlob[] = []
        const format = textOf(field(json, "output_format")) || "png"
        for (const item of Array.isArray(data) ? data : []) {
            const encoded = textOf(field(item, "b64_json"))
            if (encoded !== "") images.push({ bytes: bytesOf(encoded), mime: `image/${format}` })
        }
        if (images.length === 0) throw transient("openai answered no image", entry.provider, entry.id)
        const usage = field(json, "usage")
        const input = field(usage, "input_tokens")
        const output = field(usage, "output_tokens")
        return { images, model: entry.id, provider: entry.provider, usage: { units: images.length, ...(typeof input === "number" ? { inputTokens: input } : {}), ...(typeof output === "number" ? { outputTokens: output } : {}) } }
    }

    function googleOutputs(json: unknown, type: string): { blocks: Record<string, unknown>[]; text: string } {
        const blocks: Record<string, unknown>[] = []
        let text = ""
        const steps = field(json, "steps")
        for (const step of Array.isArray(steps) ? steps : []) {
            if (field(step, "type") !== "model_output") continue
            const content = field(step, "content")
            for (const block of Array.isArray(content) ? content : []) {
                if (!isPlainRecord(block)) continue
                if (block.type === type && typeof block.data === "string") blocks.push(block)
                else if (block.type === "text") text += textOf(block.text)
            }
        }
        return { blocks, text }
    }

    async function googleCall(entry: CatalogueEntry, base: string, key: string, body: unknown, limitMs: number, signal: AbortSignal | undefined): Promise<unknown> {
        const response = await http(entry, key, `${base}/interactions`, { method: "POST", headers: { "x-goog-api-key": key, "content-type": "application/json" }, body: JSON.stringify(body) }, signal, limitMs)
        return (await ok(entry, key, response)).json().catch(() => undefined)
    }

    async function googleImage(entry: CatalogueEntry, base: string, key: string, request: ImageRequest, signal: AbortSignal | undefined): Promise<ImageResult> {
        const input: unknown[] = [{ type: "text", text: request.prompt }, ...(request.referenceImages ?? []).map((ref) => ({ type: "image", data: Buffer.from(ref.bytes).toString("base64"), mime_type: ref.mime }))]
        const ratio = ratioOf(request.size)
        const body = { model: entry.id, input, ...(ratio === undefined ? {} : { response_format: { type: "image", aspect_ratio: ratio } }) }
        const images: MediaBlob[] = []
        let refusal = ""
        for (let at = 0; at < (request.n ?? 1); at++) {
            const { blocks, text } = googleOutputs(await googleCall(entry, base, key, body, timeoutMs, signal), "image")
            for (const block of blocks) images.push({ bytes: bytesOf(textOf(block.data)), mime: textOf(block.mime_type) || "image/png" })
            if (blocks.length === 0) refusal = text
        }
        if (images.length === 0) throw new MediaError({ failureClass: "refused", message: `google returned no image${refusal === "" ? "" : `: ${refusal.slice(0, 300)}`}`, provider: entry.provider, model: entry.id })
        return { images, model: entry.id, provider: entry.provider, usage: { units: images.length } }
    }

    async function openaiSpeech(entry: CatalogueEntry, base: string, key: string, request: SpeechRequest, signal: AbortSignal | undefined): Promise<SpeechResult> {
        const format = request.format ?? "mp3"
        const body = { model: entry.id, input: request.text, voice: request.voice ?? "marin", response_format: format }
        const response = await ok(entry, key, await http(entry, key, `${base}/audio/speech`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) }, signal, timeoutMs))
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (bytes.length === 0) throw transient("openai answered no audio", entry.provider, entry.id)
        return { bytes, mime: response.headers.get("content-type") ?? OPENAI_FORMATS[format] ?? "application/octet-stream", model: entry.id, provider: entry.provider, usage: { characters: request.text.length } }
    }

    async function elevenSpeech(entry: CatalogueEntry, base: string, key: string, voice: string, request: SpeechRequest, signal: AbortSignal | undefined): Promise<SpeechResult> {
        const format = request.format === undefined || request.format === "mp3" ? undefined : request.format
        const query = format === undefined ? "" : `?output_format=${encodeURIComponent(format)}`
        const response = await ok(entry, key, await http(entry, key, `${base}/text-to-speech/${encodeURIComponent(voice)}${query}`, { method: "POST", headers: { "xi-api-key": key, "content-type": "application/json" }, body: JSON.stringify({ text: request.text, model_id: entry.id }) }, signal, timeoutMs))
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (bytes.length === 0) throw transient("elevenlabs answered no audio", entry.provider, entry.id)
        const fallback = format === undefined || format.startsWith("mp3") ? "audio/mpeg" : format.startsWith("wav") ? "audio/wav" : format.startsWith("opus") ? "audio/opus" : format.startsWith("pcm") ? "audio/pcm" : "application/octet-stream"
        return { bytes, mime: response.headers.get("content-type") ?? fallback, model: entry.id, provider: entry.provider, usage: { characters: request.text.length } }
    }

    function videoBody(entry: CatalogueEntry, request: VideoRequest): unknown {
        const format: Record<string, string> = { type: "video" }
        const ratio = ratioOf(request.size)
        const parts = ratio?.split(":").map(Number) ?? []
        if (parts.length === 2) format.aspect_ratio = (parts[0] ?? 1) >= (parts[1] ?? 1) ? "16:9" : "9:16"
        if (request.seconds !== undefined) format.duration = `${String(request.seconds)}s`
        return { model: entry.id, input: request.prompt, response_format: format }
    }

    function prune(): void {
        for (const [id, job] of jobs) if (now() - job.at > JOB_TTL_MS && job.state.status !== "running") jobs.delete(id)
    }

    return {
        async generateImage(request, signal) {
            if (request.prompt.trim() === "") throw new MediaError({ failureClass: "invalid_request", message: "an image needs a prompt" })
            if (request.n !== undefined && (!Number.isInteger(request.n) || request.n < 1 || request.n > 10)) throw new MediaError({ failureClass: "invalid_request", message: "n is 1 to 10" })
            return attempt("image", request, (entry, base, key) => (entry.provider === "openai" ? openaiImage(entry, base, key, request, signal) : googleImage(entry, base, key, request, signal)))
        },
        async synthesizeSpeech(request, signal) {
            if (request.text.trim() === "") throw new MediaError({ failureClass: "invalid_request", message: "speech needs text" })
            return attempt("speech", request, (entry, base, key) => {
                if (entry.provider === "openai") return request.format !== undefined && !(request.format in OPENAI_FORMATS) ? "skip" : openaiSpeech(entry, base, key, request, signal)
                const voice = request.voice ?? env.ELEVENLABS_VOICE_ID
                if (voice === undefined || voice.trim() === "") return "skip"
                if (request.format !== undefined && request.format !== "mp3" && !/^[a-z0-9]+_\d+/.test(request.format)) return "skip"
                return elevenSpeech(entry, base, key, voice, request, signal)
            })
        },
        async startVideo(request) {
            if (request.prompt.trim() === "") throw new MediaError({ failureClass: "invalid_request", message: "a video needs a prompt" })
            if (request.seconds !== undefined && (request.seconds < 3 || request.seconds > 15)) throw new MediaError({ failureClass: "invalid_request", message: "seconds is 3 to 15" })
            const [entry] = candidates("video", request.model, request.provider)
            const resolved = entry === undefined ? undefined : providers.get(entry.provider)
            const key = resolved === undefined ? undefined : await resolved.keys[0]?.resolve()
            if (entry === undefined || resolved === undefined || key === undefined || key.trim() === "") throw new MediaError({ failureClass: "unavailable", message: "no key resolved for video" })
            prune()
            counter += 1
            const jobId = `${entry.provider}:${String(now())}-${String(counter)}`
            const job: Job = { provider: entry.provider, model: entry.id, at: now(), state: { status: "running" } }
            jobs.set(jobId, job)
            void googleCall(entry, resolved.baseUrl, key, videoBody(entry, request), 600_000, undefined).then(
                (json) => {
                    const { blocks, text } = googleOutputs(json, "video")
                    const block = blocks[0]
                    job.state = block === undefined
                        ? { status: "failed", failureClass: "refused", error: `google returned no video${text === "" ? "" : `: ${text.slice(0, 300)}`}` }
                        : { status: "done", bytes: bytesOf(textOf(block.data)), mime: textOf(block.mime_type) || "video/mp4", model: entry.id }
                },
                (error: unknown) => {
                    job.state = error instanceof MediaError ? { status: "failed", failureClass: error.failureClass, error: error.message } : { status: "failed", failureClass: "transient", error: scrub(error instanceof Error ? error.message : String(error), [key]) }
                },
            )
            return { jobId, provider: entry.provider }
        },
        getVideo(jobId) {
            const job = jobs.get(jobId)
            if (job === undefined) return Promise.reject(new MediaError({ failureClass: "not_found", message: `no video job ${jobId} in this process` }))
            return Promise.resolve(job.state)
        },
        availableMediaModels: available,
        auto: (kind) => available().find((entry) => entry.kind === kind),
    }
}
