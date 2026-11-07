import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Contract check (app-added tones): no Core or Common rule reads a tone token that is not HeroUI's. A tone x has
 * four tokens, `--x`, `--x-foreground`, `--x-soft`, `--x-soft-foreground`; Core and Common may read them for HeroUI's tones only (accent,
 * default, success, warning, danger) and for the one optional app alias `--informative*`. Any other tone name (for instance `--info`) is an
 * app's to declare: it reaches the Grammar only through `customToneProps`, as `--grammar-tone*`. Offset Pop and the other families are free
 * to choose their own palette and are not scanned.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src")
const BUILT_IN = new Set(["accent", "default", "success", "warning", "danger", "informative", "surface", "background", "overlay", "field", "segment", "scrollbar", "grammar", "starci", "terminal"])
const SUFFIXED = /var\(\s*--([a-z]+)-(?:soft-foreground|soft-hover|soft|foreground)\b/g
const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
        const path = resolve(dir, name)
        if (statSync(path).isDirectory()) return name === "stories" ? [] : walk(path)
        return /\.(css|ts|tsx)$/.test(name) && !name.endsWith(".d.ts") ? [path] : []
    })
const problems: string[] = []
let checked = 0
for (const dir of ["common", "core"]) {
    for (const file of walk(resolve(root, dir))) {
        checked += 1
        const text = readFileSync(file, "utf8")
        const seen = new Set<string>()
        for (const match of text.matchAll(SUFFIXED)) seen.add(match[1] ?? "")
        // A bare `var(--info)` is the tone itself; flag the known non-HeroUI tone names that appear bare too.
        for (const match of text.matchAll(/var\(\s*--(info|brand|primary|secondary|tertiary|neutral|highlight)\b/g)) seen.add(match[1] ?? "")
        for (const name of seen) {
            if (!BUILT_IN.has(name)) problems.push(`${relative(root, file).replaceAll("\\", "/")}: reads --${name}*, a tone HeroUI does not define (an app declares it in GrammarToneRegistry; Core reads it only through --grammar-tone*)`)
        }
    }
}
if (problems.length > 0) {
    console.error(problems.join("\n"))
    process.exit(1)
}
console.log(`tone tokens: ${checked} modules, no Core or Common rule reads a tone token outside HeroUI's palette and --informative*`)
