import { createServer } from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"

/** What the fake self-hosted server holds and how it behaves. */
export interface LocalServerOptions {
    /** The models it holds (Ollama's `ollama list`). Default `["m-chat", "m-embed"]`. */
    readonly models?: readonly string[]
    /** The length of the vectors it answers. Default 8. */
    readonly dimensions?: number
    /** False: `POST /v1/embeddings` is absent (404, plain text), as on a server that has only Ollama's own `/api/embed`. */
    readonly v1Embeddings?: boolean
    /** False: `GET /v1/models` is absent (404). */
    readonly v1Models?: boolean
    /** A bearer token the server requires; a call without it is answered 401. Default none: keyless. */
    readonly requireKey?: string
    /** Milliseconds the server waits before it answers (a model loading into GPU memory). */
    readonly delayMs?: number
}

/** One request the server received. */
export interface Seen {
    readonly method: string
    readonly path: string
    readonly authorization: string | undefined
    readonly body: Record<string, unknown>
}

export interface LocalServer {
    readonly baseUrl: string
    readonly origin: string
    readonly seen: Seen[]
    close(): Promise<void>
}

/** The vector the server answers for any input: not unit length, so a cut that skips normalization shows. */
export function vectorOf(dimensions: number): number[] {
    return Array.from({ length: dimensions }, (_, index) => ((index % 7) + 1) * (index % 2 === 0 ? 1 : -1))
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    const text = Buffer.concat(chunks).toString("utf8")
    return text === "" ? {} : (JSON.parse(text) as Record<string, unknown>)
}

function json(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { "content-type": "application/json" })
    response.end(JSON.stringify(body))
}

/** Ollama's answer for a model it does not hold. */
function missing(response: ServerResponse, model: string, native: boolean): void {
    const message = `model "${model}" not found, try pulling it first`
    json(response, 404, native ? { error: message } : { error: { message, type: "api_error", param: null, code: null } })
}

function inputsOf(body: Record<string, unknown>): string[] {
    return Array.isArray(body.input) ? (body.input as string[]) : [typeof body.input === "string" ? body.input : ""]
}

/** Starts a server on a free local port that speaks the OpenAI API and Ollama's own, and never needs a key unless told to. */
export async function startLocalServer(options: LocalServerOptions = {}): Promise<LocalServer> {
    const models = options.models ?? ["m-chat", "m-embed"]
    const dimensions = options.dimensions ?? 8
    const seen: Seen[] = []
    const server = createServer((request, response) => {
        void (async () => {
            const url = new URL(request.url ?? "/", "http://local")
            const body = request.method === "POST" ? await readBody(request) : {}
            const authorization = request.headers.authorization
            seen.push({ method: request.method ?? "", path: url.pathname, authorization, body })
            if (options.delayMs !== undefined) await new Promise((resolve) => setTimeout(resolve, options.delayMs))
            if (options.requireKey !== undefined && authorization !== `Bearer ${options.requireKey}`) {
                json(response, 401, { error: { message: "invalid api key", type: "authentication_error" } })
                return
            }
            const model = typeof body.model === "string" ? body.model : ""
            const path = url.pathname
            if (request.method === "GET" && path === "/v1/models" && options.v1Models !== false) {
                json(response, 200, { object: "list", data: models.map((id) => ({ id, object: "model", created: 0, owned_by: "library" })) })
            } else if (request.method === "GET" && path === "/api/tags") {
                json(response, 200, { models: models.map((name) => ({ name, model: name, size: 1_000_000 })) })
            } else if (request.method === "POST" && path === "/v1/chat/completions") {
                if (!models.includes(model)) { missing(response, model, false); return; }
                if (body.stream === true) {
                    response.writeHead(200, { "content-type": "text/event-stream" })
                    for (const piece of ["Hel", "lo"]) response.write(`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] })}\n\n`)
                    response.write(`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model, choices: [], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } })}\n\n`)
                    response.end("data: [DONE]\n\n")
                    return
                }
                json(response, 200, { id: "c1", object: "chat.completion", created: 0, model, choices: [{ index: 0, message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } })
            } else if (request.method === "POST" && path === "/v1/embeddings") {
                if (options.v1Embeddings === false) {
                    response.writeHead(404, { "content-type": "text/plain" })
                    response.end("404 page not found")
                    return
                }
                if (!models.includes(model)) { missing(response, model, false); return; }
                json(response, 200, { object: "list", model, data: inputsOf(body).map((_, index) => ({ object: "embedding", index, embedding: vectorOf(dimensions) })), usage: { prompt_tokens: 3, total_tokens: 3 } })
            } else if (request.method === "POST" && path === "/api/embed") {
                if (!models.includes(model)) { missing(response, model, true); return; }
                json(response, 200, { model, embeddings: inputsOf(body).map(() => vectorOf(dimensions)), prompt_eval_count: 3 })
            } else {
                response.writeHead(404, { "content-type": "text/plain" })
                response.end("404 page not found")
            }
        })()
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
    return {
        baseUrl: `${origin}/v1`,
        origin,
        seen,
        close: () =>
            new Promise<void>((resolve) => {
                server.closeAllConnections()
                server.close(() => { resolve(); })
            }),
    }
}

/** A base URL nothing listens on: the port was free a moment ago. */
export async function closedBaseUrl(): Promise<string> {
    const server = await startLocalServer()
    const { origin } = server
    await server.close()
    return `${origin}/v1`
}
