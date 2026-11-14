import { mkdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"

/**
 * Completes the dual build after tsc has emitted the CommonJS one into dist/cjs: each ESM entry only re-exports its CommonJS build, so
 * `DomainError` has one class identity however a consumer loads the package (`instanceof` holds across `import` and `require`).
 * The entries are the package root and the data subpaths (`./data`, `./data/testing`).
 */
writeFileSync("dist/cjs/package.json", '{"type": "commonjs"}\n')

const require = createRequire(import.meta.url)

for (const [entry, depth] of [["", ".."], ["data/", "../.."], ["data/testing/", "../../.."], ["data/git/", "../../.."]] as const) {
    const names = Object.keys(require(`../dist/cjs/${entry}index.js`) as Record<string, unknown>).sort()
    mkdirSync(`dist/esm/${entry}`, { recursive: true })
    writeFileSync(`dist/esm/${entry}index.js`, `export { ${names.join(", ")} } from "${depth}/cjs/${entry}index.js"\n`)
    writeFileSync(`dist/esm/${entry}index.d.ts`, `export * from "${depth}/cjs/${entry}index.js"\n`)
}
