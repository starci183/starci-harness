import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { parse } from "yaml"
import { runtimeRoot } from "../../harness/ledger.js"

/** One finding of a knowledge gate: what is wrong, where. */
export interface KnowledgeFinding {
    readonly kind: "rule-no-doc" | "removed-vocabulary-used" | "wrapper-stale" | "wrapper-undeclared" | "wrapper-wraps-drift" | "wrapper-pin-drift" | "wrapper-ruling-unknown"
    readonly subject: string
    readonly detail: string
}

const read = (file: string): string => readFileSync(file, "utf8").replaceAll("\r\n", "\n")
const object = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {})
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const text = (value: unknown): string => (typeof value === "string" ? value : "")

const walk = (dir: string, accept: (name: string) => boolean, skip: (path: string) => boolean = () => false, into: string[] = []): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (skip(path)) continue
        if (entry.isDirectory()) walk(path, accept, skip, into)
        else if (accept(entry.name)) into.push(path)
    }
    return into
}

/** The knowledge that states what is true now. Decisions are history (they say what was removed, and why) and `project/` is generated. */
const livingKnowledge = (knowledge: string): string[] =>
    walk(knowledge, (name) => /\.(?:md|yaml)$/.test(name), (path) => /[\\/](?:decisions|project)$/.test(path) || /search-eval\.json$/.test(path))

/**
 * R-doc: every rule of hfs/rules.yaml has a doc, a page of the living knowledge that names it by id. A rule nobody explains is a
 * rule an agent cannot look up (contexts/README.md "Looking a rule up"). hfs/rules.yaml, decisions and the generated project/
 * folder do not count.
 */
export const judgeRuleDocs = (knowledge: string): KnowledgeFinding[] => {
    const catalog = object(parse(read(join(knowledge, "hfs", "rules.yaml"))))
    const ids = list(catalog["rules"]).map((rule) => text(object(rule)["id"])).filter((id) => id !== "")
    const pages = livingKnowledge(knowledge).filter((path) => path.endsWith(".md")).map(read)
    const named = new Set<string>()
    for (const page of pages) for (const match of page.matchAll(/\bR\d{2,3}\b/g)) named.add(match[0])
    return ids.filter((id) => !named.has(id)).map((id) => ({ kind: "rule-no-doc" as const, subject: id, detail: `${id} is in hfs/rules.yaml and no page of the living knowledge names it: add it where its law is taught (contexts/code/<side>/*.md or contexts/ui/...)` }))
}

const code = (token: string): RegExp => new RegExp("(?:`" + token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "`|<" + token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[ >/])")

/**
 * rulings.yaml `removedVocabulary`: a spelling it lists is not written, as code (in backticks or as a JSX tag), in the living
 * knowledge. Only a spelling that is one identifier can be matched without reading prose; a phrase ("StatusDot with text",
 * "Text weight") names a form, not a token, and is left to the codemods and lints that refuse it in code.
 */
export const judgeRemovedVocabulary = (knowledge: string): KnowledgeFinding[] => {
    const rulings = object(parse(read(join(knowledge, "decisions", "rulings.yaml"))))
    const spellings = list(rulings["removedVocabulary"]).map((entry) => text(object(entry)["spelling"])).filter((spelling) => /^[A-Za-z][\w.@/-]*$/.test(spelling) && /[A-Z]/.test(spelling))
    const found: KnowledgeFinding[] = []
    for (const path of livingKnowledge(knowledge)) {
        const lines = read(path).split("\n")
        for (const spelling of spellings) {
            const pattern = code(spelling)
            lines.forEach((line, index) => {
                if (pattern.test(line)) found.push({ kind: "removed-vocabulary-used", subject: spelling, detail: `${relative(knowledge, path).replaceAll("\\", "/")}:${String(index + 1)} writes the removed ${spelling}; rulings.yaml removedVocabulary names what replaces it` })
            })
        }
    }
    return found
}

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex")

/** The capitalised names a file imports as values from `@heroui/react`: the vendor components it wraps. */
const heroNames = (source: string): Set<string> => {
    const names = new Set<string>()
    for (const match of source.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']@heroui\/react["']/g)) {
        if (match[1] !== undefined) continue
        for (const part of (match[2] ?? "").split(",")) {
            const token = part.trim()
            if (token === "" || token.startsWith("type ")) continue
            const name = (token.split(/\s+as\s+/)[0] ?? "").trim()
            if (/^[A-Z][a-z]/.test(name)) names.add(name)
        }
    }
    return names
}

