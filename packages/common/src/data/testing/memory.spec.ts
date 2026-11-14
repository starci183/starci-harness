import assert from "node:assert/strict"
import { test } from "node:test"
import { exportOnce, memorySpool } from "../copies.ts"
import type { CopyRef, ExportSource, WriteContext } from "../driver.ts"
import { DataRefusal } from "../driver.ts"
import type { DataEntry, DataManifest, ManifestHeader } from "../manifest.ts"
import { blobEntry, recordEntry } from "../manifest.ts"
import type { ImportOptions } from "../store.ts"
import { memoryDriver, memoryStore } from "./memory.ts"

const header: ManifestHeader = { format: "shop-seed-backup@1", purpose: "seed-backup", takenAt: "2026-01-01T00:00:00.000Z", source: { project: "shop", environment: "dev" } }
const context: WriteContext = { recipients: ["age1recipient"], dryRun: false }
const open = { identity: { kind: "age-identity", env: {} } } as const
const merge: ImportOptions = { dryRun: false, mode: "merge" }
const mirror: ImportOptions = { dryRun: false, mode: "mirror" }

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
    const out: T[] = []
    for await (const item of items) out.push(item)
    return out
}

async function* from(entries: readonly DataEntry[]): AsyncIterable<DataEntry> {
    await Promise.resolve()
    yield* entries
}

const thrownBy = async (run: () => Promise<unknown>): Promise<unknown> => {
    try {
        await run()
    } catch (error) {
        return error
    }
    return undefined
}

const sourceOf = (sets: Record<string, Record<string, never>> | Parameters<typeof memoryStore>[0]["sets"] = { products: { a: { n: 1 } } }): Promise<ExportSource> =>
    exportOnce([memoryStore({ id: "db", sets })], {}, memorySpool(), header)

test("memoryStore defaults to a logical database and describes record sets from its format and blob sets as blob@1", async () => {
    const store = memoryStore({ id: "db", sets: { products: { a: { n: 1 } }, images: { logo: new Uint8Array([1]) }, empty: {} }, cannot: [{ what: "import of x", reason: "y" }] })
    assert.equal(store.kind, "database")
    assert.equal(store.level, "logical")
    const description = await store.describe()
    assert.deepEqual(description.sets, [
        { set: "empty", schema: "db/empty@1", form: "record" },
        { set: "images", schema: "blob@1", form: "blob" },
        { set: "products", schema: "db/products@1", form: "record" },
    ])
    assert.deepEqual(description.purposes, ["seed-standard", "seed-backup"])
    assert.equal(description.canExport, true)
    assert.equal(description.canImport, true)
    assert.deepEqual(description.cannot, [{ what: "import of x", reason: "y" }])
    assert.deepEqual((await memoryStore({ id: "db" }).describe()).cannot, [])
})

test("memoryStore takes its kind, level and schema format from the init", async () => {
    const store = memoryStore({ id: "files", kind: "storage", level: "physical", format: "shop-seed-standard@3", sets: { products: { a: 1 } } })
    assert.equal(store.kind, "storage")
    assert.equal(store.level, "physical")
    assert.equal((await store.describe()).sets[0]?.schema, "shop-seed-standard/products@1")
})

test("memoryStore exports in (set, key) byte order, narrowed by the selected sets, records and blobs", async () => {
    const store = memoryStore({ id: "db", sets: { b: { y: 1, x: 2 }, a: { z: new Uint8Array([7]) } } })
    const all = await collect(store.export({}))
    assert.deepEqual(all.map((entry) => `${entry.set}/${entry.key}/${entry.form}`), ["a/z/blob", "b/x/record", "b/y/record"])
    assert.equal(all[0]?.media, "application/octet-stream")
    assert.deepEqual((await collect(store.export({ sets: ["b"] }))).map((entry) => entry.set), ["b", "b"])
})

