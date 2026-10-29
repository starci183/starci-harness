import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { Module } from "@nestjs/common"
import type { DynamicModule } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import type { TestingModule } from "@nestjs/testing"
import * as cli from "../src/gateway/cli.ts"
import * as gateway from "../src/gateway/index.ts"
import * as root from "../src/index.ts"
import { AI_ROUTER, AiRouterError, AiRouterModule, AiRouterService, getAiRouterServiceToken, getAiRouterToken, InjectAiRouter, InjectAiRouterService } from "../src/index.ts"
import type { AiRouter, AiRouterModuleOptions, PoolConfig, RouterEvents } from "../src/index.ts"
import * as testing from "../src/testing.ts"
import { AiRouterTestingModule, createFakeProvider } from "../src/testing.ts"
import type { FakeProvider } from "../src/testing.ts"
import { ask, provider } from "./helpers.ts"

/** A pool over one fake provider, at test-speed backoff. */
function pool(fake: FakeProvider, id = "a"): PoolConfig<"fast"> {
    return {
        providers: [provider(id, ["k1"], [{ id: "m1" }, { id: "e1", capabilities: ["embeddings"] }])],
        profiles: { fast: { model: "m1" } },
        fetch: fake.fetch,
        random: () => 0.5,
        resilience: { backoff: { baseMs: 1, maxMs: 2 } },
    }
}

function compile(...imports: DynamicModule[]): Promise<TestingModule> {
    return Test.createTestingModule({ imports }).compile()
}

/** A config module an async registration imports, the way an app's env module is imported. */
class ConfigHost {
    readonly role = "config"
}
const CONFIG = "CONFIG"
function configModule(options: AiRouterModuleOptions): DynamicModule {
    return { module: ConfigHost, providers: [{ provide: CONFIG, useValue: options }], exports: [CONFIG] }
}

/** A factory class for `useClass` and `useExisting`. */
class OptionsFactory {
    static options: AiRouterModuleOptions | undefined
    createAiRouterOptions(): AiRouterModuleOptions {
        assert.ok(OptionsFactory.options)
        return OptionsFactory.options
    }
}

/** A consumer that injects by the package's decorators, applied the way a compiler would. */
class Consumer {
    readonly router: AiRouter
    readonly service: AiRouterService
    constructor(router: AiRouter, service: AiRouterService) {
        this.router = router
        this.service = service
    }
}
InjectAiRouter("b")(Consumer, undefined, 0)
InjectAiRouterService("b")(Consumer, undefined, 1)

/** A feature module that holds a provider needing the default router. */
class FeatureHost {
    readonly role = "feature"
}
Module({})(FeatureHost)
function featureModule(): DynamicModule {
    return { module: FeatureHost, providers: [{ provide: "USES_ROUTER", inject: [AI_ROUTER], useFactory: (router: AiRouter) => router }], exports: ["USES_ROUTER"] }
}

