// The memory plan of `app check` (RAM-SIZING) and the greedy sizing of a test run: the check's own heap from the cache records, the lint chunk, the
// parent's re-execution rule, and a test run's workers, caps and arguments taken from the RAM free at admission and from nothing an earlier run left.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { admission, heapFor, loadHeavyRules, needsOf, testRunEnv, testRunSizing, testWorkerArgs, type Held, type HeavyRules } from "./heavy.js"
import { formatPlan, MEMORY_REEXEC_ENV, measureScope, needsReexec, planMemory, type Scope } from "./memory-plan.js"

const opsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "ops")
const rules: HeavyRules = { ...loadHeavyRules(opsDir), testWorkers: "50%" }

const NIVO: Scope = { coverageMb: 494, recordMb: 520, largestMb: 31 }
const GB = 1024

/** The value, asserted present. */
const must = <T>(value: T | null | undefined): T => {
    assert.ok(value !== null && value !== undefined)
    return value
}

/** The room a command finds on a host with `freeMb` free and nothing admitted lately. */
const roomOf = (freeMb: number): number => freeMb - rules.reserveMb

void test("one reserve of 4 GB is the only headroom, and a test run needs a parent and one worker to start", () => {
    assert.equal(rules.reserveMb, 4096)
    assert.equal(needsOf(rules).test, rules.testRun.parentMb + rules.testRun.workerMb)
    assert.equal(needsOf(rules).tsc, rules.caps.tsc.minMb)
})

void test("the plan holds the check's own heap from the cache records, and the lint chunk", () => {
    const plan = must(planMemory(NIVO, rules))
    assert.equal(plan.parentMb, 3072, "1024 + 3 x 520 MB of records, streamed, rounded up")
    assert.equal(plan.lintChunk, 600)
    assert.equal(must(planMemory({ coverageMb: 0.5, recordMb: 1, largestMb: 0.2 }, rules)).parentMb, 2048, "the floor")
    assert.equal(must(planMemory({ coverageMb: 9000, recordMb: 9000, largestMb: 31 }, rules)).parentMb, 16384, "the ceiling")
    assert.equal(planMemory(NIVO, { ...rules, plan: undefined }), null, "an ops file without a plan block plans nothing")
})

void test("nivo-like numbers (22 GB free, 28 cores) give the workers the caps divide the room into", () => {
    const sizing = testRunSizing(rules, roomOf(22 * GB), 28)
    assert.equal(sizing.parentMb, rules.testRun.parentMb)
    assert.equal(sizing.workers, 7, "floor((22528 - 4096 - 7168) / 1536)")
    assert.equal(sizing.workerMb, rules.testRun.workerMb)
    assert.equal(sizing.holdMb, sizing.parentMb + 7 * sizing.workerMb)
    assert.equal(testRunSizing(rules, roomOf(200 * GB), 28).workers, 14, "never above half the cores")
    assert.equal(testRunSizing(rules, roomOf(200 * GB), 2).workers, 1, "one core stays free for the parent")
})

void test("a low-RAM host (7 GB free) runs one worker, and the floor is one whatever the room", () => {
    assert.equal(testRunSizing(rules, roomOf(7 * GB), 28).workers, 1)
    assert.equal(testRunSizing(rules, -500, 28).workers, 1)
    assert.equal(testRunSizing(rules, 0, 28).parentMb, rules.testRun.parentMb, "the parent keeps its cap")
})

void test("more room never gives fewer workers, and a tsc takes its cap or the room when that is less, never under its minimum", () => {
    const sizes = [roomOf(10 * GB), roomOf(14 * GB), roomOf(22 * GB), roomOf(40 * GB)].map((room) => testRunSizing(rules, room, 28).workers)
    for (let at = 1; at < sizes.length; at += 1) assert.ok(must(sizes[at]) >= must(sizes[at - 1]))
    assert.equal(heapFor(rules, "tsc", 20 * GB), rules.caps.tsc.capMb)
    assert.equal(heapFor(rules, "tsc", 6 * GB), 6 * GB, "less room than its cap: the room")
    assert.equal(heapFor(rules, "tsc", 1000), rules.caps.tsc.minMb, "alone on almost no room: its minimum")
})

void test("the worker args carry the worker count and the idle memory limit, and the environment the heap caps", () => {
    const sizing = testRunSizing(rules, roomOf(22 * GB), 28)
    const held: Held = { options: {}, roomMb: roomOf(22 * GB), rules, test: sizing }
    assert.deepEqual(testWorkerArgs(["node", "jest", "--coverage"], held), ["node", "jest", "--coverage", "--maxWorkers=7", `--workerIdleMemoryLimit=${String(rules.testRun.workerMb)}MB`])
    assert.deepEqual(testWorkerArgs(["node", "jest.js"], held), ["node", "jest.js", "--maxWorkers=7", `--workerIdleMemoryLimit=${String(rules.testRun.workerMb)}MB`])
    assert.deepEqual(testWorkerArgs(["jest", "--maxWorkers=2", "--workerIdleMemoryLimit=1GB"], held), ["jest", "--maxWorkers=2", "--workerIdleMemoryLimit=1GB"], "an argv that sets them keeps them")
    assert.deepEqual(testWorkerArgs(["vitest", "run"], held), ["vitest", "run", "--maxWorkers=7"], "vitest takes the count only")
    assert.deepEqual(testWorkerArgs(["tsc"], held), ["tsc"])
    const env = testRunEnv(sizing, "--max-old-space-size=2048 --enable-source-maps", "C:/tmp/starci-jest-worker-heap-1.cjs")
    assert.equal(env.NODE_OPTIONS, `--enable-source-maps --max-old-space-size=${String(rules.testRun.parentMb)} --require=C:/tmp/starci-jest-worker-heap-1.cjs`, "the parent's heap is its cap")
    assert.equal(env.STARCI_WORKER_HEAP_MB, String(rules.testRun.workerMb), "the workers' heap cap")
})