test("memoryStore does not share its content with the init or with a snapshot", () => {
    const sets = { s: { k: { n: 1 } } }
    const store = memoryStore({ id: "db", sets })
    sets.s.k.n = 2
    const snapshot = store.snapshot()
    Object.assign(snapshot.s ?? {}, { k: "changed" })
    assert.deepEqual(store.snapshot(), { s: { k: { n: 1 } } })
})

test("memoryStore identityOf is null for an absent key and stable for a held one", async () => {
    const store = memoryStore({ id: "db", sets: { s: { k: 1 } } })
    assert.equal(await store.identityOf("s", "nope"), null)
    assert.equal(await store.identityOf("nope", "k"), null)
    const id = await store.identityOf("s", "k")
    assert.equal(typeof id, "string")
    assert.equal(await store.identityOf("s", "k"), id)
})

test("memoryStore import counts created, updated and unchanged by hash and keeps the identity of an update", async () => {
    const store = memoryStore({ id: "db", sets: { s: { same: 1, change: 1 } } })
    const before = await store.identityOf("s", "change")
    const report = await store.import(from([recordEntry("s", "change", 2), recordEntry("s", "fresh", 3), recordEntry("s", "same", 1)]), merge)
    assert.deepEqual(report, { sets: [{ set: "s", created: 1, updated: 1, unchanged: 1, removed: 0, refused: [] }], outcome: "applied" })
    assert.equal(await store.identityOf("s", "change"), before)
    assert.notEqual(await store.identityOf("s", "fresh"), null)
    assert.deepEqual(store.snapshot(), { s: { same: 1, change: 2, fresh: 3 } })
    const again = await store.import(from([recordEntry("s", "change", 2)]), merge)
    assert.equal(again.outcome, "unchanged")
})

test("memoryStore import writes blobs as bytes and compares a blob by its hash", async () => {
    const store = memoryStore({ id: "db" })
    await store.import(from([blobEntry("files", "f", new Uint8Array([1, 2]), "image/png")]), merge)
    assert.deepEqual(store.snapshot(), { files: { f: new Uint8Array([1, 2]) } })
    assert.equal((await store.import(from([blobEntry("files", "f", new Uint8Array([1, 2]), "image/png")]), merge)).outcome, "unchanged")
})

test("a dry-run import counts what would change and writes and identifies nothing", async () => {
    const store = memoryStore({ id: "db", sets: { s: { old: 1 } } })
    const report = await store.import(from([recordEntry("s", "new", 1), recordEntry("s", "old", 2)]), { dryRun: true, mode: "mirror" })
    assert.deepEqual(report.sets, [{ set: "s", created: 1, updated: 1, unchanged: 0, removed: 0, refused: [] }])
    assert.deepEqual(store.snapshot(), { s: { old: 1 } })
    assert.equal(await store.identityOf("s", "new"), null)
    const mirrorDry = await store.import(from([recordEntry("s", "new", 1)]), { dryRun: true, mode: "mirror" })
    assert.equal(mirrorDry.sets[0]?.removed, 1)
    assert.deepEqual(store.snapshot(), { s: { old: 1 } })
})

test("a merge removes nothing and a mirror removes the keys of the sets the entries name, only those", async () => {
    const store = memoryStore({ id: "db", sets: { a: { keep: 1, drop: 2 }, other: { stay: 3 } } })
    const merged = await store.import(from([recordEntry("a", "keep", 1)]), merge)
    assert.equal(merged.sets[0]?.removed, 0)
    const mirrored = await store.import(from([recordEntry("a", "keep", 1)]), mirror)
    assert.deepEqual(mirrored.sets, [{ set: "a", created: 0, updated: 0, unchanged: 1, removed: 1, refused: [] }])
    assert.equal(mirrored.outcome, "applied")
    assert.deepEqual(store.snapshot(), { a: { keep: 1 }, other: { stay: 3 } })
})

