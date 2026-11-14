import assert from "node:assert/strict"
import { test } from "node:test"
import type { SetImport } from "./store.ts"
import { importOutcome } from "./store.ts"

const counts = (over: Partial<SetImport> = {}): SetImport => ({ set: "s", created: 0, updated: 0, unchanged: 0, removed: 0, refused: [], ...over })

test("importOutcome is unchanged when nothing moved, also for no set at all", () => {
    assert.equal(importOutcome([]), "unchanged")
    assert.equal(importOutcome([counts({ unchanged: 4 })]), "unchanged")
})

test("importOutcome is applied when a set created, updated or removed a key", () => {
    assert.equal(importOutcome([counts({ created: 1 })]), "applied")
    assert.equal(importOutcome([counts(), counts({ updated: 1 })]), "applied")
    assert.equal(importOutcome([counts({ removed: 1 })]), "applied")
})

test("importOutcome is partial as soon as a door refused a key, even when others applied", () => {
    assert.equal(importOutcome([counts({ refused: [{ key: "k", code: "NO" }] })]), "partial")
    assert.equal(importOutcome([counts({ created: 3 }), counts({ refused: [{ key: "k", code: "NO" }] })]), "partial")
})