/**
 * vendor/wrappers.yaml against the Grammar source it describes (the part of the parity gate that needs no vendor cache):
 *   - every row's file exists and still imports a HeroUI component (else the row is stale; a row with `wraps: []` is a role override on a file that wraps nothing and stands while the file exists);
 *   - every Grammar file that imports a HeroUI component has a row, and the row's `wraps` is the set it imports;
 *   - every override names a ruling of rulings.yaml;
 *   - the sha256 of wrappers.yaml equals the digest the latest ruling that pins it records.
 * What it does not read: the vendor reference cache the role, anatomy, slot, style and default findings need
 * (packages/hfs scripts/lib/grammar-vendor-parity.mts `parityFindings`), which a run of the vendor reader produces.
 */
export const judgeVendorWrappers = (knowledge: string, grammarSource: string): KnowledgeFinding[] => {
    const file = join(knowledge, "vendor", "wrappers.yaml")
    if (!existsSync(file) || !existsSync(grammarSource)) return []
    const raw = read(file)
    const rows = list(object(parse(raw))["wrappers"]).map(object)
    const rulings = list(object(parse(read(join(knowledge, "decisions", "rulings.yaml"))))["rulings"]).map(object)
    const found: KnowledgeFinding[] = []
    const imported = new Map<string, Set<string>>()
    for (const path of walk(grammarSource, (name) => /\.tsx?$/.test(name) && !/\.(?:stories|spec)\./.test(name))) {
        const names = heroNames(read(path))
        if (names.size > 0) imported.set(relative(grammarSource, path).replaceAll("\\", "/"), names)
    }
    const declared = new Set<string>()
    for (const row of rows) {
        const rowFile = text(row["file"])
        declared.add(rowFile)
        const actual = imported.get(rowFile)
        const wrapsNothing = list(row["wraps"]).length === 0
        if (actual === undefined && wrapsNothing && existsSync(join(grammarSource, rowFile))) continue
        if (actual === undefined) {
            found.push({ kind: "wrapper-stale", subject: rowFile, detail: `${rowFile} is a row of vendor/wrappers.yaml and ${existsSync(join(grammarSource, rowFile)) ? "imports no HeroUI component" : "does not exist"}: remove the row` })
            continue
        }
        const wraps = new Set(list(row["wraps"]).map(text))
        const missing = [...actual].filter((name) => !wraps.has(name))
        const extra = [...wraps].filter((name) => !actual.has(name))
        if (missing.length > 0 || extra.length > 0) {
            found.push({ kind: "wrapper-wraps-drift", subject: rowFile, detail: `${rowFile} wraps ${[...actual].sort().join(", ")}; the row says ${[...wraps].sort().join(", ")}` })
        }
        for (const override of list(row["overrides"]).map(object)) {
            const ruling = text(override["ruling"])
            if (!rulings.some((entry) => text(entry["id"]) === ruling)) found.push({ kind: "wrapper-ruling-unknown", subject: rowFile, detail: `an override of ${rowFile} cites ruling ${ruling}, which rulings.yaml does not hold` })
        }
    }
    for (const [path, names] of imported) {
        if (!declared.has(path)) found.push({ kind: "wrapper-undeclared", subject: path, detail: `${path} imports ${[...names].sort().join(", ")} from @heroui/react and has no row in vendor/wrappers.yaml` })
    }
    const pins = rulings.flatMap((ruling) => {
        const pinned = object(ruling["pins"])["contexts/vendor/wrappers.yaml"]
        return typeof pinned === "string" ? [{ id: text(ruling["id"]), digest: pinned }] : []
    })
    const live = pins.at(-1)
    if (live === undefined) found.push({ kind: "wrapper-pin-drift", subject: "contexts/vendor/wrappers.yaml", detail: "no ruling of rulings.yaml pins the digest of vendor/wrappers.yaml" })
    else if (live.digest !== sha256(raw)) found.push({ kind: "wrapper-pin-drift", subject: "contexts/vendor/wrappers.yaml", detail: `vendor/wrappers.yaml hashes to ${sha256(raw)}; ruling ${live.id} pins ${live.digest}: record the new digest in the ruling that owns the change` })
    return found
}

/** The Grammar source the wrappers describe. */
export const grammarSourceDir = (): string => join(runtimeRoot(), "packages", "grammar", "src")
