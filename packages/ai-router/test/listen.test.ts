import assert from "node:assert/strict"
import { createServer } from "node:http"
import type { Server } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, test } from "node:test"
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

/** A fresh, unbound app server, and a port for it whose next port is free too, so `+1` is bindable. */
async function appServer(): Promise<{ server: Server; port: number }> {
    for (;;) {
        const first = createServer()
        await bind(first, 0)
        const port = (first.address() as AddressInfo).port
        const probe = createServer()
        try {
            await bind(probe, port + 1)
            await shut(probe)
            await shut(first)
            return { server: createServer(), port }
        } catch {
            await shut(first)
        }
    }
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
    test("true waits for the app to listen, then serves on app port + 1 on 127.0.0.1", async () => {
        const { server, port } = await appServer()
        const before = server.listenerCount("listening")
        const moduleRef = await compile(true, server)
        await moduleRef.init()
        assert.equal(server.listenerCount("listening"), before + 1)
        await bind(server, port)
        await served(port + 1)
        const gateway = moduleRef.get<AiRouterGateway>(getAiRouterGatewayToken())
        const { secret } = await gateway.admin.create({ label: "derived", models: ["m1"] })
        assert.equal((await http(`http://127.0.0.1:${String(port + 1)}`, "/v1/chat/completions", { key: secret, body: chatBody("m1") })).status, 200)
        await moduleRef.close()
        await shut(server)
    })

    test("an app already listening is read at once, and the offset is added", async () => {
        const { server, port } = await appServer()
        await bind(server, port)
        const errors: unknown[] = []
        const moduleRef = await compile({ offset: 1 }, server, errors)
        await moduleRef.init()
        await served(port + 1)
        assert.deepEqual(errors, [])
        await moduleRef.close()
        await shut(server)
    })

    test("an explicit port still wins over the app's", async () => {
        const { server, port } = await appServer()
        await bind(server, port)
        const other = await appServer()
        const moduleRef = await compile({ port: other.port }, server)
        await moduleRef.init()
        await served(other.port)
        await moduleRef.close()
        await shut(server)
    })

    test("a gateway port already taken is reported to onError, not thrown", async () => {
        let { server, port } = await appServer()
        const blocker = createServer()
        for (;;) {
            try {
                await bind(blocker, port + 1)
                break
            } catch {
                ;({ server, port } = await appServer())
            }
        }
        await bind(server, port)
        const errors: unknown[] = []
        const moduleRef = await compile(true, server, errors)
        await moduleRef.init()
        for (let i = 0; i < 100 && errors.length === 0; i += 1) await pause(20)
        assert.match((errors[0] as Error).message, /EADDRINUSE/)
        await moduleRef.close()
        await shut(blocker)
        await shut(server)
    })

    test("closing before the app listens cancels the wait", async () => {
        const { server, port } = await appServer()
        const before = server.listenerCount("listening")
        const moduleRef = await compile(true, server)
        await moduleRef.init()
        assert.equal(server.listenerCount("listening"), before + 1)
        await moduleRef.close()
        assert.equal(server.listenerCount("listening"), before)
        await bind(server, port)
        await shut(server)
    })

    test("with no HTTP server it uses PORT, and refuses without it", async () => {
        const saved = process.env.PORT
        try {
            const { port } = await appServer()
            process.env.PORT = String(port)
            const moduleRef = await compile(true, undefined)
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
