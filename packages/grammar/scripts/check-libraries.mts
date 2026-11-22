import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { EXT_LIBRARIES, extBoundaryProblem, libraryProblem, MOTION_LIBRARIES } from "./lint/eslint-plugin.mts"

/**
 * Contract check (DNA-COMMON-NO-GRAPH-OR-MOTION-LIBRARY): the Grammar imports no animation library (`motion`, `framer-motion`, `gsap`,
 * ...), and a graph or markdown library (`@xyflow/react`, `elkjs`, `d3-force`, `unified`, `remark-*`, `shiki`, `beautiful-mermaid`) only
 * inside its own core ext (`src/core/ext/graph`, `src/core/ext/markdown`); the core never imports an ext. The manifest declares an ext
 * library only as an OPTIONAL peer (and a devDependency to build it), never as a dependency, and no animation library at all. The lint
 * rules `starci-grammar/no-graph-or-animation-library` and `starci-grammar/ext-boundary` judge the published source; this check also
 * reads the stories (never linted) and the manifest.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)(["'])([^"']+)\1/gm
const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
        const path = resolve(dir, name)
        if (statSync(path).isDirectory()) return walk(path)
        return /\.(ts|tsx|mts)$/.test(name) ? [path] : []
    })
const problems: string[] = []
let checked = 0
for (const file of walk(resolve(root, "src"))) {
    checked += 1
    const rel = relative(root, file).replaceAll("\\", "/")
    for (const match of readFileSync(file, "utf8").matchAll(IMPORT)) {
        const specifier = match[2] ?? ""
        const problem = libraryProblem(rel, specifier) ?? extBoundaryProblem(rel, specifier)
        if (problem !== null) problems.push(`${rel}: ${problem}`)
    }
}
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as Record<string, unknown>
const fieldOf = (field: string): Record<string, unknown> => {
    const value = manifest[field]
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
}
const isMotion = (name: string): boolean => MOTION_LIBRARIES.some((pattern) => pattern.test(name))
const isExt = (name: string): boolean => Object.values(EXT_LIBRARIES).some((patterns) => patterns.some((pattern) => pattern.test(name)))
const optional = fieldOf("peerDependenciesMeta")
for (const field of ["dependencies", "peerDependencies", "devDependencies", "optionalDependencies"]) {
    for (const name of Object.keys(fieldOf(field))) {
        if (isMotion(name)) problems.push(`package.json ${field}: declares ${name}, an animation library`)
        else if (isExt(name) && (field === "dependencies" || field === "optionalDependencies")) problems.push(`package.json ${field}: declares ${name}; an ext library is an optional peer`)
        else if (isExt(name) && field === "peerDependencies") {
            const meta = optional[name]
            if (typeof meta !== "object" || meta === null || (meta as Record<string, unknown>)["optional"] !== true) problems.push(`package.json peerDependenciesMeta: ${name} must be { "optional": true }`)
        }
    }
}
if (problems.length > 0) {
    console.error(`The Grammar uses no animation library, and a graph or markdown library only inside its own core ext:\n${problems.join("\n")}`)
    process.exit(1)
}
console.log(`check-libraries: ${checked} source files and the manifest: no animation library, ext libraries only in their ext and as optional peers, no core import of an ext`)
