import "reflect-metadata"
import assert from "node:assert/strict"
import { test } from "node:test"
import { Module } from "@nestjs/common"
import type { DynamicModule } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import { defineCapabilityModule, defineConfigurableModule } from "./index.ts"

interface ClockOptions {
    readonly zone: string
}

const plain = defineConfigurableModule<ClockOptions>()
const capability = defineCapabilityModule<ClockOptions>()
const NAMED = Symbol("CLOCK_OPTIONS")
const named = defineCapabilityModule<ClockOptions>({ optionsInjectionToken: NAMED })

class PlainModule extends plain.ConfigurableModuleClass {}
Module({})(PlainModule)

class CapabilityModule extends capability.ConfigurableModuleClass {}
Module({})(CapabilityModule)

class NamedModule extends named.ConfigurableModuleClass {}
Module({})(NamedModule)

test("a plain definition registers synchronously and provides the options under its token", async () => {
    const module = await Test.createTestingModule({ imports: [PlainModule.register({ zone: "UTC" })] }).compile()
    assert.deepEqual(module.get(plain.MODULE_OPTIONS_TOKEN, { strict: false }), { zone: "UTC" })
})

test("a plain definition registers asynchronously", async () => {
    const module = await Test.createTestingModule({ imports: [PlainModule.registerAsync({ useFactory: () => ({ zone: "Asia/Saigon" }) })] }).compile()
    assert.deepEqual(module.get(plain.MODULE_OPTIONS_TOKEN, { strict: false }), { zone: "Asia/Saigon" })
})

test("a plain definition is never global and takes no isGlobal", () => {
    const registered: DynamicModule = PlainModule.register({ zone: "UTC" })
    assert.equal(registered.global, undefined)
    assert.equal(registered.module, PlainModule)
})

test("a capability is local by default and global when the app root says so", () => {
    assert.equal(CapabilityModule.register({ zone: "UTC" }).global, false)
    assert.equal(CapabilityModule.register({ zone: "UTC", isGlobal: true }).global, true)
    assert.equal(CapabilityModule.registerAsync({ useFactory: () => ({ zone: "UTC" }), isGlobal: true }).global, true)
})

test("a capability can name the token its options are provided under", async () => {
    assert.equal(named.MODULE_OPTIONS_TOKEN, NAMED)
    const module = await Test.createTestingModule({ imports: [NamedModule.register({ zone: "UTC" })] }).compile()
    assert.deepEqual(module.get(NAMED, { strict: false }), { zone: "UTC" })
})

test("the exports state their types", () => {
    const options: typeof plain.OPTIONS_TYPE = { zone: "UTC" }
    const global: typeof capability.OPTIONS_TYPE = { zone: "UTC", isGlobal: true }
    const asyncOptions: typeof plain.ASYNC_OPTIONS_TYPE = { useFactory: () => ({ zone: "UTC" }) }
    assert.equal(options.zone, global.zone)
    assert.equal(typeof asyncOptions.useFactory, "function")
})
