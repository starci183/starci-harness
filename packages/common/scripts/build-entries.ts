import { mkdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"

/**
 * Completes the dual build after tsc has emitted the CommonJS one into dist/cjs: the ESM entry only re-exports the CommonJS build, so
 * `DomainError` has one class identity however a consumer loads the package (`instanceof` holds across `import` and `require`).
 */
writeFileSync("dist/cjs/package.json", '{"type": "commonjs"}\n')

const require = createRequire(import.meta.url)
const names = Object.keys(require("../dist/cjs/index.js") as Record<string, unknown>).sort()

mkdirSync("dist/esm", { recursive: true })
writeFileSync("dist/esm/index.js", `export { ${names.join(", ")} } from "../cjs/index.js"\n`)
writeFileSync("dist/esm/index.d.ts", 'export * from "../cjs/index.js"\n')
