import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { defaultFetchRoute, timedFetcher } from "./timed-fetcher.ts"
import type { FetchSample } from "./timed-fetcher.ts"

/** A clock that moves only when told, and the samples a sink received. */
const harness = (): { readonly now: () => number; readonly tick: (ms: number) => void; readonly samples: FetchSample[]; readonly sink: (sample: FetchSample) => void } => {
    let time = 1000
    const samples: FetchSample[] = []
    return { now: () => time, tick: (ms) => { time += ms }, samples, sink: (sample) => { samples.push(sample) } }
}

describe("defaultFetchRoute", () => {
    it("names a route by a string key or the first string of an array key", () => {
        assert.equal(defaultFetchRoute("/api/leads"), "/api/leads")
        assert.equal(defaultFetchRoute(["leads", "tenant-1", "page-2"]), "leads")
        assert.equal(defaultFetchRoute([7, "x"]), "unknown")
        assert.equal(defaultFetchRoute([]), "unknown")
        assert.equal(defaultFetchRoute(null), "unknown")
    })
})

describe("timedFetcher", () => {
    it("is off without a sink: the fetcher comes back unchanged", () => {
        const fetcher = (key: string): string => key
        assert.equal(timedFetcher(fetcher), fetcher)
        assert.equal(timedFetcher(fetcher, { route: () => "r" }), fetcher)
    })

    it("reports the route, the time and ok for an async fetch that resolves", async () => {
        const run = harness()
        const fetcher = timedFetcher((key: readonly [string, string]) => {
            run.tick(42)
            return Promise.resolve(key[1])
        }, { sink: run.sink, now: run.now })
        assert.equal(await fetcher(["leads", "t-1"]), "t-1")
        assert.deepEqual(run.samples, [{ route: "leads", ms: 42, ok: true }])
    })

    it("reports ok false for a fetch that rejects and still rejects", async () => {
        const run = harness()
        const fetcher = timedFetcher((): Promise<number> => {
            run.tick(9)
            return Promise.reject(new Error("down"))
        }, { sink: run.sink, now: run.now, route: () => "/contacts" })
        await assert.rejects(() => Promise.resolve(fetcher("any")), /down/)
        assert.deepEqual(run.samples, [{ route: "/contacts", ms: 9, ok: false }])
    })

    it("measures a sync fetcher that returns or throws", () => {
        const run = harness()
        const fetcher = timedFetcher((key: string): number => {
            run.tick(3)
            if (key === "bad") throw new Error("sync")
            return key.length
        }, { sink: run.sink, now: run.now })
        assert.equal(fetcher("abcd"), 4)
        assert.throws(() => fetcher("bad"), /sync/)
        assert.deepEqual(run.samples, [{ route: "abcd", ms: 3, ok: true }, { route: "bad", ms: 3, ok: false }])
    })

    it("keeps the fetch whole when the sink throws, and defaults to performance.now", async () => {
        const fetcher = timedFetcher((key: string) => Promise.resolve(key), { sink: () => { throw new Error("sink") } })
        assert.equal(await fetcher("ok"), "ok")
        const samples: FetchSample[] = []
        const timed = timedFetcher((key: string) => Promise.resolve(key), { sink: (sample) => { samples.push(sample) } })
        await timed("/x")
        assert.equal(samples.length, 1)
        assert.ok((samples[0]?.ms ?? -1) >= 0)
    })
})
