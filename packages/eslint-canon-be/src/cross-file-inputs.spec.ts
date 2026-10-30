/**
 * The proof that `crossFileInputs` is complete (contexts/project/check-cache.md, ESLint, kind 3).
 *
 * Two halves. Static: every source file of this canon that reads the disk is named by a declaration or accounted for below. Dynamic:
 * `fixtures/fs-audit.ts`, preloaded into every spec process of this package, records the `node:fs` reads of each rule under every fixture
 * the other specs run and fails the spec on a read neither a declaration nor the import graph covers; the probes at the end prove the
 * recorder catches an uncovered read and accepts a declared one.
 */
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import test from "node:test"
import { HISTORY_MIN_LINES, crossFileInputs, type CrossFileInput } from "./lib/cross-file-inputs.ts"
import { rules } from "./index.ts"
import { canonRuleTester, ruleNamed } from "../fixtures/rule-tester.ts"
import { fixtureHfs } from "../fixtures/typed/tester.ts"
import { hardGrowthLines } from "../runtime/scripts/lib/line-count.mjs"

const SRC = import.meta.dirname

/** Source files that name the disk or TypeScript's `sys` but read nothing a declaration is needed for, and why. */
const ACCOUNTED: Readonly<Record<string, string>> = {
    "transport.ts": "ts.resolveModuleName on an import of the linted file: module resolution, carried by the import graph",
}

const READS_DISK = /from\s+["'](?:node:)?fs(?:\/promises)?["']|\bts\.sys\b|recorded-lines\.mjs/

const sourceFiles = (folder = SRC): string[] =>
    readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
        const file = join(folder, entry.name)
        if (entry.isDirectory()) return entry.name === "types" ? [] : sourceFiles(file)
        return entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts") ? [relative(SRC, file).replaceAll("\\", "/")] : []
    })

test("every source file that reads the disk is declared or accounted for", () => {
    const readers = new Set(crossFileInputs.map((input) => input.reader))
    const reading = sourceFiles().filter((file) => READS_DISK.test(readFileSync(join(SRC, file), "utf8")))
    const unaccounted = reading.filter((file) => !readers.has(file) && !(file in ACCOUNTED))
    assert.deepEqual(unaccounted, [], "declare these in src/cross-file-inputs.ts, or account for them in ACCOUNTED with the reason they need no declaration")
    for (const file of [...readers, ...Object.keys(ACCOUNTED)]) assert.ok(reading.includes(file), `${file} no longer reads the disk: drop its declaration`)
})

test("every declaration names a published rule, a real reader and well-formed globs", () => {
    for (const input of crossFileInputs) {
        assert.ok(input.rule in rules, `${input.rule} is no rule of this canon`)
        assert.ok(["content", "exists", "git"].includes(input.kind) && ["file", "side"].includes(input.relativeTo))
        assert.ok((input.kind === "git" || input.globs.length > 0) && input.appliesTo.length > 0, `${input.rule} declares no globs`)
        for (const glob of [...input.globs, ...input.appliesTo]) assert.ok(glob !== "" && !glob.includes("\\") && !glob.startsWith("/"), `${input.rule}: ${glob} is not a relative posix glob`)
        assert.ok(sourceFiles().includes(input.reader), `${input.rule}: reader ${input.reader} is no source file`)
    }
})

// ---- the recorder itself --------------------------------------------------------------------------------------------------------

const probe = (read: (dir: string) => void) => ({
    meta: { type: "problem" as const, schema: [], messages: {} },
    create: (context: { filename: string }) => { read(join(context.filename, "..")); return {} },
})

const run = (name: string, read: (dir: string) => void): void => {
    const dir = mkdtempSync(join(tmpdir(), "fs-audit-"))
    try {
        writeFileSync(join(dir, "a.js"), "1")
        writeFileSync(join(dir, "sibling.txt"), "x")
        mkdirSync(join(dir, "nested"))
        writeFileSync(join(dir, "nested", "deep.txt"), "y")
        Reflect.set(rules, name, probe(read))
        canonRuleTester({ settings: { starci: { hfs: { repoRoot: dir } } } }).run(name, ruleNamed(rules, name), { valid: [{ code: "1", filename: join(dir, "a.js") }], invalid: [] })
    } finally {
        Reflect.deleteProperty(rules, name)
        rmSync(dir, { recursive: true, force: true })
    }
}

