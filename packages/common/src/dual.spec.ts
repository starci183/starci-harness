import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { after, before, test } from "node:test"

/**
 * The dual-package hazard, held: a CommonJS consumer (module node16, `require`) and an ESM consumer (module nodenext, `import`) both
 * compile against the built package, and a DomainError made in one passes `instanceof` and `isDomainError` in the other, because the
 * ESM entry re-exports the CommonJS build (one class, never two copies). Needs the built `dist` (`npm test` builds first).
 */
const packageRoot = resolve(import.meta.dirname, "..")
const tsc = join(packageRoot, "node_modules", "typescript", "bin", "tsc")
let root = ""

const compilerOptions = (module: "node16" | "nodenext"): object => ({
    module,
    moduleResolution: module,
    target: "ES2022",
    strict: true,
    exactOptionalPropertyTypes: true,
    skipLibCheck: false,
    types: [],
    declaration: true,
    rootDir: "src",
    outDir: "out",
})

const consumer = (name: string, type: "commonjs" | "module", module: "node16" | "nodenext", files: Record<string, string>): string => {
    const dir = join(root, name)
    mkdirSync(join(dir, "src"), { recursive: true })
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name, private: true, type }))
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: compilerOptions(module), include: ["src"] }))
    for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, "src", file), text)
    execFileSync(process.execPath, [tsc, "-p", dir], { encoding: "utf8" })
    return dir
}

before(() => {
    root = mkdtempSync(join(tmpdir(), "starci-common-dual-"))
    // One installed copy both consumers resolve upward: two copies on disk would be two classes and prove nothing.
    const copy = join(root, "node_modules", "@starci", "common")
    mkdirSync(copy, { recursive: true })
    cpSync(join(packageRoot, "package.json"), join(copy, "package.json"))
    cpSync(join(packageRoot, "dist"), join(copy, "dist"), { recursive: true })
})

after(() => {
    rmSync(root, { recursive: true, force: true })
})

test("a CommonJS node16 consumer and an ESM nodenext consumer compile, and an error made in one is an error in the other", () => {
    const cjs = consumer("cjs-consumer", "commonjs", "node16", {
        "index.ts": [
            'import { DomainError, isDomainError } from "@starci/common"',
            'import type { ErrorParams } from "@starci/common"',
            "export class CjsError extends DomainError<\"CJS_FAILED\"> {}",
            "const maybe = ((): ErrorParams | undefined => undefined)()",
            'export const make = (): unknown => new CjsError({ code: "CJS_FAILED", params: maybe })',
            "export const same = (value: unknown): boolean => value instanceof DomainError && isDomainError(value)",
        ].join("\n"),
    })
    const esm = consumer("esm-consumer", "module", "nodenext", {
        "index.ts": [
            'import { DomainError, isDomainError } from "@starci/common"',
            'import { make as makeCjs, same as sameCjs } from "../../cjs-consumer/out/index.js"',
            "export class EsmError extends DomainError<\"ESM_FAILED\"> {}",
            'const esmError: unknown = new EsmError({ code: "ESM_FAILED", params: { id: 1 } })',
            "const result = {",
            "    esmSeenByCjs: sameCjs(esmError),",
            "    cjsSeenByEsm: makeCjs() instanceof DomainError && isDomainError(makeCjs()),",
            "}",
            "console.log(JSON.stringify(result))",
        ].join("\n"),
    })
    assert.ok(cjs.length > 0)
    const output = execFileSync(process.execPath, [join(esm, "out", "index.js")], { encoding: "utf8" })
    assert.deepEqual(JSON.parse(output), { esmSeenByCjs: true, cjsSeenByEsm: true })
})
