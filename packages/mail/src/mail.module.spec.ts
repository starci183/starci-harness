import "reflect-metadata"
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { Module } from "@nestjs/common"
import type { DynamicModule } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import { MAILER, MailModule, MailService } from "./index.ts"
import type { Mailer } from "./index.ts"
import { createMemoryMailer, mailTestingModule, testMailOptions } from "./testing/index.ts"

const OPTIONS = Symbol("app.mail.options")

/** What a domain service holds: the port, injected by token. */
class Consumer {
    readonly mailer: Mailer

    constructor(mailer: Mailer) {
        this.mailer = mailer
    }
}

const consumerModule = (imports: DynamicModule[]): DynamicModule => {
    class ConsumerModule {
        readonly kind = "consumer"
    }
    Module({})(ConsumerModule)
    return { module: ConsumerModule, imports, providers: [{ provide: Consumer, inject: [MAILER], useFactory: (mailer: Mailer): Consumer => new Consumer(mailer) }], exports: [Consumer] }
}

describe("MailModule", () => {
    it("registers the port from typed options and validates before it ever connects", async () => {
        const app = await Test.createTestingModule({ imports: [consumerModule([MailModule.register({ ...testMailOptions(), isGlobal: false })])] }).compile()
        const mailer = app.get(Consumer).mailer
        assert.ok(mailer instanceof MailService)
        await assert.rejects(mailer.send({ to: "nope", message: { subject: "s", text: "t" } }), { code: "MAIL_ADDRESS_INVALID" })
        await app.close()
    })

    it("registers asynchronously, from a factory over the app's own providers, and globally", async () => {
        class SettingsModule {
            readonly kind = "settings"
        }
        Module({ providers: [{ provide: OPTIONS, useValue: testMailOptions({ maxRecipients: 1 }) }], exports: [OPTIONS] })(SettingsModule)
        const mailModule = MailModule.registerAsync({
            isGlobal: true,
            imports: [SettingsModule],
            inject: [OPTIONS],
            useFactory: (options: ReturnType<typeof testMailOptions>) => options,
        })
        const app = await Test.createTestingModule({ imports: [mailModule, consumerModule([])] }).compile()
        await assert.rejects(app.get(Consumer).mailer.send({ to: ["a@x.test", "b@x.test"], message: { subject: "s", text: "t" } }), { code: "MAIL_MESSAGE_INVALID" })
        await app.close()
    })

    it("refuses options that cannot work when the app boots", async () => {
        await assert.rejects(Test.createTestingModule({ imports: [consumerModule([MailModule.register({ ...testMailOptions(), port: 0, isGlobal: false })])] }).compile(), RangeError)
    })

    it("closes the connection when the app shuts down", async () => {
        const app = await Test.createTestingModule({ imports: [MailModule.register({ ...testMailOptions(), isGlobal: true })] }).compile()
        await app.init()
        assert.equal(typeof app.get<MailService>(MAILER).onModuleDestroy, "function")
        await app.close()
    })
})

describe("mailTestingModule", () => {
    it("provides the in-memory outbox under the same token", async () => {
        const memory = createMemoryMailer()
        const app = await Test.createTestingModule({ imports: [mailTestingModule(memory), consumerModule([])] }).compile()
        await app.get(Consumer).mailer.send({ to: "ada@example.com", message: { subject: "Hi", text: "Body" } })
        assert.equal(memory.lastTo("ada@example.com")?.subject, "Hi")
        await app.close()
    })

    it("defaults to a fresh outbox", () => {
        assert.equal(mailTestingModule().global, true)
    })
})
