import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { Arguments, ScopedMutator } from "swr"
import { createViewerCache } from "./viewer-cache.ts"

/** A mutator that records what it was asked and answers the value it was given. */
const recording = (): { readonly mutator: ScopedMutator; readonly calls: unknown[][] } => {
    const calls: unknown[][] = []
    const mutator = ((...args: unknown[]) => {
        calls.push(args)
        return Promise.resolve(args[1])
    }) as unknown as ScopedMutator
    return { mutator, calls }
}

describe("createViewerCache", () => {
    it("answers undefined and writes nothing while no cache is bound", async () => {
        const cache = createViewerCache()
        assert.equal(await cache.mutate("KEY", "value"), undefined)
    })

    it("forwards a key, a key list and a key test to the bound cache", async () => {
        const cache = createViewerCache()
        const { mutator, calls } = recording()
        cache.bind(mutator)
        const matcher = (key?: Arguments): boolean => Array.isArray(key)
        assert.equal(await cache.mutate("KEY", "value", false), "value")
        assert.equal(await cache.mutate(["KEY", "t1"], 1), 1)
        await cache.mutate<number>(matcher, undefined, { revalidate: true })
        assert.deepEqual(calls[0], ["KEY", "value", false])
        assert.deepEqual(calls[1], [["KEY", "t1"], 1, undefined])
        assert.equal(calls[2]?.[0], matcher)
    })

    it("reaches the cache bound last and none after unbind", async () => {
        const cache = createViewerCache()
        const first = recording()
        const second = recording()
        cache.bind(first.mutator)
        cache.bind(second.mutator)
        await cache.mutate("KEY")
        assert.equal(first.calls.length, 0)
        assert.equal(second.calls.length, 1)
        cache.unbind()
        assert.equal(await cache.mutate("KEY", "value"), undefined)
        assert.equal(second.calls.length, 1)
    })

    it("keeps one binding per instance", async () => {
        const one = createViewerCache()
        const other = createViewerCache()
        const { mutator, calls } = recording()
        one.bind(mutator)
        await other.mutate("KEY")
        assert.equal(calls.length, 0)
    })
})