const declare = (input: CrossFileInput): (() => void) => {
    Reflect.apply(Array.prototype.push, crossFileInputs, [input])
    return () => void Reflect.apply(Array.prototype.pop, crossFileInputs, [])
}

test("the recorder fails a rule that reads a file nothing declares", () => {
    assert.throws(() => run("audit-probe-undeclared", (dir) => readFileSync(join(dir, "sibling.txt"), "utf8")), /audit-probe-undeclared linting a\.js did a read of sibling\.txt/)
})

test("the recorder accepts a read a declaration covers, in the way its kind allows", () => {
    const base = { rule: "audit-probe-declared", relativeTo: "file", globs: ["*.txt"], appliesTo: ["**/*.js"], reader: "cross-file-inputs.ts" } as const
    let undo = declare({ ...base, kind: "content" })
    try {
        assert.doesNotThrow(() => run("audit-probe-declared", (dir) => readFileSync(join(dir, "sibling.txt"), "utf8")))
        assert.doesNotThrow(() => run("audit-probe-declared", (dir) => readdirSync(dir)))
    } finally { undo() }
    undo = declare({ ...base, kind: "exists" })
    try {
        assert.throws(() => run("audit-probe-declared", (dir) => readFileSync(join(dir, "sibling.txt"), "utf8")), /did a read of sibling\.txt/)
        assert.doesNotThrow(() => run("audit-probe-declared", (dir) => readdirSync(dir)))
    } finally { undo() }
    undo = declare({ ...base, kind: "content", globs: ["nested/*.txt"] })
    try {
        assert.doesNotThrow(() => run("audit-probe-declared", (dir) => readFileSync(join(dir, "nested", "deep.txt"), "utf8")))
        assert.throws(() => run("audit-probe-declared", (dir) => readFileSync(join(dir, "sibling.txt"), "utf8")), /did a read of sibling\.txt/)
    } finally { undo() }
})

test("a file the linted file imports is carried by the import graph, not by a declaration", () => {
    const dir = mkdtempSync(join(tmpdir(), "fs-audit-"))
    try {
        writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "esnext", moduleResolution: "bundler", allowJs: true } }))
        writeFileSync(join(dir, "a.js"), "import './dep.js'")
        writeFileSync(join(dir, "dep.js"), "export {}")
        writeFileSync(join(dir, "other.js"), "export {}")
        const tester = canonRuleTester({ settings: { starci: { hfs: { repoRoot: dir } } }, languageOptions: { sourceType: "module" } })
        const tests = { valid: [{ code: "import './dep.js'", filename: join(dir, "a.js") }], invalid: [] }
        Reflect.set(rules, "audit-probe-imports", probe((folder) => readFileSync(join(folder, "dep.js"), "utf8")))
        assert.doesNotThrow(() => tester.run("audit-probe-imports", ruleNamed(rules, "audit-probe-imports"), tests))
        Reflect.set(rules, "audit-probe-imports", probe((folder) => readFileSync(join(folder, "other.js"), "utf8")))
        assert.throws(() => tester.run("audit-probe-imports", ruleNamed(rules, "audit-probe-imports"), tests), /did a read of other\.js/)
    } finally {
        Reflect.deleteProperty(rules, "audit-probe-imports")
        rmSync(dir, { recursive: true, force: true })
    }
})

test("the history declaration starts below the budget at which file-size-growth reads history", () => {
    const budget = hardGrowthLines(fixtureHfs().ruleParams.fileLines)
    assert.ok(Number.isFinite(budget) && HISTORY_MIN_LINES <= budget, `file-size-growth reads history above ${budget} lines; the declaration says ${HISTORY_MIN_LINES}`)
})
