/**
 * The contract layer helper: builds the REAL integration client against a provider SANDBOX, so a contract spec can check that
 * the fake at the network edge still behaves like the provider. Sandbox coordinates come only from the process environment
 * under the keys the spec names (never committed, never printed); the library, not the spec, reads them, and when any
 * required key is absent the described body does not run and the library registers a FAILING test that names the missing
 * keys: a run without the sandbox credentials is red, never a silent pass.
 */
import { Module } from "@nestjs/common"
import type { DynamicModule, INestApplicationContext, Type } from "@nestjs/common"
import { NestFactory } from "@nestjs/core"
import { TestWorldErrorCode, worldError } from "../errors"

const BOOT_TIMEOUT_MS = 60_000

/** How a module of the sandbox is registered: as the app root does, global. */
export interface ModuleRegistration {
    /** Always global: the capability is consumed through its injectors. */
    readonly isGlobal: true
}

/** What builds one real client. */
export interface SandboxSpec<T> {
    /** The provider name, for the missing-keys message. */
    readonly provider: string
    /** The environment keys the sandbox needs; every one must be declared for the body to run. */
    readonly keys: ReadonlyArray<string>
    /** The integration module registered with the sandbox values, spreading the registration the library gives. `values` holds the declared keys. */
    readonly module: (values: Readonly<Record<string, string>>, registration: ModuleRegistration) => DynamicModule
    /** The token of the client inside that module: its class, or its injection symbol. */
    readonly client: Type<T> | symbol
}

/** One raw JSON call to a provider. */
export interface SandboxRequest {
    readonly method: "GET" | "POST" | "PUT" | "DELETE"
    /** The absolute URL. */
    readonly url: string
    readonly headers?: Readonly<Record<string, string>>
    /** A JSON body, sent as `application/json`. */
    readonly body?: unknown
}

/** A raw JSON call and what came back: the status and the parsed JSON body (or the text when it is not JSON). */
export interface SandboxAnswer {
    readonly status: number
    readonly body: unknown
}

/** A browser-style sandbox request. Cookies set by one call stay on this handle for later calls. */
export interface SandboxBrowserRequest {
    readonly method: "GET" | "POST"
    /** The absolute URL. Redirects are returned to the caller and are never followed automatically. */
    readonly url: string
    readonly headers?: Readonly<Record<string, string>>
    /** Form fields encoded as `application/x-www-form-urlencoded`; supported for POST. */
    readonly form?: Readonly<Record<string, string>>
}

/** The unparsed response from a browser-style request. Multiple Set-Cookie headers stay separate. */
export interface SandboxBrowserAnswer {
    readonly status: number
    readonly headers: Readonly<Record<string, string | ReadonlyArray<string>>>
    readonly body: string
}

/** The handle a contract spec holds. */
export interface SandboxHandle<T> {
    /** True when every required key is declared. */
    readonly available: boolean
    /** `describe` with the client built for the body when the sandbox is configured; when it is not, a `describe` whose one test fails naming the missing keys. */
    describe(name: string, body: () => void): void
    /** The real client, valid inside the described body. */
    client(): T
    /** One declared sandbox value (the base URL, the API key) for the raw calls of a spec. */
    value(key: string): string
    /** A raw JSON call to the provider, for comparing the real payload (not what the client parsed out of it) with a fixture. */
    fetchJson(request: SandboxRequest): Promise<SandboxAnswer>
    /** A cookie-preserving request that returns each response without following redirects. */
    request(request: SandboxBrowserRequest): Promise<SandboxBrowserAnswer>
}

@Module({})
/** The root of a sandbox client: the repository's outbound ports plus the integration module under test. */
class SandboxRoot {
    /** Composes the root. */
    static register(base: ReadonlyArray<DynamicModule>, integration: DynamicModule): DynamicModule {
        return { module: SandboxRoot, imports: [...base, integration] }
    }
}

const readJson = (text: string): unknown => {
    try {
        return JSON.parse(text) as unknown
    } catch {
        return text
    }
}

interface SandboxCookie {
    readonly name: string
    readonly value: string
    readonly domain: string
    readonly path: string
    readonly hostOnly: boolean
    readonly secure: boolean
}

const defaultCookiePath = (pathname: string): string => {
    if (!pathname.startsWith("/") || pathname === "/") return "/"
    const lastSlash = pathname.lastIndexOf("/")
    return lastSlash <= 0 ? "/" : pathname.slice(0, lastSlash)
}

const cookieMatches = (cookie: SandboxCookie, url: URL): boolean => {
    const hostMatches = cookie.hostOnly ? url.hostname === cookie.domain : url.hostname === cookie.domain || url.hostname.endsWith(`.${cookie.domain}`)
    const pathMatches = url.pathname === cookie.path || (url.pathname.startsWith(cookie.path) && (cookie.path.endsWith("/") || url.pathname[cookie.path.length] === "/"))
    return hostMatches && pathMatches && (!cookie.secure || url.protocol === "https:")
}