void test("the preload gives each forked worker the worker heap in place of the parent's", (t) => {
    const dir = mkdtempSync(join(tmpdir(), "starci-worker-heap-"))
    t.after(() => {
        rmSync(dir, { recursive: true, force: true })
    })
    const env = testRunEnv(testRunSizing(rules, roomOf(22 * GB), 28), "")
    const child = join(dir, "child.cjs")
    writeFileSync(child, "const v8 = require('node:v8'); process.stdout.write(String(Math.round(v8.getHeapStatistics().heap_size_limit / 1048576)) + ' ' + (process.env.NODE_OPTIONS ?? ''))\n")
    const parent = join(dir, "parent.cjs")
    writeFileSync(parent, `const { fork } = require("node:child_process"); const c = fork(${JSON.stringify(child)}, [], { silent: true, env: { ...process.env } }); let out = ""; c.stdout.on("data", (d) => { out += d }); c.on("close", () => { process.stdout.write(out) })\n`)
    const run = spawnSync(process.execPath, [parent], { encoding: "utf8", env: { ...process.env, ...env } })
    const [limit = "0", ...options] = run.stdout.split(" ")
    assert.ok(Math.abs(Number(limit) - rules.testRun.workerMb) < 300, `the worker's heap limit is its ${String(rules.testRun.workerMb)} MB cap (${limit})`)
    assert.match(options.join(" "), new RegExp(`--max-old-space-size=${String(rules.testRun.workerMb)}`, "u"))
    assert.doesNotMatch(options.join(" "), /starci-jest-worker-heap/u, "the preload is not loaded again by the worker")
})

void test("the check re-executes itself only when node's heap is under the plan, and never twice", () => {
    const plan = must(planMemory(NIVO, rules))
    assert.equal(needsReexec(plan, {}, 4144), false, "4 GB holds the streamed parent of 3 GB")
    assert.equal(needsReexec({ ...plan, parentMb: 5632 }, {}, 4144), true)
    assert.equal(needsReexec({ ...plan, parentMb: 5632 }, { [MEMORY_REEXEC_ENV]: "1" }, 4144), false)
})

void test("--explain prints the test run the RAM free now would get", () => {
    const lines = formatPlan(must(planMemory(NIVO, rules)), rules, 22 * GB, 28)
    assert.ok(lines.some((line) => line.includes("a test run on the 22528 MB free now") && line.includes("7 workers at 1536 MB")), lines.join("\n"))
})

void test("the scope reads the cache folder's bytes from disk", (t) => {
    const app = mkdtempSync(join(tmpdir(), "starci-memory-scope-"))
    t.after(() => {
        rmSync(app, { recursive: true, force: true })
    })
    mkdirSync(join(app, ".starcistacks", "cache", "test-coverage", "be"), { recursive: true })
    writeFileSync(join(app, ".starcistacks", "cache", "test-coverage", "be", "root.jsonl"), "x".repeat(2 * 1_048_576))
    writeFileSync(join(app, ".starcistacks", "cache", "fingerprint.jsonl"), "x".repeat(1_048_576))
    const scope = measureScope(app)
    assert.equal(scope.coverageMb, 2)
    assert.equal(scope.recordMb, 3)
    assert.equal(scope.largestMb, 2)
})

void test("admission counts only what lately admitted commands planned, and an older command shows as live free RAM", () => {
    const free = 40 * GB
    const lately = admission(rules, free, 10, [{ kind: "tsc", mb: 8192 }], "tsc", false, null)
    const aged = admission(rules, free, 10, [{ kind: "tsc", mb: 0 }], "tsc", false, null)
    assert.equal(lately.committedMb, 8192)
    assert.equal(lately.roomMb, free - rules.reserveMb - 8192)
    assert.equal(aged.roomMb, free - rules.reserveMb, "no longer planned: free RAM shows it")
    assert.equal(admission(rules, 10 * GB, 10, [], "tsc", false, null).admits, true, "alone, a tsc starts on 10 GB free")
})

void test("nothing running admits a command whose need exceeds the room: waiting would free nothing", () => {
    const alone = admission(rules, 6000, 10, [], "test", false, null)
    assert.equal(alone.admits, true)
    assert.equal(alone.roomMb, 6000 - rules.reserveMb)
    assert.equal(alone.shortMb, needsOf(rules).test - alone.roomMb, "the shortfall is named so the caller can say it")
    assert.equal(admission(rules, 40 * GB, 10, [], "test", false, null).shortMb, 0, "a command the room holds is short of nothing")
    assert.equal(admission(rules, 200, 10, [], "tsc", false, null).admits, true, "even a host under its reserve admits the one command that runs")
    const busy = admission(rules, 6000, 10, [{ kind: "tsc", mb: 4096 }], "test", false, null)
    assert.equal(busy.admits, false, "with a command running its memory may free: the newcomer waits")
    assert.equal(busy.shortMb, 0)
})
