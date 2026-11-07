// The memory plan of `app check` (RAM-SIZING, decision memory-plan): the fitted formulas at a Nivo-sized and a tiny scope, the clamps, the workers
// against free RAM, a factor learned after an over-peak run, the parent's re-execution rule, the side a child judges, and admission holding a
// planned row at its planned MB.
import assert from "node:assert/strict"
import { existsSync, mkdirSync, readdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { plannedFor, requestSide } from "../core/app/hfs.js"
import { admission, loadHeavyRules, plannedWorkerCount, testWorkerArgs, type Held, type HeavyRules } from "./heavy.js"
import { factorsPath, formatPlan, learnPeak, MAX_FACTOR, MEMORY_REEXEC_ENV, needsReexec, planMemory, readFactors, scopeOf, type Scope } from "./memory-plan.js"

// The learned factors live in the tool cache; the specs keep it in a scratch folder of their own.
process.env.STARCI_CACHE_HOME = mkdtempSync(join(tmpdir(), "starci-memory-cache-"))

const opsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "ops")
const rules: HeavyRules = { ...loadHeavyRules(opsDir), testWorkers: "50%" }

const NIVO: Scope = { sides: { be: { specs: 1831, sources: 7000 }, fe: { specs: 400, sources: 3000 } }, coverageMb: 494, recordMb: 520, largestMb: 31 }
/** The value, asserted present. */
const must = <T>(value: T | null | undefined): T => {
    assert.ok(value !== null && value !== undefined)
    return value
}

const TINY: Scope = { sides: { be: { specs: 12, sources: 80 } }, coverageMb: 0.5, recordMb: 1, largestMb: 0.2 }

void test("a Nivo-sized scope gets the fitted heaps: a 14 GB coverage parent, an 8 GB back-end tsc, and the workers the free RAM holds", () => {
    const wide = planMemory(NIVO, rules, 26 * 1024, 16)
    assert.ok(wide !== null)
    const be = wide.sides.be
    assert.ok(be !== undefined)
    assert.equal(be.testParentMb, 14336, "ceil512(1.15 x 6.7 x 1831)")
    assert.equal(be.typesMb, 8192, "1536 + 0.95 x 7000, rounded up")
    assert.equal(be.workers, 8, "26 GB free less 6 GB holds the cap of 8 at their worker heap")
    assert.equal(wide.parentMb, 3072, "1024 + 3 x 520 MB of records, streamed, rounded up")
    const tight = planMemory(NIVO, rules, 15 * 1024, 16)
    assert.equal(must(must(tight).sides.be).workers, 3, "15 GB free gives 3 workers, one under the 4 that ran, which errs safe")
    assert.ok(must(must(tight).sides.be).testWorkerMb > be.testWorkerMb, "fewer workers each take more of the specs")
})

void test("a tiny app is planned at the floors, not at the largest app's heap", () => {
    const plan = planMemory(TINY, rules, 8192, 4)
    assert.deepEqual(must(plan).sides.be, { testParentMb: 4096, testWorkerMb: 2048, workers: 1, typesMb: 2048 })
    assert.equal(must(plan).parentMb, 2048)
    assert.equal(must(plan).lintChunk, 600, "the lint chunk stays at its default until a peak per file was learned")
})

void test("every heap is clamped to its ceiling, and a learned lint cost sets the chunk within its bounds", () => {
    const huge: Scope = { sides: { be: { specs: 50_000, sources: 90_000 } }, coverageMb: 9000, recordMb: 9000, largestMb: 31 }
    const plan = planMemory(huge, rules, 64 * 1024, 32, { lintPerFileMb: 100 })
    assert.equal(must(must(plan).sides.be).testParentMb, 16384)
    assert.equal(must(must(plan).sides.be).typesMb, 12288)
    assert.equal(must(plan).parentMb, 16384)
    assert.equal(must(plan).lintChunk, 200, "8192 MB over 100 MB a file is under the floor of 200")
    assert.equal(must(planMemory(TINY, rules, 8192, 4, { lintPerFileMb: 1 })).lintChunk, 1200)
    assert.equal(planMemory(TINY, { ...rules, plan: undefined }), null, "an ops file without a plan block plans nothing")
})

