// The DNA gate's contract reader and its judge, run on the contract this harness ships and on fixtures; no browser is started.
// Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { runInNewContext } from "node:vm"
import { judgePart, loadDnaContract, thresholdValue } from "./dna.js"
import type { DnaPart } from "./dna.js"

const part = (partial: Partial<DnaPart> & Pick<DnaPart, "op" | "measured" | "expected">): DnaPart => ({ metric: "m", pattern: false, tolerance: 0.5, ...partial })

void test("the shipped contract loads: every group, every kind, every value form", () => {
    const contract = loadDnaContract()
    assert.deepEqual(contract.grammars, ["core", "offset-pop"])
    assert.ok(contract.entries.length >= 100)
    const kinds = new Set(contract.entries.flatMap((entry) => entry.variants.map((variant) => variant.kind)))
    for (const kind of ["box", "style", "attr", "relation", "uniform", "count", "seams", "a11y", "text", "tokens", "interaction", "source"]) assert.ok(kinds.has(kind as never), `no entry of kind ${kind}`)
    const common = contract.entries.find((entry) => entry.id === "DNA-COMMON-CONTROL-MD")
    assert.deepEqual(common?.families, ["core", "offset-pop"])
    assert.deepEqual(contract.entries.find((entry) => entry.id.startsWith("DNA-OFFSET-POP-"))?.families, ["offset-pop"])
})

void test("a threshold is read from thresholds.yaml by key, as a floor or a ceiling", () => {
    const contract = loadDnaContract()
    const coarse = contract.entries.find((entry) => entry.id === "DNA-COMMON-TARGET-COARSE")?.variants[0]
    assert.equal(coarse?.value, 44)
    const accent = contract.entries.find((entry) => entry.id === "DNA-COMMON-ONE-ACCENT-FILL")?.variants[0]
    assert.equal(accent?.value, 1)
    assert.equal(thresholdValue({ contrast: { text: { min: 4.5 } } }, "contrast.text", ">="), 4.5)
    assert.throws(() => thresholdValue({}, "missing.key", ">="))
})

void test("a contract list of token names becomes the metrics of a tokens law", () => {
    const tokens = loadDnaContract().entries.find((entry) => entry.id === "DNA-COMMON-TOKENS-BOUND")?.variants[0]
    assert.ok((tokens?.metrics.length ?? 0) > 20)
    assert.ok(tokens?.metrics.every((name) => name.startsWith("--")))
})

void test("a mustKeep group that names no grammar is refused", () => {
    const folder = mkdtempSync(join(tmpdir(), "starci-dna-contract-"))
    mkdirSync(join(folder, "grammars"), { recursive: true })
    mkdirSync(join(folder, "ui", "proof"), { recursive: true })
    writeFileSync(join(folder, "ui", "proof", "thresholds.yaml"), "schema: x\n")
    const file = join(folder, "grammars", "contract.yaml")
    writeFileSync(file, "grammars: [core]\nmustKeep:\n  shape: {}\n  ghost: []\n")
    assert.throws(() => loadDnaContract(file), /neither common nor one of the grammars/)
})

void test("judgePart compares numbers with their unit, text blank-normalised, and set, matches and alternatives", () => {
    assert.ok(judgePart(part({ op: "=", measured: [40], expected: [["40px"]] })).ok)
    assert.ok(!judgePart(part({ op: "=", measured: [39], expected: [["40px"]] })).ok)
    assert.ok(judgePart(part({ op: ">=", measured: [44], expected: [[44]] })).ok)
    assert.ok(judgePart(part({ op: "<", measured: [31.9], expected: [[32]] })).ok)
    assert.ok(judgePart(part({ op: "=", measured: [" a   b "], expected: [["a b"]] })).ok)
    assert.ok(judgePart(part({ op: "=", measured: [3], expected: [[2], [3]] })).ok)
    assert.ok(judgePart(part({ op: "set", measured: ["x"], expected: [] })).ok)
    assert.ok(!judgePart(part({ op: "set", measured: [""], expected: [] })).ok)
    assert.ok(judgePart(part({ op: "matches", measured: ["••••••••ab"], expected: [["^•{8}.{0,4}$"]], pattern: true })).ok)
    assert.ok(judgePart(part({ op: "matches", measured: ["Name is required"], expected: [["is required"]] })).ok)
    assert.ok(!judgePart(part({ op: "=", measured: [], expected: [[1]] })).ok, "nothing measured is never a pass")
})

void test("judgePart is one self-contained function, because the page runs its source", () => {
    // Run in a context that holds nothing of this module: a helper outside the function would be undefined there.
    const verdict = (given: DnaPart): unknown => runInNewContext(`(${judgePart.toString()})(${JSON.stringify(given)})`)
    assert.deepEqual(verdict(part({ op: ">=", measured: [44], expected: [[44]] })), { ok: true, want: ">= 44" })
    assert.deepEqual(verdict(part({ op: "=", measured: ["a"], expected: [["b"]] })), { ok: false, want: '= "b"' })
})