describe("AiRouterModule.register", () => {
    test("provides the raw router and the service, and the service delegates through the pool", async () => {
        const fake = createFakeProvider()
        fake.on({}, { text: "hello" })
        fake.on({ path: "/embeddings" }, { embedding: [1, 2] })
        const app = await compile(AiRouterModule.register(pool(fake)))
        const service = app.get<AiRouterService<"fast">>(AiRouterService)
        const router = app.get<AiRouter>(AI_ROUTER)
        assert.equal(service.router, router)

        const reply = await service.chat(ask(), { profile: "fast" })
        assert.equal(reply.choices[0]?.message.content, "hello")
        const chunks: string[] = []
        for await (const chunk of service.stream(ask())) chunks.push(chunk.choices[0]?.delta.content ?? "")
        assert.equal(chunks.join(""), "hello")
        const embedded = await service.embeddings({ model: "e1", input: "x" })
        assert.deepEqual(embedded.data[0]?.embedding, [1, 2])

        assert.equal(service.stats().succeeded, 3)
        assert.equal((await service.health()).providers[0]?.id, "a")
        await service.reset()
        assert.equal(fake.calls.length, 3)
        assert.equal(fake.calls[0]?.key, "sk-a-k1")
        await app.close()
    })

    test("a caller's own signal still cancels a call", async () => {
        const fake = createFakeProvider()
        fake.on({}, { text: "late", latencyMs: 200 })
        const app = await compile(AiRouterModule.register(pool(fake)))
        const controller = new AbortController()
        const pending = app.get(AiRouterService).chat(ask(), { signal: controller.signal })
        controller.abort()
        await assert.rejects(pending, (error: unknown) => error instanceof AiRouterError && error.errorClass === "cancelled")
        await app.close()
    })

    test("a bad pool fails the module at init", async () => {
        await assert.rejects(compile(AiRouterModule.register({ providers: [] })))
    })

    test("handlers from options receive events until shutdown, with no key value", async () => {
        const fake = createFakeProvider()
        fake.on({}, { text: "ok" })
        const requests: RouterEvents["request"][] = []
        const attempts: RouterEvents["attempt"][] = []
        const app = await compile(
            AiRouterModule.register({ ...pool(fake), on: { request: (event) => requests.push(event), attempt: (event) => attempts.push(event), breaker: () => undefined, "key-disabled": () => undefined } }),
        )
        const service = app.get(AiRouterService)
        const extra: string[] = []
        const unsubscribe = service.on("request", (event) => extra.push(event.outcome))
        await service.chat(ask())
        unsubscribe()
        await service.chat(ask())
        assert.equal(requests.length, 2)
        assert.equal(attempts.length, 2)
        assert.deepEqual(extra, ["success"])
        assert.ok(!JSON.stringify([requests, attempts]).includes("sk-a-k1"))

        const router = app.get<AiRouter>(AI_ROUTER)
        await app.close()
        await router.chat(ask())
        assert.equal(requests.length, 2)
    })

    test("shutdown aborts a stream in flight and every later call through the service", async () => {
        const fake = createFakeProvider()
        fake.on({}, { stream: { chunks: ["a", "b", "c"], delayMs: 30 } })
        const app = await compile(AiRouterModule.register(pool(fake)))
        const service = app.get(AiRouterService)
        let closing: Promise<void> | undefined
        const seen: string[] = []
        await assert.rejects(
            (async () => {
                for await (const chunk of service.stream(ask())) {
                    seen.push(chunk.choices[0]?.delta.content ?? "")
                    closing ??= app.close()
                }
            })(),
            (error: unknown) => error instanceof AiRouterError && error.errorClass === "cancelled",
        )
        await closing
        assert.deepEqual(seen.filter((piece) => piece !== ""), ["a"])
        await assert.rejects(service.chat(ask()), (error: unknown) => error instanceof AiRouterError && error.errorClass === "cancelled")
    })
})

describe("AiRouterModule.registerAsync", () => {
    test("useFactory with an injected config provider", async () => {
        const fake = createFakeProvider()
        fake.on({}, { text: "from factory" })
        const app = await compile(
            AiRouterModule.registerAsync({
                imports: [configModule(pool(fake))],
                inject: [CONFIG],
                useFactory: (config: AiRouterModuleOptions) => config,
            }),
        )
        const reply = await app.get(AiRouterService).chat(ask())
        assert.equal(reply.choices[0]?.message.content, "from factory")
        await app.close()
    })

    test("useClass and useExisting call createAiRouterOptions", async () => {
        const fake = createFakeProvider()
        fake.on({}, { text: "from class" })
        OptionsFactory.options = pool(fake)
        const byClass = await compile(AiRouterModule.registerAsync({ useClass: OptionsFactory }))
        assert.equal((await byClass.get(AiRouterService).chat(ask())).choices[0]?.message.content, "from class")
        await byClass.close()

        const existing: DynamicModule = { module: ConfigHost, providers: [OptionsFactory], exports: [OptionsFactory] }
        const byExisting = await compile(AiRouterModule.registerAsync({ imports: [existing], useExisting: OptionsFactory }))
        assert.equal((await byExisting.get(AiRouterService).chat(ask())).choices[0]?.message.content, "from class")
        await byExisting.close()
    })
})

