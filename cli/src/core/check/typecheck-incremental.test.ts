// The incremental typecheck of check/scope.ts on real tsc: a cached build info makes an unchanged program cheap and never hides an error.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { withHeavySlot } from "../../harness/heavy.js"
import { captureTool } from "../../shared/exec.js"
import { buildInfoFor, typecheckArgs } from "./scope.js"

const tsc = join(createRequire(import.meta.url).resolve("typescript/package.json"), "..", "bin", "tsc")

const program = (): { readonly dir: string; readonly run: () => Promise<{ readonly code: number | null; readonly out: string }>; readonly info: string } => {
    const dir = mkdtempSync(join(tmpdir(), "starci-incremental-"))
    mkdirSync(join(dir, "src"))
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "es2022", module: "nodenext", skipLibCheck: true }, include: ["src"] }))
    writeFileSync(join(dir, "src", "a.ts"), "export const a: number = 1\n")
    writeFileSync(join(dir, "src", "b.ts"), "import { a } from \"./a.js\"\nexport const b: number = a + 1\n")
    const info = join(dir, "..", `${String(Date.now())}-${String(Math.random()).slice(2)}.tsbuildinfo`)
    const run = async (): Promise<{ readonly code: number | null; readonly out: string }> => {
        const result = await withHeavySlot("tsc", "typecheck-incremental spec", dir, {}, (held) => captureTool(process.execPath, [tsc, ...typecheckArgs("tsconfig.json", info, ["--pretty", "false"])], dir, held.options))
        return { code: result.exitCode, out: `${result.stdout}${result.stderr}` }
    }
    return { dir, run, info }
}

void test("a type error introduced after a cached run is still caught, and an unchanged erroneous file keeps reporting it", async () => {
    const { dir, run, info } = program()
    try {
        assert.equal((await run()).code, 0, "the clean program is green and writes its build info")
        assert.equal((await run()).code, 0, "the second run reads the build info")
        writeFileSync(join(dir, "src", "a.ts"), "export const a: number = \"one\"\n")
        const broken = await run()
        assert.notEqual(broken.code, 0, "the error introduced in a.ts is found, not hidden by the cache")
        assert.match(broken.out, /src\/a\.ts\(1,14\): error TS2322/)
        const again = await run()
        assert.notEqual(again.code, 0, "an unchanged file with an error still fails from the cache")
        assert.match(again.out, /TS2322/)
        // An error in a file that imports a changed one is found too: b.ts is untouched while a.ts changes its export type.
        writeFileSync(join(dir, "src", "a.ts"), "export const a = \"one\"\n")
        const dependent = await run()
        assert.match(dependent.out, /src\/b\.ts\(2,\d+\): error TS2322/, "the dependent file is re-checked against the changed declaration")
        writeFileSync(join(dir, "src", "a.ts"), "export const a: number = 1\n")
        assert.equal((await run()).code, 0, "fixing the error turns the program green again")
    } finally {
        rmSync(dir, { recursive: true, force: true })
        rmSync(info, { force: true })
    }
})

void test("the build info of a program is its own: one per folder, tsconfig and option set, in the harness cache and never in the tree", () => {
    const one = buildInfoFor("/r/be", "tsconfig.json")
    assert.equal(one, buildInfoFor("/r/be", "tsconfig.json"))
    assert.notEqual(one, buildInfoFor("/r/fe", "tsconfig.json"))
    assert.notEqual(one, buildInfoFor("/r/be", "tsconfig.spec.json"))
    assert.notEqual(one, buildInfoFor("/r/be", "tsconfig.json", ["--noUnusedLocals"]))
    assert.ok(one.endsWith(".tsbuildinfo") && one.includes("tsbuildinfo"))
    assert.deepEqual(typecheckArgs("tsconfig.json", "x.tsbuildinfo", ["--noUnusedLocals"]), ["-p", "tsconfig.json", "--noEmit", "--incremental", "--tsBuildInfoFile", "x.tsbuildinfo", "--noUnusedLocals"])
})
