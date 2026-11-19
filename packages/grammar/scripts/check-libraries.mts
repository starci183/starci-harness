import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { isBannedLibrary } from "./lint/eslint-plugin.mts"

/**
 * Contract check (DNA-COMMON-NO-GRAPH-OR-MOTION-LIBRARY): the Grammar imports no graph or flow toolkit (`@xyflow/react`) and no
 * animation library (`motion`, `motion/react`, `framer-motion`, `gsap`, ...), and declares none as a dependency or peer. Motion is the CSS
 * transitions its tokens drive; a graph is app code, written inside `<Custom reason="...">`. The lint rule
 * `starci-grammar/no-graph-or-animation-library` judges the published source; this check also reads the stories (never linted) and the manifest.
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
    for (const match of readFileSync(file, "utf8").matchAll(IMPORT)) {
        const specifier = match[2] ?? ""
        if (isBannedLibrary(specifier)) problems.push(`${relative(root, file).replaceAll("\\", "/")}: imports ${specifier}`)
    }
}
const manifest: unknown = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"))
for (const field of ["dependencies", "peerDependencies", "devDependencies", "optionalDependencies"]) {
    const declared: unknown = typeof manifest === "object" && manifest !== null ? Reflect.get(manifest, field) : undefined
    if (typeof declared !== "object" || declared === null) continue
    for (const name of Object.keys(declared)) if (isBannedLibrary(name)) problems.push(`package.json ${field}: declares ${name}`)
}
if (problems.length > 0) {
    console.error(`The Grammar uses no graph or animation library (an app uses one only inside <Custom reason="...">):\n${problems.join("\n")}`)
    process.exit(1)
}
console.log(`check-libraries: ${checked} source files and the manifest import and declare no graph or animation library`)