void test("a child that peaks more than 20% over its plan raises its kind's factor for the next run, and the plan applies it", (t) => {
    const app = mkdtempSync(join(tmpdir(), "starci-memory-plan-"))
    t.after(() => {
        rmSync(app, { recursive: true, force: true })
    })
    assert.equal(learnPeak(app, "tsc", 8192, 9000, 20), null, "within 20% is no lesson")
    const warning = learnPeak(app, "tsc", 8192, 12288, 20)
    assert.match(warning ?? "", /tsc peaked at 12288 MB, over its planned 8192 MB/u)
    assert.equal(readFactors(app).tsc, 1.5)
    assert.ok(factorsPath(app).startsWith(process.env.STARCI_CACHE_HOME ?? ""), "the factors are written in the tool cache")
    assert.ok(existsSync(factorsPath(app)))
    assert.equal(existsSync(join(app, ".starciwork")), false, "the governor writes nothing into the app's .starciwork")
    assert.deepEqual(readdirSync(app), [], "a learned factor leaves no file in the app")
    assert.equal(learnPeak(app, "eslint", 100, 1000, 20), null, "a kind the plan does not size learns nothing")
    const planned = planMemory({ sides: { be: { specs: 0, sources: 4000 } }, coverageMb: 0, recordMb: 0, largestMb: 0 }, rules, 32 * 1024, 8, readFactors(app))
    assert.equal(must(must(planned).sides.be).typesMb, Math.ceil(((1536 + 0.95 * 4000) * 1.5) / 512) * 512)
    assert.ok(formatPlan(must(planned)).some((line) => line.includes("tsc x1.50")))
})

void test("the check re-executes itself only when node's heap is under the plan, and never twice", () => {
    const plan = planMemory(NIVO, rules, 26 * 1024, 16)
    assert.ok(plan !== null)
    assert.equal(needsReexec(plan, {}, 4144), false, "4 GB holds the streamed parent of 3 GB")
    assert.equal(needsReexec({ ...plan, parentMb: 5632 }, {}, 4144), true)
    assert.equal(needsReexec({ ...plan, parentMb: 5632 }, { [MEMORY_REEXEC_ENV]: "1" }, 4144), false)
})

void test("the scope counts specs and sources per side from the index and the cache folder's bytes from disk", (t) => {
    const app = mkdtempSync(join(tmpdir(), "starci-memory-scope-"))
    t.after(() => {
        rmSync(app, { recursive: true, force: true })
    })
    mkdirSync(join(app, ".starcistacks", "cache", "test-coverage", "be"), { recursive: true })
    writeFileSync(join(app, ".starcistacks", "cache", "test-coverage", "be", "root.jsonl"), "x".repeat(2 * 1_048_576))
    writeFileSync(join(app, ".starcistacks", "cache", "fingerprint.jsonl"), "x".repeat(1_048_576))
    const scope = scopeOf(app, ["be/src/a.ts", "be/src/a.spec.ts", "be/src/b.d.ts", "fe/apps/web/page.tsx", "fe/apps/web/page.test.tsx", "README.md", "be/node_modules/x/index.ts"])
    assert.deepEqual(scope.sides, { be: { specs: 1, sources: 1 }, fe: { specs: 1, sources: 1 } })
    assert.equal(scope.coverageMb, 2)
    assert.equal(scope.recordMb, 3)
    assert.equal(scope.largestMb, 2)
})

void test("a coverage run and a tsc program get their side's planned heaps; other children keep their kind's", () => {
    const plan = planMemory(NIVO, rules, 26 * 1024, 16)
    const app = join(tmpdir(), "app")
    assert.equal(requestSide({ args: ["tsc", "-p", "fe/apps/web/tsconfig.json"], cwd: app }, app), "fe")
    assert.equal(requestSide({ args: ["jest"], cwd: join(app, "be") }, app), "be")
    assert.deepEqual(plannedFor(plan, { kind: "test", args: ["jest", "--coverage"], cwd: join(app, "be") }, app), { memoryMb: 14336, workerMb: plan?.sides.be?.testWorkerMb, workers: 8 })
    assert.deepEqual(plannedFor(plan, { kind: "tsc", args: ["tsc", "-p", "be/tsconfig.json"], cwd: app }, app), { memoryMb: 8192 })
    assert.equal(plannedFor(plan, { kind: "test", args: ["jest", "--listTests"], cwd: join(app, "be") }, app), undefined, "a discovery run is not a coverage run")
    assert.equal(plannedFor(null, { kind: "tsc", args: ["tsc", "-p", "be/tsconfig.json"], cwd: app }, app), undefined)
})

