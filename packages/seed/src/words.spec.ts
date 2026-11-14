import assert from "node:assert/strict"
import { test } from "node:test"
import { DATA_PURPOSES, DRIVER_KINDS, GIT_CAP_BYTES, GIT_SHARD_BYTES, GIT_WARN_BYTES, STORE_KINDS } from "./words.ts"

test("the closed vocabularies list their members in manifest order and are frozen", () => {
    assert.deepEqual(STORE_KINDS, ["database", "storage"])
    assert.deepEqual(DRIVER_KINDS, ["git", "s3"])
    assert.deepEqual(DATA_PURPOSES, ["seed-standard", "seed-backup"])
    for (const list of [STORE_KINDS, DRIVER_KINDS, DATA_PURPOSES]) assert.ok(Object.isFrozen(list))
})

test("the git sizes are 500 MiB, 400 MiB (80%) and 4 MiB", () => {
    assert.equal(GIT_CAP_BYTES, 500 * 1024 * 1024)
    assert.equal(GIT_WARN_BYTES, 400 * 1024 * 1024)
    assert.equal(GIT_SHARD_BYTES, 4 * 1024 * 1024)
})
