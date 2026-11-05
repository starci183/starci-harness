// The heap of a test run's parent (ops/liveness.yaml heavy.memoryMb.test) and what admission holds for it (estimateMb.test) stay one
// number, and that number holds the coverage of the largest back end the harness runs: a 1,832-spec run died at 8 GB after 1,236 specs
// (about 6.6 MB a spec held until the run ends), so the parent's heap covers 1,832 specs with room.
import assert from "node:assert/strict"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { loadHeavyRules } from "./heavy.js"

const opsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "ops")
const MB_PER_SPEC = 8192 / 1236
const LARGEST_SUITE = 1832

void test("the test heap is what admission holds, and it holds the coverage of the largest suite", () => {
    const rules = loadHeavyRules(opsDir)
    assert.equal(rules.memoryMb.test, rules.estimateMb.test, "admission holds a test run's parent at its heap ceiling")
    assert.ok(rules.memoryMb.test >= Math.ceil(MB_PER_SPEC * LARGEST_SUITE), `${String(rules.memoryMb.test)} MB holds ${String(LARGEST_SUITE)} specs at ${MB_PER_SPEC.toFixed(1)} MB each`)
    assert.ok(rules.memoryMb.test > rules.memoryMb.eslint, "a coverage run outgrows a typed lint")
})
