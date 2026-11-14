import assert from "node:assert/strict"
import { test } from "node:test"
import { isDomainError } from "../error.ts"
import { DataRefusal, holdingFor } from "./driver.ts"
import type { DataManifest, DataSetSummary } from "./manifest.ts"

const summary = (set: string, form: "record" | "blob"): DataSetSummary => ({ store: "db", set, schema: "x", form, items: 1, bytes: 1, digest: "d" })
const manifest = (sets: DataSetSummary[]): DataManifest => ({
    schema: "starci/data-manifest@1",
    format: "x@1",
    purpose: "seed-backup",
    takenAt: "2026-01-01T00:00:00.000Z",
    source: { project: "p", environment: "e" },
    sets,
    exportDigest: "digest",
})

test("holdingFor holds all when the driver takes every form of the export", () => {
    const holding = holdingFor(manifest([summary("a", "record"), summary("b", "blob")]), ["record", "blob"])
    assert.equal(holding.holds, "all")
    assert.equal(holding.exportDigest, "digest")
    assert.equal(holding.sets.length, 2)
    assert.deepEqual(holding.omitted, [])
})

test("holdingFor names every set of a form the driver does not hold, with its reason", () => {
    const holding = holdingFor(manifest([summary("a", "record"), summary("b", "blob")]), ["record"])
    assert.equal(holding.holds, "subset")
    assert.deepEqual(holding.sets.map((set) => set.set), ["a"])
    assert.deepEqual(holding.omitted, [{ store: "db", set: "b", reason: "the driver holds no blob entries" }])
})

test("DataRefusal carries its code, retry class, params and cause, and is a domain error", () => {
    const cause = new Error("disk")
    const refusal = new DataRefusal("DATA_SEAL_FAILED", "transient", { driver: "git" }, cause)
    assert.equal(refusal.code, "DATA_SEAL_FAILED")
    assert.equal(refusal.retry, "transient")
    assert.deepEqual(refusal.params, { driver: "git" })
    assert.equal(refusal.cause, cause)
    assert.equal(refusal.name, "DataRefusal")
    assert.equal(isDomainError(refusal), true)
    const plain = new DataRefusal("DATA_COPY_MISSING", "configuration")
    assert.deepEqual(plain.params, {})
    assert.equal(plain.cause, undefined)
})
