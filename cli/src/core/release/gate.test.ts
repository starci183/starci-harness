// The harness's own two-level gate: the FAST level builds and typechecks what the diff changed and its dependents, runs the publish checks
// and each of those packages' own npm test (CI's package jobs), never the CLI's suite; the FULL level of the train adds every package, the
// CLI's tests, lint and CI's light gates (core/release/gate.ts).
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { blockingFindings } from "../../harness/lane-state.js"
import { CI_LIGHT_GATES, failingTests, failureMessage, findingLines, harnessGateSteps, runHarnessGate, tsSpecifierDeclarations } from "./gate.js"
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

void test("the FAST level installs and builds each build order once, then typechecks each affected package, runs its publish checks and its own npm test; no lint, no CLI it does not need", () => {
    const steps = named(harnessGateSteps(plan(), "dev", scriptsOf))
    assert.deepEqual(steps, [
        "install packages/tsconfig",
        "install packages/grammar",
        "build packages/grammar",
        "typecheck packages/grammar",
        "declarations packages/grammar",
        "test packages/grammar",
        "install packages/gallery",
        "build packages/gallery",
        "declarations packages/gallery",
        "test packages/gallery",
    ])
    assert.ok(!steps.some((step) => step.startsWith("lint ")), "a landing on dev lints nothing: lint belongs to the release (full) gate")
})

void test("a package with bundles:check runs it at the FAST level, then its npm test; a typecheck its test already runs is not run twice", () => {
    const hfs = { "packages/hfs": { build: "tsc", typecheck: "tsc --noEmit", "bundles:check": "node scripts/sync-bundles.mjs --check", test: "npm run typecheck && node-test" } }
    const steps = named(harnessGateSteps(plan({ packages: [{ name: "@starci/hfs", dir: "packages/hfs", build: ["packages/hfs"] }] }), "dev", (dir): Readonly<Record<string, string>> => (dir === "packages/hfs" ? hfs["packages/hfs"] : {})))
    assert.deepEqual(steps, ["install packages/hfs", "build packages/hfs", "declarations packages/hfs", "bundles packages/hfs", "test packages/hfs"])
})

