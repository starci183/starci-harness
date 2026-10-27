import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"
import { COMPONENT_PAGES } from "./cite-anchors.js"

/**
 * Which Grammar component families a change uses, kept deliberately simple:
 *
 * 1. A family is a page `contexts/ui/components/<family>.md`. Its names are the page name, the grammar contract entry its
 *    `Contract:` line links (`contract.md#<entry>`), and that entry's `vendorParity` parts in contexts/grammars/contract.yaml,
 *    each compared lower case with everything but letters and digits dropped (`tag-group` and `TagGroup` are one name).
 * 2. A changed source file uses a family when it imports a name of it from `@starci/grammar` or a subpath
 *    (`import { Tabs, type TabsProps } from "@starci/grammar/core"`): the imported name, before any `as`, type-only names skipped.
 * 3. A name the page or contract entry of a family is named by belongs to that family alone (`Button` is button, though the
 *    empty-state entry renders one); a vendor part several families share (`ListBox`) belongs to each, and citing a Choose
 *    anchor of any one of them answers for it. A name of no family (`Text`, `Stack`) asks for nothing.
 */
export interface FamilyUse {
    /** The imported name as written. */
    readonly name: string
    /** The file importing it. */
    readonly file: string
    /** The families whose Choose anchor answers for it. */
    readonly families: readonly string[]
}

/** The package whose imports name Grammar components. */
export const GRAMMAR_PACKAGE = "@starci/grammar"

/** The source files the import scan reads. */
export const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/

const CONTRACT_YAML = "contexts/grammars/contract.yaml"

const normal = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, "")

interface Family {
    readonly family: string
    /** The page name and its contract entry: a name of these belongs to this family alone. */
    readonly own: ReadonlySet<string>
    /** The vendor parts of its contract entry. */
    readonly parts: ReadonlySet<string>
}

/** The contract entries of contract.yaml: every object with an `id` and a `vendorParity` list, wherever it sits. */
const contractEntries = (value: unknown, into = new Map<string, string[]>()): Map<string, string[]> => {
    if (Array.isArray(value)) for (const item of value) contractEntries(item, into)
    else if (typeof value === "object" && value !== null) {
        const record = value as Record<string, unknown>
        if (typeof record.id === "string" && Array.isArray(record.vendorParity)) into.set(normal(record.id), record.vendorParity.filter((part): part is string => typeof part === "string").map(normal))
        for (const item of Object.values(record)) contractEntries(item, into)
    }
    return into
}

const familiesCache = new Map<string, readonly Family[]>()

/** The component families of the harness checkout at `root` (rule 1). */
const familiesOf = (root: string): readonly Family[] => {
    const known = familiesCache.get(root)
    if (known !== undefined) return known
    const dir = join(root, COMPONENT_PAGES)
    const contractFile = join(root, CONTRACT_YAML)
    const entries = existsSync(contractFile) ? contractEntries(parse(readFileSync(contractFile, "utf8"))) : new Map<string, string[]>()
    const pages = existsSync(dir) ? readdirSync(dir).filter((name) => /^[a-z0-9-]+\.md$/.test(name)) : []
    const families = pages.map((page): Family => {
        const family = page.slice(0, -".md".length)
        const entry = /contract\.md#([A-Za-z0-9-]+)/.exec(readFileSync(join(dir, page), "utf8"))?.[1]
        const id = entry === undefined ? undefined : normal(entry)
        return { family, own: new Set([normal(family), ...(id === undefined ? [] : [id])]), parts: new Set(id === undefined ? [] : (entries.get(id) ?? [])) }
    })
    familiesCache.set(root, families)
    return families
}

/** The families an imported name belongs to (rule 3). */
const familiesNamed = (name: string, families: readonly Family[]): string[] => {
    const key = normal(name)
    const owners = families.filter((family) => family.own.has(key))
    return (owners.length > 0 ? owners : families.filter((family) => family.parts.has(key))).map((family) => family.family)
}

// Group 1 marks a type-only import (`import type { ... }`), which uses no component; group 2 is the braced list.
const IMPORT = new RegExp(String.raw`import\s+(type\s+)?\{([^}]*)\}\s*from\s*["']${GRAMMAR_PACKAGE.replace("/", String.raw`\/`)}(?:\/[^"']*)?["']`, "g")

/** The names a source imports from the Grammar package (rule 2). */
export const grammarImports = (source: string): string[] =>
    [...source.matchAll(IMPORT)].flatMap((found) =>
        (found[1] === undefined ? (found[2] ?? "") : "")
            .split(",")
            .map((item) => item.trim())
            .filter((item) => item !== "" && !item.startsWith("type "))
            .map((item) => item.split(/\s+as\s+/)[0]?.trim() ?? ""),
    )

/** Every family use of the given sources, against the families of the harness checkout at `root`. */
export const familyUses = (root: string, sources: readonly { readonly file: string; readonly text: string }[]): FamilyUse[] => {
    const families = familiesOf(root)
    return sources.flatMap(({ file, text }) =>
        grammarImports(text).flatMap((name) => {
            const named = familiesNamed(name, families)
            return named.length === 0 ? [] : [{ name, file, families: named }]
        }),
    )
}
