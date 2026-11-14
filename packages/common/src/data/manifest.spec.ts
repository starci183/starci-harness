import assert from "node:assert/strict"
import { test } from "node:test"
import type { DataSetSummary, ManifestHeader } from "./manifest.ts"
import {
    ManifestBuilder,
    blobEntry,
    byteOrder,
    canonicalJson,
    entryIntact,
    exportDigestOf,
    manifestProblems,
    recordEntry,
    recordValue,
    setDigest,
    setSchemaOf,
    sha256Hex,
} from "./manifest.ts"

const header: ManifestHeader = { format: "shop-seed-standard@2", purpose: "seed-standard", takenAt: "2026-01-01T00:00:00.000Z", source: { project: "shop", environment: "dev" } }
const setAt = (sets: readonly DataSetSummary[], index: number): DataSetSummary => {
    const found = sets[index]
    assert.ok(found !== undefined)
    return found
}
const bytes = (...values: number[]): Uint8Array => new Uint8Array(values)

test("sha256Hex hashes a string as its UTF-8 bytes and bytes as they are", () => {
    assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    assert.equal(sha256Hex(new TextEncoder().encode("abc")), sha256Hex("abc"))
})

test("byteOrder compares by UTF-8 bytes, not UTF-16 units", () => {
    assert.ok(byteOrder("a", "b") < 0)
    assert.ok(byteOrder("b", "a") > 0)
    assert.equal(byteOrder("a", "a"), 0)
    // U+FF5E is 3 bytes in UTF-8 and one BMP unit; U+1F600 is 4 bytes but two surrogates that sort lower in UTF-16.
    assert.ok(byteOrder("～", "\u{1f600}") < 0)
    assert.deepEqual(["～", "\u{1f600}"].sort(), ["\u{1f600}", "～"])
})

test("canonicalJson sorts keys by byte order, drops undefined fields and keeps arrays in order", () => {
    assert.equal(
        canonicalJson({ b: 1, a: [3, 1, { z: null, y: undefined, x: true }], "\u{1f600}": "e", "～": "f" }),
        '{"a":[3,1,{"x":true,"z":null}],"b":1,"～":"f","\u{1f600}":"e"}',
    )
    assert.equal(canonicalJson("text"), '"text"')
    assert.equal(canonicalJson(null), "null")
    assert.equal(canonicalJson(false), "false")
    assert.equal(canonicalJson(1.5), "1.5")
    assert.equal(canonicalJson([]), "[]")
    assert.equal(canonicalJson({}), "{}")
})

test("canonicalJson refuses NaN, Infinity and values JSON has no word for", () => {
    assert.throws(() => canonicalJson(Number.NaN), TypeError)
    assert.throws(() => canonicalJson(Number.POSITIVE_INFINITY), TypeError)
    assert.throws(() => canonicalJson({ nested: [Number.NEGATIVE_INFINITY] }), TypeError)
    assert.throws(() => canonicalJson(undefined), /undefined/u)
    assert.throws(() => canonicalJson(() => 1), /function/u)
    assert.throws(() => canonicalJson(10n), /bigint/u)
})

test("recordEntry holds the canonical JSON, the application/json media and the body's hash", () => {
    const entry = recordEntry("products", "sku-1", { b: 2, a: 1 })
    assert.equal(entry.form, "record")
    assert.equal(entry.media, "application/json")
    assert.equal(new TextDecoder().decode(entry.body), '{"a":1,"b":2}')
    assert.equal(entry.sha256, sha256Hex('{"a":1,"b":2}'))
    assert.equal(entryIntact(entry), true)
    assert.deepEqual(recordEntry("products", "sku-1", { a: 1, b: 2 }), entry)
})

test("blobEntry keeps the bytes and the stated media", () => {
    const entry = blobEntry("images", "logo.png", bytes(1, 2, 3), "image/png")
    assert.equal(entry.form, "blob")
    assert.equal(entry.media, "image/png")
    assert.deepEqual([...entry.body], [1, 2, 3])
    assert.equal(entry.sha256, sha256Hex(bytes(1, 2, 3)))
})

test("recordValue reads a record back and refuses a blob", () => {
    assert.deepEqual(recordValue(recordEntry("s", "k", { a: [1, "x"] })), { a: [1, "x"] })
    assert.throws(() => recordValue(blobEntry("s", "k", bytes(1), "image/png")), /s\/k is a blob/u)
})

test("entryIntact is false when the body no longer matches its hash", () => {
    const entry = recordEntry("s", "k", 1)
    assert.equal(entryIntact({ ...entry, body: bytes(0) }), false)
})

test("setDigest is the hash of the sorted key and hash lines, whatever the order given", () => {
    const one = { key: "a", sha256: "1" }
    const two = { key: "b", sha256: "2" }
    assert.equal(setDigest([one, two]), sha256Hex("a\t1\nb\t2\n"))
    assert.equal(setDigest([two, one]), setDigest([one, two]))
    assert.equal(setDigest([]), sha256Hex(""))
})

