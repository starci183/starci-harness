// The batch lander and memory: a gate (or a check inside it) that ran out of memory blames no lane; the round runs again once the host has
// RAM, at most OOM_RETRIES more times, and a round that keeps running out of memory parks the batch instead of rejecting it; a real
// finding is still judged as before.
import assert from "node:assert/strict"
import test from "node:test"
import { judgeWithOomRetry, waitForFreeRam } from "./land-batch.js"
import type { GateRun } from "./land-batch.js"
import { OOM_RETRIES, isOutOfMemory, judgeRound } from "./land-queue.js"
import type { RoundVerdict } from "./land-queue.js"

const report = (...findings: readonly { code: string; path: string; message: string }[]): string =>
    JSON.stringify({ data: { output: { findings: findings.map((finding) => ({ ...finding, level: "error" })) } } })
const changed = new Map<string, readonly string[]>([["lane-a", ["packages/a/src/a.ts"]], ["lane-b", ["packages/b/src/b.ts"]]])
const cache = { code: "HFS_CHECK_CACHE_UNWARMED", path: ".starcistacks/cache", message: "warm the cache" }
/** The lanes a drop verdict names; none for any other verdict. */
const blamedLanes = (verdict: RoundVerdict): string[] => (verdict.kind === "drop" ? [...verdict.blamed.keys()] : [])
const heapAbort = {
    code: "HFS_PROJECT_CHECK_FAILED",
    path: "ext/checks/package-boundary.mjs",
    message: "project check package-boundary failed (exit 134): FATAL ERROR: Committing semi space failed. Allocation failed - JavaScript heap out of memory",
}

void test("each out-of-memory mark is recognised, and an ordinary failure is not", () => {
    assert.equal(isOutOfMemory(134), true)
    assert.equal(isOutOfMemory(137), true)
    assert.equal(isOutOfMemory(3221226505), true)
    assert.equal(isOutOfMemory(1, "starci: heap cap 4096 MB reached; free RAM was 87 MB at admission"), true)
    assert.equal(isOutOfMemory(1, "<--- Last few GCs ---> FATAL ERROR: Reached heap limit Allocation failed"), true)
    assert.equal(isOutOfMemory(1, "Error: spawn ENOMEM"), true)
    assert.equal(isOutOfMemory(undefined, "npm run build:modules exited 134"), true)
    assert.equal(isOutOfMemory(undefined, "command (packages/x) npm run build exited (134)"), true)
    assert.equal(isOutOfMemory(undefined, "npm run build:modules exited 1"), false)
    assert.equal(isOutOfMemory(undefined, "npm run build:modules exited 1345"), false)
    assert.equal(isOutOfMemory(1, "src/a.ts(3,1): error TS2304: Cannot find name 'x'."), false)
    assert.equal(isOutOfMemory(0, ""), false)
})

void test("a finding that reports a heap abort is oom, not an unmapped finding that rejects the batch", () => {
    const verdict = judgeRound(1, 1, report(cache, heapAbort), changed)
    assert.equal(verdict.kind, "oom")
})

void test("a gate that aborted with no report is oom; one that failed with no report and no mark is still no verdict", () => {
    assert.equal(judgeRound(1, 134, "", changed).kind, "oom")
    assert.equal(judgeRound(1, 1, "", changed, "FATAL ERROR: Reached heap limit").kind, "oom")
    assert.equal(judgeRound(1, 1, "", changed).kind, "no-verdict")
})

void test("a real finding still drops the lane its diff names; green except the cache still lands", () => {
    const verdict = judgeRound(1, 1, report(cache, { code: "TS2304", path: "packages/a/src/a.ts", message: "Cannot find name" }), changed)
    assert.equal(verdict.kind, "drop")
    assert.deepEqual(blamedLanes(verdict), ["lane-a"])
    assert.equal(judgeRound(1, 1, report(cache), changed).kind, "green")
})

const oomRun: GateRun = { exitCode: 134, stdout: "", stderr: "JavaScript heap out of memory" }
const greenRun: GateRun = { exitCode: 1, stdout: report(cache), stderr: "" }
const judge = (run: GateRun): RoundVerdict => judgeRound(1, run.exitCode, run.stdout, changed, run.stderr)

void test("a round that ran out of memory waits for RAM and runs again, and the run after it gives the verdict", async () => {
    const runs = [oomRun, greenRun]
    let waits = 0
    const judged = await judgeWithOomRetry((attempt) => Promise.resolve(runs[attempt] ?? greenRun), judge, () => { waits += 1; return Promise.resolve() }, () => undefined)
    assert.equal(judged.verdict.kind, "green")
    assert.equal(judged.oomRuns, 1)
    assert.equal(waits, 1)
})

void test("a round that keeps running out of memory stops after OOM_RETRIES repeats and ends oom (the batch parks)", async () => {
    let started = 0
    let waits = 0
    const judged = await judgeWithOomRetry(() => { started += 1; return Promise.resolve(oomRun) }, judge, () => { waits += 1; return Promise.resolve() }, () => undefined)
    assert.equal(judged.verdict.kind, "oom")
    assert.equal(started, OOM_RETRIES + 1)
    assert.equal(waits, OOM_RETRIES)
    assert.equal(judged.oomRuns, OOM_RETRIES + 1)
})

void test("the RAM wait returns at once with enough free, and otherwise polls until the reading rises above the threshold", async () => {
    const said: string[] = []
    await waitForFreeRam(6144, (line) => said.push(line), () => 9000, 1)
    assert.equal(said.length, 0)
    const readings = [100, 3000, 7000]
    let reads = 0
    await waitForFreeRam(6144, (line) => said.push(line), () => readings[Math.min(reads++, readings.length - 1)] ?? 7000, 1)
    assert.equal(reads, 3)
    assert.equal(said.length, 1)
})
