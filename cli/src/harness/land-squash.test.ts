// Owner 2026-11-22: "dồn!!! nhiều changes thì gộp 1 commit duy nhất và ci làm kiểu nếu push commit mới thì cancel lun commit cũ". The batch lander lands a batch as ONE
// commit listing its lanes and their shas (a later batch still knows those lanes are on dev), a newer registration of a lane cancels the running batch gate and the batch
// re-forms (the statuses say superseded by <sha>), and a new gate of a lane kills the lane's running gate and releases its slot (harness/land-batch.ts, supersede.ts).
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { hostname, tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { LANDED_TRAILER, abortIfNotReady, cancellableRun, judgeWithOomRetry, onBase, squashBatch, squashMessage } from "./land-batch.js"
import type { GitPort } from "./land-batch.js"
import { readStatuses, writeReady, writeStatus } from "./land-queue.js"
import type { ReadyEntry } from "./land-queue.js"
import { loadSlotRules, readHolder, slotFile, slotKind } from "./slots.js"
import type { HostProbe } from "./slots.js"
import { cancelLaneGate, markSuperseded } from "./supersede.js"

const entry = (lane: string, sha = lane.padEnd(40, "0")): ReadyEntry => ({ lane, branch: `lane/${lane}`, sha, at: "2026-11-22T00:00:00Z" })

void test("a batch lands as ONE commit on the base with the judged tree, its message listing every lane and its sha", async () => {
    const lanes = [entry("a"), entry("bb")]
    const message = squashMessage("B1", lanes)
    assert.match(message, /^land batch B1: 2 lane\(s\) onto dev \(a, bb\)\n/)
    for (const lane of lanes) {
        assert.ok(message.includes(`- ${lane.lane} (${lane.branch} ${lane.sha})`))
        assert.ok(message.includes(`${LANDED_TRAILER}: ${lane.lane} ${lane.sha}`))
    }
    const calls: (readonly string[])[] = []
    const git: GitPort = (_cwd, args) => {
        calls.push(args)
        return Promise.resolve({ ok: true, out: args[0] === "commit-tree" ? "c0ffee" : "", err: "" })
    }
    assert.equal(await squashBatch("wt", "base1", "B1", lanes, git), "c0ffee")
    assert.deepEqual(calls[0]?.slice(0, 4), ["commit-tree", "HEAD^{tree}", "-p", "base1"], "the tree the gate judged, the base its only parent")
    assert.deepEqual(calls[1], ["reset", "--soft", "c0ffee"])
    assert.equal(calls.length, 2)
})

void test("a later batch knows a squashed lane is on dev by the trailer, as it knows a merged one by ancestry", async () => {
    const lane = entry("a")
    const squashed: GitPort = (_cwd, args) => Promise.resolve(args[0] === "merge-base" ? { ok: false, out: "", err: "" } : { ok: true, out: args.includes(`--grep=${LANDED_TRAILER}: a ${lane.sha}`) ? "c0ffee" : "", err: "" })
    assert.equal(await onBase("wt", "dev", lane, squashed), true)
    assert.equal(await onBase("wt", "dev", entry("zz"), squashed), false)
    const merged: GitPort = () => Promise.resolve({ ok: true, out: "", err: "" })
    assert.equal(await onBase("wt", "dev", lane, merged), true)
})

void test("a lane registered again while its batch gates cancels the gate (its process tree killed, no verdict, never an out-of-memory run) and the batch re-forms", async () => {
    const killed: number[] = []
    let superseded = false
    // The gate ends only when it is killed (as a real process tree does), so a busy machine cannot settle it before the poll sees the supersede.
    let end: (() => void) | undefined
    const run = await cancellableRun(
        (onSpawn) =>
            new Promise((settle) => {
                end = () => {
                    settle({ exitCode: 137, stdout: "", stderr: "" })
                }
                onSpawn(4242)
                setTimeout(() => {
                    superseded = true
                }, 5)
            }),
        () => superseded,
        (pid) => {
            killed.push(pid)
            end?.()
            return true
        },
        2,
    )
    assert.equal(run.cancelled, true)
    assert.deepEqual(killed, [4242])
    const judged = await judgeWithOomRetry(() => Promise.resolve(run), () => ({ kind: "oom", evidence: "137" }), () => Promise.resolve(), () => undefined)
    assert.equal(judged.verdict.kind, "no-verdict", "a killed gate is no verdict, never parked as out of memory")
    assert.equal(judged.oomRuns, 0)
    const plain = await cancellableRun(() => Promise.resolve({ exitCode: 0, stdout: "{}", stderr: "" }), () => true, () => assert.fail("never killed once the run ended"), 1000)
    assert.equal(plain.cancelled, undefined)

    const dir = mkdtempSync(join(tmpdir(), "land-squash-"))
    try {
        const a = entry("a")
        const b = entry("bb")
        writeReady(dir, a)
        writeReady(dir, b)
        const newer = entry("a", "f".repeat(40))
        writeReady(dir, newer)
        const outcome = abortIfNotReady(dir, "B2", [a, b], () => undefined)
        assert.match(outcome ?? "", /^aborted, re-formed: a registered again from batch B2 \(a superseded by ffffffffff\); 1 lane\(s\) stay ready/)
        const statuses = new Map(readStatuses(dir).map((status) => [status.lane, status]))
        assert.equal(statuses.get("a")?.supersededBy, newer.sha)
        assert.equal(statuses.get("a")?.laneSha, newer.sha)
        assert.match(statuses.get("a")?.reason ?? "", new RegExp(`^superseded by ${newer.sha}`))
        assert.equal(statuses.get("bb")?.reformedFrom, "B2")
        assert.match(statuses.get("bb")?.reason ?? "", /a superseded by ffffffffff/)
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

void test("a new gate of the same lane kills its running gate's process tree, releases its slot and marks its status superseded; another lane's gate and its own are kept", () => {
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
        writeStatus(dir, { lane: "lane-x", laneSha: "1".repeat(40), branch: "lane/lane-x", state: "queued", sha: "1".repeat(40) })
        assert.equal(markSuperseded(dir, "lane-x", "2".repeat(40), "the running gate was cancelled by a newer push"), true)
        const status = readStatuses(dir).find((one) => one.lane === "lane-x")
        assert.equal(status?.supersededBy, "2".repeat(40))
        assert.match(status.reason ?? "", /^superseded by 2{40}: /)
        assert.equal(status.state, "queued")
        assert.equal(markSuperseded(dir, "nobody", "3".repeat(40), "x"), false)
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})
