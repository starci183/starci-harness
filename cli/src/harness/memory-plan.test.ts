// The memory plan of `app check` (RAM-SIZING) and the fixed sizing of a test run: the check's own heap from the cache records, the lint chunk, the
// parent's re-execution rule, and a test run's workers, caps and arguments, process limits that never decide admission.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { heapFor, hfsLimitsEnv, loadHeavyRules, testRunEnv, testRunSizing, testWorkerArgs, testWorkerCap, type Held, type HeavyRules } from "./heavy.js"
import { formatPlan, MEMORY_REEXEC_ENV, measureScope, needsReexec, planMemory, type Scope } from "./memory-plan.js"

const opsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "ops")
const rules: HeavyRules = { ...loadHeavyRules(opsDir), testWorkers: "50%" }

const REFERENCE: Scope = { coverageMb: 494, recordMb: 520, largestMb: 31 }

/** The value, asserted present. */
const must = <T>(value: T | null | undefined): T => {
    assert.ok(value !== null && value !== undefined)
    return value
}

void test("the plan holds the check's own heap from the cache records, and the lint chunk", () => {
    const plan = must(planMemory(REFERENCE, rules))
    assert.equal(plan.parentMb, 3072, "1024 + 3 x 520 MB of records, streamed, rounded up")
    assert.equal(plan.lintChunk, 600)
    assert.equal(must(planMemory({ coverageMb: 0.5, recordMb: 1, largestMb: 0.2 }, rules)).parentMb, 2048, "the floor")
    assert.equal(must(planMemory({ coverageMb: 9000, recordMb: 9000, largestMb: 31 }, rules)).parentMb, 16384, "the ceiling")
    assert.equal(planMemory(REFERENCE, { ...rules, plan: undefined }), null, "an ops file without a plan block plans nothing")
})

void test("a test run takes min(testWorkers of the cores, its caller's cap) workers, at least one, one core left to the parent", () => {
    assert.equal(testRunSizing(rules, 12).workers, testWorkerCap(rules, 12))
    assert.equal(testRunSizing(rules, 28).workers, 14, "half the cores")
    assert.equal(testRunSizing(rules, 2).workers, 1, "one core stays free for the parent")
    assert.equal(testRunSizing(rules, 12, 1).workers, 1, "a caller that names a cap (the jest discovery) keeps it")
    const sizing = testRunSizing(rules, 28)
    assert.equal(sizing.holdMb, sizing.parentMb + sizing.workers * sizing.workerMb)
    assert.equal(hfsLimitsEnv(rules).STARCI_TSC_HEAP_MB, String(rules.caps.tsc.capMb), "the tsc heap cap reaches the app check, which sizes its tsc programs by it")
    assert.equal(heapFor(rules, "tsc"), rules.caps.tsc.capMb, "a tool runs under its cap")
    assert.equal(heapFor(rules, "eslint"), rules.caps.eslint.capMb)
})

void test("the worker args carry the worker count and the idle memory limit, and the environment the heap caps", () => {
    const sizing = testRunSizing(rules, 28)
    const held: Held = { options: {}, rules, test: sizing }
    assert.deepEqual(testWorkerArgs(["node", "jest", "--coverage"], held), ["node", "jest", "--coverage", `--maxWorkers=${String(sizing.workers)}`, `--workerIdleMemoryLimit=${String(rules.testRun.workerMb)}MB`])
    assert.deepEqual(testWorkerArgs(["node", "jest.js"], held), ["node", "jest.js", `--maxWorkers=${String(sizing.workers)}`, `--workerIdleMemoryLimit=${String(rules.testRun.workerMb)}MB`])
    assert.deepEqual(testWorkerArgs(["jest", "--maxWorkers=2", "--workerIdleMemoryLimit=1GB"], held), ["jest", "--maxWorkers=2", "--workerIdleMemoryLimit=1GB"], "an argv that sets them keeps them")
    assert.deepEqual(testWorkerArgs(["vitest", "run"], held), ["vitest", "run", `--maxWorkers=${String(sizing.workers)}`], "vitest takes the count only")
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
    const env = testRunEnv(testRunSizing(rules, 28), "")
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
    const plan = must(planMemory(REFERENCE, rules))
    assert.equal(needsReexec(plan, {}, 4144), false, "4 GB holds the streamed parent of 3 GB")
    assert.equal(needsReexec({ ...plan, parentMb: 5632 }, {}, 4144), true)
    assert.equal(needsReexec({ ...plan, parentMb: 5632 }, { [MEMORY_REEXEC_ENV]: "1" }, 4144), false)
})

void test("--explain prints the test run's sizing", () => {
    const lines = formatPlan(must(planMemory(REFERENCE, rules)), rules, 28)
    assert.ok(lines.some((line) => line.includes("a test run: parent") && line.includes("14 workers at 1536 MB")), lines.join("\n"))
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
