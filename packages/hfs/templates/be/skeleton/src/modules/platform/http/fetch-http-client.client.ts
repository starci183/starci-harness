import { rootCertificates } from "node:tls"
import { Injectable } from "@nestjs/common"
import type { OnModuleDestroy } from "@nestjs/common"
import { Agent } from "undici"
import { isRecord } from "@modules/platform/primitives"
import { HttpError, HttpErrorCode } from "./errors/http.error"
import { InjectHttpOptions } from "./http.decorators"
import type { HttpOptions } from "./http.options"
import type { HttpClient, HttpRequest, HttpResponse } from "./http.port"

@Injectable()
/** The HttpClient adapter over the global `fetch`; the only place outside a spec that calls it. */
export class FetchHttpClient implements HttpClient, OnModuleDestroy {
    /**
     * The connection pool that adds `trustedCa` to Node's bundled roots (the CA joins the trusted list, verification stays
     * on); absent without one, so every request goes through fetch's own default pool as before.
     */
    private readonly dispatcher: Agent | undefined

    constructor(@InjectHttpOptions() options: HttpOptions) {
        this.dispatcher =
            options.trustedCa === undefined
                ? undefined
                : new Agent({ connect: { ca: [...rootCertificates, options.trustedCa] } })
    }

    /** Closes the pool of the trusted CA, if the app configured one, when the app stops. */
    async onModuleDestroy(): Promise<void> {
        await this.dispatcher?.close()
    }

    /** Sends `request` with its deadline and reads the body: parsed JSON, or the raw bytes when the request asks for them. */
    async request(request: HttpRequest): Promise<HttpResponse> {
        const deadline = AbortSignal.timeout(request.timeoutMs)
        const signal = request.signal ? AbortSignal.any([deadline, request.signal]) : deadline
        const response = await this.send(request, signal)
        if (request.read === "bytes")
            return {
                status: response.status,
                body: await this.received(response.arrayBuffer().then((bytes) => Buffer.from(bytes))),
            }
        const text = await this.received(response.text())
        return { status: response.status, body: text === "" ? undefined : this.parse(text) }
    }

    /** The body as it arrives; a deadline or a cut while it streams is the same HttpError as one before the headers. */
    private async received<T>(reading: Promise<T>): Promise<T> {
        try {
            return await reading
        } catch (cause) {
            throw this.failure(cause)
        }
    }

    private failure(cause: unknown): HttpError {
        // The deadline rejects with a DOMException from the runtime's own realm: compare its name, never its prototype chain.
        const timedOut = isRecord(cause) && cause.name === "TimeoutError"
        return new HttpError({ code: timedOut ? HttpErrorCode.Timeout : HttpErrorCode.Network, cause })
    }

    private async send(request: HttpRequest, signal: AbortSignal): Promise<Response> {
        try {
            const body = this.bodyOf(request)
            const init: RequestInit = {
                method: request.method,
                headers: this.headersOf(request),
                ...(body === undefined ? {} : { body }),
                signal,
            }
            return await fetch(request.url, this.routed(init))
        } catch (cause) {
            throw this.failure(cause)
        }
    }

    /**
     * `init` sent through the trusted-CA pool when there is one. @types/node declares fetch over its own copy of undici's
     * types, which the Agent of the undici package does not match nominally; `Object.assign` keeps the declared type of
     * `init` and hands fetch the Agent itself.
     */
    private routed(init: RequestInit): RequestInit {
        return this.dispatcher === undefined ? init : Object.assign(init, { dispatcher: this.dispatcher })
    }

    /** The explicit id owns correlation; a copied traceparent would take precedence at the receiving logger. */
    private headersOf(request: HttpRequest): Record<string, string> {
        const extra = Object.fromEntries(
            Object.entries(request.headers ?? {}).filter(
                ([name]) => !["x-request-id", "traceparent"].includes(name.toLowerCase()),
            ),
        )
        return { ...this.contentTypeOf(request), ...extra, "x-request-id": request.correlationId }
    }

    private contentTypeOf(request: HttpRequest): Record<string, string> {
        if (request.form !== undefined) return { "content-type": "application/x-www-form-urlencoded" }
        if (request.bytes !== undefined) return { "content-type": "application/octet-stream" }
        return request.body === undefined ? {} : { "content-type": "application/json" }
    }

    private bodyOf(request: HttpRequest): string | Buffer | undefined {
        return request.bytes ?? this.textOf(request)
    }

    /** The text body of a request that carries no bytes: the form encoded, else the JSON body, else none. */
    private textOf(request: HttpRequest): string | undefined {
        if (request.form !== undefined) return new URLSearchParams(request.form).toString()
        return request.body === undefined ? undefined : JSON.stringify(request.body)
    }

    private parse(text: string): unknown {
        try {
            return JSON.parse(text)
        } catch (cause) {
            throw new HttpError({ code: HttpErrorCode.BodyUnreadable, cause })
        }
    }
}
