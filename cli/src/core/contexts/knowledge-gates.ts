import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"

/** One finding of a knowledge gate: what is wrong, where. */
export interface KnowledgeFinding {
    readonly kind: "rule-no-doc"
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

/** The generated pages: the contexts index, the anatomy and its slices, the section indexes. */
const GENERATED_PAGE = /^(?:index|anatomy(?:-[a-z]+-[a-z]+)?)\.md$|-sections\.md$/

/** The knowledge that states what is true now: every page but the generated ones. */
const livingKnowledge = (knowledge: string): string[] => walk(knowledge, (name) => /\.(?:md|yaml)$/.test(name) && !GENERATED_PAGE.test(name))

/**
 * R-doc: every rule of hfs/rules.yaml has a doc, a page of the living knowledge that names it by id. A rule nobody explains is a
 * rule an agent cannot look up (contexts/README.md "Looking a rule up"). hfs/rules.yaml and the generated pages do not count.
 */
export const judgeRuleDocs = (knowledge: string): KnowledgeFinding[] => {
    const catalog = object(parse(read(join(knowledge, "hfs", "rules.yaml"))))
    const ids = list(catalog.rules).map((rule) => text(object(rule).id)).filter((id) => id !== "")
    const pages = livingKnowledge(knowledge).filter((path) => path.endsWith(".md")).map(read)
    const named = new Set<string>()
    for (const page of pages) for (const match of page.matchAll(/\bR\d{2,3}\b/g)) named.add(match[0])
    return ids.filter((id) => !named.has(id)).map((id) => ({ kind: "rule-no-doc" as const, subject: id, detail: `${id} is in hfs/rules.yaml and no page of the living knowledge names it: add it where its law is taught (contexts/code/<side>/*.md or contexts/ui/...)` }))
}
