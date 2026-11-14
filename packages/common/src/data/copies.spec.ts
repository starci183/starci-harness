import assert from "node:assert/strict"
import { test } from "node:test"
import type { StoredEntry } from "./copies.ts"
import { chooseCopy, compareCopies, exportOnce, memorySpool, restoreFrom, spooledSource, unchangedSince, writeEverywhere } from "./copies.ts"
import type { CopyReceipt, CopyRef, CopyVerdict, DriverAdapter, WriteContext } from "./driver.ts"
import { DataRefusal } from "./driver.ts"
import type { DataEntry, DataManifest, DataSetSummary, ManifestHeader, Selection } from "./manifest.ts"
import { blobEntry, recordEntry } from "./manifest.ts"
import type { ImportOptions, ImportReport, StoreAdapter } from "./store.ts"
import { memoryDriver, memoryStore } from "./testing/memory.ts"

const header: ManifestHeader = { format: "shop-seed-backup@1", purpose: "seed-backup", takenAt: "2026-01-01T00:00:00.000Z", source: { project: "shop", environment: "dev" } }
const context: WriteContext = { recipients: ["age1recipient"], dryRun: false }
const merge: ImportOptions = { dryRun: false, mode: "merge" }

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
    const out: T[] = []
    for await (const item of items) out.push(item)
    return out
}

/** A store that yields exactly the entries given (in the given order), or throws what it is told after them. */
function scripted(id: string, entries: readonly DataEntry[], failure?: Error): StoreAdapter {
    return {
        id,
        kind: "database",
        level: "logical",
        describe: () => Promise.reject(new Error("not used")),
        identityOf: () => Promise.resolve(null),
        import: () => Promise.reject(new Error("not used")),
        async *export() {
            await Promise.resolve()
            yield* entries
            if (failure !== undefined) throw failure
        },
    }
}

const thrownBy = async (run: () => Promise<unknown>): Promise<unknown> => {
    try {
        await run()
    } catch (error) {
        return error
    }
    return undefined
}

test("exportOnce reads the stores in the order given into the spool and builds the manifest", async () => {
    const spool = memorySpool()
    const seen: Selection[] = []
    const first = scripted("one", [recordEntry("a", "1", 1), recordEntry("a", "2", 2)])
    const spy: StoreAdapter = { ...first, export: (selection) => { seen.push(selection); return first.export(selection) } }
    const second = scripted("two", [blobEntry("files", "f", new Uint8Array([9]), "image/png")])
    const source = await exportOnce([spy, second], { sets: ["a", "files"] }, spool, header)
    assert.deepEqual(seen, [{ sets: ["a", "files"] }])
    assert.deepEqual(source.manifest.sets.map((set) => `${set.store}/${set.set}:${String(set.items)}`), ["one/a:2", "two/files:1"])
    assert.deepEqual((await collect(spool.replay())).map((item) => `${item.store}/${item.entry.set}/${item.entry.key}`), ["one/a/1", "one/a/2", "two/files/f"])
})

test("exportOnce accepts a set order that rises even when the next key is lower", async () => {
    const source = await exportOnce([scripted("one", [recordEntry("a", "z", 1), recordEntry("b", "a", 2)])], {}, memorySpool(), header)
    assert.equal(source.manifest.sets.length, 2)
})

test("exportOnce refuses a store whose sets or keys come out of order or repeat, as DATA_STORE_FAILED", async () => {
    const cases: [string, DataEntry[]][] = [
        ["sets out of order", [recordEntry("b", "1", 1), recordEntry("a", "1", 1)]],
        ["keys out of order", [recordEntry("a", "2", 1), recordEntry("a", "1", 1)]],
        ["a repeated key", [recordEntry("a", "1", 1), recordEntry("a", "1", 1)]],
    ]
    for (const [, entries] of cases) {
        const error = await thrownBy(() => exportOnce([scripted("one", entries)], {}, memorySpool(), header))
        assert.ok(error instanceof DataRefusal)
        assert.equal(error.code, "DATA_STORE_FAILED")
        assert.equal(error.retry, "configuration")
        assert.deepEqual(error.params, { store: "one" })
        assert.ok(error.cause instanceof TypeError)
    }
})

test("exportOnce wraps a plain store failure and lets a DomainError through unchanged", async () => {
    const boom = new Error("connection lost")
    const wrapped = await thrownBy(() => exportOnce([scripted("one", [], boom)], {}, memorySpool(), header))
    assert.ok(wrapped instanceof DataRefusal)
    assert.equal(wrapped.code, "DATA_STORE_FAILED")
    assert.equal(wrapped.cause, boom)
    const refusal = new DataRefusal("DATA_DRIVER_UNAVAILABLE", "transient")
    assert.equal(await thrownBy(() => exportOnce([scripted("one", [], refusal)], {}, memorySpool(), header)), refusal)
})

