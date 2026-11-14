import assert from "node:assert/strict"
import { test } from "node:test"
import { DATA_PURPOSES, DRIVER_KINDS, GIT_CAP_BYTES, GIT_SHARD_BYTES, GIT_WARN_BYTES, STORE_KINDS } from "./words.ts"

test("the closed vocabularies list their members in manifest order and are frozen", () => {
    assert.deepEqual(STORE_KINDS, ["database", "storage"])
    assert.deepEqual(DRIVER_KINDS, ["git", "s3"])
    assert.deepEqual(DATA_PURPOSES, ["seed-standard", "seed-backup"])
    for (const list of [STORE_KINDS, DRIVER_KINDS, DATA_PURPOSES]) assert.ok(Object.isFrozen(list))
})

test("the git sizes are 100 MiB, 80 MiB and 4 MiB", () => {
    assert.equal(GIT_CAP_BYTES, 100 * 1024 * 1024)
    assert.equal(GIT_WARN_BYTES, 80 * 1024 * 1024)
    assert.equal(GIT_SHARD_BYTES, 4 * 1024 * 1024)
})
