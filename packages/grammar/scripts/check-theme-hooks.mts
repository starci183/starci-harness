import { readdirSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Contract check (theme hooks): `src/common/theme-hooks.json` lists the optional custom properties an app's theme layer may set beside
 * HeroUI's tokens. Each listed hook is read by at least one rule as `var(<name>, <fallback>)`, so an app that sets none draws the default
 * look, and no stylesheet of the package declares it (a declaration on the grammar root would shadow the app's `:root` value).
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src")
const { hooks } = JSON.parse(readFileSync(resolve(root, "common", "theme-hooks.json"), "utf8")) as { hooks: { name: string }[] }
const sheets = ["common", "core", "offset-pop"].flatMap((dir) =>
    readdirSync(resolve(root, dir)).filter((name) => name.endsWith(".css")).map((name) => readFileSync(resolve(root, dir, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")),
).join("\n")
const problems: string[] = []
const seen = new Set<string>()
for (const { name } of hooks) {
    if (seen.has(name)) problems.push(`${name} is listed twice`)
    seen.add(name)
    if (!new RegExp(String.raw`var\(\s*${name}\s*,`).test(sheets)) problems.push(`${name} is listed as a theme hook but no rule reads it with a fallback`)
    if (new RegExp(String.raw`(?:^|[;{\s])${name}\s*:`).test(sheets)) problems.push(`${name} is declared by a Grammar stylesheet: a theme hook is the app's to set, never declared on the grammar root`)
}
if (problems.length > 0) {
    console.error(problems.join("\n"))
    process.exit(1)
}
console.log(`theme hooks: ${hooks.length} hooks, each read with its fallback and declared by no stylesheet`)
