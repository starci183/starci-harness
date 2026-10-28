/**
 * The declarations a consumer reads name only emitted modules.
 *
 *   node --test src/published-declarations.spec.ts
 *
 * The managed `be/eslint.config.mjs` of every app is typed-linted, so `starciBeConfig({ hfs: loadHfs(import.meta.url) })`
 * must type in the consumer. A declaration reachable from the package entry that imports a bundled `runtime/` file
 * (untyped JavaScript with no declaration beside it) resolves there to an error type, and the managed line fails
 * `no-unsafe-assignment`. This spec emits the declarations of the entry in memory and walks their relative imports.
 */
import assert from "node:assert/strict"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import ts from "typescript"

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), "..")
const ENTRY = join(PACKAGE, "src", "index.ts")

/** The emitted declarations of the build config, by absolute output path. */
const emittedDeclarations = (): Map<string, string> => {
    const configFile = join(PACKAGE, "tsconfig.build.json")
    const read = ts.readConfigFile(configFile, (file) => ts.sys.readFile(file))
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, PACKAGE, undefined, configFile)
    const program = ts.createProgram([ENTRY], { ...parsed.options, noEmit: false, emitDeclarationOnly: true, declaration: true })
    const out = new Map<string, string>()
    program.emit(undefined, (file, text) => out.set(resolve(file), text))
    return out
}

/** The relative specifiers a declaration imports or re-exports. */
const specifiersOf = (text: string): string[] => [...text.matchAll(/(?:from |import\()["'](\.\.?\/[^"']+)["']/g)].flatMap((match) => (match[1] === undefined ? [] : [match[1]]))

test("be: every declaration reachable from the package entry imports only emitted modules", () => {
    const declarations = emittedDeclarations()
    const outDir = join(PACKAGE, "dist")
    const start = join(outDir, "index.d.ts")
    assert.ok(declarations.has(start), "the entry emits its declaration")
    const seen = new Set<string>()
    const pending = [start]
    const strays: string[] = []
    for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
        if (seen.has(file)) continue
        seen.add(file)
        for (const specifier of specifiersOf(declarations.get(file) ?? "")) {
            const target = resolve(dirname(file), specifier.replace(/\.(?:ts|js)$/, ".d.ts"))
            if (declarations.has(target)) pending.push(target)
            else strays.push(`${relative(outDir, file)} -> ${specifier}`)
        }
    }
    assert.deepEqual(strays, [])
    assert.ok(seen.has(join(outDir, "lib", "hfs-view.d.ts")), "loadHfs names the emitted view shapes")
})
