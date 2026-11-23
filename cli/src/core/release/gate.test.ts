// The harness's own two-level gate (owner: "rules là k check nhánh khi dev, khi nào push mới check tổng 1 lần sửa 1 lần vẫn hơn"): the FAST level builds and
// typechecks what the diff changed and its dependents and runs the publish checks, no test suite; the FULL level of the train adds every package, the
// tests, lint and CI's light gates (core/release/gate.ts).
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { blockingFindings } from "../../harness/land-queue.js"
import { CI_LIGHT_GATES, harnessGateSteps, runHarnessGate, tsSpecifierDeclarations } from "./gate.js"
import type { GateStep } from "./gate.js"
import type { Affected } from "./affected.js"

const SCRIPTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    "packages/grammar": { build: "tsc", typecheck: "tsc --noEmit", lint: "eslint .", test: "jest" },
    "packages/gallery": { build: "tsc", test: "jest" },
    "packages/tsconfig": {},
    cli: { build: "tsc", typecheck: "tsc --noEmit", lint: "eslint .", test: "node --test" },
}
const scriptsOf = (dir: string): Readonly<Record<string, string>> => SCRIPTS[dir] ?? {}

const plan = (over: Partial<Affected> = {}): Affected => ({
    base: "b".repeat(40), head: "h".repeat(40), full: false, changed: ["packages/grammar/src/a.ts"],
    packages: [
        { name: "@starci/grammar", dir: "packages/grammar", build: ["packages/tsconfig", "packages/grammar"] },
        { name: "@starci/gallery", dir: "packages/gallery", build: ["packages/tsconfig", "packages/grammar", "packages/gallery"] },
    ],
    harness: false, app: false, appBuild: [], matrix: { include: [] }, summary: ["base b head h", "packages: grammar, gallery"],
    ...over,
})

const named = (steps: readonly GateStep[]): string[] => steps.map((step) => `${step.kind} ${step.dir}${step.args === undefined ? "" : ` ${step.args.join(" ")}`}`)

void test("the FAST level installs and builds each build order once, then typechecks each affected package and runs its publish checks; no test suite, no lint, no CLI it does not need", () => {
    const steps = named(harnessGateSteps(plan(), "dev", scriptsOf))
    assert.deepEqual(steps, [
        "install packages/tsconfig",
        "install packages/grammar",
        "build packages/grammar",
        "typecheck packages/grammar",
        "declarations packages/grammar",
        "install packages/gallery",
        "build packages/gallery",
        "declarations packages/gallery",
    ])
    assert.ok(!steps.some((step) => step.startsWith("test ")), "a landing on dev runs no test suite: tests belong to the release (full) gate")
})

void test("a package with bundles:check runs it at the FAST level, and nothing of its test script", () => {
    const hfs = { "packages/hfs": { build: "tsc", typecheck: "tsc --noEmit", "bundles:check": "npm run build && node scripts/sync-bundles.mjs --check", test: "npm run typecheck && node-test" } }
    const steps = named(harnessGateSteps(plan({ packages: [{ name: "@starci/hfs", dir: "packages/hfs", build: ["packages/hfs"] }] }), "dev", (dir): Readonly<Record<string, string>> => (dir === "packages/hfs" ? hfs["packages/hfs"] : {})))
    assert.deepEqual(steps, ["install packages/hfs", "build packages/hfs", "typecheck packages/hfs", "declarations packages/hfs", "bundles packages/hfs"])
})

void test("an affected CLI is installed, built and typechecked at the FAST level, never tested", () => {
    const steps = named(harnessGateSteps(plan({ packages: [], harness: true }), "dev", scriptsOf))
    assert.deepEqual(steps, ["install cli", "build cli", "typecheck cli"])
})

void test("the FULL level keeps every test suite and adds lint, the CLI and CI's light gates", () => {
    const steps = named(harnessGateSteps(plan(), "full", scriptsOf))
    for (const step of ["test packages/grammar", "test packages/gallery", "test cli", "lint packages/grammar", "lint cli", "declarations packages/grammar"]) assert.ok(steps.includes(step), step)
    assert.deepEqual(steps.slice(-CI_LIGHT_GATES.length), CI_LIGHT_GATES.map((args) => `check . ${args.join(" ")}`))
})

void test("a built declaration naming a .ts specifier is found; .js specifiers and a missing dist are clean", () => {
    const folder = mkdtempSync(join(tmpdir(), "gate-decl-"))
    try {
        assert.deepEqual(tsSpecifierDeclarations(folder), [])
        mkdirSync(join(folder, "dist", "sub"), { recursive: true })
        writeFileSync(join(folder, "dist", "index.d.ts"), 'export * from "./a.js"\n')
        writeFileSync(join(folder, "dist", "sub", "b.d.ts"), 'import type { A } from "../a.js"\nexport type B = import("./c.ts").C\n')
        assert.deepEqual(tsSpecifierDeclarations(folder), ["dist/sub/b.d.ts:2"])
    } finally {
        rmSync(folder, { recursive: true, force: true })
    }
})

void test("a red build skips what needs it, names the folder in a finding the lander reads, and every other step still runs", async () => {
    const ran: string[] = []
    const gate = await runHarnessGate("/r", plan(), "dev", scriptsOf, (_root, step) => {
        ran.push(`${step.kind} ${step.dir}`)
        return Promise.resolve(step.kind === "build" && step.dir === "packages/grammar" ? { ok: false, output: "TS2322 in src/a.ts" } : { ok: true, output: "" })
    })
    assert.equal(gate.verdict, "red")
    assert.deepEqual(ran, ["install packages/tsconfig", "install packages/grammar", "build packages/grammar"], "grammar's own steps and gallery (which builds against it) are skipped")
    assert.deepEqual(gate.findings.map((finding) => [finding.code, finding.path]), [["HARNESS_GATE_BUILD", "packages/grammar"]])
    assert.deepEqual(blockingFindings(JSON.stringify({ ok: false, data: gate })), [{ code: "HARNESS_GATE_BUILD", path: "packages/grammar", message: gate.findings[0]?.message ?? "" }], "the batch lander reads the verdict from the --json envelope")
    const green = await runHarnessGate("/r", plan(), "dev", scriptsOf, () => Promise.resolve({ ok: true, output: "" }))
    assert.equal(green.verdict, "green")
    assert.deepEqual(blockingFindings(JSON.stringify({ data: green })), [])
})