void test("admission holds a planned running row at its planned MB and a planned newcomer at its own", () => {
    const free = 40 * 1024
    const byKind = admission(rules, free, 10, ["test"], "tsc", false, null)
    const planned = admission(rules, free, 10, [{ kind: "test", mb: 20 * 1024 }], "tsc", false, null, 2048)
    assert.equal(byKind.committedMb, rules.estimateMb.test)
    assert.equal(planned.committedMb, 20 * 1024)
    assert.equal(planned.roomMb, free - rules.reserveMb - 20 * 1024)
    assert.equal(admission(rules, 10 * 1024, 10, [], "tsc", false, null, 3000).admits, true, "alone, a planned 3 GB tsc fits 10 GB free")
})

void test("nothing running admits a command whose estimate exceeds the room: waiting would free nothing", () => {
    // The log of the deadlock: free 23522 MB, reserve 8192 MB, a learned worker factor making the coverage run's plan 30208 MB, nothing running.
    const alone = admission(rules, 23522, 10, [], "test", false, null, 30208)
    assert.equal(alone.admits, true)
    assert.equal(alone.roomMb, 23522 - rules.reserveMb)
    assert.equal(alone.shortMb, 30208 - alone.roomMb, "the shortfall is named so the caller can say it")
    assert.equal(alone.pressure, false)
    assert.equal(admission(rules, 40 * 1024, 10, [], "test", false, null, 30208).shortMb, 0, "a command the room holds is short of nothing")
    assert.equal(admission(rules, 200, 10, [], "tsc", false, null).admits, true, "even a host under its reserve admits the one command that runs")
    const busy = admission(rules, 23522, 10, [{ kind: "tsc", mb: 4096 }], "test", false, null, 30208)
    assert.equal(busy.admits, false, "with a command running its memory may free: the newcomer waits")
    assert.equal(busy.shortMb, 0)
})

void test("a planned test run gets the most workers its room holds, one when not even the parent fits", () => {
    const planned = { memoryMb: 14336, workerMb: 3984, workers: 8 }
    assert.equal(plannedWorkerCount(planned, 15330), 1, "15330 MB holds the 14336 MB parent and 994 MB: no second worker")
    assert.equal(plannedWorkerCount(planned, 24000), 3, "9664 MB over the parent holds two more")
    assert.equal(plannedWorkerCount(planned, 200_000), 8, "never more than the plan")
    assert.equal(plannedWorkerCount(planned, -500), 1)
    assert.equal(plannedWorkerCount(planned, null), 8, "a run under its parent's slot takes the plan's workers")
    const held = (roomMb: number | null): Held => ({ options: {}, roomMb, rules, planned })
    assert.deepEqual(testWorkerArgs(["jest", "--coverage"], held(24000)), ["jest", "--coverage", "--maxWorkers=3"])
    assert.deepEqual(testWorkerArgs(["jest", "--maxWorkers=2"], held(24000)), ["jest", "--maxWorkers=2"], "an argv that sets it keeps it")
    assert.deepEqual(testWorkerArgs(["tsc"], held(24000)), ["tsc"])
})

void test("a learned factor is bounded, eases when the plan overshoots, and never plans a worker above the room", (t) => {
    const app = mkdtempSync(join(tmpdir(), "starci-memory-factor-"))
    t.after(() => {
        rmSync(app, { recursive: true, force: true })
    })
    assert.match(learnPeak(app, "test", 2560, 3984, 20, true) ?? "", /factor is now x1.56/u)
    assert.match(learnPeak(app, "test", 2560, 40_000, 20, true) ?? "", /at most x2/u)
    assert.equal(readFactors(app).testWorker, MAX_FACTOR, "one wild peak cannot grow a factor past its bound")
    assert.match(learnPeak(app, "test", 4096, 1500, 20, true) ?? "", /eases to x1.7/u)
    assert.equal(readFactors(app).testWorker, 1.7)
    for (let run = 0; run < 12; run += 1) learnPeak(app, "test", 2048, 100, 20, true)
    assert.equal(readFactors(app).testWorker, 1, "a plan that keeps overshooting returns to the fitted heap")
    assert.equal(learnPeak(app, "test", 2048, 100, 20, true), null, "nothing left to ease")
    const huge = planMemory(NIVO, rules, 12 * 1024, 16, { testWorker: 50 })
    const room = 12 * 1024 - must(rules.plan).testWorker.reserveMb
    assert.ok(must(must(huge).sides.be).testWorkerMb <= room, "a hand-written factor of 50 plans no worker above the room")
})
