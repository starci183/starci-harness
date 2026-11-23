import assert from "node:assert/strict"
import { createServer } from "node:http"
import type { Server } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, test } from "node:test"
import type { TestContext } from "node:test"
import { HttpAdapterHost } from "@nestjs/core"
import { Test } from "@nestjs/testing"
import type { TestingModule } from "@nestjs/testing"
import { gatewayHost, gatewayPort } from "../src/ai-router-gateway.listen.ts"
import { AiRouterGatewayModule, getAiRouterGatewayToken } from "../src/ai-router-gateway.module.ts"
import type { AiRouterGatewayModuleOptions } from "../src/ai-router-gateway.module-definition.ts"
import { AiRouterTestingModule } from "../src/ai-router-testing.module.ts"
import { AiRouterError } from "../src/errors.ts"
import { createFakeProvider } from "../src/fake.ts"
import type { AiRouterGateway } from "../src/gateway/gateway.ts"
import { MemoryKeyStore } from "../src/gateway/keys.ts"
import { chatBody, http } from "./fixtures/gateway-helpers.ts"

/** A Nest testing module whose HTTP adapter fronts `server`, the way an application created on an HTTP platform does. */
async function compile(listen: AiRouterGatewayModuleOptions["listen"], server: unknown, errors: unknown[] = []): Promise<TestingModule> {
    const fake = createFakeProvider()
    const moduleRef = await Test.createTestingModule({
        imports: [
            AiRouterTestingModule.register({ fake, isGlobal: true, providers: [{ id: "a", baseUrl: "https://a.test/v1", keys: [{ alias: "k", resolve: () => "sk-a" }], models: [{ id: "m1" }] }] }),
            AiRouterGatewayModule.register({
                keys: new MemoryKeyStore(),
                ...(listen === undefined ? {} : { listen }),
                onError: (error) => {
                    errors.push(error)
                },
            }),
        ],
    }).compile()
    if (server !== undefined) moduleRef.get(HttpAdapterHost).httpAdapter = { getHttpServer: () => server } as never
    return moduleRef
}

function bind(server: Server, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
        server.once("error", reject)
        server.listen(port, "127.0.0.1", () => {
            server.off("error", reject)
            resolve()
        })
    })
}

function shut(server: Server): Promise<void> {
    return new Promise((resolve) => {
        server.close(() => {
            resolve()
        })
    })
}

function pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * A fresh, unbound app server and a port for it whose next port is free too, so `+1` is bindable. Both ports stay held by placeholders until
 * the test hands them over (`freeApp` before the app binds `port`, `freeGateway` before the gateway binds `port + 1`): the test files run in
 * parallel processes, and a port let go early is taken by another file's server (EADDRINUSE). Whatever the test leaves open is closed after
 * it, a failed one too, so a red assertion reports instead of keeping the file's process alive.
 */
async function appServer(t: TestContext): Promise<{ server: Server; port: number; freeApp: () => Promise<void>; freeGateway: () => Promise<void> }> {
    for (;;) {
        const first = createServer()
        await bind(first, 0)
        const port = (first.address() as AddressInfo).port
        const probe = createServer()
        try {
            await bind(probe, port + 1)
        } catch {
            await shut(first)
            continue
        }
        const server = createServer()
        t.after(async () => {
            await Promise.all([first, probe, server].map(async (open) => (open.listening ? shut(open) : undefined)))
        })
        return { server, port, freeApp: () => shut(first), freeGateway: () => shut(probe) }
    }
}

/** Compiles the module and closes it after the test, a failed one too (closing twice is harmless). */
async function compiled(t: TestContext, ...args: Parameters<typeof compile>): Promise<TestingModule> {
    const moduleRef = await compile(...args)
    t.after(() => moduleRef.close())
    return moduleRef
}

async function health(port: number): Promise<number> {
    return (await http(`http://127.0.0.1:${String(port)}`, "/health")).status
}

/** Waits until the gateway answers on `port`. */
async function served(port: number): Promise<void> {
    for (let i = 0; i < 100; i += 1) {
        if ((await health(port).catch(() => 0)) === 200) return
        await pause(20)
    }
    assert.fail(`nothing serves on ${String(port)}`)
}

/** Bootstrapping over `server` is refused with `pattern`; the module is closed after. */
async function refused(server: unknown, pattern: RegExp): Promise<void> {
    const moduleRef = await compile(true, server)
    try {
        await assert.rejects(moduleRef.init(), (error: unknown) => error instanceof AiRouterError && pattern.test(error.message))
    } finally {
        await moduleRef.close()
    }
}