test("a door that refuses a key is reported by code, writes nothing for it, and makes the import partial", async () => {
    const store = memoryStore({ id: "db", sets: { s: { bad: 1 } }, refuse: { bad: "DOOR_REFUSED", worse: "DOOR_REFUSED" } })
    const report = await store.import(from([recordEntry("s", "bad", 2), recordEntry("s", "good", 3), recordEntry("t", "worse", 4)]), mirror)
    assert.equal(report.outcome, "partial")
    assert.deepEqual(report.sets.map((set) => [set.set, set.created, set.refused]), [
        ["s", 1, [{ key: "bad", code: "DOOR_REFUSED" }]],
        ["t", 0, [{ key: "worse", code: "DOOR_REFUSED" }]],
    ])
    assert.deepEqual(store.snapshot(), { s: { bad: 1, good: 3 } })
})

test("memoryDriver defaults to a git driver with the 500 MiB cap and the 400 MiB warning, holding records and blobs", () => {
    const driver = memoryDriver({ id: "git" })
    assert.equal(driver.kind, "git")
    assert.deepEqual(driver.limits(), { forms: ["record", "blob"], maxFileBytes: null, maxCopyBytes: 524_288_000, warnCopyBytes: 419_430_400 })
    assert.equal(memoryDriver({ id: "s3", kind: "s3", limits: { maxFileBytes: 10 } }).limits().maxFileBytes, 10)
    assert.equal(memoryDriver({ id: "s3", kind: "s3" }).kind, "s3")
})

test("memoryDriver writes, lists newest first, reads back and verifies healthy", async () => {
    const driver = memoryDriver({ id: "git" })
    const first = await driver.write(await sourceOf({ products: { a: 1 } }), context)
    const second = await driver.write(await sourceOf({ products: { a: 2 } }), context)
    assert.equal(first.schema, "starci/data-copy@1")
    assert.equal(first.changed, 1)
    assert.equal(first.ref.locator, "git#1")
    assert.equal(second.ref.locator, "git#2")
    assert.deepEqual((await driver.list()).map((ref) => ref.locator), ["git#2", "git#1"])
    assert.deepEqual(first.warnings, [])
    const back = await driver.read(second.ref, open)
    assert.deepEqual((await collect(back.entries())).map((item) => item.entry.key), ["a"])
    assert.equal(back.manifest.exportDigest, second.ref.exportDigest)
    const verdict = await driver.verify(second.ref, open)
    assert.equal(verdict.healthy, true)
    assert.deepEqual(verdict.checks, [{ name: "digests", ok: true, detail: "every set matches" }])
    assert.equal((await driver.verify(second.ref, null)).healthy, true)
})

test("writing the export the newest copy already holds changes nothing and keeps one copy", async () => {
    const driver = memoryDriver({ id: "git" })
    const source = await sourceOf()
    const first = await driver.write(source, context)
    const again = await driver.write(source, context)
    assert.equal(again.changed, 0)
    assert.deepEqual(again.ref, first.ref)
    assert.equal((await driver.list()).length, 1)
})

test("a driver limited to records names the blob sets it omits and keeps a copy that still verifies", async () => {
    const driver = memoryDriver({ id: "git", limits: { forms: ["record"] } })
    const source = await sourceOf({ products: { a: 1 }, images: { logo: new Uint8Array([1]) } })
    assert.equal(driver.plan(source.manifest).holds, "subset")
    const receipt = await driver.write(source, context)
    assert.equal(receipt.holding.holds, "subset")
    assert.deepEqual(receipt.holding.omitted.map((set) => set.set), ["images"])
    assert.equal(receipt.changed, 1)
    assert.equal((await driver.verify(receipt.ref, null)).healthy, true)
    assert.deepEqual((await collect((await driver.read(receipt.ref, open)).entries())).map((item) => item.entry.set), ["products"])
})

test("a copy over the cap is refused as DATA_GIT_CAP_EXCEEDED, a configuration refusal", async () => {
    const driver = memoryDriver({ id: "git", limits: { maxCopyBytes: 3 } })
    const error = await thrownBy(async () => driver.write(await sourceOf({ s: { k: "twelve chars" } }), context))
    assert.ok(error instanceof DataRefusal)
    assert.equal(error.code, "DATA_GIT_CAP_EXCEEDED")
    assert.equal(error.retry, "configuration")
    assert.equal(error.params.cap, 3)
    assert.equal((await driver.list()).length, 0)
})

