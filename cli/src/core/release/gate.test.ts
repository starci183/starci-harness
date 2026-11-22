// The harness's own two-level gate (owner: "rules là k check nhánh khi dev, khi nào push mới check tổng 1 lần sửa 1 lần vẫn hơn"): the FAST level builds,
// typechecks and tests what the diff changed and its dependents; the FULL level of the train adds every package, lint and CI's light gates (core/release/gate.ts).
import assert from "node:assert/strict"
import test from "node:test"
import { blockingFindings } from "../../harness/land-queue.js"
import { CI_LIGHT_GATES, harnessGateSteps, runHarnessGate } from "./gate.js"
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

void test("the FAST level installs and builds each build order once, then typechecks and tests each affected package; no lint, no CLI it does not need", () => {
    assert.deepEqual(named(harnessGateSteps(plan(), "dev", scriptsOf)), [
        "install packages/tsconfig",
        "install packages/grammar",
        "build packages/grammar",
        "typecheck packages/grammar",
        "test packages/grammar",
        "install packages/gallery",
        "build packages/gallery",
        "test packages/gallery",
    ])
})

void test("an affected CLI is installed, built, typechecked and tested at the FAST level", () => {
    const steps = named(harnessGateSteps(plan({ packages: [], harness: true }), "dev", scriptsOf))
    assert.deepEqual(steps, ["install cli", "build cli", "typecheck cli", "test cli"])
})

void test("the FULL level adds lint, the CLI and CI's light gates", () => {
    const steps = named(harnessGateSteps(plan(), "full", scriptsOf))
    assert.ok(steps.includes("lint packages/grammar"))
    assert.ok(steps.includes("lint cli"))
    assert.deepEqual(steps.slice(-CI_LIGHT_GATES.length), CI_LIGHT_GATES.map((args) => `check . ${args.join(" ")}`))
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