describe("gatewayPort and gatewayHost", () => {
    test("an explicit port wins, true and an empty offset mean +1, an offset is added", () => {
        assert.equal(gatewayPort({ port: 9000 }, 3001), 9000)
        assert.equal(gatewayPort({ port: 9000 }, undefined), 9000)
        assert.equal(gatewayPort(true, 3001), 3002)
        assert.equal(gatewayPort({}, 3001), 3002)
        assert.equal(gatewayPort({ offset: 10 }, 3000), 3010)
    })

    test("refuses an unknown app port, a bad offset and a port past 65535", () => {
        assert.throws(
            () => gatewayPort(true, undefined),
            (error: unknown) => error instanceof AiRouterError && error.message.includes('no known port'),
        )
        assert.throws(() => gatewayPort({ offset: 0 }, 3001), /offset/)
        assert.throws(() => gatewayPort({ offset: 1.5 }, 3001), /offset/)
        assert.throws(() => gatewayPort(true, 65535), /not a port number/)
    })

    test("the host is the caller's, or left to the gateway's 127.0.0.1", () => {
        assert.equal(gatewayHost(true), undefined)
        assert.equal(gatewayHost({}), undefined)
        assert.equal(gatewayHost({ offset: 1, host: "::1" }), "::1")
    })
})

describe("AiRouterGatewayModule listen derived from the app port", () => {
    test("true waits for the app to listen, then serves on app port + 1 on 127.0.0.1", async (t) => {
        const { server, port, freeApp, freeGateway } = await appServer(t)
        const before = server.listenerCount("listening")
        const moduleRef = await compiled(t, true, server)
        await moduleRef.init()
        assert.equal(server.listenerCount("listening"), before + 1)
        await freeGateway()
        await freeApp()
        await bind(server, port)
        await served(port + 1)
        const gateway = moduleRef.get<AiRouterGateway>(getAiRouterGatewayToken())
        const { secret } = await gateway.admin.create({ label: "derived", models: ["m1"] })
        assert.equal((await http(`http://127.0.0.1:${String(port + 1)}`, "/v1/chat/completions", { key: secret, body: chatBody("m1") })).status, 200)
    })

    test("an app already listening is read at once, and the offset is added", async (t) => {
        const { server, port, freeApp, freeGateway } = await appServer(t)
        await freeApp()
        await bind(server, port)
        const errors: unknown[] = []
        const moduleRef = await compiled(t, { offset: 1 }, server, errors)
        await freeGateway()
        await moduleRef.init()
        await served(port + 1)
        assert.deepEqual(errors, [])
    })

    test("an explicit port still wins over the app's", async (t) => {
        const { server, port, freeApp } = await appServer(t)
        await freeApp()
        await bind(server, port)
        const other = await appServer(t)
        const moduleRef = await compiled(t, { port: other.port }, server)
        await other.freeApp()
        await moduleRef.init()
        await served(other.port)
    })

    test("a gateway port already taken is reported to onError, not thrown", async (t) => {
        const { server, port, freeApp, freeGateway } = await appServer(t)
        const blocker = createServer()
        t.after(async () => (blocker.listening ? shut(blocker) : undefined))
        await freeGateway()
        await bind(blocker, port + 1)
        await freeApp()
        await bind(server, port)
        const errors: unknown[] = []
        const moduleRef = await compiled(t, true, server, errors)
        await moduleRef.init()
        for (let i = 0; i < 100 && errors.length === 0; i += 1) await pause(20)
        assert.match((errors[0] as Error).message, /EADDRINUSE/)
    })

    test("closing before the app listens cancels the wait", async (t) => {
        const { server, port, freeApp } = await appServer(t)
        const before = server.listenerCount("listening")
        const moduleRef = await compile(true, server)
        await moduleRef.init()
        assert.equal(server.listenerCount("listening"), before + 1)
        await moduleRef.close()
        assert.equal(server.listenerCount("listening"), before)
        await freeApp()
        await bind(server, port)
    })

    test("with no HTTP server it uses PORT, and refuses without it", async (t) => {
        const saved = process.env.PORT
        try {
            const { port, freeGateway } = await appServer(t)
            process.env.PORT = String(port)
            const moduleRef = await compiled(t, true, undefined)
            await freeGateway()
            await moduleRef.init()
            await served(port + 1)
            await moduleRef.close()
            delete process.env.PORT
            await refused(undefined, /PORT is not set/)
            process.env.PORT = "http"
            await refused(undefined, /PORT is not set/)
            process.env.PORT = "70000"
            await refused(undefined, /PORT is not set/)
        } finally {
            if (saved === undefined) delete process.env.PORT
            else process.env.PORT = saved
        }
    })

    test("a server on a pipe has no TCP port to derive from", async () => {
        const pipe = { listening: true, address: () => "/tmp/app.sock", once: () => undefined, off: () => undefined }
        await refused(pipe, /not on a TCP port/)
    })

    test("a server that listens on a pipe later starts nothing", async () => {
        let fire: () => void = () => undefined
        const pipe = {
            listening: false,
            address: () => "/tmp/app.sock",
            once: (_event: string, listener: () => void) => {
                fire = listener
            },
            off: () => undefined,
        }
        const moduleRef = await compile(true, pipe)
        await moduleRef.init()
        fire()
        await moduleRef.close()
    })
})
