import { randomBytes, timingSafeEqual } from "node:crypto"
import { createServer } from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { asRefusal, Refusal } from "../../shared/errors.js"
import type { VerbContext } from "../../shared/verb.js"
import type { ConfigSet, GoalSet, LiveEvent, Ruling } from "./contract.js"
import { poll } from "./live.js"
import type { Markers } from "./live.js"
import { configOf, inboxOf, overviewOf, taskOf, workflowOf } from "./read.js"
import { rule, setConfig, setGoal, WORKFLOW_ACTIONS, workflowAction } from "./write.js"
import type { WorkflowAction } from "./write.js"

/** The origins that may call the API from a page: the packaged Tauri app (macOS, Windows over http and https) and its dev server. */
const ORIGINS: ReadonlySet<string> = new Set(["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost", "http://localhost:1420"])

/** How often the event stream polls the stores, and how often it sends a heartbeat comment. */
const POLL_MS = 1000
const HEARTBEAT_MS = 15_000

/** The largest request body the server reads. */
const MAX_BODY = 64 * 1024

/** A running `starci ui` server: where it listens, its bearer token, and how it is closed. */
export interface UiServer {
    readonly url: string
    readonly port: number
    readonly token: string
    readonly closed: Promise<void>
    readonly close: () => void
}

/** The HTTP status a refusal answers with: an unknown subject is 404, a bad request 400, any other refusal 409. */
const statusOf = (code: string): number => {
    if (code.endsWith("_UNKNOWN") || code === "NOT_FOUND") return 404
    if (code === "BAD_REQUEST" || code === "CLI_USAGE") return 400
    if (code === "CLI_UNEXPECTED") return 500
    return 409
}

const send = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" })
    res.end(JSON.stringify(body))
}

/** Every non-2xx answer carries `{code, message}`, which the app shows. */
const fail = (res: ServerResponse, status: number, code: string, message: string): void => {
    send(res, status, { code, message })
}

const sameSecret = (given: string, token: string): boolean => {
    const a = Buffer.from(given)
    const b = Buffer.from(token)
    return a.length === b.length && timingSafeEqual(a, b)
}

const readBody = async (req: IncomingMessage): Promise<unknown> => {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
        size += buffer.length
        if (size > MAX_BODY) throw new Refusal("BAD_REQUEST", `the body is over ${String(MAX_BODY)} bytes`)
        chunks.push(buffer)
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
    } catch {
        throw new Refusal("BAD_REQUEST", "the body is not JSON")
    }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

const rulingOf = (body: unknown): Ruling => {
    if (!isRecord(body) || !(body.option === null || typeof body.option === "string") || typeof body.note !== "string") throw new Refusal("BAD_REQUEST", "a ruling is {option: string | null, note: string}")
    return { option: body.option, note: body.note }
}

const configSetOf = (body: unknown): ConfigSet => {
    if (!isRecord(body) || typeof body.key !== "string" || !("value" in body)) throw new Refusal("BAD_REQUEST", "a config change is {key: string, value}")
    return { key: body.key, value: body.value }
}

const goalSetOf = (body: unknown): GoalSet => {
    if (!isRecord(body) || typeof body.text !== "string") throw new Refusal("BAD_REQUEST", "a goal is {text: string}")
    return { text: body.text }
}

const isAction = (value: string): value is WorkflowAction => (WORKFLOW_ACTIONS as readonly string[]).includes(value)

/** The event stream's clients and its poller: polls only while a client listens, and tells every client each change. */
const liveFeed = (): { readonly join: (res: ServerResponse) => void; readonly stop: () => void } => {
    const clients = new Set<ServerResponse>()
    let markers: Markers | undefined
    let polling = false
    const broadcast = (text: string): void => {
        for (const client of clients) client.write(text)
    }
    const tick = async (): Promise<void> => {
        if (polling || clients.size === 0) return
        polling = true
        try {
            const next = await poll(markers)
            markers = next.markers
            for (const change of next.changes) broadcast(`data: ${JSON.stringify(change satisfies LiveEvent)}\n\n`)
        } catch (error: unknown) {
            broadcast(`: poll failed (${asRefusal(error).code})\n\n`)
        } finally {
            polling = false
        }
    }
    const poller = setInterval(() => void tick(), POLL_MS)
    const heartbeat = setInterval(() => {
        broadcast(": heartbeat\n\n")
    }, HEARTBEAT_MS)
    return {
        join: (res) => {
            res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive" })
            res.write(": connected\n\n")
            clients.add(res)
            res.on("close", () => clients.delete(res))
            void tick()
        },
        stop: () => {
            clearInterval(poller)
            clearInterval(heartbeat)
            for (const client of clients) client.end()
            clients.clear()
        },
    }
}

