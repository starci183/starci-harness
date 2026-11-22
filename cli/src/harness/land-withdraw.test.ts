// `lane withdraw` and the batch lander: a withdrawn lane leaves the ready set at once, a batch that already holds it aborts (nothing is
// pushed) and re-forms without it, and the re-check right before the push refuses a lane that is no longer ready.
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { withdrawLane } from "../core/lane/withdraw.js"
import { abortIfNotReady } from "./land-batch.js"
import { notReadyAny, readStatuses, readyEntries, writeReady, writeStatus } from "./land-queue.js"
import type { LaneStatus, ReadyEntry } from "./land-queue.js"

const entry = (lane: string, sha = lane.padEnd(40, "0")): ReadyEntry => ({ lane, branch: `lane/${lane}`, sha, at: `2026-11-22T00:00:0${String(lane.length)}Z` })
const folder = (): string => mkdtempSync(join(tmpdir(), "land-withdraw-"))
const statusOf = (dir: string, lane: string): LaneStatus => {
    const found = readStatuses(dir).find((status) => status.lane === lane)
    assert.ok(found, `no status for ${lane}`)
    return found
}
/** What the batch does to its lanes when it forms: each is queued in its batch. */
const inBatch = (dir: string, lanes: readonly ReadyEntry[], batch: string): void => {
    for (const lane of lanes) writeStatus(dir, { lane: lane.lane, laneSha: lane.sha, branch: lane.branch, batch, state: "queued", sha: lane.sha, reason: `in batch ${batch}, gate round 1` })
}

void test("withdraw while queued: the lane is no longer ready, so no batch takes it", () => {
    const dir = folder()
    try {
        const a = entry("a")
        const b = entry("bb")
        writeReady(dir, a)
        writeReady(dir, b)
        assert.deepEqual(withdrawLane(dir, "a"), {})
        assert.deepEqual(readyEntries(dir).map((one) => one.lane), ["bb"])
        const status = statusOf(dir, "a")
        assert.equal(status.state, "withdrawn")
        assert.equal(status.fromBatch, undefined)
        assert.equal(withdrawLane(dir, "a"), false)
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

void test("withdraw while the batch gates: the batch aborts, the withdrawn lane is never pushed, the others stay ready and say re-formed", () => {
    const dir = folder()
    const lines: string[] = []
    try {
        const lanes = [entry("a"), entry("bb"), entry("ccc")]
        for (const lane of lanes) writeReady(dir, lane)
        inBatch(dir, lanes, "B1")
        assert.equal(abortIfNotReady(dir, "B1", lanes, (line) => lines.push(line)), undefined)
        assert.deepEqual(withdrawLane(dir, "bb"), { fromBatch: "B1" })
        const outcome = abortIfNotReady(dir, "B1", lanes, (line) => lines.push(line))
        assert.match(outcome ?? "", /^aborted, re-formed: bb withdrawn from batch B1; 2 lane\(s\) stay ready/)
        const withdrawn = statusOf(dir, "bb")
        assert.equal(withdrawn.state, "withdrawn")
        assert.equal(withdrawn.fromBatch, "B1")
        for (const name of ["a", "ccc"]) {
            const status = statusOf(dir, name)
            assert.equal(status.state, "queued")
            assert.equal(status.reformedFrom, "B1")
            assert.match(status.reason ?? "", /re-formed: bb withdrawn/)
        }
        // The next batch forms from the ready set: the others, without the withdrawn lane.
        assert.deepEqual(readyEntries(dir).map((one) => one.lane).sort((left, right) => left.localeCompare(right)), ["a", "ccc"])
        assert.equal(lines.length, 1)
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

void test("the land-time check refuses a lane that is no longer ready, and one registered again with another sha", () => {
    const dir = folder()
    try {
        const a = entry("a")
        const b = entry("bb")
        writeReady(dir, a)
        writeReady(dir, b)
        assert.deepEqual(notReadyAny(dir, [a, b]), { withdrawn: [], replaced: [] })
        withdrawLane(dir, "a")
        assert.deepEqual(notReadyAny(dir, [a, b]).withdrawn.map((one) => one.lane), ["a"])
        writeReady(dir, { ...b, sha: "f".repeat(40) })
        assert.deepEqual(notReadyAny(dir, [a, b]).replaced.map((one) => one.lane), ["bb"])
        assert.match(abortIfNotReady(dir, "B2", [b], () => undefined) ?? "", /bb registered again from batch B2 \(bb superseded by ffffffffff\); 0 lane\(s\) stay ready/)
        // The new registration is the lane's status now: queued at its new sha, superseding the old one (owner: "nếu push commit mới thì cancel lun commit cũ").
        const status = statusOf(dir, "bb")
        assert.equal(status.supersededBy, "f".repeat(40))
        assert.equal(status.laneSha, "f".repeat(40))
        assert.equal(status.state, "queued")
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})