describe("visibility and names", () => {
    test("a global registration reaches a feature module that does not import it", async () => {
        const fake = createFakeProvider()
        const app = await compile(AiRouterModule.register({ ...pool(fake), isGlobal: true }), featureModule())
        assert.equal(app.get("USES_ROUTER"), app.get(AI_ROUTER))
        await app.close()
    })

    test("a scoped registration does not reach a feature module that does not import it", async () => {
        const fake = createFakeProvider()
        await assert.rejects(compile(AiRouterModule.register(pool(fake)), featureModule()))
    })

    test("named instances hold separate pools, injected by name", async () => {
        const fakeA = createFakeProvider()
        fakeA.on({}, { text: "from a" })
        const fakeB = createFakeProvider()
        fakeB.on({}, { text: "from b" })
        const app = await Test.createTestingModule({
            imports: [
                AiRouterModule.register({ ...pool(fakeA, "a"), name: "a", isGlobal: true }),
                AiRouterModule.registerAsync({ name: "b", isGlobal: true, useFactory: () => pool(fakeB, "b") }),
            ],
            providers: [Consumer],
        }).compile()
        const consumer = app.get(Consumer)
        assert.equal(consumer.router, app.get(getAiRouterToken("b")))
        assert.equal(consumer.service, app.get(getAiRouterServiceToken("b")))
        assert.notEqual(app.get(getAiRouterToken("a")), consumer.router)
        assert.equal((await consumer.service.chat(ask())).choices[0]?.message.content, "from b")
        const serviceA = app.get<AiRouterService>(getAiRouterServiceToken("a"))
        assert.equal((await serviceA.chat(ask())).choices[0]?.message.content, "from a")
        assert.equal(fakeA.calls.length, 1)
        assert.equal(fakeB.calls.length, 1)
        assert.throws(() => app.get(AI_ROUTER))
        await app.close()
    })

    test("tokens name the default and named instances", () => {
        assert.equal(getAiRouterToken(), AI_ROUTER)
        assert.equal(getAiRouterToken("x"), "AI_ROUTER:x")
        assert.equal(getAiRouterServiceToken(), AiRouterService)
        assert.equal(getAiRouterServiceToken("x"), "AiRouterService:x")
    })
})

describe("AiRouterTestingModule", () => {
    test("registers the router over a fake provider, with the real module's extras", async () => {
        const fake = createFakeProvider()
        fake.on({}, { text: "faked" })
        const app = await compile(AiRouterTestingModule.register({ fake, name: "t", isGlobal: true, providers: [provider("a", ["k1"], [{ id: "m1" }])] }))
        const service = app.get<AiRouterService>(getAiRouterServiceToken("t"))
        assert.equal((await service.chat(ask())).choices[0]?.message.content, "faked")
        assert.equal(fake.calls[0]?.key, "sk-a-k1")
        assert.throws(() => app.get(AI_ROUTER))
        await app.close()
    })
})

describe("the package entries", () => {
    test("the gateway entry exports the Nest-free router, gateway and key stores", () => {
        const names = ["AiRouterError", "KEY_STORE_SCHEMA", "KeyAdmin", "KeyAdminError", "MemoryKeyStore", "MountedKeyError", "createGateway", "createRouter", "loadGatewayConfig", "openKeyStore", "openSqliteKeyStore", "parseGatewayConfig", "serveGateway"]
        assert.deepEqual(Object.keys(gateway).sort(), names.sort())
    })

    test("the cli entry exports the command runner only", () => {
        assert.deepEqual(Object.keys(cli), ["main"])
    })

    test("the root exports the Nest API plus everything of the gateway entry", () => {
        const nest = ["AI_ROUTER", "AI_ROUTER_GATEWAY", "AiRouterGatewayModule", "AiRouterModule", "AiRouterService", "InjectAiRouter", "InjectAiRouterGateway", "InjectAiRouterService", "getAiRouterGatewayToken", "getAiRouterServiceToken", "getAiRouterToken"]
        assert.deepEqual(Object.keys(root).sort(), [...nest, ...Object.keys(gateway)].sort())
    })

    test("the testing entry exports the fake provider and the testing module", () => {
        assert.deepEqual(Object.keys(testing).sort(), ["AiRouterTestingModule", "createFakeProvider"])
    })
})
