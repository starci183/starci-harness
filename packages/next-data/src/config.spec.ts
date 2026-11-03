import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { Middleware } from "swr"
import { viewerSwrConfig } from "./config.ts"
import { pollingRestart } from "./polling.ts"

describe("viewerSwrConfig", () => {
    it("keeps the app defaults and lists pollingRestart", () => {
        const config = viewerSwrConfig({ focusThrottleInterval: 30_000 })
        assert.equal(config.focusThrottleInterval, 30_000)
        assert.deepEqual(config.use, [pollingRestart])
    })

    it("puts pollingRestart after the middleware the app already lists", () => {
        const own: Middleware = (useSWRNext) => useSWRNext
        assert.deepEqual(viewerSwrConfig({ use: [own] }).use, [own, pollingRestart])
        assert.deepEqual(viewerSwrConfig().use, [pollingRestart])
    })

    it("gives every mount a cache of its own", () => {
        const config = viewerSwrConfig()
        const first = config.provider()
        first.set("KEY", { data: 1 })
        assert.notEqual(config.provider(), first)
        assert.equal(config.provider().get("KEY"), undefined)
        assert.deepEqual(first.get("KEY"), { data: 1 })
    })
})