test("a driver without a cap or a warning size writes any size and warns of nothing", async () => {
    const driver = memoryDriver({ id: "s3", kind: "s3", limits: { maxCopyBytes: null, warnCopyBytes: null } })
    const receipt = await driver.write(await sourceOf({ s: { k: "twelve chars" } }), context)
    assert.deepEqual(receipt.warnings, [])
})

test("a copy over the warning size but under the cap writes with DATA_GIT_CAP_NEAR", async () => {
    const driver = memoryDriver({ id: "git", limits: { warnCopyBytes: 3, maxCopyBytes: 100 } })
    const receipt = await driver.write(await sourceOf({ s: { k: "twelve chars" } }), context)
    assert.deepEqual(receipt.warnings, ["DATA_GIT_CAP_NEAR"])
    assert.deepEqual((await driver.write(await sourceOf({ s: { k: "twelve chars" } }), context)).warnings, ["DATA_GIT_CAP_NEAR"])
})

test("fail makes the named operation refuse with its code, transient by default, and leaves the others working", async () => {
    const written = memoryDriver({ id: "w", fail: { on: "write", code: "DATA_SEAL_FAILED" } })
    const error = await thrownBy(async () => written.write(await sourceOf(), context))
    assert.ok(error instanceof DataRefusal)
    assert.equal(error.code, "DATA_SEAL_FAILED")
    assert.equal(error.retry, "transient")
    assert.deepEqual(error.params, { driver: "w" })

    const ref: CopyRef = { driver: "x", kind: "git", locator: "x#1", exportDigest: "d", takenAt: "t" }
    const read = memoryDriver({ id: "r", fail: { on: "read", code: "DATA_COPY_CORRUPT", retry: "configuration" } })
    const readError = await thrownBy(() => read.read(ref, open))
    assert.ok(readError instanceof DataRefusal)
    assert.equal(readError.retry, "configuration")
    const receipt = await read.write(await sourceOf(), context)
    assert.equal((await read.verify(receipt.ref, null)).healthy, true)

    const verified = memoryDriver({ id: "v", fail: { on: "verify", code: "DATA_DRIVER_UNAVAILABLE" } })
    const stored = await verified.write(await sourceOf(), context)
    assert.equal(((await thrownBy(() => verified.verify(stored.ref, null))) as DataRefusal).code, "DATA_DRIVER_UNAVAILABLE")
    assert.equal((await collect((await verified.read(stored.ref, open)).entries())).length, 1)
})

test("reading or verifying a locator the driver does not keep is DATA_COPY_MISSING", async () => {
    const driver = memoryDriver({ id: "git" })
    const ref: CopyRef = { driver: "git", kind: "git", locator: "git#9", exportDigest: "d", takenAt: "t" }
    for (const run of [() => driver.read(ref, open), () => driver.verify(ref, null)]) {
        const error = await thrownBy(run)
        assert.ok(error instanceof DataRefusal)
        assert.equal(error.code, "DATA_COPY_MISSING")
        assert.equal(error.retry, "configuration")
        assert.deepEqual(error.params, { driver: "git", locator: "git#9" })
    }
})

test("a corrupted entry makes verify unhealthy with the digests check failing", async () => {
    const driver = memoryDriver({ id: "git" })
    const receipt = await driver.write(await sourceOf({ s: { k: "value", j: "other" } }), context)
    driver.corrupt("s", "k")
    const verdict = await driver.verify(receipt.ref, null)
    assert.equal(verdict.healthy, false)
    assert.deepEqual(verdict.checks.map((check) => [check.name, check.ok]), [["digests", false]])
    assert.match(verdict.checks.map((check) => check.detail).join(), /sha256 does not match/u)
    assert.notEqual(verdict.manifest, null)
})

