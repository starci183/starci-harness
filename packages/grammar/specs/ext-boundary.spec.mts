/**
 * The core's ext boundary, both ways (owner 2026-11-22: "ext import core vào để xài vì nó là 1 phần của core"; the core never imports
 * an ext): the import graph of the core entry reaches no ext file and no ext library, each ext reaches the core, and the two lint
 * helpers say the same.
 *
 *   node --import ./specs/support/register.mts --test specs/ext-boundary.spec.mts
 */
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { EXT_LIBRARIES, extBoundaryProblem, extOf, libraryProblem } from "../scripts/lint/eslint-plugin.mts"

const root = fileURLToPath(new URL("..", import.meta.url))
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+|\bexport\s+\*\s+from\s*)(["'])([^"']+)\1/gm
const rel = (path: string): string => relative(root, path).replaceAll("\\", "/")

const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) return walk(path)
        return /\.(ts|tsx)$/.test(name) ? [path] : []
    })

const importsOf = (file: string): string[] => [...readFileSync(file, "utf8").matchAll(IMPORT)].map((match) => match[2] ?? "")

/** The source file a relative specifier names (`./x.js` is `x.ts` or `x.tsx`, a folder its index). */
const resolveLocal = (from: string, specifier: string): string | null => {
    const base = resolve(dirname(from), specifier.replace(/\.js$/u, ""))
    for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) if (existsSync(candidate)) return candidate
    return null
}

/** Every source file and bare specifier the entry reaches. */
const closure = (entry: string): { readonly files: Set<string>; readonly packages: Set<string> } => {
    const files = new Set<string>()
    const packages = new Set<string>()
    const queue = [entry]
    while (queue.length > 0) {
        const file = queue.pop() as string
        if (files.has(file)) continue
        files.add(file)
        for (const specifier of importsOf(file)) {
            if (!specifier.startsWith(".")) {
                packages.add(specifier)
                continue
            }
            const next = resolveLocal(file, specifier)
            if (next !== null) queue.push(next)
        }
    }
    return { files, packages }
}

const EXTS = readdirSync(join(root, "src", "core", "ext")).filter((name) => statSync(join(root, "src", "core", "ext", name)).isDirectory())

test("the core has its ext folders, graph and markdown, each with an index", () => {
    for (const name of ["graph", "markdown"]) {
        assert.ok(EXTS.includes(name), name)
        assert.ok(existsSync(join(root, "src", "core", "ext", name, "index.ts")), name)
    }
})

test("core never imports ext: the core and Common entries reach no ext file and no ext library", () => {
    const extLibraries = Object.values(EXT_LIBRARIES).flat()
    for (const entry of ["src/core/index.ts", "src/common/index.ts", "src/offset-pop/index.tsx"]) {
        const { files, packages } = closure(join(root, entry))
        assert.ok(files.size > 20, `${entry} reaches the components`)
        const ext = [...files].map(rel).filter((file) => extOf(file) !== null)
        assert.deepEqual(ext, [], `${entry} reaches an ext`)
        const libs = [...packages].filter((name) => extLibraries.some((pattern) => pattern.test(name)))
        assert.deepEqual(libs, [], `${entry} reaches an ext library`)
    }
})

test("ext imports core: each ext reaches the core, and nothing outside the core", () => {
    for (const name of EXTS) {
        const files = walk(join(root, "src", "core", "ext", name))
        let reachesCore = false
        for (const file of files) {
            for (const specifier of importsOf(file)) {
                assert.equal(extBoundaryProblem(rel(file), specifier), null, `${rel(file)} imports ${specifier}`)
                assert.equal(libraryProblem(rel(file), specifier), null, `${rel(file)} imports ${specifier}`)
                if (!specifier.startsWith(".")) continue
                const target = resolveLocal(file, specifier)
                if (target !== null && extOf(rel(target)) === null && rel(target).startsWith("src/core/")) reachesCore = true
            }
        }
        assert.ok(reachesCore, `${name} uses the core's components`)
    }
})

test("every file outside the ext keeps both rules", () => {
    for (const file of walk(join(root, "src"))) {
        const path = rel(file)
        if (extOf(path) !== null) continue
        for (const specifier of importsOf(file)) {
            assert.equal(extBoundaryProblem(path, specifier), null, `${path} imports ${specifier}`)
            assert.equal(libraryProblem(path, specifier), null, `${path} imports ${specifier}`)
        }
    }
})

test("the helpers: the boundary in both directions and the library homes", () => {
    assert.match(extBoundaryProblem("src/core/leaf/Text/index.tsx", "../../ext/graph/index.js") ?? "", /core never imports an ext/)
    assert.match(extBoundaryProblem("src/common/renderers.ts", "../core/ext/markdown/index.js") ?? "", /core never imports an ext/)
    assert.equal(extBoundaryProblem("src/core/ext/graph/erd/ErdMap.ts", "../../../index.js"), null)
    assert.equal(extBoundaryProblem("src/core/ext/graph/FlowGraph.ts", "../../leaf/Text/index.js"), null)
    assert.match(extBoundaryProblem("src/core/ext/graph/FlowGraph.ts", "../markdown/index.js") ?? "", /no other ext/)
    assert.match(extBoundaryProblem("src/core/ext/graph/FlowGraph.ts", "../../../offset-pop/index.js") ?? "", /only the core/)
    assert.match(extBoundaryProblem("src/core/ext/markdown/react/index.ts", "@starci/grammar/core") ?? "", /by path/)
    assert.equal(extBoundaryProblem("src/stories/Graph.stories.tsx", "../core/ext/graph/index.js"), null)
    assert.equal(libraryProblem("src/core/ext/graph/layout.ts", "elkjs/lib/elk.bundled.js"), null)
    // A `?url` import is an asset (pdfjs's worker under Vite), not the library's code.
    assert.equal(libraryProblem("src/stories/PdfViewer.stories.tsx", "pdfjs-dist/build/pdf.worker.min.mjs?url"), null)
    assert.notEqual(libraryProblem("src/stories/PdfViewer.stories.tsx", "pdfjs-dist"), null)
    assert.equal(libraryProblem("src/core/ext/markdown/server/highlight.ts", "shiki"), null)
    assert.match(libraryProblem("src/core/ext/markdown/parse.ts", "@xyflow/react") ?? "", /graph ext/)
    assert.match(libraryProblem("src/core/frame/Section/index.tsx", "remark-gfm") ?? "", /markdown ext/)
    assert.match(libraryProblem("src/core/ext/graph/FlowGraph.ts", "motion/react") ?? "", /never imports/)
})
