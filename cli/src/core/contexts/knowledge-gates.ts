import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { parse } from "yaml"
import { runtimeRoot } from "../../harness/ledger.js"
import { ruleBookIds } from "../../harness/rule-book.js"

/** One finding of a knowledge gate: what is wrong, where. */
export interface KnowledgeFinding {
    readonly kind: "rule-no-doc" | "removed-vocabulary-used" | "wrapper-stale" | "wrapper-undeclared" | "wrapper-wraps-drift" | "wrapper-pin-drift" | "wrapper-rule-unknown"
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

/** The knowledge that states what is true now; `project/` is generated. */
const livingKnowledge = (knowledge: string): string[] =>
    walk(knowledge, (name) => /\.(?:md|yaml)$/.test(name), (path) => /[\\/]project$/.test(path) || path.endsWith("search-eval.json"))

/**
 * R-doc: every rule of hfs/rules.yaml has a doc, a page of the living knowledge that names it by id. A rule nobody explains is a
 * rule an agent cannot look up (contexts/README.md "Looking a rule up"). hfs/rules.yaml and the generated project/ folder do
 * not count.
 */
export const judgeRuleDocs = (knowledge: string): KnowledgeFinding[] => {
    const catalog = object(parse(read(join(knowledge, "hfs", "rules.yaml"))))
    const ids = list(catalog.rules).map((rule) => text(object(rule).id)).filter((id) => id !== "")
    const pages = livingKnowledge(knowledge).filter((path) => path.endsWith(".md")).map(read)
    const named = new Set<string>()
    for (const page of pages) for (const match of page.matchAll(/\bR\d{2,3}\b/g)) named.add(match[0])
    return ids.filter((id) => !named.has(id)).map((id) => ({ kind: "rule-no-doc" as const, subject: id, detail: `${id} is in hfs/rules.yaml and no page of the living knowledge names it: add it where its law is taught (contexts/code/<side>/*.md or contexts/ui/...)` }))
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)

const code = (token: string): RegExp => new RegExp("(?:`" + escapeRegExp(token) + "`|<" + escapeRegExp(token) + "[ >/])")

/** The removed spellings: packages/hfs/runtime/modules/kernel/removed-vocabulary.yaml, the one list of names the runtime refuses. */
const REMOVED_VOCABULARY = ["packages", "hfs", "runtime", "modules", "kernel", "removed-vocabulary.yaml"] as const

/** The `grammar` entries of the removed vocabulary that are one identifier; `shipped` when the runtime may not write them either. */
const removedGrammarNames = (knowledge: string): { readonly name: string; readonly shipped: boolean }[] => {
    const file = join(knowledge, "..", ...REMOVED_VOCABULARY)
    if (!existsSync(file)) return []
    return list(object(parse(read(file))).removed)
        .map(object)
        .filter((entry) => entry.kind === "grammar")
        .map((entry) => ({ name: text(entry.name), shipped: entry.shipped === true }))
        .filter((entry) => /^[A-Za-z][\w.@/-]*$/.test(entry.name) && /[A-Z]/.test(entry.name))
}

const removedDetail = (where: string, spelling: string): string => `${where} writes the removed ${spelling}; modules/kernel/removed-vocabulary.yaml of @starci/hfs names what replaces it`

/**
 * The removed Grammar names (kind `grammar` of the removed vocabulary): a spelling it lists is not written, as code (in backticks
 * or as a JSX tag), in the living knowledge. Only a spelling that is one identifier can be matched without reading prose; a
 * phrase ("StatusDot with text", "Text weight") names a form, not a token, and is left to the codemods and lints that refuse it in code.
 */
export const judgeRemovedVocabulary = (knowledge: string): KnowledgeFinding[] => {
    const spellings = removedGrammarNames(knowledge).map((entry) => entry.name)
    const found: KnowledgeFinding[] = []
    for (const path of livingKnowledge(knowledge)) {
        const lines = read(path).split("\n")
        for (const spelling of spellings) {
            const pattern = code(spelling)
            lines.forEach((line, index) => {
                if (pattern.test(line)) found.push({ kind: "removed-vocabulary-used", subject: spelling, detail: removedDetail(`${relative(knowledge, path).replaceAll("\\", "/")}:${String(index + 1)}`, spelling) })
            })
        }
    }
    return found
}

/**
 * The removed Grammar names marked `shipped: true` against what the harness ships: `packages/hfs/runtime` (the playbooks, the rule catalog, the failure codes and the
 * draw scripts the eslint packages bundle), the removed vocabulary itself aside. It is data an agent loads, so a spelling is a
 * finding wherever it stands as a whole word, not only in code marks.
 */
export const judgeShippedVocabulary = (knowledge: string): KnowledgeFinding[] => {
    const runtime = join(knowledge, "..", "packages", "hfs", "runtime")
    if (!existsSync(runtime)) return []
    const spellings = removedGrammarNames(knowledge).filter((entry) => entry.shipped).map((entry) => entry.name)
    const removedList = join(knowledge, "..", ...REMOVED_VOCABULARY)
    const found: KnowledgeFinding[] = []
    for (const path of walk(runtime, (name) => /\.(?:md|yaml|json|mts|ts)$/.test(name), (path) => path === removedList)) {
        const lines = read(path).split("\n")
        for (const spelling of spellings) {
            const pattern = new RegExp(String.raw`(?<![\w.-])` + escapeRegExp(spelling) + String.raw`(?![\w-])`)
            lines.forEach((line, index) => {
                if (pattern.test(line)) found.push({ kind: "removed-vocabulary-used", subject: spelling, detail: removedDetail(`${relative(knowledge, path).replaceAll("\\", "/")}:${String(index + 1)}`, spelling) })
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
            const name = (token.split(/\s/)[0] ?? "").trim()
            if (/^[A-Z][a-z]/.test(name)) names.add(name)
        }
    }
    return names
}

/** Adds a finding for each override of a wrapper row that gives no reason, or cites a rule the rule book does not hold. */
const judgeOverrides = (row: Record<string, unknown>, rowFile: string, rules: ReadonlySet<string>, found: KnowledgeFinding[]): void => {
    for (const override of list(row.overrides).map(object)) {
        const target = text(override.target)
        if ("ruling" in override) found.push({ kind: "wrapper-rule-unknown", subject: rowFile, detail: `the ${target} override of ${rowFile} writes the removed ruling: key; it gives its reason and cites the rule it applies with rule: <rule id>` })
        if (text(override.reason).trim() === "") found.push({ kind: "wrapper-rule-unknown", subject: rowFile, detail: `the ${target} override of ${rowFile} gives no reason` })
        const rule = text(override.rule)
        if (rule !== "" && !rules.has(rule)) found.push({ kind: "wrapper-rule-unknown", subject: rowFile, detail: `the ${target} override of ${rowFile} cites rule ${rule}, which no file of contexts/ or CONTRIBUTING.md holds` })
    }
}

/** Judges each row of vendor/wrappers.yaml against the HeroUI components its Grammar file imports; the files the rows name. */
const judgeWrapperRows = (rows: readonly Record<string, unknown>[], imported: ReadonlyMap<string, Set<string>>, grammarSource: string, rules: ReadonlySet<string>, found: KnowledgeFinding[]): Set<string> => {
    const declared = new Set<string>()
    for (const row of rows) {
        const rowFile = text(row.file)
        declared.add(rowFile)
        const actual = imported.get(rowFile)
        const wrapsNothing = list(row.wraps).length === 0
        if (actual === undefined && wrapsNothing && existsSync(join(grammarSource, rowFile))) continue
        if (actual === undefined) {
            found.push({ kind: "wrapper-stale", subject: rowFile, detail: `${rowFile} is a row of vendor/wrappers.yaml and ${existsSync(join(grammarSource, rowFile)) ? "imports no HeroUI component" : "does not exist"}: remove the row` })
            continue
        }
        const wraps = new Set(list(row.wraps).map(text))
        const missing = [...actual].filter((name) => !wraps.has(name))
        const extra = [...wraps].filter((name) => !actual.has(name))
        if (missing.length > 0 || extra.length > 0) {
            found.push({ kind: "wrapper-wraps-drift", subject: rowFile, detail: `${rowFile} wraps ${[...actual].sort((left, right) => left.localeCompare(right)).join(", ")}; the row says ${[...wraps].sort((left, right) => left.localeCompare(right)).join(", ")}` })
        }
        judgeOverrides(row, rowFile, rules, found)
    }
    return declared
}

/**
 * vendor/wrappers.yaml against the Grammar source it describes (the part of the parity gate that needs no vendor cache):
 *   - every row's file exists and still imports a HeroUI component (else the row is stale; a row with `wraps: []` is a role override on a file that wraps nothing and stands while the file exists);
 *   - every Grammar file that imports a HeroUI component has a row, and the row's `wraps` is the set it imports;
 *   - every override gives its reason, and a rule it cites is a rule id of contexts/ or CONTRIBUTING.md;
 *   - the sha256 of wrappers.yaml equals the digest vendor/pins.yaml records.
 * What it does not read: the vendor reference cache the role, anatomy, slot, style and default findings need
 * (packages/hfs scripts/lib/grammar-vendor-parity.mts `parityFindings`), which a run of the vendor reader produces.
 */
export const judgeVendorWrappers = (knowledge: string, grammarSource: string): KnowledgeFinding[] => {
    const file = join(knowledge, "vendor", "wrappers.yaml")
    if (!existsSync(file) || !existsSync(grammarSource)) return []
    const raw = read(file)
    const rows = list(object(parse(raw)).wrappers).map(object)
    const found: KnowledgeFinding[] = []
    const imported = new Map<string, Set<string>>()
    for (const path of walk(grammarSource, (name) => /\.tsx?$/.test(name) && !/\.(?:stories|spec)\./.test(name))) {
        const names = heroNames(read(path))
        if (names.size > 0) imported.set(relative(grammarSource, path).replaceAll("\\", "/"), names)
    }
    const declared = judgeWrapperRows(rows, imported, grammarSource, ruleBookIds(join(knowledge, "..")), found)
    for (const [path, names] of imported) {
        if (!declared.has(path)) found.push({ kind: "wrapper-undeclared", subject: path, detail: `${path} imports ${[...names].sort((left, right) => left.localeCompare(right)).join(", ")} from @heroui/react and has no row in vendor/wrappers.yaml` })
    }
    const pinsFile = join(knowledge, "vendor", "pins.yaml")
    const pinned = existsSync(pinsFile) ? object(object(parse(read(pinsFile))).pins)["wrappers.yaml"] : undefined
    if (typeof pinned !== "string") found.push({ kind: "wrapper-pin-drift", subject: "contexts/vendor/wrappers.yaml", detail: "vendor/pins.yaml records no digest of wrappers.yaml" })
    else if (pinned !== sha256(raw)) found.push({ kind: "wrapper-pin-drift", subject: "contexts/vendor/wrappers.yaml", detail: `vendor/wrappers.yaml hashes to ${sha256(raw)}; vendor/pins.yaml records ${pinned}: record the new digest there in the commit that changes the file` })
    return found
}

/** The Grammar source the wrappers describe. */
export const grammarSourceDir = (): string => join(runtimeRoot(), "packages", "grammar", "src")
