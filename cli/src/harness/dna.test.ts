// The DNA gate's contract reader and its judge, run on the contract this harness ships and on fixtures; no browser is started.
// Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import ts from "typescript"
import { judgePart, loadDnaContract, thresholdValue } from "./dna.js"
import type { DnaPart } from "./dna.js"

const part = (partial: Partial<DnaPart> & Pick<DnaPart, "op" | "measured" | "expected">): DnaPart => ({ metric: "m", pattern: false, tolerance: 0.5, ...partial })

const interactionContract = (t: { after: (fn: () => void) => void }, measure: string): string => {
    const folder = mkdtempSync(join(tmpdir(), "starci-dna-interaction-"))
    t.after(() => { rmSync(folder, { recursive: true, force: true }) })
    mkdirSync(join(folder, "grammars"), { recursive: true })
    mkdirSync(join(folder, "ui", "proof"), { recursive: true })
    writeFileSync(join(folder, "ui", "proof", "thresholds.yaml"), "schema: x\n")
    const file = join(folder, "grammars", "contract.yaml")
    writeFileSync(file, `grammars: [core]\nmustKeep:\n  common:\n    - id: DNA-COMMON-INTERACTION\n      role: button\n      law: A press preserves width.\n      measure: ${measure}\n      owner: fixture\n`)
    return file
}

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

void test("the public interaction then is loaded as after without a thenable key", () => {
    const pending = loadDnaContract().entries.find((entry) => entry.id === "DNA-COMMON-PENDING-KEEPS-BOX")?.variants[0]
    assert.ok(pending)
    assert.ok(pending.after)
    assert.deepEqual(pending.after.metrics, ["width", "height", "name"])
    assert.deepEqual(pending.after.value, { before: true })
    assert.equal(Object.hasOwn(pending, "then"), false)
})

void test("an interaction refuses the internal after name in a public contract", (t) => {
    const postcondition = "{ metric: width, op: '=', value: 40 }"
    for (const extra of [`after: ${postcondition}`, `then: ${postcondition}, after: ${postcondition}`]) {
        const file = interactionContract(t, `{ kind: interaction, select: button, act: [click], ${extra} }`)
        assert.throws(() => loadDnaContract(file), (error: unknown) => error instanceof Error && /unrecognized.*after/i.test(error.message))
    }
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

void test("judgePart is one self-contained function, because the page runs its source", (t) => {
    const folder = mkdtempSync(join(tmpdir(), "starci-dna-standalone-"))
    t.after(() => { rmSync(folder, { recursive: true, force: true }) })
    const file = join(folder, "judge.mjs")
    // Check the serialized function with no module bindings or ambient Node globals, without executing source text.
    writeFileSync(file, judgePart.toString())
    const program = ts.createProgram([file], { allowJs: true, checkJs: true, noEmit: true, target: ts.ScriptTarget.ES2024, types: [], skipLibCheck: true })
    assert.deepEqual(ts.getPreEmitDiagnostics(program).map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")), [])
    assert.deepEqual(judgePart(part({ op: ">=", measured: [44], expected: [[44]] })), { ok: true, want: ">= 44" })
    assert.deepEqual(judgePart(part({ op: "=", measured: ["a"], expected: [["b"]] })), { ok: false, want: '= "b"' })
})