void test("the FULL level lints a package once: a lint its npm test already runs is not a second step", () => {
    const pkg = { "packages/mail": { build: "tsc", typecheck: "tsc --noEmit", lint: "eslint .", test: "npm run typecheck && npm run lint && node --test" } }
    const steps = named(harnessGateSteps(plan({ packages: [{ name: "@starci/mail", dir: "packages/mail", build: ["packages/mail"] }] }), "full", (dir): Readonly<Record<string, string>> => (dir === "packages/mail" ? pkg["packages/mail"] : {})))
    assert.ok(!steps.includes("lint packages/mail") && !steps.includes("typecheck packages/mail"), steps.join(", "))
    assert.ok(steps.includes("test packages/mail"))
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

void test("a red build skips what needs it, names the folder in a finding `lane gate` reads, and every other step still runs", async () => {
    const ran: string[] = []
    const gate = await runHarnessGate("/r", plan(), "dev", scriptsOf, (_root, step) => {
        ran.push(`${step.kind} ${step.dir}`)
        return Promise.resolve(step.kind === "build" && step.dir === "packages/grammar" ? { ok: false, output: "TS2322 in src/a.ts" } : { ok: true, output: "" })
    })
    assert.equal(gate.verdict, "red")
    assert.deepEqual(ran, ["install packages/tsconfig", "install packages/grammar", "build packages/grammar"], "grammar's own steps and gallery (which builds against it) are skipped")
    assert.deepEqual(gate.findings.map((finding) => [finding.code, finding.path]), [["HARNESS_GATE_BUILD", "packages/grammar"]])
    assert.deepEqual(blockingFindings(JSON.stringify({ ok: false, data: gate })), [{ code: "HARNESS_GATE_BUILD", path: "packages/grammar", message: gate.findings[0]?.message ?? "" }], "lane gate reads the verdict from the --json envelope")
    const green = await runHarnessGate("/r", plan(), "dev", scriptsOf, () => Promise.resolve({ ok: true, output: "" }))
    assert.equal(green.verdict, "green")
    assert.deepEqual(blockingFindings(JSON.stringify({ data: green })), [])
})

void test("the typechecks of the folders run together, the other steps in order, and the result reads in step order with a red typecheck named", async () => {
    let active = 0
    let most = 0
    const release: (() => void)[] = []
    const started: string[] = []
    const pending = runHarnessGate("/r", plan({ harness: true }), "dev", scriptsOf, async (_root, step) => {
        started.push(`${step.kind} ${step.dir}`)
        if (step.kind !== "typecheck") return { ok: true, output: "" }
        active += 1
        most = Math.max(most, active)
        await new Promise<void>((resolve) => release.push(resolve))
        active -= 1
        return step.dir === "cli" ? { ok: false, output: "TS2322 in src/a.ts" } : { ok: true, output: "" }
    })
    // Both typechecks are in flight before either finishes: the second started while the first still ran.
    for (let waited = 0; release.length < 2 && waited < 200; waited += 1) await new Promise<void>((resolve) => setTimeout(resolve, 5))
    assert.equal(release.length, 2, "both typechecks started before either finished")
    release.forEach((go) => {
        go()
    })
    const gate = await pending
    assert.equal(most, 2)
    assert.deepEqual(gate.steps.map((step) => `${step.kind} ${step.dir}`), named(harnessGateSteps(plan({ harness: true }), "dev", scriptsOf)).map((line) => line.replace(/ $/, "")))
    assert.deepEqual(gate.findings.map((finding) => [finding.code, finding.path]), [["HARNESS_GATE_TYPECHECK", "cli"]])
    assert.equal(gate.verdict, "red")
})

void test("a red package test names its failing tests from node's TAP and spec reporters, once each, and keeps the run's last lines", () => {
    const tap = ["TAP version 13", "# Subtest: renders the empty state", "not ok 3 - renders the empty state", "  ---", "ok 4 - Chip renders", "not ok 5 - grammar version matches # TODO"].join("\n")
    assert.deepEqual(failingTests(tap), ["renders the empty state", "grammar version matches"])
    const spec = ["▶ empty states", "  ✖ renders the empty state (12.5ms)", "✖ empty states (13ms)", "ℹ fail 1", "✖ failing tests:", "", "test at src/empty.spec.ts:40:1", "✖ renders the empty state (12.5ms)", "  TypeError: Cannot read properties of undefined (reading 'ready')"].join("\n")
    assert.deepEqual(failingTests(spec), ["renders the empty state", "empty states"])
    assert.deepEqual(failingTests("src/a.ts(3,1): error TS2322\nnpm error code 2"), [], "a run that failed in its typecheck names no test")

    const step: GateStep = { dir: "packages/grammar", kind: "test" }
    const message = failureMessage(step, `${spec}\n${Array.from({ length: 40 }, (_, line) => `line ${String(line)}`).join("\n")}`)
    const [first, ...rest] = message.split("\n")
    assert.equal(first, "test in packages/grammar failed: 2 failing: renders the empty state; empty states")
    assert.deepEqual(rest, Array.from({ length: 15 }, (_, line) => `line ${String(line + 25)}`), "the last 15 lines follow the names")
    assert.match(failureMessage(step, "error TS2322\nnpm error code 2"), /^test in packages\/grammar failed: no failing test named \(the run stopped before or outside its tests: see its last lines\)\nerror TS2322\nnpm error code 2$/)
    const many = failureMessage(step, Array.from({ length: 11 }, (_, n) => `not ok ${String(n + 1)} - t${String(n)}`).join("\n"))
    assert.match(many.split("\n")[0] ?? "", /11 failing: t0; t1; t2; t3; t4; t5; t6; t7; \+3 more$/)
    assert.ok(failureMessage(step, "x".repeat(10_000)).length <= 2400)
    assert.equal(failureMessage({ dir: "packages/grammar", kind: "build" }, "TS2322"), "build in packages/grammar failed: TS2322", "other steps keep their one-line message")

    const lines = findingLines({ code: "HARNESS_GATE_TEST", path: "packages/grammar", message })
    assert.equal(lines[0], "  HARNESS_GATE_TEST packages/grammar test in packages/grammar failed: 2 failing: renders the empty state; empty states")
    assert.equal(lines.length, 16)
    assert.equal(lines.at(-1), "      line 39")
    assert.deepEqual(findingLines({ code: "HARNESS_GATE_BUILD", path: "packages/grammar", message: "build failed\nmore" }), ["  HARNESS_GATE_BUILD packages/grammar build failed"])
})

void test("a red package test at the FAST level is a blocking finding `lane gate` reads with its failing names, and the rest of the gate still runs", async () => {
    const ran: string[] = []
    const gate = await runHarnessGate("/r", plan(), "dev", scriptsOf, (_root, step) => {
        ran.push(`${step.kind} ${step.dir}`)
        return Promise.resolve(step.kind === "test" && step.dir === "packages/grammar" ? { ok: false, output: "not ok 1 - renders the empty state\nnpm error code 1" } : { ok: true, output: "" })
    })
    assert.equal(gate.verdict, "red")
    assert.ok(ran.includes("test packages/gallery"), "a red test skips nothing after it")
    const read = blockingFindings(JSON.stringify({ ok: false, data: gate }))
    assert.deepEqual(read?.map((finding) => [finding.code, finding.path, finding.message.split("\n")[0]]), [["HARNESS_GATE_TEST", "packages/grammar", "test in packages/grammar failed: 1 failing: renders the empty state"]])
})