/** The body of one /api answer after its token passed; a refusal becomes its status with `{code, message}`. */
const answerOf = async (context: VerbContext, req: IncomingMessage, parts: readonly string[]): Promise<unknown> => {
    const method = req.method ?? "GET"
    const [head, a, b, c, d] = parts
    if (method === "GET" && head === "overview" && a === undefined) return overviewOf(context.cwd)
    if (method === "GET" && head === "inbox" && a === undefined) return inboxOf()
    if (method === "GET" && head === "config" && a === undefined) return configOf()
    if (method === "GET" && head === "workflows" && a !== undefined && b !== undefined && c === undefined) return workflowOf(context.cwd, a, b)
    if (method === "GET" && head === "tasks" && a !== undefined && b !== undefined && c === undefined) return taskOf(a, b)
    if (method === "POST" && head === "inbox" && a !== undefined && b !== undefined && c === "ruling" && d === undefined) return rule(context, a, b, rulingOf(await readBody(req)))
    if (method === "POST" && head === "workflows" && a !== undefined && b !== undefined && c === "goal" && d === undefined) return setGoal(context, a, b, goalSetOf(await readBody(req)))
    if (method === "POST" && head === "workflows" && a !== undefined && b !== undefined && c !== undefined && d === undefined) {
        if (!isAction(c)) throw new Refusal("NOT_FOUND", `no workflow action ${c}; the actions are ${WORKFLOW_ACTIONS.join(", ")}`)
        return workflowAction(context, a, b, c)
    }
    if (method === "POST" && head === "config" && a === undefined) return setConfig(context, configSetOf(await readBody(req)))
    throw new Refusal("NOT_FOUND", `no ${method} /api/${parts.join("/")}`)
}

/** What one request is, after the origin, host and token gates: refused, a preflight, the index, the event stream or an /api call. */
type Gated =
    | { readonly kind: "refuse"; readonly status: number; readonly code: string; readonly message: string }
    | { readonly kind: "preflight" | "index" | "events" }
    | { readonly kind: "api"; readonly parts: readonly string[] }

/** Sets the CORS headers for an allowed origin and judges the request; a page of any other origin is refused. */
const gateOf = (req: IncomingMessage, res: ServerResponse, port: number, token: string): Gated => {
    const origin = req.headers.origin
    if (origin !== undefined) {
        if (!ORIGINS.has(origin)) return { kind: "refuse", status: 403, code: "ORIGIN_REFUSED", message: `origin ${origin} may not call starci ui` }
        res.setHeader("Access-Control-Allow-Origin", origin)
        res.setHeader("Vary", "Origin")
        res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type")
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    }
    const host = req.headers.host ?? ""
    if (host !== `127.0.0.1:${String(port)}` && host !== `localhost:${String(port)}`) return { kind: "refuse", status: 403, code: "HOST_REFUSED", message: `host ${host} is not this server` }
    if (req.method === "OPTIONS") return { kind: "preflight" }
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${String(port)}`)
    const parts = url.pathname.split("/").filter((part) => part !== "").map(decodeURIComponent)
    if (parts.length === 0 && req.method === "GET") return { kind: "index" }
    if (parts[0] !== "api") return { kind: "refuse", status: 404, code: "NOT_FOUND", message: `no ${url.pathname}` }
    const events = req.method === "GET" && parts.length === 2 && parts[1] === "events"
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1]
    const given = bearer ?? (events ? url.searchParams.get("token") : null) ?? ""
    if (!sameSecret(given, token)) return { kind: "refuse", status: 401, code: "UNAUTHORIZED", message: "every /api call needs the bearer token starci ui printed" }
    return events ? { kind: "events" } : { kind: "api", parts: parts.slice(1) }
}

/**
 * Starts the server on 127.0.0.1 only. Every /api request needs the bearer token (`Authorization: Bearer`, or `?token=` on the
 * event stream alone, which EventSource cannot send headers for); a Host that is not this loopback address is refused, so a
 * rebound DNS name cannot reach it; CORS answers only the Tauri origins and the app's dev server, with OPTIONS preflight.
 */
export const startUi = async (context: VerbContext, port: number): Promise<UiServer> => {
    const token = randomBytes(24).toString("base64url")
    const feed = liveFeed()
    let bound = port
    const server = createServer((req, res) => {
        const gated = gateOf(req, res, bound, token)
        switch (gated.kind) {
            case "refuse":
                fail(res, gated.status, gated.code, gated.message)
                break
            case "preflight":
                res.writeHead(204)
                res.end()
                break
            case "index":
                send(res, 200, { name: "starci ui", api: "/api" })
                break
            case "events":
                feed.join(res)
                break
            case "api":
                answerOf(context, req, gated.parts)
                    .then((body) => {
                        send(res, 200, body)
                    })
                    .catch((error: unknown) => {
                        const refusal = asRefusal(error)
                        if (!res.headersSent) fail(res, statusOf(refusal.code), refusal.code, refusal.message)
                    })
        }
    })
    await new Promise<void>((listening, refuse) => {
        server.once("error", (error: Error) => {
            refuse(new Refusal("UI_PORT_TAKEN", `127.0.0.1:${String(port)} cannot be bound: ${error.message}`))
        })
        server.listen(port, "127.0.0.1", () => {
            listening()
        })
    })
    bound = (server.address() as AddressInfo).port
    const closed = new Promise<void>((done) => server.once("close", () => {
        done()
    }))
    const close = (): void => {
        feed.stop()
        server.closeAllConnections()
        server.close()
    }
    return { url: `http://127.0.0.1:${String(bound)}`, port: bound, token, closed, close }
}
