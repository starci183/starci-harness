import assert from "node:assert/strict"
import { test } from "node:test"
import { isPlainRecord, isRecord } from "./index.ts"

test("isRecord admits every non-null object, arrays included", () => {
    assert.equal(isRecord({ status: 200 }), true)
    assert.equal(isRecord([]), true)
    assert.equal(isRecord(null), false)
    assert.equal(isRecord(undefined), false)
    assert.equal(isRecord("response"), false)
    assert.equal(isRecord(200), false)
})

test("isPlainRecord admits a non-null object that is no array", () => {
    assert.equal(isPlainRecord({ status: 200 }), true)
    assert.equal(isPlainRecord([]), false)
    assert.equal(isPlainRecord(null), false)
    assert.equal(isPlainRecord("response"), false)
})
