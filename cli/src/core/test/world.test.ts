// The run `starci test integration|e2e` makes and the report it prints. Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { CACHE_ENV, REPORT_ENV, WORKERS_ENV, linesOf, preflightOf, reportOf, testE2eVerb, testIntegrationVerb, specPattern, workersOf, worldRun } from "./world.js"
import type { WorldLine } from "./world.js"

void test("the verbs are `test integration` and `test e2e`, local-write, on request", () => {
    assert.deepEqual(testIntegrationVerb.path, ["test", "integration"])
    assert.deepEqual(testE2eVerb.path, ["test", "e2e"])
    for (const verb of [testIntegrationVerb, testE2eVerb]) {
        assert.equal(verb.effect, "local-write")
        assert.deepEqual(Object.keys(verb.flags).sort((left, right) => left.localeCompare(right)), ["full", "spec", "workers"])
    }
})

void test("a run is the app's own script of the kind, on the declared workers and cached unless asked otherwise", () => {
    const plain = worldRun("integration", { full: false, spec: [], workers: undefined }, "/tmp/report.json")
    assert.deepEqual(plain.argv, ["npm", "run", "test:integration"])
    assert.deepEqual(plain.env, { [REPORT_ENV]: "/tmp/report.json" }, "the workers are the app's own declaration")
    assert.equal(CACHE_ENV in plain.env, false, "the cache is on")
})

void test("--full turns the cache off, --spec names the files as one escaped --testPathPattern= after `--`, --workers sets the worker count", () => {
    const run = worldRun("e2e", { full: true, spec: ["be\\src\\tests\\e2e\\todo\\flow.e2e-spec.ts", "other.e2e-spec"], workers: 3 }, "r.json")
    assert.deepEqual(run.argv, ["npm", "run", "test:e2e", "--", "--testPathPattern=be/src/tests/e2e/todo/flow\\.e2e-spec\\.ts|other\\.e2e-spec"])
    assert.deepEqual(run.env, { [REPORT_ENV]: "r.json", [WORKERS_ENV]: "3", [CACHE_ENV]: "off" })
})

void test("--workers is a positive integer and absent by default, so the app's declaration decides", () => {
    assert.equal(workersOf(undefined), undefined)
    assert.equal(workersOf("4"), 4)
    for (const wrong of ["0", "-2", "1.5", "two", ""]) assert.throws(() => workersOf(wrong), { code: "TEST_WORLD_WORKERS" }, wrong)
})

void test("the runner's report file is read, and a missing or foreign one is no lines", () => {
    const lines: WorldLine[] = [{ spec: "be/a.e2e-spec.ts", kind: "e2e", outcome: "cached", ms: 1500, why: "x" }]
    assert.deepEqual(linesOf(JSON.stringify({ lines, summary: "s" })), lines)
    for (const text of ["", "not json", "[]", "null", JSON.stringify({ lines: "x" })]) assert.deepEqual(linesOf(text), [], text)
})

void test("the report names each spec file with its time and sums what the cache saved", () => {
    const lines: WorldLine[] = [
        { spec: "be/a.e2e-spec.ts", kind: "e2e", outcome: "cached", ms: 4200, why: "" },
        { spec: "be/b.e2e-spec.ts", kind: "e2e", outcome: "ran", ms: 2000, why: "changed: spec" },
        { spec: "be/c.e2e-spec.ts", kind: "e2e", outcome: "failed", ms: 500, why: "new or previously red" },
    ]
    assert.equal(
        reportOf(lines),
        [
            "cached  be/a.e2e-spec.ts  green before in 4.2s",
            "ran     be/b.e2e-spec.ts  2.0s, changed: spec",
            "FAILED  be/c.e2e-spec.ts  500ms, new or previously red",
            "3 spec file(s): 1 ran, 1 cached, 1 failed; 2.5s spent, 4.2s saved by the cache",
        ].join("\n"),
    )
})

/** An app whose back end has `@starci/jest-preset` installed with the given `world-cache` module. */
const appWithPreset = (cache: string | undefined): string => {
    const root = mkdtempSync(join(tmpdir(), "starci-world-"))
    mkdirSync(join(root, "be"), { recursive: true })
    writeFileSync(join(root, "be", "package.json"), "{}")
    if (cache !== undefined) {
        const installed = join(root, "be", "node_modules", "@starci", "jest-preset")
        mkdirSync(installed, { recursive: true })
        writeFileSync(join(installed, "package.json"), JSON.stringify({ name: "@starci/jest-preset", version: "2.10.0", exports: { "./world-cache": "./cache.js" } }))
        writeFileSync(join(installed, "cache.js"), cache)
    }
    return root
}

void test("the preflight is read through the preset the app has installed, and an app without it goes to jest", () => {
    const bare = mkdtempSync(join(tmpdir(), "starci-world-"))
    const roots = [bare, appWithPreset(undefined), appWithPreset("exports.other = 1\n"), appWithPreset("exports.preflight = (be, kind) => ({ specs: 2, allCached: true, lines: [], be, kind })\n")]
    try {
        assert.equal(preflightOf(roots[0] ?? "", "e2e"), undefined, "no be/ folder")
        assert.equal(preflightOf(roots[1] ?? "", "e2e"), undefined, "no preset installed")
        assert.equal(preflightOf(roots[2] ?? "", "e2e"), undefined, "a preset without preflight")
        assert.deepEqual(preflightOf(roots[3] ?? "", "e2e"), { specs: 2, allCached: true, lines: [], be: join(roots[3] ?? "", "be"), kind: "e2e" })
    } finally {
        for (const root of roots) rmSync(root, { recursive: true, force: true })
    }
})

void test("a spec is never a bare argument that jest --selectProjects would read as a project name", () => {
    const run = worldRun("integration", { full: false, spec: ["src/a(1).spec.ts"], workers: undefined }, "r.json")
    assert.equal(run.argv.length, 5)
    assert.ok(run.argv[4]?.startsWith("--testPathPattern="))
    assert.equal(new RegExp(run.argv[4]?.slice("--testPathPattern=".length) ?? "").test("D:/app/be/src/a(1).spec.ts"), true)
    assert.equal(specPattern("a.b"), "a\\.b")
})