test("exportDigestOf is the hash of the canonical JSON of the sets", () => {
    const sets: DataSetSummary[] = [{ store: "db", set: "s", schema: "x/s@1", form: "record", items: 1, bytes: 2, digest: "d" }]
    assert.equal(exportDigestOf(sets), sha256Hex(canonicalJson(sets)))
})

test("setSchemaOf names a record set from the format and a blob set blob@1", () => {
    assert.equal(setSchemaOf("shop-seed-standard@2", "products", "record"), "shop-seed-standard/products@2")
    assert.equal(setSchemaOf("shop", "products", "record"), "shop/products@1")
    assert.equal(setSchemaOf("shop-seed@3", "files", "blob"), "blob@1")
})

test("ManifestBuilder summarises per store and set, sorted by (store, set), whatever the arrival order", () => {
    const builder = new ManifestBuilder()
    builder.add("storage", blobEntry("images", "b.png", bytes(1, 2), "image/png"))
    builder.add("db", recordEntry("products", "b", { n: 2 }))
    builder.add("db", recordEntry("products", "a", { n: 1 }))
    builder.add("db", recordEntry("orders", "z", { n: 3 }))
    const manifest = builder.build(header)
    assert.equal(manifest.schema, "starci/data-manifest@1")
    assert.equal(manifest.format, header.format)
    assert.deepEqual(manifest.sets.map((set) => `${set.store}/${set.set}`), ["db/orders", "db/products", "storage/images"])
    const products = setAt(manifest.sets, 1)
    assert.equal(products.schema, "shop-seed-standard/products@2")
    assert.equal(products.items, 2)
    assert.equal(products.bytes, '{"n":1}'.length * 2)
    assert.equal(products.digest, setDigest([recordEntry("p", "a", { n: 1 }), recordEntry("p", "b", { n: 2 })]))
    assert.equal(setAt(manifest.sets, 2).schema, "blob@1")
    assert.equal(manifest.exportDigest, exportDigestOf(manifest.sets))
    assert.deepEqual(manifestProblems(manifest), [])
})

test("ManifestBuilder refuses a hash that does not match, a repeated key and a set that mixes forms", () => {
    const builder = new ManifestBuilder()
    const entry = recordEntry("s", "k", 1)
    assert.throws(() => { builder.add("db", { ...entry, sha256: "0".repeat(64) }) }, /sha256 does not match/u)
    builder.add("db", entry)
    assert.throws(() => { builder.add("db", entry) }, /db\/s\/k is repeated/u)
    assert.throws(() => { builder.add("db", blobEntry("s", "other", bytes(1), "x/y")) }, /mixes records and blobs/u)
    builder.add("other-store", blobEntry("s", "k", bytes(1), "x/y"))
    assert.equal(builder.build(header).sets.length, 2)
})

test("manifestProblems says why a document is not a manifest, and nothing for a valid one", () => {
    const valid = new ManifestBuilder().build(header)
    assert.deepEqual(manifestProblems(valid), [])
    assert.deepEqual(manifestProblems(null), ["the manifest is not an object"])
    assert.deepEqual(manifestProblems("text"), ["the manifest is not an object"])
    assert.deepEqual(manifestProblems([]), ["the manifest is not an object"])
    assert.deepEqual(manifestProblems({ ...valid, schema: "other" }), ["schema is not starci/data-manifest@1"])
    assert.deepEqual(manifestProblems({ ...valid, format: 7 }), ["format is not <name>@<major>"])
    assert.deepEqual(manifestProblems({ ...valid, format: "Bad Name@x" }), ["format is not <name>@<major>"])
    assert.deepEqual(manifestProblems({ ...valid, purpose: "nope" }), ["purpose is not seed-standard or seed-backup"])
    assert.deepEqual(manifestProblems({ ...valid, takenAt: 5 }), ["takenAt is missing"])
    assert.deepEqual(manifestProblems({ ...valid, sets: "x" }), ["sets is not a list"])
    assert.deepEqual(manifestProblems({ ...valid, schema: "other", sets: "x" }), ["schema is not starci/data-manifest@1", "sets is not a list"])
    assert.deepEqual(manifestProblems({ ...valid, exportDigest: "0".repeat(64) }), ["exportDigest does not match the sets"])
})

test("manifestProblems names every incomplete set entry and skips the digest check then", () => {
    const complete = { store: "db", set: "s", digest: "d", items: 1 }
    const valid = new ManifestBuilder().build(header)
    for (const broken of [{ ...complete, store: 1 }, { ...complete, set: 1 }, { ...complete, digest: 1 }, { ...complete, items: 1.5 }, undefined]) {
        const problems = manifestProblems({ ...valid, sets: [broken] })
        assert.equal(problems.length, 1)
        assert.match(problems[0] ?? "", /^a set entry is incomplete/u)
    }
    assert.deepEqual(manifestProblems({ ...valid, sets: [complete], exportDigest: exportDigestOf([complete as unknown as DataSetSummary]) }), [])
})