test("exportOnce refuses an entry whose hash does not match its body", async () => {
    const bad = { ...recordEntry("a", "1", 1), sha256: "0".repeat(64) }
    const error = await thrownBy(() => exportOnce([scripted("one", [bad])], {}, memorySpool(), header))
    assert.ok(error instanceof DataRefusal)
    assert.equal(error.code, "DATA_STORE_FAILED")
})

test("a spooled source replays everything, or only the selected sets", async () => {
    const spool = memorySpool()
    await spool.append({ store: "db", entry: recordEntry("a", "1", 1) })
    await spool.append({ store: "db", entry: recordEntry("b", "1", 1) })
    const source = spooledSource({} as DataManifest, spool)
    assert.equal((await collect(source.entries())).length, 2)
    assert.equal((await collect(source.entries({}))).length, 2)
    assert.deepEqual((await collect(source.entries({ sets: ["b"] }))).map((item) => item.entry.set), ["b"])
    assert.equal((await collect(source.entries({ sets: [] }))).length, 0)
})

test("memorySpool keeps entries in order, can be replayed twice and is empty after dispose", async () => {
    const spool = memorySpool()
    const item: StoredEntry = { store: "db", entry: recordEntry("a", "1", 1) }
    await spool.append(item)
    await spool.append({ store: "db", entry: recordEntry("a", "2", 2) })
    assert.equal((await collect(spool.replay())).length, 2)
    assert.equal((await collect(spool.replay())).length, 2)
    await spool.dispose()
    assert.equal((await collect(spool.replay())).length, 0)
})

test("unchangedSince is true only when the digest equals the last one recorded", () => {
    const manifest = { exportDigest: "d1" } as DataManifest
    assert.equal(unchangedSince(manifest, null), false)
    assert.equal(unchangedSince(manifest, "d0"), false)
    assert.equal(unchangedSince(manifest, "d1"), true)
})

async function sourceOf(): Promise<Awaited<ReturnType<typeof exportOnce>>> {
    return exportOnce([memoryStore({ id: "db", sets: { products: { a: { n: 1 } } } })], {}, memorySpool(), header)
}

test("writeEverywhere is complete when every driver holds the export, written or already held", async () => {
    const source = await sourceOf()
    const first = memoryDriver({ id: "git-1" })
    const second = memoryDriver({ id: "git-2" })
    await second.write(source, context)
    const run = await writeEverywhere(source, [first, second], context)
    assert.equal(run.outcome, "complete")
    assert.equal(run.manifest, source.manifest)
    assert.deepEqual(run.legs.map((leg) => [leg.driver, leg.outcome, leg.failure]), [["git-1", "written", null], ["git-2", "unchanged", null]])
    assert.equal(run.legs[0]?.receipt?.changed, 1)
})

test("writeEverywhere is partial when one driver fails, and the failure keeps its code and retry class", async () => {
    const source = await sourceOf()
    const run = await writeEverywhere(source, [memoryDriver({ id: "bad", fail: { on: "write", code: "DATA_SEAL_FAILED", retry: "configuration" } }), memoryDriver({ id: "good" })], context)
    assert.equal(run.outcome, "partial")
    assert.deepEqual(run.legs[0], { driver: "bad", outcome: "failed", receipt: null, failure: { code: "DATA_SEAL_FAILED", retry: "configuration" } })
    assert.equal(run.legs[1]?.outcome, "written")
})

test("writeEverywhere is failed when none holds the export, and treats a foreign throw as a transient unavailable driver", async () => {
    const source = await sourceOf()
    const foreign: DriverAdapter = { ...memoryDriver({ id: "net" }), write: () => Promise.reject(new Error("ECONNRESET")) }
    const run = await writeEverywhere(source, [foreign, memoryDriver({ id: "x", fail: { on: "write", code: "DATA_COPY_CORRUPT" } })], context)
    assert.equal(run.outcome, "failed")
    assert.deepEqual(run.legs.map((leg) => leg.failure), [{ code: "DATA_DRIVER_UNAVAILABLE", retry: "transient" }, { code: "DATA_COPY_CORRUPT", retry: "transient" }])
})

test("writeEverywhere with no driver is complete and holds no leg", async () => {
    const run = await writeEverywhere(await sourceOf(), [], context)
    assert.equal(run.outcome, "complete")
    assert.deepEqual(run.legs, [])
})

const summary = (set: string, digest: string, store = "db"): DataSetSummary => ({ store, set, schema: "x", form: "record", items: 1, bytes: 1, digest })
const manifestOf = (...sets: DataSetSummary[]): DataManifest => ({ schema: "starci/data-manifest@1", ...header, sets, exportDigest: "d" })
const verdict = (driver: string, takenAt: string, sets: DataSetSummary[], healthy = true): CopyVerdict => ({
    ref: { driver, kind: "git", locator: `${driver}#1`, exportDigest: "d", takenAt },
    healthy,
    checks: [],
    manifest: manifestOf(...sets),
})

