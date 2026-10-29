import "reflect-metadata"
import assert from "node:assert/strict"
import test from "node:test"
import { Injectable, Module } from "@nestjs/common"
import type { DynamicModule } from "@nestjs/common"
import { TestWorldError, TestWorldErrorCode } from "../errors"
import { createSandbox } from "./sandbox"

@Injectable()
class ProviderClient {
    readonly name = "provider"
}

@Module({})
class ProviderModule {
    static register(): DynamicModule {
        return { module: ProviderModule, providers: [ProviderClient], exports: [ProviderClient] }
    }
}

const spec = { provider: "acme", keys: ["ACME_SANDBOX_URL", "ACME_SANDBOX_KEY"], module: () => ProviderModule.register(), client: ProviderClient } as const

interface Registered {
    readonly kind: "describe" | "it" | "beforeAll" | "afterAll"
    readonly name: string
    readonly run: () => unknown
}

/** Runs `work` with the jest globals the helper registers through replaced by recorders; answers what was registered in order. */
const withJestGlobals = (work: () => void): ReadonlyArray<Registered> => {
    const hooks = globalThis as unknown as Record<string, unknown>
    const names = ["describe", "it", "beforeAll", "afterAll"] as const
    const saved = names.map((name) => [name, hooks[name]] as const)
    const registered: Array<Registered> = []
    const record = (kind: Registered["kind"]) => (nameOrRun: string | (() => unknown), run?: () => unknown) => {
        registered.push({ kind, name: typeof nameOrRun === "string" ? nameOrRun : "", run: typeof nameOrRun === "string" ? (run ?? (() => undefined)) : nameOrRun })
        if (kind === "describe") registered[registered.length - 1]?.run()
    }
    for (const name of names) hooks[name] = record(name)
    try {
        work()
    } finally {
        for (const [name, value] of saved) hooks[name] = value
    }
    return registered
}

const withKeys = (values: Readonly<Record<string, string | undefined>>, work: () => void): void => {
    const saved = Object.keys(values).map((key) => [key, process.env[key]] as const)
    for (const [key, value] of Object.entries(values)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
    }
    try {
        work()
    } finally {
        for (const [key, value] of saved) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
        }
    }
}

test("a sandbox whose keys are missing registers a failing test that names them, and never runs the body", () => {
    withKeys({ ACME_SANDBOX_URL: "https://sandbox.example", ACME_SANDBOX_KEY: undefined }, () => {
        const sandbox = createSandbox(spec, () => [])
        assert.equal(sandbox.available, false)
        let bodyRan = false
        const registered = withJestGlobals(() => sandbox.describe("acme contract", () => void (bodyRan = true)))
        assert.equal(bodyRan, false)
        assert.deepEqual(registered.map((entry) => `${entry.kind}:${entry.name}`), ["describe:acme contract", "it:needs the acme sandbox keys: ACME_SANDBOX_KEY"])
        assert.throws(registered[1]?.run ?? (() => undefined), (error: unknown) => error instanceof TestWorldError && error.code === TestWorldErrorCode.NotDeclared && error.message.includes("ACME_SANDBOX_KEY") && !error.message.includes("ACME_SANDBOX_URL"))
    })
})

test("a configured sandbox runs the body inside a describe that boots and closes the client around it", () => {
    withKeys({ ACME_SANDBOX_URL: "https://sandbox.example", ACME_SANDBOX_KEY: "k" }, () => {
        const sandbox = createSandbox(spec, () => [])
        assert.equal(sandbox.available, true)
        assert.equal(sandbox.value("ACME_SANDBOX_KEY"), "k")
        let bodyRan = false
        const registered = withJestGlobals(() => sandbox.describe("acme contract", () => void (bodyRan = true)))
        assert.equal(bodyRan, true)
        assert.deepEqual(registered.map((entry) => entry.kind), ["describe", "beforeAll", "afterAll"])
    })
})

test("sandbox requests preserve cookies per handle, return redirects, and encode POST forms", async () => {
    const originalFetch = globalThis.fetch
    const calls: Array<{ url: string; init: RequestInit }> = []
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        const actual = init ?? {}
        calls.push({ url, init: actual })
        if (url.endsWith("/login")) return new Response("redirect body", { status: 302, headers: { location: "/form", "set-cookie": "sid=abc; Path=/; HttpOnly" } })
        return new Response("done", { status: 200, headers: { "content-type": "text/plain" } })
    }) as typeof fetch
    try {
        const first = createSandbox(spec, () => [])
        const second = createSandbox(spec, () => [])
        const redirect = await first.request({ method: "GET", url: "https://sandbox.example/login" })
        assert.equal(redirect.status, 302)
        assert.equal(redirect.headers.location, "/form")
        assert.deepEqual(redirect.headers["set-cookie"], ["sid=abc; Path=/; HttpOnly"])
        assert.equal(redirect.body, "redirect body")
        assert.equal(calls[0]?.init.redirect, "manual")
        await first.request({ method: "POST", url: "https://sandbox.example/form", form: { username: "a b", password: "p&x" } })
        await second.request({ method: "GET", url: "https://sandbox.example/form" })
        assert.equal(new Headers(calls[1]?.init.headers).get("cookie"), "sid=abc")
        assert.equal(new Headers(calls[1]?.init.headers).get("content-type"), "application/x-www-form-urlencoded")
        assert.equal(calls[1]?.init.body, "username=a+b&password=p%26x")
        assert.equal(new Headers(calls[2]?.init.headers).has("cookie"), false)
    } finally {
        globalThis.fetch = originalFetch
    }
})
