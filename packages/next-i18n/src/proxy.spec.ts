import assert from "node:assert/strict"
import test from "node:test"
import { NextRequest } from "next/server.js"
import { defineI18n } from "./config.ts"
import { DEFAULT_UNNEGOTIATED_ROOTS, createProxy, isUnnegotiated } from "./proxy.ts"

const i18n = defineI18n({ locales: ["vi", "en"], defaultLocale: "vi", timeZone: "UTC" })
const proxy = createProxy(i18n)

const request = (path: string, cookie?: string): NextRequest =>
    new NextRequest(`http://localhost:3000${path}`, cookie === undefined ? {} : { headers: { cookie } })

/** The headers next-intl and Next set to say what the proxy decided. */
const decision = (path: string, cookie?: string): { readonly rewrite: string | null; readonly redirect: string | null; readonly next: boolean } => {
    const response = proxy(request(path, cookie))
    return { rewrite: response.headers.get("x-middleware-rewrite"), redirect: response.headers.get("location"), next: response.headers.get("x-middleware-next") === "1" }
}

test("FE-I18N-1: the default locale is served at the bare path, rewritten to its [locale] form", () => {
    assert.equal(decision("/").rewrite, "http://localhost:3000/vi")
    assert.equal(decision("/orders").rewrite, "http://localhost:3000/vi/orders")
})

test("FE-I18N-1: a path that names a served locale passes through", () => {
    assert.equal(decision("/en/orders").rewrite, null)
    assert.equal(decision("/en/orders").next, true)
})

test("FE-I18N-1: the locale cookie decides the language of a bare path", () => {
    assert.equal(decision("/orders", "NEXT_LOCALE=en").redirect, "http://localhost:3000/en/orders")
})

test("the API, the health probe, the framework and any file with an extension are never negotiated", () => {
    for (const path of ["/api/graphql", "/health", "/_next/static/chunk.js", "/_vercel/insights", "/robots.txt", "/a/b/logo.svg"]) {
        const { rewrite, redirect, next } = decision(path)
        assert.equal(rewrite, null, path)
        assert.equal(redirect, null, path)
        assert.equal(next, true, path)
    }
    assert.deepEqual(DEFAULT_UNNEGOTIATED_ROOTS, ["api", "health", "_next", "_vercel"])
})

test("a path ending in a dot is not a file, and the roots the app lists replace the defaults", () => {
    assert.equal(isUnnegotiated("/page.", DEFAULT_UNNEGOTIATED_ROOTS), false)
    assert.equal(isUnnegotiated("/", DEFAULT_UNNEGOTIATED_ROOTS), false)
    assert.equal(isUnnegotiated("/hooks/stripe", ["hooks"]), true)
    const own = createProxy(i18n, { unnegotiatedRoots: ["hooks"] })
    assert.equal(own(request("/hooks/stripe")).headers.get("x-middleware-rewrite"), null)
    assert.equal(own(request("/api/x")).headers.get("x-middleware-rewrite"), "http://localhost:3000/vi/api/x")
})

test("the prefix mode never serves every path unprefixed, in the language of the cookie", () => {
    const never = createProxy(defineI18n({ locales: ["vi", "en"], defaultLocale: "vi", timeZone: "UTC", localePrefix: "never" }))
    assert.equal(never(request("/orders", "NEXT_LOCALE=en")).headers.get("x-middleware-rewrite"), "http://localhost:3000/en/orders")
})