test("compareCopies is equal when every shared set has one digest, and a subset copy is compared on what it holds", () => {
    const result = compareCopies([
        verdict("a", "t", [summary("p", "1"), summary("q", "2")]),
        verdict("b", "t", [summary("p", "1")]),
    ])
    assert.deepEqual(result, { equal: true, differing: [] })
    assert.deepEqual(compareCopies([]), { equal: true, differing: [] })
})

test("compareCopies names a set whose copies differ with each digest by driver", () => {
    const result = compareCopies([verdict("a", "t", [summary("p", "1")]), verdict("b", "t", [summary("p", "2")])])
    assert.equal(result.equal, false)
    assert.deepEqual(result.differing, [{ set: "db/p", digests: { a: "1", b: "2" } }])
})

test("compareCopies leaves an unhealthy copy or one without a manifest out and is then unequal", () => {
    const result = compareCopies([
        verdict("a", "t", [summary("p", "1")]),
        verdict("b", "t", [summary("p", "9")], false),
        { ...verdict("c", "t", []), manifest: null },
    ])
    assert.deepEqual(result, { equal: false, differing: [] })
})

test("chooseCopy takes the newest healthy copy that holds every selected set", () => {
    const old = verdict("a", "2026-01-01T00:00:00.000Z", [summary("p", "1"), summary("q", "1")])
    const fresh = verdict("b", "2026-02-01T00:00:00.000Z", [summary("p", "1"), summary("q", "1")])
    assert.equal(chooseCopy([old, fresh], { sets: ["p", "q"] }, []), fresh.ref)
    assert.equal(chooseCopy([fresh, old], {}, []), fresh.ref)
})

test("chooseCopy breaks a tie by the driver preference, an unlisted driver last", () => {
    const at = "2026-02-01T00:00:00.000Z"
    const git = verdict("git", at, [summary("p", "1")])
    const s3 = verdict("s3", at, [summary("p", "1")])
    const other = verdict("other", at, [summary("p", "1")])
    assert.equal(chooseCopy([git, s3], {}, ["s3", "git"]), s3.ref)
    assert.equal(chooseCopy([s3, git], {}, ["git", "s3"]), git.ref)
    assert.equal(chooseCopy([other, git], {}, ["git"]), git.ref)
})

test("chooseCopy skips an unhealthy copy, one without a manifest and one that lacks a selected set, and answers null when none is left", () => {
    const missing = verdict("a", "2026-03-01T00:00:00.000Z", [summary("p", "1")])
    const unhealthy = verdict("b", "2026-03-02T00:00:00.000Z", [summary("p", "1"), summary("q", "1")], false)
    const bare: CopyVerdict = { ...verdict("c", "2026-03-03T00:00:00.000Z", []), manifest: null }
    assert.equal(chooseCopy([missing, unhealthy, bare], { sets: ["p", "q"] }, []), null)
    assert.equal(chooseCopy([], {}, []), null)
    const ref: CopyRef = missing.ref
    assert.equal(chooseCopy([missing, unhealthy, bare], { sets: ["p"] }, []), ref)
})

async function twoStoreSource(): Promise<Awaited<ReturnType<typeof exportOnce>>> {
    return exportOnce(
        [memoryStore({ id: "db", sets: { products: { a: 1 }, orders: { o: 2 } } }), memoryStore({ id: "files", sets: { images: { i: new Uint8Array([1]) } } })],
        {},
        memorySpool(),
        header,
    )
}

test("restoreFrom imports each store its own entries, in the order given, and skips a store the copy lacks", async () => {
    const source = await twoStoreSource()
    const files = memoryStore({ id: "files" })
    const db = memoryStore({ id: "db" })
    const absent = memoryStore({ id: "absent" })
    const reports = await restoreFrom(source, [files, absent, db], merge)
    assert.equal(reports.length, 2)
    assert.deepEqual(reports.map((report) => report.sets.map((set) => set.set)), [["images"], ["orders", "products"]])
    assert.deepEqual(db.snapshot(), { products: { a: 1 }, orders: { o: 2 } })
    assert.deepEqual(files.snapshot(), { images: { i: new Uint8Array([1]) } })
    assert.deepEqual(absent.snapshot(), {})
})

test("restoreFrom narrows by selection and skips a store none of whose sets is selected", async () => {
    const source = await twoStoreSource()
    const db = memoryStore({ id: "db" })
    const files = memoryStore({ id: "files" })
    const reports: readonly ImportReport[] = await restoreFrom(source, [db, files], merge, { sets: ["orders"] })
    assert.equal(reports.length, 1)
    assert.deepEqual(db.snapshot(), { orders: { o: 2 } })
    assert.deepEqual(files.snapshot(), {})
    const all: readonly ImportReport[] = await restoreFrom(source, [memoryStore({ id: "db" })], merge, {})
    assert.equal(all.length, 1)
})

test("a receipt of the write names the copy the driver kept", async () => {
    const driver = memoryDriver({ id: "git" })
    const receipt: CopyReceipt = await driver.write(await sourceOf(), context)
    assert.equal(receipt.schema, "starci/data-copy@1")
    assert.equal(receipt.ref.driver, "git")
})
