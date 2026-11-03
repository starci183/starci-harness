import "reflect-metadata"
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { Module } from "@nestjs/common"
import type { DynamicModule } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import { OBJECT_STORAGE, ObjectStorageModule } from "./index.ts"
import type { ObjectStorage } from "./index.ts"
import { createMemoryObjectStorage, objectStorageTestingModule, testObjectStorageOptions } from "./testing/index.ts"

const OPTIONS = Symbol("app.storage.options")

/** What a domain service holds: the port, injected by token. */
class Consumer {
    readonly storage: ObjectStorage

    constructor(storage: ObjectStorage) {
        this.storage = storage
    }
}

const consumerModule = (imports: DynamicModule[]): DynamicModule => {
    class ConsumerModule {
        readonly kind = "consumer"
    }
    Module({})(ConsumerModule)
    return { module: ConsumerModule, imports, providers: [{ provide: Consumer, inject: [OBJECT_STORAGE], useFactory: (storage: ObjectStorage): Consumer => new Consumer(storage) }], exports: [Consumer] }
}

describe("ObjectStorageModule", () => {
    it("registers the port from typed options, signing for the public origin", async () => {
        const app = await Test.createTestingModule({
            imports: [
                consumerModule([
                    ObjectStorageModule.register({ ...testObjectStorageOptions(), publicEndpoint: "https://files.example.com", isGlobal: false }),
                ]),
            ],
        }).compile()
        const storage = app.get(Consumer).storage
        const request = await storage.presignGet("media", "k.txt")
        assert.equal(new URL(request.url).origin, "https://files.example.com")
        assert.equal(new URL(request.url).searchParams.get("X-Amz-Expires"), "300")
        await app.close()
    })

    it("registers asynchronously, from a factory over the app's own providers, and globally", async () => {
        class SettingsModule {
            readonly kind = "settings"
        }
        Module({ providers: [{ provide: OPTIONS, useValue: testObjectStorageOptions({ defaultExpiresIn: 42 }) }], exports: [OPTIONS] })(SettingsModule)
        const storageModule = ObjectStorageModule.registerAsync({
            isGlobal: true,
            imports: [SettingsModule],
            inject: [OPTIONS],
            useFactory: (options: ReturnType<typeof testObjectStorageOptions>) => options,
        })
        const app = await Test.createTestingModule({ imports: [storageModule, consumerModule([])] }).compile()
        assert.equal((await app.get(Consumer).storage.presignGet("media", "k")).expiresIn, 42)
        await app.close()
    })

    it("closes the S3 clients when the app shuts down", async () => {
        const app = await Test.createTestingModule({ imports: [ObjectStorageModule.register({ ...testObjectStorageOptions(), isGlobal: true })] }).compile()
        await app.init()
        const storage = app.get<ObjectStorage>(OBJECT_STORAGE)
        assert.equal(typeof (storage as { onModuleDestroy?: unknown }).onModuleDestroy, "function")
        await app.close()
    })
})

describe("objectStorageTestingModule", () => {
    it("provides the in-memory port under the same token", async () => {
        const memory = createMemoryObjectStorage()
        const app = await Test.createTestingModule({ imports: [objectStorageTestingModule(memory), consumerModule([])] }).compile()
        assert.equal(app.get(Consumer).storage, memory)
        await app.close()
    })

    it("defaults to a fresh store", () => {
        assert.equal(objectStorageTestingModule().global, true)
    })
})