const storeCookies = (jar: Map<string, SandboxCookie>, url: URL, setCookies: ReadonlyArray<string>): void => {
    for (const line of setCookies) {
        const [pair, ...attributes] = line.split(";")
        if (pair === undefined) continue
        const separator = pair.indexOf("=")
        if (separator <= 0) continue
        const name = pair.slice(0, separator).trim()
        const value = pair.slice(separator + 1).trim()
        if (!name) continue
        let domain = url.hostname.toLowerCase()
        let hostOnly = true
        let path = defaultCookiePath(url.pathname)
        let secure = false
        let remove = false
        for (const attribute of attributes) {
            const [rawName, ...rawValue] = attribute.trim().split("=")
            const attributeName = rawName?.toLowerCase()
            const attributeValue = rawValue.join("=").trim()
            if (attributeName === "domain" && attributeValue) {
                const candidate = attributeValue.replace(/^\./, "").toLowerCase()
                if (url.hostname !== candidate && !url.hostname.endsWith(`.${candidate}`)) { domain = ""; break }
                domain = candidate
                hostOnly = false
            } else if (attributeName === "path" && attributeValue.startsWith("/")) path = attributeValue
            else if (attributeName === "secure") secure = true
            else if (attributeName === "max-age" && Number(attributeValue) <= 0) remove = true
            else if (attributeName === "expires" && Number.isFinite(Date.parse(attributeValue)) && Date.parse(attributeValue) <= Date.now()) remove = true
        }
        if (!domain) continue
        const key = `${domain}\n${path}\n${name}`
        if (remove) jar.delete(key)
        else jar.set(key, { name, value, domain, path, hostOnly, secure })
    }
}

const responseHeaders = (headers: Headers): Readonly<Record<string, string | ReadonlyArray<string>>> => {
    const result: Record<string, string | ReadonlyArray<string>> = {}
    for (const [name, value] of headers) result[name.toLowerCase()] = value
    const setCookies = headers.getSetCookie()
    if (setCookies.length > 0) result["set-cookie"] = setCookies
    return result
}

/** Builds the sandbox handle of one provider; nothing is booted until the described body runs. */
export const createSandbox = <T>(spec: SandboxSpec<T>, base: () => ReadonlyArray<DynamicModule>): SandboxHandle<T> => {
    const values: Record<string, string> = {}
    for (const key of spec.keys) {
        const value = process.env[key]
        if (value !== undefined && value !== "") values[key] = value
    }
    const missing = spec.keys.filter((key) => values[key] === undefined)
    const cookieJar = new Map<string, SandboxCookie>()
    let context: INestApplicationContext | null = null
    return {
        available: missing.length === 0,
        value: (key) => {
            const value = values[key]
            if (value === undefined) throw worldError(TestWorldErrorCode.NotDeclared, `the ${spec.provider} sandbox key ${key} is not declared`)
            return value
        },
        client: () => {
            if (context === null) throw worldError(TestWorldErrorCode.NotBooted, `the ${spec.provider} sandbox client was used outside its describe`)
            return context.get<T, T>(spec.client, { strict: false })
        },
        fetchJson: async (request) => {
            const response = await fetch(request.url, {
                method: request.method,
                headers: { ...(request.body === undefined ? {} : { "content-type": "application/json" }), ...request.headers },
                ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
                signal: AbortSignal.timeout(30_000),
            })
            return { status: response.status, body: readJson(await response.text()) }
        },
        request: async (request) => {
            if (request.form !== undefined && request.method !== "POST") throw new TypeError("sandbox form data requires POST")
            const url = new URL(request.url)
            const cookie = [...cookieJar.values()].filter((item) => cookieMatches(item, url)).map((item) => `${item.name}=${item.value}`).join("; ")
            const headers = new Headers(request.headers)
            if (cookie) headers.set("cookie", cookie)
            let body: string | undefined
            if (request.form !== undefined) {
                headers.set("content-type", "application/x-www-form-urlencoded")
                body = new URLSearchParams(request.form).toString()
            }
            const response = await fetch(url, { method: request.method, headers, ...(body === undefined ? {} : { body }), redirect: "manual", signal: AbortSignal.timeout(30_000) })
            storeCookies(cookieJar, url, response.headers.getSetCookie())
            return { status: response.status, headers: responseHeaders(response.headers), body: await response.text() }
        },
        describe: (name, body) => {
            if (missing.length > 0) {
                describe(name, () => {
                    it(`needs the ${spec.provider} sandbox keys: ${missing.join(", ")}`, () => {
                        throw worldError(TestWorldErrorCode.NotDeclared, `the ${spec.provider} sandbox keys are not declared in the environment: ${missing.join(", ")}`)
                    })
                })
                return
            }
            describe(name, () => {
                beforeAll(async () => {
                    context = await NestFactory.createApplicationContext(SandboxRoot.register(base(), spec.module(values, { isGlobal: true })), { logger: ["error"] })
                }, BOOT_TIMEOUT_MS)
                afterAll(async () => {
                    await context?.close()
                    context = null
                })
                body()
            })
        },
    }
}