test("corrupting an entry that is not there, or in a driver with no copy, throws", async () => {
    const driver = memoryDriver({ id: "git" })
    assert.throws(() => { driver.corrupt("s", "k") }, /no entry s\/k to corrupt/u)
    await driver.write(await sourceOf({ s: { k: 1 } }), context)
    assert.throws(() => { driver.corrupt("s", "nope") }, /no entry s\/nope to corrupt/u)
    assert.throws(() => { driver.corrupt("nope", "k") }, TypeError)
})

test("corrupting an entry with an empty body still changes it", async () => {
    const driver = memoryDriver({ id: "git" })
    const empty = blobEntry("files", "empty", new Uint8Array([]), "x/y")
    const source = await exportOnce([{ ...memoryStore({ id: "db" }), export: () => from([empty]) }], {}, memorySpool(), header)
    const receipt = await driver.write(source, context)
    driver.corrupt("files", "empty")
    assert.equal((await driver.verify(receipt.ref, null)).healthy, true)
})

test("verify is unhealthy when a set's digest in the manifest differs from its entries", async () => {
    const source = await sourceOf({ s: { k: 1 } })
    const lying: DataManifest = { ...source.manifest, sets: source.manifest.sets.map((set) => ({ ...set, digest: "0".repeat(64) })) }
    const driver = memoryDriver({ id: "git" })
    const receipt = await driver.write({ manifest: lying, entries: (selection) => source.entries(selection) }, context)
    const verdict = await driver.verify(receipt.ref, null)
    assert.equal(verdict.healthy, false)
    assert.deepEqual(verdict.checks, [{ name: "digests", ok: false, detail: "differ: s" }])
})

test("a set that holds no content at all is described as a record set, exported as nothing and imported into", async () => {
    const store = memoryStore({ id: "db", sets: { hollow: undefined as never } })
    assert.deepEqual((await store.describe()).sets, [{ set: "hollow", schema: "db/hollow@1", form: "record" }])
    assert.deepEqual(await collect(store.export({})), [])
    assert.equal(await store.identityOf("hollow", "k"), null)
    const report = await store.import(from([recordEntry("hollow", "k", 1)]), mirror)
    assert.equal(report.outcome, "applied")
    const refusing = memoryStore({ id: "db", sets: { hollow: undefined as never }, refuse: { k: "DOOR_REFUSED" } })
    assert.equal((await refusing.import(from([recordEntry("hollow", "k", 1)]), mirror)).outcome, "partial")
})

test("identityOf is null for a name the maps only inherit from Object.prototype", async () => {
    const store = memoryStore({ id: "db", sets: { s: { k: 1 } } })
    assert.equal(await store.identityOf("s", "toString"), null)
})

test("a natural key named like an Object.prototype member is created, held and compared like any other", async () => {
    const store = memoryStore({ id: "db" })
    const entries = [recordEntry("s", "constructor", 2), recordEntry("s", "toString", 3)]
    const first = await store.import(from(entries), merge)
    assert.deepEqual(first.sets.map((set) => [set.created, set.updated, set.unchanged]), [[2, 0, 0]])
    assert.notEqual(await store.identityOf("s", "constructor"), null)
    assert.notEqual(await store.identityOf("s", "toString"), null)
    const second = await store.import(from(entries), merge)
    assert.equal(second.outcome, "unchanged")
    assert.deepEqual((await collect(store.export({}))).map((entry) => entry.key).sort(), ["constructor", "toString"])
})

test("memoryStore keeps a natural key named __proto__ as an own key: a second import answers unchanged", async () => {
    const store = memoryStore({ id: "db" })
    const entry = recordEntry("things", "__proto__", { n: 1 })
    async function* one() { await Promise.resolve(); yield entry }
    assert.equal((await store.import(one(), { dryRun: false, mode: "merge" })).outcome, "applied")
    assert.equal((await store.import(one(), { dryRun: false, mode: "merge" })).outcome, "unchanged")
})
