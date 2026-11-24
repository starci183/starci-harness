// A new gate of a lane kills the lane's running gate and releases its slot (harness/supersede.ts).
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { hostname, tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { loadSlotRules, readHolder, slotFile, slotKind } from "./slots.js"
import type { HostProbe } from "./slots.js"
import { cancelLaneGate } from "./supersede.js"

void test("a new gate of the same lane kills its running gate's process tree, releases its slot, and another lane's gate and its own are kept", () => {
    const dir = mkdtempSync(join(tmpdir(), "lane-supersede-"))
    try {
        const rules = loadSlotRules()
        const kind = slotKind(rules, "gate")
        const now = Date.now()
        const holder = (lane: string, pid: number): string => `${lane} ${new Date(now).toISOString()} pid=${String(pid)} start=${new Date(now - 1000).toISOString()} boot=${new Date(now - 3_600_000).toISOString()} host=${hostname()}`
        writeFileSync(slotFile(dir, kind, 1), holder("lane-x", 111))
        writeFileSync(slotFile(dir, kind, 2), holder("lane-y", 222))
        writeFileSync(slotFile(dir, kind, 3), holder("lane-x", process.pid))
        const probe: HostProbe = { nowMs: now, bootMs: now - 3_600_000, hostname: hostname(), alive: () => true, startMs: () => now - 1000 }
        const killed: number[] = []
        const cancelled = cancelLaneGate(dir, rules, "lane-x", process.pid, (pid) => {
            killed.push(pid)
            return true
        }, probe)
        assert.deepEqual(killed, [111])
        assert.deepEqual(cancelled.map((run) => run.pid), [111])
        assert.equal(readHolder(slotFile(dir, kind, 1)), undefined, "its slot is released")
        assert.equal(readHolder(slotFile(dir, kind, 2))?.holder, "lane-y", "another lane's gate is kept")
        assert.equal(readHolder(slotFile(dir, kind, 3))?.pid, process.pid, "this run's own slot is kept")
        const dead = cancelLaneGate(dir, rules, "lane-y", process.pid, () => assert.fail("a dead holder is a reclaim, never a kill"), { ...probe, alive: () => false })
        assert.deepEqual(dead, [])
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})
