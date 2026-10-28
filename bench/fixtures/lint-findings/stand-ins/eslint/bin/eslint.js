// The ESLint stand-in. It reports `bench/no-error` on a file holding LINT_ERROR, and `starci-be/feature-not-composed` on a
// file under src/<feature>/ while src/app.ts does not name the feature, as the canon does for a feature module no app module
// composes. It answers in ESLint's json with `--format json`, else in one line per finding, and exits 1 on any finding.
const { existsSync, readFileSync } = require("node:fs")
const { resolve } = require("node:path")
const args = process.argv.slice(2)
const json = args.includes("--format")
const files = args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--format")
const app = existsSync("src/app.ts") ? readFileSync("src/app.ts", "utf8") : ""
const feature = (file) => /^src\/([^/]+)\//.exec(file.replaceAll("\\", "/"))?.[1]
const findings = (file) => [
    ...(readFileSync(file, "utf8").includes("LINT_ERROR") ? [{ ruleId: "bench/no-error", severity: 2, message: "LINT_ERROR is an error", line: 1, column: 1 }] : []),
    ...(feature(file) !== undefined && !app.includes(feature(file)) ? [{ ruleId: "starci-be/feature-not-composed", severity: 2, message: "no app module composes this feature module", line: 1, column: 1 }] : []),
]
const results = files.map((file) => ({ filePath: resolve(file), messages: findings(file) }))
if (json) console.log(JSON.stringify(results))
else for (const result of results) for (const message of result.messages) console.log(`${result.filePath}: error ${message.message} ${message.ruleId}`)
process.exit(results.some((result) => result.messages.length > 0) ? 1 : 0)
